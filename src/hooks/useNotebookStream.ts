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
import { connectSSE } from '@/lib/sse-client';
import { friendlyStreamError } from '@/lib/streaming';
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
  /** #112: verbatim tool arguments, carried so a publish from this session
   *  populates the package's `queries[].arguments`. */
  args?: Record<string, unknown>;
  duration_ms?: number;
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
  /** Phase 2a2 item 1: composed system prompt streamed at pipeline start. */
  composedSystemPrompt: string | null;
  composedSystemPromptHash: string | null;
  /** Phase 2a2 item 4: active platform signing key id. */
  signingKeyId: string | null;
  // --- #112 publish-path inputs (from the `publish_inputs` SSE event) ---
  /** Phase A answer text — the package `output` at publish time. */
  answerContent: string | null;
  /** Finalized OTel trace for the pipeline run. */
  evidenceTrace: Record<string, unknown> | null;
  /** Phase A token usage. */
  tokenUsage: { promptTokens?: number; completionTokens?: number } | null;
  /** End-to-end pipeline duration reported by the route. */
  pipelineDurationMs: number | null;
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
  composedSystemPrompt: null,
  composedSystemPromptHash: null,
  signingKeyId: null,
  answerContent: null,
  evidenceTrace: null,
  tokenUsage: null,
  pipelineDurationMs: null,
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
          const args = raw.args as Record<string, unknown> | undefined;
          const duration_ms = raw.duration_ms as number | undefined;
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
                args,
                duration_ms,
              },
            ],
          }));
          break;
        }
        case 'phase_a_answer': {
          // The synthesis text is embedded in the notebook by Phase B; capture
          // it here as the package `output` for the publish path (#112).
          const content = raw.content as string | undefined;
          if (typeof content === 'string') {
            setState((prev) => ({ ...prev, answerContent: content }));
          }
          break;
        }
        case 'publish_inputs': {
          // #112: trace + usage + answer for publishing the executed session.
          const trace = raw.trace as Record<string, unknown> | undefined;
          const tokenUsage = raw.tokenUsage as NotebookStreamState['tokenUsage'] | undefined;
          const answer = raw.answer as string | undefined;
          const duration_ms = raw.duration_ms as number | undefined;
          setState((prev) => ({
            ...prev,
            evidenceTrace: trace ?? prev.evidenceTrace,
            tokenUsage: tokenUsage ?? prev.tokenUsage,
            answerContent: answer ?? prev.answerContent,
            pipelineDurationMs: duration_ms ?? prev.pipelineDurationMs,
          }));
          break;
        }
        case 'metadata': {
          // Phase 2a2 item 1 + 4: route emits the composed system prompt
          // and active signing key id at pipeline start. Both feed the
          // chat-output A-G renderer (Section B inline disclosure;
          // Signers section honest pre-publish UX).
          const composedSystemPrompt = raw.composedSystemPrompt as string | undefined;
          const composedSystemPromptHash = raw.composedSystemPromptHash as string | undefined;
          // Null when the instance declared no key id — keep the prior value
          // (initially null) so the Signers row renders honest absence.
          const signingKeyId = raw.signingKeyId as string | null | undefined;
          setState((prev) => ({
            ...prev,
            composedSystemPrompt: composedSystemPrompt ?? prev.composedSystemPrompt,
            composedSystemPromptHash: composedSystemPromptHash ?? prev.composedSystemPromptHash,
            signingKeyId: signingKeyId ?? prev.signingKeyId,
          }));
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
          const message = friendlyStreamError((raw.message as string | undefined) || 'Notebook generation failed');
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
      // friendlyStreamError maps SSEError 429, MCP timeout/down, and connection
      // drops to calm copy — the raw error/server text never reaches the UI.
      setState((prev) => ({ ...prev, error: friendlyStreamError(err), isLoading: false, completedAt: Date.now() }));
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  return { state, start, abort, reset };
}
