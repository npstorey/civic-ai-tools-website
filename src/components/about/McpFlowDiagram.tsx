'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import BpmnViewerComponent, { type BpmnViewerHandle } from './BpmnViewer';
import TraceControls from './TraceControls';
import NarrativePanel from './NarrativePanel';
import DiagramAnnotations from './DiagramAnnotations';
import { TRACES, getTraceById } from '@/lib/bpmn/traces';
import { useTraceReplay } from '@/hooks/useTraceReplay';

export default function McpFlowDiagram() {
  const [selectedTraceId, setSelectedTraceId] = useState(TRACES[0].id);
  const [viewerReady, setViewerReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const viewerRef = useRef<BpmnViewerHandle>(null);
  const trace = getTraceById(selectedTraceId) ?? null;
  const { state: replayState, speed, play, pause, reset, setSpeed } = useTraceReplay(trace);

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
      // Auto-enter fullscreen on first play
      if (!hasPlayedOnce && !isFullscreen) {
        setIsFullscreen(true);
        setHasPlayedOnce(true);
        // Delay play slightly so fullscreen transition + re-fit happens first
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

  // Sync replay state to bpmn-js viewer
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const viewer = viewerRef.current;

    viewer.resetAll();

    for (const nodeId of replayState.completedNodes) {
      viewer.completeNode(nodeId);
    }
    for (const nodeId of replayState.activeNodes) {
      viewer.activateNode(nodeId);
    }
    for (const edgeId of replayState.activeEdges) {
      viewer.activateEdge(edgeId);
    }
    for (const [edgeId, marker] of replayState.markedEdges) {
      viewer.highlightEdge(edgeId, marker);
    }

    viewer.clearOverlays();
    if (replayState.currentOverlay) {
      const o = replayState.currentOverlay;
      let html = '';
      switch (o.type) {
        case 'soql':
          html = `<pre class="soql-preview">${escapeHtml(o.content)}</pre>`;
          break;
        case 'result':
          html = `<span class="result-text">${escapeHtml(o.content)}</span>`;
          break;
        case 'iteration':
          html = `<span class="iteration-badge">${replayState.currentIteration}</span><br/><span class="info-text">${escapeHtml(o.content)}</span>`;
          break;
        case 'info':
          html = `<span class="info-text">${escapeHtml(o.content)}</span>`;
          break;
      }
      viewer.showOverlay(o.nodeId, html);
    }
  }, [
    viewerReady,
    replayState.activeNodes,
    replayState.completedNodes,
    replayState.activeEdges,
    replayState.markedEdges,
    replayState.currentOverlay,
    replayState.currentIteration,
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
            right: isFullscreen ? '12px' : '160px', // offset from zoom controls
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
        <NarrativePanel replayState={replayState} />
      </div>
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

      <DiagramAnnotations replayState={replayState} />

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
