'use client';

/**
 * Phase 2a — SSE client for /api/query-notebook (Phase 1 backend).
 *
 * Consumes the NotebookEvent union declared in
 * `src/app/api/query-notebook/route.ts` and exposes a chat-input-ready
 * state object: current phase, last detail message, elapsed clocks, the
 * executed notebook on completion, validation result, and error string.
 *
 * Elapsed clocks (total + per-phase) are tracked in millisecond timestamps
 * captured at phase boundaries. The NotebookProgress component owns the
 * 1Hz tick re-render; this hook only updates state when a real SSE event
 * arrives, so the rest of the UI does not re-render every second.
 */
import { useCallback, useRef, useState } from 'react';
import { connectSSE, SSEError } from '@/lib/sse-client';
import type { Notebook } from '@/lib/notebook-author';
import type { NotebookPhase } from '@/components/notebook/NotebookProgress';

/** A single tool call captured during Phase A — used to populate the
 *  deliberative-trace section of the chat-output A-G renderer. Shape mirrors
 *  the Phase 1 route's `phase_a_tool_call` event. */
export interface CapturedToolCall {
  name: string;
  operationType?: string;
  reason?: string;
  resultSummary?: { rows: number; columns: number };
}

export interface NotebookStreamState {
  phase: NotebookPhase | null;
  /** Detail line shown beneath the active row (Phase A tool call / progress). */
  detail: string | null;
  /** Accumulated tool calls captured during Phase A. Drives section D. */
  toolCalls: CapturedToolCall[];
  phaseStartedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  notebook: Notebook | null;
  validation: { ok: boolean; issues: { path: string; message: string }[] } | null;
  sandboxId: string | null;
  executionDurationMs: number | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL_STATE: NotebookStreamState = {
  phase: null,
  detail: null,
  toolCalls: [],
  phaseStartedAt: null,
  startedAt: null,
  completedAt: null,
  notebook: null,
  validation: null,
  sandboxId: null,
  executionDurationMs: null,
  isLoading: false,
  error: null,
};

interface RawNotebookEvent {
  type: string;
  [key: string]: unknown;
}

export function useNotebookStream() {
  const [state, setState] = useState<NotebookStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const start = useCallback(async (query: string, model: string, portal: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const startedAt = Date.now();
    setState({
      ...INITIAL_STATE,
      isLoading: true,
      startedAt,
    });

    const handleEvent = (raw: RawNotebookEvent) => {
      switch (raw.type) {
        case 'phase': {
          const name = raw.name as NotebookPhase;
          if (name === 'complete') {
            setState((prev) => ({
              ...prev,
              phase: 'complete',
              detail: null,
              completedAt: Date.now(),
            }));
          } else {
            setState((prev) => ({
              ...prev,
              phase: name,
              phaseStartedAt: Date.now(),
              detail: null,
            }));
          }
          break;
        }
        case 'phase_a_progress': {
          const message = raw.message as string | undefined;
          if (message) setState((prev) => ({ ...prev, detail: message }));
          break;
        }
        case 'phase_a_tool_call': {
          const name = raw.name as string | undefined;
          const op = raw.operationType as string | undefined;
          const reason = raw.reason as string | undefined;
          const resultSummary = raw.resultSummary as CapturedToolCall['resultSummary'] | undefined;
          if (!name) break;
          const label = [op || name, reason ? `(${reason})` : null].filter(Boolean).join(' ');
          setState((prev) => ({
            ...prev,
            detail: label || prev.detail,
            toolCalls: [
              ...prev.toolCalls,
              {
                name,
                operationType: op,
                reason,
                resultSummary,
              },
            ],
          }));
          break;
        }
        case 'phase_a_answer': {
          // Synthesis text is already embedded in the notebook by Phase B; no
          // chat-side rendering needed yet. Future work may stream it here.
          break;
        }
        case 'notebook': {
          const notebook = raw.notebook as Notebook;
          const sandboxId = raw.sandboxId as string | undefined;
          const executionDurationMs = raw.executionDuration_ms as number | undefined;
          const validation = raw.validation as NotebookStreamState['validation'] | undefined;
          setState((prev) => ({
            ...prev,
            notebook,
            sandboxId: sandboxId ?? null,
            executionDurationMs: executionDurationMs ?? null,
            validation: validation ?? null,
          }));
          break;
        }
        case 'error': {
          const message = (raw.message as string | undefined) || 'Notebook generation failed';
          setState((prev) => ({
            ...prev,
            error: message,
            isLoading: false,
            completedAt: Date.now(),
          }));
          break;
        }
        default:
          break;
      }
    };

    try {
      await connectSSE({
        url: '/api/query-notebook',
        body: { query, model, portal },
        signal: abortRef.current.signal,
        onEvent: (evt) => handleEvent(evt as RawNotebookEvent),
        onComplete: () => {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            completedAt: prev.completedAt ?? Date.now(),
          }));
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message =
        err instanceof SSEError && err.status === 429
          ? 'Rate limit exceeded. Try again tomorrow or sign in for more requests.'
          : err instanceof Error
            ? err.message
            : 'Failed to connect to /api/query-notebook';
      setState((prev) => ({ ...prev, error: message, isLoading: false, completedAt: Date.now() }));
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  return { state, start, abort, reset };
}
