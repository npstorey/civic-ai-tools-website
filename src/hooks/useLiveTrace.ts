'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { connectSSE } from '@/lib/sse-client';
import { createTraceCapture } from '@/lib/bpmn/capture-trace';
import { mapEventToNodes } from '@/lib/bpmn/node-mapping';
import type { ToolFailureKind } from '@/lib/notebook-author/tool-to-cell';
import type { TraceEvent, PreRecordedTrace } from '@/lib/bpmn/traces';
import { classifyStreamError, friendlyStreamError, type ProgressPhase } from '@/lib/streaming';
import { cancelConsentPauses, reportConsentPause, reportConsentRefusal } from '@/components/sources/useSourceConsent';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';
import { generateGroupLabel } from '@/hooks/useStreamingComparison';
import {
  type ReplayState,
  initialReplayState,
  buildOverlay,
  applyAnimationSteps,
  applyCascadeStep,
} from '@/lib/bpmn/animation';

export type LiveTraceStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';

export interface SlowQueryMessage {
  text: string;
  tier: 1 | 2 | 3 | 4 | 5;
  suggestedQuery?: string;
}

export interface UseLiveTraceReturn {
  state: ReplayState;
  status: LiveTraceStatus;
  currentIteration: number;
  elapsedMs: number;
  responseContent: string;
  capturedTrace: PreRecordedTrace | null;
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
  toolsCalled: ToolCall[];
  error: string | null;
  slowMessage: SlowQueryMessage | null;
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
  const [slowMessage, setSlowMessage] = useState<SlowQueryMessage | null>(null);
  const [progressLog, setProgressLog] = useState<ProgressLogEntry[]>([]);
  const [progressGroups, setProgressGroups] = useState<ProgressGroup[]>([]);
  const [toolsCalled, setToolsCalled] = useState<ToolCall[]>([]);
  const queryRef = useRef('');

  const abortRef = useRef<AbortController | null>(null);
  const traceCaptureRef = useRef<ReturnType<typeof createTraceCapture> | null>(null);
  const startTimeRef = useRef(0);
  const eventIndexRef = useRef(0);
  const statusRef = useRef<LiveTraceStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cascadeTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const receivedCompleteRef = useRef(false);
  // Tracks a typed `error` event in a ref (statusRef lags a render behind), so
  // onComplete's connection-lost fallback can't overwrite the real error when
  // the stream closes immediately after erroring.
  const receivedErrorRef = useRef(false);
  // R9 P1 (Amendment 4): set by Cancel, synchronously and before the abort, and read by every path
  // that could write an error or a completion (statusRef lags a render behind). Reset by `start`.
  const cancelledRef = useRef(false);

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
    setProgressLog([]);
    setProgressGroups([]);
    setToolsCalled([]);
    eventIndexRef.current = 0;
    receivedCompleteRef.current = false;
    receivedErrorRef.current = false;
    traceCaptureRef.current = null;
  }, [clearTimers]);

  const cancel = useCallback(() => {
    // R9 P1 (#668, Amendment 4): the run is cancelled, and a hold it was in ended, BEFORE the abort,
    // so nothing the abort sets off (in whatever order an engine runs it) can write over either.
    cancelledRef.current = true;
    cancelConsentPauses();
    clearTimers();
    setElapsedMs(Date.now() - startTimeRef.current);
    setStatus('cancelled');
    // Export partial trace
    if (traceCaptureRef.current) {
      const trace = traceCaptureRef.current.exportTrace();
      setCapturedTrace(trace);
      traceCaptureRef.current = null;
    }
    try {
      if (abortRef.current) abortRef.current.abort();
    } catch {
      // The run is cancelled whatever the abort's own consequences are.
    }
  }, [clearTimers]);

  // Process progress events into ProgressLogEntry[] and ProgressGroup[]
  // This keeps its own copy of the accumulation the comparison and the
  // executed run share as `applyProgressEvent` in src/lib/answer-view/steps.ts
  const handleProgressEvent = useCallback((
    phase: ProgressPhase,
    message: string,
    iteration: number | undefined,
    args: Record<string, unknown> | undefined,
    duration_ms: number | undefined,
    toolName: string | undefined,
    operationType: string | undefined,
    failed?: boolean,
    failureKind?: ToolFailureKind,
  ) => {
    // The rejection the wire carried, if any (#384 P8, F2); absent stays absent.
    const failure = {
      ...(failed !== undefined ? { failed } : {}),
      ...(failureKind !== undefined ? { failureKind } : {}),
    };
    const entry: ProgressLogEntry = {
      message,
      timestamp: Date.now(),
      duration_ms,
      phase,
      iteration,
      args,
      toolName,
      operationType,
      ...failure,
    };

    if (phase === 'tool_complete' && iteration !== undefined) {
      // The end event's outcome travels onto the start entry it pairs to.
      const outcome = { isComplete: true, duration_ms, ...failure };
      // Update the matching tool_start entry in-place within its group
      setProgressGroups(prev => {
        const newGroups = prev.map(g => ({ ...g, entries: [...g.entries] }));
        const group = newGroups.find(g => g.iteration === iteration);
        if (group) {
          const startIdx = group.entries.findIndex(
            e => e.phase === 'tool_start' && e.message === message && !e.isComplete
          );
          if (startIdx !== -1) {
            group.entries[startIdx] = { ...group.entries[startIdx], ...outcome };
          }
        }
        return newGroups;
      });
      // Also update in flat log
      setProgressLog(prev => {
        const newLog = [...prev];
        const flatIdx = newLog.findIndex(
          e => e.phase === 'tool_start' && e.message === message && !e.isComplete
        );
        if (flatIdx !== -1) {
          newLog[flatIdx] = { ...newLog[flatIdx], ...outcome };
        }
        return newLog;
      });
      return;
    }

    if (phase === 'tool_result' && iteration !== undefined) {
      entry.isComplete = true;
      setProgressGroups(prev => {
        const newGroups = prev.map(g => ({ ...g, entries: [...g.entries] }));
        const group = newGroups.find(g => g.iteration === iteration);
        if (group) {
          group.entries.push(entry);
        }
        return newGroups;
      });
      setProgressLog(prev => [...prev, entry]);
      return;
    }

    if (phase === 'thinking' && iteration !== undefined) {
      // Mark the current group as complete
      setProgressGroups(prev => {
        const newGroups = prev.map(g => ({ ...g, entries: [...g.entries] }));
        const group = newGroups.find(g => g.iteration === iteration);
        if (group) {
          group.isComplete = true;
          const durations = group.entries
            .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
            .map(e => e.duration_ms!);
          if (durations.length > 0) {
            group.totalDuration_ms = durations.reduce((a, b) => a + b, 0);
          }
          const prevEntries = newGroups
            .filter(g => g.iteration < iteration!)
            .flatMap(g => g.entries);
          group.label = generateGroupLabel(group.entries, prevEntries);
        }
        return newGroups;
      });
      return;
    }

    if (phase === 'tool_start' && iteration !== undefined) {
      setProgressGroups(prev => {
        const newGroups = prev.map(g => ({ ...g, entries: [...g.entries] }));
        let group = newGroups.find(g => g.iteration === iteration);
        if (!group) {
          group = { iteration, label: 'Gathering data', entries: [], isComplete: false };
          newGroups.push(group);
        }
        group.entries.push(entry);
        return newGroups;
      });
      setProgressLog(prev => [...prev, entry]);
      return;
    }

    // Standalone entries (analyze, synthesize, or no phase)
    setProgressLog(prev => {
      const newLog = [...prev];
      if (newLog.length > 0) {
        newLog[newLog.length - 1] = { ...newLog[newLog.length - 1], isComplete: true };
      }
      newLog.push(entry);
      return newLog;
    });
  }, []);

  // Finalize all progress state (mark entries/groups complete, generate labels)
  const finalizeProgress = useCallback(() => {
    setProgressLog(prev => prev.map(entry => ({ ...entry, isComplete: true })));
    setProgressGroups(prev => prev.map((g, gIdx, allGroups) => {
      if (!g.isComplete) {
        const entries = g.entries.map(e => ({ ...e, isComplete: true }));
        const durations = entries
          .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
          .map(e => e.duration_ms!);
        const prevEntries = allGroups.slice(0, gIdx).flatMap(pg => pg.entries);
        return {
          ...g,
          entries,
          isComplete: true,
          label: generateGroupLabel(entries, prevEntries),
          totalDuration_ms: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined,
        };
      }
      return g;
    }));
  }, []);

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
    setProgressLog([]);
    setProgressGroups([]);
    setToolsCalled([]);
    eventIndexRef.current = 0;
    receivedCompleteRef.current = false;
    receivedErrorRef.current = false;
    cancelledRef.current = false;

    const abortController = new AbortController();
    abortRef.current = abortController;
    startTimeRef.current = Date.now();

    // Initialize trace capture
    traceCaptureRef.current = createTraceCapture(query, model, portal);

    queryRef.current = query;

    // Elapsed timer (ticks every 500ms) with 5-tier slow messages
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedMs(elapsed);
      if (elapsed > 180_000) {
        setSlowMessage({
          text: 'This query may be too broad. Try a more specific question.',
          tier: 5,
          suggestedQuery: `${queryRef.current} in 2024`,
        });
      } else if (elapsed > 120_000) {
        setSlowMessage({
          text: 'This is taking unusually long. You can cancel and try a simpler query.',
          tier: 4,
        });
      } else if (elapsed > 90_000) {
        setSlowMessage({
          text: 'Tip: Adding a date range (e.g. "in 2024") can speed up queries significantly.',
          tier: 3,
        });
      } else if (elapsed > 60_000) {
        setSlowMessage({
          text: 'Complex queries can take 1\u20132 minutes when iterating through large datasets.',
          tier: 2,
        });
      } else if (elapsed > 30_000) {
        setSlowMessage({
          text: 'Still working \u2014 the AI is iterating through the data...',
          tier: 1,
        });
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
        // Nothing a cancelled run still delivers is read: no pause comes back, no error is written (Amendment 4).
        if (cancelledRef.current || abortController.signal.aborted) return;
        // Only process withMcp panel events (mcpOnly mode)
        if (eventData.panel !== 'withMcp') return;

        const type = eventData.type as string;

        if (type === 'progress') {
          const phase = eventData.phase as ProgressPhase | undefined;
          if (!phase) return;

          // R8 W2 (#644): a load paused to ask the reader. Its own branch: the
          // pause's key goes into the run's steps and the panel's bus only,
          // never through the trace capture or the shared fold below.
          if (phase === 'consent_pause') {
            const pause = eventData.pause as ProgressLogEntry['pause'];
            if (!pause) return;
            setProgressLog(prev => [...prev, { message: eventData.message as string, timestamp: Date.now(), phase, pause }]);
            reportConsentPause(pause);
            return;
          }
          // Any other line of the run: it has moved past a hold still open, as on the other surfaces (R9 P1).
          reportConsentPause(null);

          const message = eventData.message as string;
          const iteration = eventData.iteration as number | undefined;
          const args = eventData.args as Record<string, unknown> | undefined;
          const duration_ms = eventData.duration_ms as number | undefined;
          const resultSummary = eventData.resultSummary as { rows: number; columns: number } | undefined;
          const toolName = eventData.toolName as string | undefined;
          const operationType = eventData.operationType as string | undefined;
          // The rejection the wire carried, if any (#384 P8, F2).
          const failed = eventData.failed as boolean | undefined;
          const failureKind = eventData.failureKind as ToolFailureKind | undefined;

          // Record for trace capture
          traceCaptureRef.current?.recordEvent({ phase, message, iteration, args, duration_ms, resultSummary, toolName, operationType, failed, failureKind });

          // Build progress log entries (same as home page)
          handleProgressEvent(phase, message, iteration, args, duration_ms, toolName, operationType, failed, failureKind);

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
            toolName,
            operationType,
            ...(failed !== undefined ? { failed } : {}),
            ...(failureKind !== undefined ? { failureKind } : {}),
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
          // Mark all progress as complete when tokens start
          finalizeProgress();
          setResponseContent(prev => prev + (eventData.content as string));
        }

        if (type === 'complete') {
          receivedCompleteRef.current = true;
          const data = eventData.data as { content: string; duration_ms: number; tokens_used?: number; tools_called?: ToolCall[] } | undefined;
          if (data?.content) {
            setResponseContent(data.content);
          }
          if (data?.tools_called) {
            setToolsCalled(data.tools_called);
          }

          // Finalize all progress
          finalizeProgress();

          // Export captured trace
          if (traceCaptureRef.current) {
            const trace = traceCaptureRef.current.exportTrace();
            setCapturedTrace(trace);
            traceCaptureRef.current = null;
          }
        }

        if (type === 'error') {
          // Pass the whole event: a typed `code` (e.g. model_not_configured)
          // selects operator-actionable copy; otherwise the message text is
          // classified as before.
          receivedErrorRef.current = true;
          clearTimers();
          // R6 W3 (#632): a question the consent gate refused is the consent
          // card's to answer: the input comes back and the card is shown.
          if (classifyStreamError(eventData) === 'consent_required') {
            reportConsentRefusal();
            setError(null);
            setStatus('idle');
            return;
          }
          setError(friendlyStreamError(eventData));
          setStatus('error');
        }
      },
      onComplete: () => {
        // A cancelled run's end writes nothing: Cancel has written it (Amendment 4).
        if (cancelledRef.current) return;
        clearTimers();
        // R9 P1 (Amendment 3): a run whose own request was aborted by a newer run neither reads
        // as a lost connection nor overwrites that run's state.
        if (abortController.signal.aborted) {
          if (abortRef.current === abortController) cancelConsentPauses();
          return;
        }
        // The run's stream is over, however it ended: a hold still open is over too (#669 D2),
        // so its card reads the after-hold words and still takes an answer for later questions.
        reportConsentPause(null);
        finalizeProgress();
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
          } else if (!receivedErrorRef.current) {
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
      // A cancelled or superseded run's rejection, whatever an engine names it, writes nothing (Amendment 4).
      if (cancelledRef.current || abortController.signal.aborted) return;
      clearTimers();
      // friendlyStreamError covers SSEError 429, MCP timeout/down, and connection
      // drops with calm copy — never the raw error message.
      setError(friendlyStreamError(err));
      setStatus('error');
    });
  }, [clearTimers, handleProgressEvent, finalizeProgress]);

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
    progressLog,
    progressGroups,
    toolsCalled,
    error,
    slowMessage,
    start,
    cancel,
    reset,
  };
}
