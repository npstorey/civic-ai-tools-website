'use client';

import { useState, useCallback, useRef } from 'react';
// Relative, extension-carrying imports (the convention of src/lib since #345)
// rather than the `@/` alias: the test runner has no path mapping, and this
// module (its event handler, and the label functions it re-exports) is under
// test (#384).
import { createTraceCapture } from '../lib/bpmn/capture-trace.ts';
import { connectSSE } from '../lib/sse-client.ts';
import { isComparisonRunComplete } from '../lib/query-presentation.ts';
import { classifyStreamError, friendlyStreamError, type ProgressPhase, type CompleteEvent } from '../lib/streaming.ts';
import { reportConsentRefusal } from '../components/sources/useSourceConsent.ts';
// The steps — the per-call type, the grouping of progress events into steps
// and their labels — live in one pure module, shared with the other readers
// of a run's steps. This hook keeps the React state and calls it.
import {
  applyProgressEvent,
  closeStepsOnAnswer,
  closeStepsOnComplete,
  closeStepsOnError,
  type ProgressGroup,
  type ProgressLogEntry,
  type ToolCall,
} from '../lib/answer-view/steps.ts';
// Type-only: erased at compile time, so nothing from the notebook author rides
// into this hook's bundle. The kind vocabulary is declared once, beside the
// table that turns it into reader-facing copy.
import type { ToolFailureKind } from '../lib/notebook-author/tool-to-cell.ts';

// What moved to the step module, re-exported under the names its readers import.
export type { ToolCall, ProgressLogEntry, ProgressGroup, EnrichedGroup } from '../lib/answer-view/steps.ts';
export { generateGroupLabel, mapGroupsToToolCalls } from '../lib/answer-view/steps.ts';

interface PanelState {
  content: string;
  progress: string | null;
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
  isComplete: boolean;
  duration_ms?: number;
  tokens_used?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
  tools_called?: ToolCall[];
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvidenceTrace = Record<string, any>;

interface StreamingState {
  withoutMcp: PanelState;
  withMcp: PanelState;
  isLoading: boolean;
  error: string | null;
  evidenceTrace: EvidenceTrace | null;
  /**
   * Whether the current run executes only the with-data arm (s6 P2, #229).
   * Latched per run at start: completion logic must not wait for a
   * without-data panel that will never stream, and the surface renders the
   * demoted (answer-first) treatment for exactly the runs that skipped the
   * comparison. Always false on mounts that never pass the option — the
   * apex default, unchanged.
   */
  mcpOnly: boolean;
}

const initialPanelState: PanelState = {
  content: '',
  progress: null,
  progressLog: [],
  progressGroups: [],
  isComplete: false,
};

const initialState: StreamingState = {
  withoutMcp: { ...initialPanelState },
  withMcp: { ...initialPanelState },
  isLoading: false,
  error: null,
  evidenceTrace: null,
  mcpOnly: false,
};

export function useStreamingComparison() {
  const [state, setState] = useState<StreamingState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const traceCaptureRef = useRef<ReturnType<typeof createTraceCapture> | null>(null);

  const startComparison = useCallback(async (
    query: string,
    model: string,
    portal: string,
    opts?: { mcpOnly?: boolean },
  ) => {
    const mcpOnly = opts?.mcpOnly ?? false;

    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    // Reset state
    setState({
      withoutMcp: { ...initialPanelState },
      withMcp: { ...initialPanelState },
      isLoading: true,
      error: null,
      evidenceTrace: null,
      mcpOnly,
    });

    // Initialize trace capture if enabled
    if (process.env.NEXT_PUBLIC_CAPTURE_TRACES === 'true') {
      traceCaptureRef.current = createTraceCapture(query, model, portal);
    } else {
      traceCaptureRef.current = null;
    }

    try {
      await connectSSE({
        url: '/api/compare-stream',
        // The flag is only serialized when set, so a default (two-arm) run's
        // request body is byte-identical to what the apex has always sent.
        body: { query, model, portal, ...(mcpOnly ? { mcpOnly: true } : {}) },
        signal: abortControllerRef.current.signal,
        onEvent: (eventData) => {
          // Record MCP-panel events for trace capture
          if (traceCaptureRef.current && eventData.panel === 'withMcp') {
            if (eventData.type === 'progress') {
              traceCaptureRef.current.recordEvent({
                phase: eventData.phase as ProgressPhase,
                message: eventData.message as string,
                iteration: eventData.iteration as number | undefined,
                args: eventData.args as Record<string, unknown> | undefined,
                duration_ms: eventData.duration_ms as number | undefined,
                toolName: eventData.toolName as string | undefined,
                operationType: eventData.operationType as string | undefined,
              });
            } else if (eventData.type === 'complete') {
              const trace = traceCaptureRef.current.exportTrace();
              console.log('[Trace Capture] MCP panel trace captured. Copy the JSON below into src/lib/bpmn/traces.ts:');
              console.log(JSON.stringify(trace, null, 2));
              traceCaptureRef.current = null;
            }
          }

          handleComparisonEvent(eventData as { type: string; panel: 'withMcp' | 'withoutMcp'; [key: string]: unknown }, setState);
        },
        onComplete: () => {
          // Check whether every panel this run actually has is complete —
          // a demoted (mcpOnly) run must not wait for the without-data
          // panel, which never streams.
          setState(prev => ({
            ...prev,
            isLoading: !isComparisonRunComplete(
              prev.mcpOnly,
              prev.withoutMcp.isComplete,
              prev.withMcp.isComplete,
            ),
          }));
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      // friendlyStreamError maps every shape (SSEError 429, MCP timeout/down,
      // connection drop, generic) to calm copy — no raw error text reaches the UI.
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: friendlyStreamError(error),
      }));
    }
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setState(prev => ({ ...prev, isLoading: false }));
  }, []);

  return {
    ...state,
    startComparison,
    abort,
  };
}

/**
 * Fold one stream event into the comparison's state. Exported for the render
 * test that drives a fixture run through it; the hook is its only caller.
 */
export function handleComparisonEvent(
  event: { type: string; panel: 'withMcp' | 'withoutMcp'; [key: string]: unknown },
  setState: React.Dispatch<React.SetStateAction<StreamingState>>
) {
  const { type, panel } = event;

  switch (type) {
    case 'progress':
      setState(prev => {
        const message = event.message as string;
        const steps = applyProgressEvent(
          prev[panel],
          {
            message,
            duration_ms: event.duration_ms as number | undefined,
            phase: event.phase as string | undefined,
            iteration: event.iteration as number | undefined,
            args: event.args as Record<string, unknown> | undefined,
            toolName: event.toolName as string | undefined,
            operationType: event.operationType as string | undefined,
            // The rejection the wire carried, if any (#384 P8, F2); absent stays absent.
            failed: event.failed as boolean | undefined,
            failureKind: event.failureKind as ToolFailureKind | undefined,
          },
          Date.now(),
        );
        return {
          ...prev,
          [panel]: { ...prev[panel], progress: message, ...steps },
        };
      });
      break;

    case 'token':
      setState(prev => ({
        ...prev,
        [panel]: {
          ...prev[panel],
          content: prev[panel].content + (event.content as string),
          progress: null,
          // The answer has started: every step still open closes.
          ...closeStepsOnAnswer(prev[panel]),
        },
      }));
      break;

    case 'complete':
      // #374: cast to the wire type itself rather than a hand-typed copy of
      // it — a private duplicate is what let this site's `tokens_used`
      // disagree (as a required `number`) with the source of truth in
      // src/lib/streaming.ts.
      const data = event.data as CompleteEvent['data'];
      setState(prev => {
        const newState = {
          ...prev,
          [panel]: {
            ...prev[panel],
            content: data.content,
            duration_ms: data.duration_ms,
            tokens_used: data.tokens_used,
            prompt_tokens: data.prompt_tokens,
            completion_tokens: data.completion_tokens,
            token_limit_exceeded: data.token_limit_exceeded,
            tools_called: data.tools_called,
            isComplete: true,
            progress: null,
            // Every step closes and is labelled again from all its entries.
            ...closeStepsOnComplete(prev[panel]),
          },
        };
        // Check if every panel this run has is complete (one for a demoted
        // mcpOnly run, both otherwise)
        const runComplete = isComparisonRunComplete(
          newState.mcpOnly,
          newState.withoutMcp.isComplete,
          newState.withMcp.isComplete,
        );
        return {
          ...newState,
          isLoading: !runComplete,
        };
      });
      break;

    case 'trace':
      setState(prev => ({
        ...prev,
        evidenceTrace: event.data as EvidenceTrace,
      }));
      break;

    case 'error':
      // R6 W3 (#632): a question the consent gate refused is the consent
      // card's to answer, never an error line; the form shows the card.
      if (classifyStreamError(event) === 'consent_required') {
        reportConsentRefusal();
        setState(prev => ({ ...prev, isLoading: false, [panel]: { ...prev[panel], isComplete: true, progress: null, ...closeStepsOnError(prev[panel]) } }));
        break;
      }
      setState(prev => ({
        ...prev,
        [panel]: {
          ...prev[panel],
          // Pass the whole event: a typed `code` (e.g. model_not_configured)
          // selects operator-actionable copy; otherwise the message text is
          // classified as before.
          error: friendlyStreamError(event),
          isComplete: true,
          progress: null,
          // Stop the spinners: without this, a panel that errors before any
          // content arrives keeps its in-flight progress entries animating
          // forever — the silent-hang symptom of #178.
          ...closeStepsOnError(prev[panel]),
        },
      }));
      break;
  }
}
