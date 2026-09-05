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
import { createOfferedModelResolver, type OfferedModelResolver } from '@/lib/offered-model';
import { useDefaultPortalArg } from '@/components/DefaultPortalProvider';

export default function McpFlowDiagram() {
  // Server-resolved default portal for live runs, '' when none is configured.
  const defaultPortal = useDefaultPortalArg();
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

  /**
   * The model this instance offers, for the live query (#314, closed as part
   * of website#30 P6 F1).
   *
   * WHAT WAS HERE, AND WHY IT HAD TO GO. A module constant,
   * `anthropic/claude-sonnet-4`, passed straight to `liveTrace.start` and out
   * to `POST /api/compare-stream` as the `model` field — a WIRE VALUE, not a
   * diagram label. That id is not in any catalog: website#30 P2 placed it in
   * `HISTORICAL_MODELS`, the table that exists to render already-published
   * records and is deliberately never resolvable. It survived only because the
   * compare routes resolved a caller's id tolerantly, forwarding it upstream
   * where the built-in endpoint happened to know the slug — so `/explore`'s
   * live trace queried and billed a model this instance does not offer. That
   * trace is recorded server-side (`analysis.model` and `gen_ai.request.model`
   * in `compare-stream/route.ts`) but DISCARDED on this surface, not
   * published: `useLiveTrace.ts` has no handler for the `trace` SSE event
   * `compare-stream/route.ts` emits (it switches on `progress`/`token`/
   * `complete`/`error` only), so `LiveResponsePanel` renders
   * `McpResponseDisplay` with no `evidenceTrace` prop, and `canPublish` in
   * `McpResponseDisplay.tsx` requires `!!evidenceTrace` — never true on this
   * page. P6 makes the compare routes refuse an unoffered id, which turns a
   * quiet wrong answer into a loud one; either way the constant was the
   * defect. (Corrected here in P7: the previous version of this comment
   * claimed the live trace "is publishable" — it verifiably is not, by the
   * three facts above.)
   *
   * THE REPLACEMENT is the one `QueryForm` already uses since website#30 P4,
   * which had the identical defect (a hardcoded initial model id): the first
   * model `/api/models` offers, read from the instance rather than asserted
   * here. Warmed on mount so the click does not wait.
   *
   * #314 asks a further question this does NOT answer: whether `/explore`
   * should instead have its own catalog role, or reach the `default` entry
   * (which is `selectable: false` and therefore absent from `/api/models`).
   * That is a product decision; this only stops the page naming a model the
   * instance never offered.
   */
  // Lazy `useState` initializer, not a ref read during render: the latter
  // trips `react-hooks/refs` ("refs should only be accessed outside of
  // render"), even for the read-then-lazily-assign-once idiom. `useState`'s
  // initializer function is the sanctioned way to construct something once
  // per mount; the setter is never called again, so this is otherwise
  // identical to a ref holding a stable instance.
  const [offeredModelResolver] = useState<OfferedModelResolver>(() => createOfferedModelResolver());

  /**
   * True once an `/api/models` attempt has settled without producing a
   * usable id — a network failure, a malformed body, or an empty catalog
   * (website#30 P7). Mirrors `QueryForm`'s identically-named flag (website#30
   * P4, #283): it clears on a later success, and while it is set the
   * live-query Run control is withdrawn (`TraceControls`) rather than left to
   * invite a click.
   *
   * That click would otherwise reach `/api/compare-stream` with an empty
   * `model` and hit its "Query and model are required" 400 — a refusal whose
   * body carries no `code` field (`compare-stream/route.ts`), so
   * `classifyStreamError` falls through to `generic` and the reader would see
   * only "Something went wrong while running this query. Please try again in
   * a moment." (Corrected here in P7: the previous version of this comment
   * claimed that refusal "surfaces in the live panel — an error the reader
   * can see," as if the generic fallback were informative. `handleLiveStart`
   * below now checks for an empty id itself and never sends that request, so
   * the reader sees the disclosure below instead of a round trip to a
   * mismatched-code 400.)
   */
  const [modelsError, setModelsError] = useState(false);

  const offeredModel = useCallback((): Promise<string> => {
    return offeredModelResolver.resolve().then((id) => {
      setModelsError(id === '');
      return id;
    });
  }, [offeredModelResolver]);

  useEffect(() => {
    void offeredModel();
  }, [offeredModel]);

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
    const enteringFullscreen = !isFullscreen;
    if (enteringFullscreen) {
      setIsFullscreen(true);
      setHasPlayedOnce(true);
    }
    // The model is resolved before the query starts (#314). Usually already
    // resolved: the fetch is warmed on mount, so this settles in a microtask
    // and the 400ms fullscreen beat is unchanged. `TraceControls` withdraws
    // the Run control while `modelsError` is set, so this form should not be
    // submittable with an empty id — the guard below is defense against the
    // narrow race where a click lands before the mount-warmed fetch has
    // settled and that settlement turns out to be a failure. In that case
    // back out of the fullscreen entry rather than opening it onto nothing.
    void offeredModel().then((model) => {
      if (!model) {
        if (enteringFullscreen) {
          setIsFullscreen(false);
          setHasPlayedOnce(false);
        }
        return;
      }
      // The instance's configured default, or '' — the wire's "no portal"
      // (#407). It used to be a module literal, so every live run on /explore
      // was recorded against one deployment's city no matter whose instance
      // was serving the page.
      const begin = () => liveTrace.start(query, model, defaultPortal);
      if (enteringFullscreen) setTimeout(begin, 400);
      else begin();
    });
  }, [reset, liveTrace, isFullscreen, offeredModel, defaultPortal]);

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
          modelsUnavailable={modelsError}
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
