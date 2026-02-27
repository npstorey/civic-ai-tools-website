'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { connectSSE, SSEError } from '@/lib/sse-client';
import { createTraceCapture } from '@/lib/bpmn/capture-trace';
import { mapEventToNodes } from '@/lib/bpmn/node-mapping';
import type { TraceEvent, PreRecordedTrace } from '@/lib/bpmn/traces';
import type { ProgressPhase } from '@/lib/streaming';
import {
  type ReplayState,
  initialReplayState,
  buildOverlay,
  applyAnimationSteps,
  applyCascadeStep,
} from '@/lib/bpmn/animation';

export type LiveTraceStatus = 'idle' | 'running' | 'complete' | 'error';

export interface UseLiveTraceReturn {
  state: ReplayState;
  status: LiveTraceStatus;
  currentIteration: number;
  elapsedMs: number;
  responseContent: string;
  capturedTrace: PreRecordedTrace | null;
  error: string | null;
  slowMessage: string | null;
  start: (query: string, model: string, portal: string) => void;
  cancel: () => void;
  reset: () => void;
}

export function useLiveTrace(): UseLiveTraceReturn {
  const [state, setState] = useState<ReplayState>(initialReplayState);
  const [status, setStatus] = useState<LiveTraceStatus>('idle');
  const [currentIteration, setCurrentIteration] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [responseContent, setResponseContent] = useState('');
  const [capturedTrace, setCapturedTrace] = useState<PreRecordedTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slowMessage, setSlowMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const traceCaptureRef = useRef<ReturnType<typeof createTraceCapture> | null>(null);
  const startTimeRef = useRef(0);
  const eventIndexRef = useRef(0);
  const statusRef = useRef<LiveTraceStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cascadeTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const receivedCompleteRef = useRef(false);

  // Keep statusRef in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const t of cascadeTimeoutsRef.current) clearTimeout(t);
    cascadeTimeoutsRef.current = [];
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    clearTimers();
    setState(initialReplayState);
    setStatus('idle');
    setCurrentIteration(0);
    setElapsedMs(0);
    setResponseContent('');
    setCapturedTrace(null);
    setError(null);
    setSlowMessage(null);
    eventIndexRef.current = 0;
    receivedCompleteRef.current = false;
    traceCaptureRef.current = null;
  }, [clearTimers]);

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    clearTimers();
    setStatus('idle');
  }, [clearTimers]);

  const start = useCallback((query: string, model: string, portal: string) => {
    // Abort any existing
    if (abortRef.current) abortRef.current.abort();
    clearTimers();

    // Reset state
    setState(initialReplayState);
    setStatus('running');
    setCurrentIteration(0);
    setElapsedMs(0);
    setResponseContent('');
    setCapturedTrace(null);
    setError(null);
    setSlowMessage(null);
    eventIndexRef.current = 0;
    receivedCompleteRef.current = false;

    const abortController = new AbortController();
    abortRef.current = abortController;
    startTimeRef.current = Date.now();

    // Initialize trace capture
    traceCaptureRef.current = createTraceCapture(query, model, portal);

    // Elapsed timer (ticks every 500ms)
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedMs(elapsed);
      if (elapsed > 90_000) {
        setSlowMessage('This is taking longer than usual. Complex queries can take 1-2 minutes.');
      } else if (elapsed > 30_000) {
        setSlowMessage('Still working \u2014 the AI is iterating through the data...');
      }
    }, 500);

    // Activate the start node immediately
    setState(prev => {
      const newActive = new Set(prev.activeNodes);
      newActive.add('event_start');
      return { ...prev, activeNodes: newActive, isPlaying: true, activeLane: 'Browser' };
    });

    connectSSE({
      url: '/api/compare-stream',
      body: { query, model, portal, mcpOnly: true },
      signal: abortController.signal,
      onEvent: (eventData) => {
        // Only process withMcp panel events (mcpOnly mode)
        if (eventData.panel !== 'withMcp') return;

        const type = eventData.type as string;

        if (type === 'progress') {
          const phase = eventData.phase as ProgressPhase | undefined;
          if (!phase) return;

          const message = eventData.message as string;
          const iteration = eventData.iteration as number | undefined;
          const args = eventData.args as Record<string, unknown> | undefined;
          const duration_ms = eventData.duration_ms as number | undefined;
          const resultSummary = eventData.resultSummary as { rows: number; columns: number } | undefined;

          // Record for trace capture
          traceCaptureRef.current?.recordEvent({ phase, message, iteration, args, duration_ms, resultSummary });

          if (iteration !== undefined) {
            setCurrentIteration(iteration);
          }

          // Build a TraceEvent and animate
          const traceEvent: TraceEvent = {
            relativeMs: Date.now() - startTimeRef.current,
            phase,
            message,
            iteration,
            args,
            duration_ms,
            resultSummary,
          };

          const steps = mapEventToNodes(traceEvent);
          if (steps.length === 0) return;

          const overlay = buildOverlay(traceEvent);
          const idx = eventIndexRef.current++;

          // Apply immediate animation — use a generous totalEvents estimate
          // so the progress bar advances smoothly
          setState(prev => applyAnimationSteps(prev, traceEvent, steps, overlay, idx, Math.max(idx + 5, 10)));

          // Schedule cascade sub-steps at 1x timing for natural feel
          for (const step of steps) {
            if (step.delay > 0) {
              const subT = setTimeout(() => {
                if (statusRef.current !== 'running') return;
                setState(prev => applyCascadeStep(prev, step));
              }, step.delay);
              cascadeTimeoutsRef.current.push(subT);
            }
          }
        }

        if (type === 'token') {
          setResponseContent(prev => prev + (eventData.content as string));
        }

        if (type === 'complete') {
          receivedCompleteRef.current = true;
          const data = eventData.data as { content: string; duration_ms: number } | undefined;
          if (data?.content) {
            setResponseContent(data.content);
          }

          // Export captured trace
          if (traceCaptureRef.current) {
            const trace = traceCaptureRef.current.exportTrace();
            setCapturedTrace(trace);
            traceCaptureRef.current = null;
          }
        }

        if (type === 'error') {
          setError(eventData.message as string);
          setStatus('error');
          clearTimers();
        }
      },
      onComplete: () => {
        clearTimers();
        if (statusRef.current === 'running') {
          // Finalize diagram state
          setState(prev => ({
            ...prev,
            isPlaying: false,
            isComplete: true,
            progress: 1,
            activeLane: null,
          }));

          if (receivedCompleteRef.current) {
            setStatus('complete');
          } else {
            // Stream ended without a complete event — likely a connection drop
            setError('Connection lost before the query finished. Partial results may be shown.');
            setStatus('error');
            // Still export partial trace
            if (traceCaptureRef.current) {
              const trace = traceCaptureRef.current.exportTrace();
              setCapturedTrace(trace);
              traceCaptureRef.current = null;
            }
          }

          setElapsedMs(Date.now() - startTimeRef.current);
        }
      },
    }).catch((err) => {
      if (err instanceof Error && err.name === 'AbortError') return;
      clearTimers();
      if (err instanceof SSEError && err.status === 429) {
        setError('Rate limit exceeded. Please try again tomorrow or sign in for more requests.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to connect to the server.');
      }
      setStatus('error');
    });
  }, [clearTimers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      clearTimers();
    };
  }, [clearTimers]);

  return {
    state,
    status,
    currentIteration,
    elapsedMs,
    responseContent,
    capturedTrace,
    error,
    slowMessage,
    start,
    cancel,
    reset,
  };
}
