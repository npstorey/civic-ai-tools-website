'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import BpmnViewerComponent, { type BpmnViewerHandle } from './BpmnViewer';
import TraceControls, { type DiagramMode } from './TraceControls';
import NarrativePanel from './NarrativePanel';
import LiveResponsePanel from './LiveResponsePanel';
import DiagramAnnotations from './DiagramAnnotations';
import { TRACES, getTraceById } from '@/lib/bpmn/traces';
import type { PreRecordedTrace } from '@/lib/bpmn/traces';
import { useTraceReplay } from '@/hooks/useTraceReplay';
import { useLiveTrace } from '@/hooks/useLiveTrace';
import type { ReplayState } from '@/lib/bpmn/animation';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const DEFAULT_PORTAL = 'data.cityofnewyork.us';

export default function McpFlowDiagram() {
  const [mode, setMode] = useState<DiagramMode>('examples');
  const [selectedTraceId, setSelectedTraceId] = useState(TRACES[0].id);
  const [viewerReady, setViewerReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [isReplayingCapture, setIsReplayingCapture] = useState(false);
  const [liveReplayTrace, setLiveReplayTrace] = useState<PreRecordedTrace | null>(null);
  const viewerRef = useRef<BpmnViewerHandle>(null);

  // Example trace replay
  const exampleTrace = getTraceById(selectedTraceId) ?? null;
  const activeReplayTrace = mode === 'live' && isReplayingCapture ? liveReplayTrace : exampleTrace;
  const { state: replayState, speed, play, pause, reset, setSpeed } = useTraceReplay(activeReplayTrace);

  // Live trace
  const liveTrace = useLiveTrace();

  // Derive which state drives the viewer
  let activeState: ReplayState;
  if (mode === 'examples') {
    activeState = replayState;
  } else if (isReplayingCapture) {
    activeState = replayState;
  } else if (liveTrace.status === 'running' || liveTrace.status === 'complete') {
    activeState = liveTrace.state;
  } else {
    activeState = replayState;
  }

  const handleViewerReady = useCallback(() => {
    setViewerReady(true);
  }, []);

  const handleSelectTrace = useCallback((id: string) => {
    reset();
    viewerRef.current?.resetAll();
    setSelectedTraceId(id);
  }, [reset]);

  const handlePlay = useCallback(() => {
    if (replayState.isComplete) {
      reset();
      viewerRef.current?.resetAll();
      setTimeout(() => play(), 50);
    } else {
      if (!hasPlayedOnce && !isFullscreen) {
        setIsFullscreen(true);
        setHasPlayedOnce(true);
        setTimeout(() => play(), 400);
        return;
      }
      play();
    }
  }, [play, reset, replayState.isComplete, hasPlayedOnce, isFullscreen]);

  const handlePause = useCallback(() => {
    pause();
  }, [pause]);

  const handleReset = useCallback(() => {
    reset();
    viewerRef.current?.resetAll();
  }, [reset]);

  const handleModeChange = useCallback((newMode: DiagramMode) => {
    // Reset everything when switching modes
    reset();
    viewerRef.current?.resetAll();
    setIsReplayingCapture(false);
    setLiveReplayTrace(null);
    if (newMode === 'examples') {
      liveTrace.reset();
    }
    setMode(newMode);
  }, [reset, liveTrace]);

  const handleLiveStart = useCallback((query: string) => {
    setIsReplayingCapture(false);
    setLiveReplayTrace(null);
    reset();
    viewerRef.current?.resetAll();
    // Auto-enter fullscreen on first live query
    if (!isFullscreen) {
      setIsFullscreen(true);
      setHasPlayedOnce(true);
      setTimeout(() => {
        liveTrace.start(query, DEFAULT_MODEL, DEFAULT_PORTAL);
      }, 400);
    } else {
      liveTrace.start(query, DEFAULT_MODEL, DEFAULT_PORTAL);
    }
  }, [reset, liveTrace, isFullscreen]);

  const handleLiveCancel = useCallback(() => {
    liveTrace.cancel();
    viewerRef.current?.resetAll();
  }, [liveTrace]);

  const handleLiveReplay = useCallback(() => {
    if (!liveTrace.capturedTrace) return;
    setLiveReplayTrace(liveTrace.capturedTrace);
    setIsReplayingCapture(true);
    // The useTraceReplay hook will reset when liveReplayTrace changes (via activeReplayTrace).
    // We need to wait a tick then play.
    viewerRef.current?.resetAll();
    setTimeout(() => play(), 100);
  }, [liveTrace.capturedTrace, play]);

  const handleLiveReset = useCallback(() => {
    liveTrace.reset();
    setIsReplayingCapture(false);
    setLiveReplayTrace(null);
    reset();
    viewerRef.current?.resetAll();
  }, [liveTrace, reset]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // ESC exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsFullscreen(false);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFullscreen]);

  // Re-fit diagram when fullscreen toggles
  useEffect(() => {
    if (viewerReady) {
      const t = setTimeout(() => viewerRef.current?.fitToView(), 150);
      return () => clearTimeout(t);
    }
  }, [isFullscreen, viewerReady]);

  // Sync active state to bpmn-js viewer
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const viewer = viewerRef.current;

    viewer.resetAll();

    for (const nodeId of activeState.completedNodes) {
      viewer.completeNode(nodeId);
    }
    for (const nodeId of activeState.activeNodes) {
      viewer.activateNode(nodeId);
    }
    for (const edgeId of activeState.activeEdges) {
      viewer.activateEdge(edgeId);
    }
    for (const [edgeId, marker] of activeState.markedEdges) {
      viewer.highlightEdge(edgeId, marker);
    }

    viewer.clearOverlays();
    if (activeState.currentOverlay) {
      const o = activeState.currentOverlay;
      let html = '';
      switch (o.type) {
        case 'soql':
          html = `<pre class="soql-preview">${escapeHtml(o.content)}</pre>`;
          break;
        case 'result':
          html = `<span class="result-text">${escapeHtml(o.content)}</span>`;
          break;
        case 'iteration':
          html = `<span class="iteration-badge">${activeState.currentIteration}</span><br/><span class="info-text">${escapeHtml(o.content)}</span>`;
          break;
        case 'info':
          html = `<span class="info-text">${escapeHtml(o.content)}</span>`;
          break;
      }
      viewer.showOverlay(o.nodeId, html);
    }
  }, [
    viewerReady,
    activeState.activeNodes,
    activeState.completedNodes,
    activeState.activeEdges,
    activeState.markedEdges,
    activeState.currentOverlay,
    activeState.currentIteration,
  ]);

  const content = (
    <>
      <div style={{ flexShrink: 0 }}>
        <TraceControls
          traces={TRACES}
          selectedTraceId={selectedTraceId}
          onSelectTrace={handleSelectTrace}
          replayState={replayState}
          speed={speed}
          onPlay={handlePlay}
          onPause={handlePause}
          onReset={handleReset}
          onSetSpeed={setSpeed}
          mode={mode}
          onModeChange={handleModeChange}
          liveStatus={liveTrace.status}
          liveError={liveTrace.error}
          liveElapsedMs={liveTrace.elapsedMs}
          liveSlowMessage={liveTrace.slowMessage}
          onLiveStart={handleLiveStart}
          onLiveCancel={handleLiveCancel}
          onLiveReplay={handleLiveReplay}
          onLiveReset={handleLiveReset}
          isReplayingCapture={isReplayingCapture}
        />
      </div>

      <div style={{ position: 'relative', flex: isFullscreen ? 1 : undefined, minHeight: isFullscreen ? 0 : undefined }}>
        <BpmnViewerComponent
          ref={viewerRef}
          onReady={handleViewerReady}
          isFullscreen={isFullscreen}
        />

        {/* Fullscreen toggle */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen view'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          style={{
            position: 'absolute',
            top: '12px',
            right: isFullscreen ? '12px' : '160px',
            width: '32px',
            height: '32px',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            background: 'white',
            color: 'var(--text-secondary)',
            fontSize: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 6,
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
          }}
        >
          {isFullscreen ? '\u2715' : '\u26F6'}
        </button>
      </div>

      <div style={{ flexShrink: 0 }}>
        <NarrativePanel replayState={activeState} />
      </div>

      {/* Live response panel (below narrative, only in live mode) */}
      {mode === 'live' && (liveTrace.status === 'running' || liveTrace.status === 'complete') && !isReplayingCapture && (
        <div style={{ flexShrink: 0 }}>
          <LiveResponsePanel
            content={liveTrace.responseContent}
            elapsedMs={liveTrace.elapsedMs}
            iterationCount={liveTrace.currentIteration}
            isComplete={liveTrace.status === 'complete'}
          />
        </div>
      )}
    </>
  );

  if (isFullscreen) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100dvh',
          zIndex: 1000,
          background: 'white',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 24px',
          overflow: 'hidden',
          animation: 'bpmn-fullscreen-in 300ms ease-out',
        }}
      >
        {content}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {content}

      <DiagramAnnotations replayState={activeState} />

      {/* Download link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '14px' }}>
        <a
          href="/bpmn/mcp-query-flow.bpmn"
          download
          style={{ color: 'var(--text-muted)', fontWeight: 400 }}
        >
          Download BPMN file
        </a>
      </div>

      {/* Understanding this diagram */}
      <details
        style={{
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
        }}
      >
        <summary
          style={{
            padding: '12px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--text-secondary)',
          }}
        >
          Understanding this diagram
        </summary>
        <div
          style={{
            padding: '0 16px 16px',
            fontSize: '13px',
            color: 'var(--text-muted)',
            lineHeight: '1.6',
          }}
        >
          <p style={{ margin: '0 0 8px 0' }}>
            This is a{' '}
            <a href="https://www.bpmn.org/" target="_blank" rel="noopener noreferrer">
              BPMN 2.0
            </a>{' '}
            (Business Process Model and Notation) diagram &mdash; a standard way to visualize workflows.
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <li><strong>Rounded rectangles</strong> = Tasks (actions performed by a participant)</li>
            <li><strong>Diamonds</strong> = Gateways (decision points)</li>
            <li><strong>Circles</strong> = Events (start/end of the process)</li>
            <li><strong>Dashed arrows</strong> = Messages crossing between participants</li>
            <li><strong>Solid arrows</strong> = Sequence flow within a participant</li>
            <li><strong>Horizontal bands</strong> = Swim lanes (each represents a different system)</li>
            <li><strong>Loop-back arrow</strong> = The AI can repeat the tool-call cycle multiple times</li>
          </ul>
          <p style={{ margin: '8px 0 0 0' }}>
            The downloaded .bpmn file can be opened in any BPMN-compatible tool
            (e.g., <a href="https://demo.bpmn.io/" target="_blank" rel="noopener noreferrer">bpmn.io</a>).
          </p>
        </div>
      </details>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
