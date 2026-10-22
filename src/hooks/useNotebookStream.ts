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
import { classifyStreamError, friendlyStreamError, notebookExecutionErrorMessage, reasonWithoutIdentifier } from '@/lib/streaming';
import { reportConsentRefusal } from '@/components/sources/useSourceConsent';
import type { Notebook } from '@/lib/notebook-author';
import type { NotebookPhase } from '@/components/notebook/NotebookProgress';
import type { PhaseAToolCall } from '@/lib/notebook-author';
import type { WhereItWentModel } from '@/lib/flows/where-it-went';
// The run's steps, folded the way the comparison folds its own (LAYOUT-WEB W2
// P2): one group per Phase A iteration, from the progress lines.
import {
  applyProgressEvent,
  closeStepsOnComplete,
  closeStepsOnError,
  type ReportedPhase,
  type StepLog,
} from '@/lib/answer-view/steps';
// A tool name reaches the reader through the seam (#599 W3), never in its
// exposed spelling (LAYOUT-WEB W3 P1 fix 1).
import { upstreamToolName } from '@/lib/mcp/operation-types';

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
  /** Set when Phase A recorded the call as rejected (#384, F5): carried off
   *  the `phase_a_tool_call` event so a publish from this session says so.
   *  Absent means not recorded as failed. */
  failed?: boolean;
  failureKind?: PhaseAToolCall['failureKind'];
}

export interface NotebookStreamState {
  phase: NotebookPhase | null;
  /** Detail line shown beneath the active row (Phase A tool call / progress). */
  detail: string | null;
  /** The tool the `phase_a_progress` line is about, as the loop recorded it
   *  (#384): its name and, when the loop derived one, its operation type.
   *  Carried with the line rather than dropped at this reader; null when the
   *  line is not about a tool call. */
  detailTool: {
    toolName: string;
    operationType?: string;
    /** The line is the end or outcome of a call the loop recorded as rejected (#384 P8, F2). */
    failed?: boolean;
    failureKind?: PhaseAToolCall['failureKind'];
  } | null;
  /** Accumulated tool calls captured during Phase A. Drives section D. */
  toolCalls: CapturedToolCall[];
  /**
   * Phase A's steps, one group per loop iteration, folded from the
   * `phase_a_progress` lines by the shared step module (LAYOUT-WEB W2 P2).
   * The lines carry no arguments: the step view pairs the groups with
   * `toolCalls` when it renders (`buildRunStepView`). Optional, so a state
   * built by hand (the dev preview's fixtures) need not name it; absent means
   * no steps were recorded, and the step view is not shown.
   */
  steps?: StepLog;
  /**
   * Every `phase` event the stream sent, with the route's message, in order
   * (LAYOUT-WEB W2 P2 fix 1): the executed run's step view closes with a row
   * for each of B, C and D the run reported (`buildClosingRows`). `phase`
   * above keeps only the latest. Optional, as `steps` is; absent means none
   * was recorded.
   */
  phaseLog?: ReportedPhase[];
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
  /**
   * A notebook's own traceback, the reader's detail (#516, the 2026-09-21
   * ruling), with the correlation id the error message carries. Set only from
   * a `notebook_execution` error event that carries a `traceback` field; null
   * otherwise, and always null under `EXECUTOR_DRIVER=lambda` (G0-9).
   * Optional, so a state built by hand (the dev preview's fixtures) need not
   * name it; absent reads as null.
   */
  errorTraceback?: { text: string; correlationId: string } | null;
  /** R6 W4: where the question went, from the `complete` phase's `flows`; absent until then. */
  flows?: WhereItWentModel;
}

const NO_STEPS: StepLog = { progressLog: [], progressGroups: [] };

const INITIAL_STATE: NotebookStreamState = {
  phase: null,
  detail: null,
  detailTool: null,
  toolCalls: [],
  steps: NO_STEPS,
  phaseLog: [],
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
  errorTraceback: null,
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
          // The phase as the run reported it, kept for the closing rows.
          const reported = typeof raw.message === 'string' ? [{ phase: name, message: raw.message }] : [];
          if (name === 'complete') {
            setState((prev) => ({
              ...prev,
              phase: 'complete',
              phaseLog: [...(prev.phaseLog ?? []), ...reported],
              detail: null,
              detailTool: null,
              completedAt: Date.now(),
              ...(raw.flows !== undefined ? { flows: raw.flows as WhereItWentModel } : {}),
            }));
          } else {
            setState((prev) => ({
              ...prev,
              phase: name,
              phaseLog: [...(prev.phaseLog ?? []), ...reported],
              phaseStartedAt: Date.now(),
              detail: null,
              detailTool: null,
              // Phase A is over once a later phase starts: its steps close,
              // each labelled from its entries.
              ...(name !== 'A' ? { steps: closeStepsOnComplete(prev.steps ?? NO_STEPS) } : {}),
            }));
          }
          break;
        }
        case 'phase_a_progress': {
          const message = raw.message as string | undefined;
          const toolName = raw.toolName as string | undefined;
          const operationType = raw.operationType as string | undefined;
          const failed = raw.failed as boolean | undefined;
          const failureKind = raw.failureKind as PhaseAToolCall['failureKind'] | undefined;
          if (message) {
            const phase = raw.phase as string | undefined;
            const iteration = raw.iteration as number | undefined;
            setState((prev) => ({
              ...prev,
              // The line joins its iteration's step, as the comparison's do.
              steps: applyProgressEvent(prev.steps ?? NO_STEPS, {
                message,
                phase,
                iteration,
                toolName,
                operationType,
                failed,
                failureKind,
              }, Date.now()),
              detail: message,
              detailTool: toolName
                ? {
                    toolName,
                    ...(operationType !== undefined ? { operationType } : {}),
                    // #384 P8 (F2): the route now forwards a call's end and
                    // outcome lines too; a rejection rides with them.
                    ...(failed !== undefined ? { failed } : {}),
                    ...(failureKind !== undefined ? { failureKind } : {}),
                  }
                : null,
            }));
          }
          break;
        }
        case 'phase_a_tool_call': {
          const name = raw.name as string | undefined;
          const op = raw.operationType as string | undefined;
          const reason = raw.reason as string | undefined;
          const resultSummary = raw.resultSummary as CapturedToolCall['resultSummary'] | undefined;
          const args = raw.args as Record<string, unknown> | undefined;
          const duration_ms = raw.duration_ms as number | undefined;
          const failed = raw.failed as boolean | undefined;
          const failureKind = raw.failureKind as PhaseAToolCall['failureKind'] | undefined;
          if (!name) break;
          // The live progress line paints at the call, before its outcome is
          // known, so its phrase goes through the shared sanitiser on every
          // call (#426, the owner's R5): a `fetch`'s `to look up record:…`
          // named a portal here while the call ran. A dropped phrase leaves
          // the line at the call's name, read by its upstream name.
          const shownReason = reasonWithoutIdentifier(reason);
          const label = [op || upstreamToolName(name), shownReason ? `(${shownReason})` : null].filter(Boolean).join(' ');
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
                // #384 F5: keep the rejection the event carried; absent stays
                // absent.
                ...(failed !== undefined ? { failed } : {}),
                ...(failureKind !== undefined ? { failureKind } : {}),
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
          const code = raw.code as string | undefined;
          const correlationId = raw.correlationId as string | undefined;
          // #271: a notebook execution failure's MESSAGE is rebuilt
          // CLIENT-SIDE from the typed `correlationId` + `exitCode` fields
          // only — never from `raw.message` — so the message can never carry
          // raw stderr no matter what the server happened to put there.
          // Falls back to the generic friendly copy if a correlation id
          // wasn't sent (a stale server, or this event predating #271).
          //
          // #516 (the 2026-09-21 ruling): the notebook's own traceback is the
          // reader's, and it arrives in a field of its own, `traceback`, kept
          // here beside the message with the same correlation id. The server
          // sends it only for a notebook's own failure on the session path,
          // with the notebook's credentials removed and its size bounded; a
          // setup failure, and every failure under `EXECUTOR_DRIVER=lambda`
          // (G0-9: the function holds the credentials, so the app cannot
          // remove them), send none, and this stays null.
          const traceback = raw.traceback;
          const errorTraceback = code === 'notebook_execution' && correlationId && typeof traceback === 'string' && traceback !== ''
            ? { text: traceback, correlationId }
            : null;
          const message = code === 'notebook_execution' && correlationId
            ? notebookExecutionErrorMessage(raw.exitCode as number | undefined, correlationId)
            // Pass the carried kind alongside the text: since #154 the Phase A
            // failure path puts a classified `code` on the event, and the message
            // is already reader-facing copy. Without the code, prefixed copy
            // would be re-classified from prose and flatten to the generic line.
            : friendlyStreamError({
                message: (raw.message as string | undefined) || 'Notebook generation failed',
                code: raw.code,
              });
          setState((prev) => ({
            ...prev,
            error: message,
            errorTraceback,
            // Nothing keeps running once the run has failed.
            steps: closeStepsOnError(prev.steps ?? NO_STEPS),
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
      // R6 W3 (#632): the route's 403 `consent_required` arrives as an
      // `SSEError` whose body carries the code; the consent card answers it.
      if (classifyStreamError(err) === 'consent_required') {
        reportConsentRefusal();
        setState((prev) => ({ ...prev, error: null, isLoading: false, completedAt: Date.now() }));
        return;
      }
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
