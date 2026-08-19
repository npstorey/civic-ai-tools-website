'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import BpmnViewerComponent, { type BpmnViewerHandle } from './BpmnViewer';
import TraceControls, { type DiagramMode } from './TraceControls';
import LiveResponsePanel from './LiveResponsePanel';
import DiagramAnnotations from './DiagramAnnotations';
import { TRACES, getTraceById } from '@/lib/bpmn/traces';
import type { PreRecordedTrace } from '@/lib/bpmn/traces';
import { useTraceReplay } from '@/hooks/useTraceReplay';
import { useLiveTrace } from '@/hooks/useLiveTrace';
import type { ReplayState } from '@/lib/bpmn/animation';
import { traceEventsToProgressData } from '@/lib/bpmn/trace-progress';

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
  } else if (liveTrace.status === 'running' || liveTrace.status === 'complete' || liveTrace.status === 'cancelled') {
    activeState = liveTrace.state;
  } else {
    activeState = replayState;
  }

  // Side-by-side split when example replay or live query is active
  const exampleIsActive = mode === 'examples' && (
    replayState.isPlaying || replayState.isPaused || replayState.isComplete
  );
  const showSplit = exampleIsActive || (mode === 'live' && (
    liveTrace.status === 'running' || liveTrace.status === 'complete'
    || liveTrace.status === 'cancelled' || isReplayingCapture
  ));

  // Derive progress data from example trace events for the side panel
  const exampleProgressData = useMemo(() => {
    if (mode !== 'examples' || !exampleTrace) {
      return { progressLog: [], progressGroups: [], toolsCalled: [] };
    }
    return traceEventsToProgressData(
      exampleTrace.events,
      replayState.currentEventIndex,
      replayState.isComplete,
    );
  }, [mode, exampleTrace, replayState.currentEventIndex, replayState.isComplete]);

  const [suggestedQuery, setSuggestedQuery] = useState<string | undefined>(undefined);
  const [liveQueryText, setLiveQueryText] = useState<string>('');

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

  // Switch to live mode with an optional pre-filled query (used by "Try this query" CTA)
  const onModeChangeTo = useCallback((newMode: DiagramMode, prefillQuery?: string) => {
    reset();
    viewerRef.current?.resetAll();
    setIsReplayingCapture(false);
    setLiveReplayTrace(null);
    if (newMode === 'examples') {
      liveTrace.reset();
    }
    if (prefillQuery) {
      setSuggestedQuery(prefillQuery);
    }
    setMode(newMode);
  }, [reset, liveTrace]);

  const handleLiveStart = useCallback((query: string) => {
    setLiveQueryText(query);
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
    // Don't reset viewer — preserve diagram state on cancel
  }, [liveTrace]);

  const handleSuggestedQuery = useCallback((query: string) => {
    liveTrace.cancel();
    setSuggestedQuery(query);
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
      const t = setTimeout(() => viewerRef.current?.fitToView(), 350);
      return () => clearTimeout(t);
    }
  }, [isFullscreen, viewerReady]);

  // Re-fit diagram when split layout changes
  useEffect(() => {
    if (viewerReady) {
      const t = setTimeout(() => viewerRef.current?.fitToView(), 350);
      return () => clearTimeout(t);
    }
  }, [showSplit, viewerReady]);

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
          suggestedQuery={suggestedQuery}
          onSuggestedQuery={handleSuggestedQuery}
        />
      </div>

      {/* Split grid container: diagram (left) + response panel (right) */}
      <div
        className="bpmn-split-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: showSplit ? '55fr 45fr' : '1fr',
          gap: showSplit ? '16px' : '0',
          transition: 'grid-template-columns 300ms ease, gap 300ms ease',
          height: isFullscreen ? undefined : 'min(650px, 70dvh)',
          flex: isFullscreen ? 1 : undefined,
          minHeight: isFullscreen ? 0 : undefined,
        }}
      >
        {/* Left cell: diagram */}
        <div style={{ position: 'relative', overflow: 'hidden', minWidth: 0 }}>
          <BpmnViewerComponent
            ref={viewerRef}
            onReady={handleViewerReady}
            isFullscreen={isFullscreen}
          />

          {/* Enter fullscreen — only in non-fullscreen mode */}
          {!isFullscreen && (
            <button
              onClick={toggleFullscreen}
              title="Fullscreen view"
              aria-label="Enter fullscreen"
              style={{
                position: 'absolute',
                top: '12px',
                right: '160px',
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
              {'\u26F6'}
            </button>
          )}
        </div>

        {/* Right cell: response panel (both example and live modes) */}
        {showSplit && (
          <div style={{
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            background: 'white',
            minWidth: 0,
          }}>
            {exampleIsActive ? (
              <LiveResponsePanel
                content={replayState.isComplete ? (exampleTrace?.responseSummary || '') : ''}
                elapsedMs={exampleTrace?.totalDuration_ms ?? 0}
                iterationCount={replayState.currentIteration}
                isComplete={replayState.isComplete}
                isRunning={replayState.isPlaying}
                progressLog={exampleProgressData.progressLog}
                progressGroups={exampleProgressData.progressGroups}
                toolsCalled={exampleProgressData.toolsCalled}
                queryText={exampleTrace?.query}
                exampleStatus={{
                  currentStep: 0,
                  totalSteps: 0,
                  currentMessage: replayState.currentEvent?.message,
                }}
                completionCta={
                  <button
                    onClick={() => {
                      onModeChangeTo('live', exampleTrace?.query);
                    }}
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--accent)',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textDecoration: 'underline',
                      textUnderlineOffset: '2px',
                    }}
                  >
                    Try this query yourself &rarr;
                  </button>
                }
              />
            ) : (
              <LiveResponsePanel
                content={liveTrace.responseContent}
                elapsedMs={liveTrace.elapsedMs}
                iterationCount={liveTrace.currentIteration}
                isComplete={liveTrace.status === 'complete' || liveTrace.status === 'cancelled'}
                isRunning={liveTrace.status === 'running'}
                progressLog={liveTrace.progressLog}
                progressGroups={liveTrace.progressGroups}
                toolsCalled={liveTrace.toolsCalled}
                queryText={liveQueryText}
                onAbort={handleLiveCancel}
              />
            )}
          </div>
        )}
      </div>
    </>
  );

  if (isFullscreen) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 'var(--header-height, 0px)',
          left: 0,
          width: '100vw',
          height: 'calc(100dvh - var(--header-height, 0px))',
          zIndex: 40,
          background: 'white',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 24px',
          overflow: 'hidden',
          animation: 'bpmn-fullscreen-in 300ms ease-out',
        }}
      >
        {/* Close fullscreen — absolutely positioned to avoid taking layout space */}
        <button
          onClick={() => setIsFullscreen(false)}
          title="Exit fullscreen (ESC)"
          aria-label="Exit fullscreen"
          style={{
            position: 'absolute',
            top: '16px',
            right: '24px',
            zIndex: 45,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            height: '40px',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--text-primary)',
            color: 'white',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          <span style={{ fontSize: '16px', lineHeight: 1 }}>{'\u2715'}</span>
          Exit fullscreen
        </button>
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
