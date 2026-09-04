/**
 * POST /api/query-notebook — executed-notebook backend endpoint
 * (project-plan N1, ADR-0005 §1).
 *
 * Composes the four-phase pipeline:
 *   - Phase A: LLM discovery via MCP tools (reuses queryWithMcpStreaming).
 *   - Phase B: deterministic notebook synthesis (lib/notebook-author).
 *   - Phase C: sandbox execution (lib/sandbox).
 *   - Phase D: comparison-cell append + execution-metadata stamp.
 *
 * Response is Server-Sent Events. The intermediate events let Phase 2a's
 * chat UI render progress (per project plan §10 Q4); the final
 * `data: { type: "notebook", … }` event carries the executed notebook for
 * the curl-driven Phase 1 acceptance test (project plan §6).
 *
 * Authentication / rate-limiting mirror the existing /api/compare-stream
 * route; this endpoint is gated by the same per-user / per-IP daily quotas.
 */
import { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit, incrementRateLimit, isRateLimited } from '@/lib/rate-limit';
import { mcpTools } from '@/lib/mcp/tools';
import { callMcpTool, routeTool } from '@/lib/mcp/client';
import { getMissingMcpRoutingError } from '@/lib/mcp/registry';
import { getDefaultModel, resolveModel, ModelNotOfferedError } from '@/lib/model-resolver';
import { ModelConfigurationError, getMissingModelCredentialError, getModelApiKind } from '@/lib/model-client';
import { modelAccessPhrase, modelIdentity, type ModelIdentity } from '@/lib/model-catalog';
import { buildSystemPrompt } from '@/lib/mcp/socrata-skill';
import {
  queryWithMcpStreaming,
  type CompletionResult,
  type StreamCallbacks,
} from '@/lib/openrouter-streaming';
import { isStreamErrorKind, notebookExecutionErrorMessage, type StreamErrorCode } from '@/lib/streaming';
import { TraceBuilder, hash as traceHash, CIVICAITOOLS_TRACE_CONFIG } from '@/lib/evidence/trace';
import { getConfiguredKeyId } from '@/lib/evidence/signing';
import {
  type PhaseAToolCall,
  stampExecutedNotebook,
  synthesizeNotebook,
  validateExecutedNotebook,
} from '@/lib/notebook-author';
import { buildNotebookExtension } from '@/lib/notebook-author/notebook-extension';
import { executeNotebook, NotebookExecutionError } from '@/lib/sandbox';

const DEFAULT_PORTAL = 'data.cityofnewyork.us';

interface QueryNotebookRequest {
  query: string;
  portal?: string;
  model?: string;
}

type NotebookEvent =
  | { type: 'phase'; name: 'A' | 'B' | 'C' | 'D' | 'complete'; message: string }
  | { type: 'phase_a_progress'; message: string; phase?: string; iteration?: number; toolName?: string; operationType?: string; failed?: boolean; failureKind?: PhaseAToolCall['failureKind'] }
  | { type: 'phase_a_tool_call'; name: string; operationType?: string; reason?: string; resultSummary?: { rows: number; columns: number }; args?: Record<string, unknown>; duration_ms?: number; failed?: boolean; failureKind?: PhaseAToolCall['failureKind'] }
  | { type: 'phase_a_answer'; content: string }
  // `signingKeyId` is null when this instance has declared no PUBLISHER_KEY_ID:
  // the Signers section then shows honest absence rather than some other
  // deployment's kid. This is a DISPLAY surface, so it reads the non-throwing
  // probe; nothing here commits to the value.
  | { type: 'metadata'; composedSystemPrompt: string; composedSystemPromptHash: string; signingKeyId: string | null }
  | { type: 'notebook'; notebook: unknown; sandboxId: string; executionDuration_ms: number; validation: { ok: boolean; issues: { path: string; message: string }[] } }
  // Publish-path inputs (civic-ai-tools-website#112): everything the client
  // needs to publish the executed session through POST /api/records without
  // regenerating a skeleton — the finalized OTel trace, token usage, and the
  // Phase A answer text (the package `output`). Emitted once, on success,
  // after the `complete` phase event.
  | {
      type: 'publish_inputs';
      trace: Record<string, unknown>;
      tokenUsage: { promptTokens?: number; completionTokens?: number };
      answer: string;
      duration_ms: number;
    }
  // `correlationId` + `exitCode` are set only for `code: 'notebook_execution'`
  // (#271): they let the reader trace a failure to its full-stderr server log
  // line without the wire ever carrying that stderr. See
  // `notebookExecutionErrorMessage()` in lib/streaming.ts, which builds
  // `message` from exactly these two values and nothing else.
  | { type: 'error'; message: string; code?: StreamErrorCode; correlationId?: string; exitCode?: number };

function encodeNotebookEvent(event: NotebookEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest) {
  let body: QueryNotebookRequest;
  try {
    body = (await request.json()) as QueryNotebookRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: 'Body must be JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!body.query || typeof body.query !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Missing required field "query"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const portal = body.portal || DEFAULT_PORTAL;

  // Fail fast when the environment cannot describe a usable model endpoint
  // (#178, and website#30 P6 F3). This is the guard /api/compare,
  // /api/compare-stream and the publication gate have used since #178, and its
  // absence here was a defect with two halves:
  //
  //   1. THE OPERATOR WAS TOLD THE WRONG VARIABLE. Without it, an endpoint
  //      failure surfaced only when the pipeline reached the model, where the
  //      typed ModelConfigurationError is classified to `model_not_configured`
  //      and rendered as the kind's reader copy — "no AI model API key
  //      configured … set MODEL_API_KEY". Measured with a valid key and
  //      MODEL_API_VERSION absent, that copy is simply false: the key is
  //      there, and the variable at fault is named nowhere the operator looks.
  //      The typed message names the variable and the fix, and it survives
  //      because it is returned from here rather than classified downstream.
  //   2. IT BURNED QUOTA TO FAIL. `incrementRateLimit` below ran before
  //      anything had established the endpoint was usable, so every attempt
  //      against a misconfigured instance spent a day's allowance of a reader
  //      who could never have got an answer. Guard first, then increment.
  //
  // Ahead of the catalog read for the same reason it is ahead of the limiter:
  // the endpoint is the more fundamental configuration, and a catalog refusal
  // raised first would send an operator after the wrong variable again. 503,
  // not 400 — an operability failure, not a bad request.
  const credentialError = getMissingModelCredentialError();
  if (credentialError) {
    console.error('[query-notebook]', credentialError.message);
    return new Response(
      JSON.stringify({ error: credentialError.message, code: credentialError.code }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // The model comes from this instance's catalog, not from a literal in this
  // file (civic-ai-tools-website#30 P2). Two things changed here:
  //   - the default is the catalog's `default` entry rather than a slug
  //     duplicated between this route and the publication gate;
  //   - a caller-named id is RESOLVED. Before, an unknown id was forwarded and
  //     the endpoint decided; now an id this instance does not offer is a 400
  //     raised before any upstream call, so it is never billed and never
  //     reaches a record's `cost.model`.
  // A catalog the instance cannot read is 503 (operator) rather than 400
  // (caller) — the two failures are not the same and do not share a status.
  // website#30 P3: the resolved entry now yields BOTH strings. `endpointModel`
  // is addressed to the endpoint and `declared` to the reader of the signed
  // record; nothing downstream carries one string doing both jobs.
  let model: ModelIdentity;
  try {
    model = modelIdentity(body.model ? resolveModel(body.model) : getDefaultModel());
  } catch (error) {
    if (error instanceof ModelNotOfferedError) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (error instanceof ModelConfigurationError) {
      console.error('[query-notebook]', error.message);
      return new Response(
        JSON.stringify({ error: error.message, code: error.code }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw error;
  }

  // Fail fast when no MCP endpoint is configured for the primary data source
  // (#258 C4): Phase A cannot discover datasets without one, and
  // SOCRATA_MCP_URL has no coded fallback. Checked before rate limiting (a
  // misconfigured instance must not burn quota). The JSON body rides the
  // pre-stream error channel the client already handles (SSEError →
  // friendlyStreamError), carrying the typed code alongside the message.
  const mcpRoutingError = getMissingMcpRoutingError();
  if (mcpRoutingError) {
    console.error('[query-notebook]', mcpRoutingError.message);
    return new Response(
      JSON.stringify({ error: mcpRoutingError.message, code: mcpRoutingError.code }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Rate-limit identical to /api/compare-stream — per-user when signed in,
  // per-IP otherwise.
  const session = await getServerSession(authOptions);
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0] || 'unknown';
  const identifier = session?.user?.id || ip;
  const isAuthenticated = !!session?.user?.id;
  const rateLimitInfo = await checkRateLimit(identifier, isAuthenticated);
  if (isRateLimited(rateLimitInfo)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded', rateLimit: rateLimitInfo }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }
  await incrementRateLimit(identifier, isAuthenticated);

  // Build the multi-source system prompt up front so its hash anchors the trace.
  const systemPrompt = await buildSystemPrompt(portal);
  const systemPromptHash = traceHash(systemPrompt);

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const emit = async (event: NotebookEvent): Promise<void> => {
    await writer.write(encoder.encode(encodeNotebookEvent(event)));
  };

  const trace = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  trace.startRoot('executed_notebook', {
    'analysis.prompt_hash': traceHash(body.query),
    'analysis.model': model.declared,
    'analysis.portal': portal,
  });

  const runPipeline = async () => {
    const pipelineStart = Date.now();
    try {
      // Phase 2a2 (item 1 + 4): emit the composed system prompt + active
      // signing key id up front so the chat output's Section B can render
      // the system prompt inline behind a disclosure and the Signers
      // section can show the platform key id honestly. Both fields are
      // server-derived and not secret (the key id is published in the
      // trust registry at /.well-known/evidence-public-keys.json).
      await emit({
        type: 'metadata',
        composedSystemPrompt: systemPrompt,
        composedSystemPromptHash: systemPromptHash,
        signingKeyId: getConfiguredKeyId(),
      });
      await emit({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
      const phaseAResult = await runPhaseA({
        query: body.query,
        portal,
        model,
        emit,
        trace,
        systemPrompt,
        systemPromptHash,
      });

      await emit({ type: 'phase', name: 'B', message: 'Synthesizing notebook…' });
      const toolCalls = (phaseAResult.tools_called ?? []) as PhaseAToolCall[];
      const synthesis = synthesizeNotebook({
        query: body.query,
        defaultPortal: portal,
        modelName: model.declared,
        modelAccess: modelAccessPhrase(getModelApiKind()),
        finalAnswer: phaseAResult.content,
        toolCalls,
      });

      await emit({ type: 'phase', name: 'C', message: 'Executing in sandbox…' });
      const execStart = Date.now();
      const execution = await executeNotebook(synthesis.notebook);

      await emit({ type: 'phase', name: 'D', message: 'Finalizing…' });
      const stamped = stampExecutedNotebook(
        execution.notebook,
        {
          executedAt: new Date().toISOString(),
          executionDuration_ms: execution.executionDuration_ms,
          sandboxId: execution.sandboxId,
          pythonVersion: execution.pythonVersion,
          libraries: execution.libraries,
        },
        synthesis.dataFrameVariables,
      );

      // #400: the verdict travels WITH the notebook, attached here, where it is
      // computed. Until this line it was emitted beside the notebook and dropped
      // by the first consumer that did not carry it forward — so a notebook the
      // validator had rejected reached a signed package asserting a reproduction
      // the one component that checked had found it could not make. Attaching it
      // at the source means every hop after this one (stream state, the publish
      // POST, the package, storage, the record page) carries it without knowing
      // it is there. It sits beside the notebook's own provenance stamp; see
      // `notebook-extension.ts` for why not at the notebook's top level.
      //
      // D1 was ruled A: there is NO publish gate here. `publish_inputs` below is
      // still emitted unconditionally and no user is refused. Disclosure, not
      // validation.
      const validation = validateExecutedNotebook(stamped.notebook);
      await emit({
        type: 'notebook',
        notebook: buildNotebookExtension(stamped.notebook, validation),
        sandboxId: execution.sandboxId,
        executionDuration_ms: Date.now() - execStart,
        // Still on the wire beside the notebook: it is the event's declared
        // contract and `useNotebookStream` exposes it as `state.validation`.
        // The notebook is now the SOURCE OF TRUTH — this field is a convenience
        // for a consumer holding the event rather than the document.
        validation,
      });
      await emit({ type: 'phase', name: 'complete', message: 'Done.' });

      // #112 publish-path parity: end the root span and ship the finalized
      // trace + usage + answer so the publish dialog can build a package from
      // the EXECUTED session (same pattern as /api/compare-stream's final
      // `trace` event). Emitted only on success — a failed pipeline has
      // nothing publishable.
      trace.endRoot();
      await emit({
        type: 'publish_inputs',
        trace: trace.finalize() as unknown as Record<string, unknown>,
        tokenUsage: {
          promptTokens: phaseAResult.prompt_tokens,
          completionTokens: phaseAResult.completion_tokens,
        },
        answer: phaseAResult.content,
        duration_ms: Date.now() - pipelineStart,
      });
    } catch (err) {
      if (err instanceof NotebookExecutionError) {
        // #271 disclosure ruling: the stderr tail is not for the reader. It
        // used to be flattened into the wire `message` and then discarded at
        // render (friendlyStreamError never showed it) — exposed on the wire
        // while unavailable to the reader it was collected for. Now it stays
        // server-side only, logged here in FULL (not just a tail — the log
        // has no wire-size constraint, so this only ever captures at least as
        // much as the old `stderrTail` bound did), tagged with a correlation
        // id the reader *does* see, so a reported failure is traceable back
        // to this exact log line. Prefix + shape are stable for grepping:
        // `[query-notebook] NotebookExecutionError` with a `correlationId`.
        const correlationId = `nb-${randomUUID().slice(0, 8)}`;
        console.error('[query-notebook] NotebookExecutionError', {
          correlationId,
          exitCode: err.exitCode,
          message: err.message,
          stderr: err.stderr,
        });
        await emit({
          type: 'error',
          message: notebookExecutionErrorMessage(err.exitCode, correlationId),
          code: 'notebook_execution',
          correlationId,
          exitCode: err.exitCode,
        });
      } else {
        if (err instanceof Error) {
          console.error('[query-notebook] error', { message: err.message, stack: err.stack });
        } else {
          console.error('[query-notebook] unknown error', err);
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        // Phase A attaches the classified kind to its rejection (#154). Guarded
        // rather than forwarded blind: plenty of unrelated errors carry a `code`
        // of their own (`ENOENT`, `ERR_*`), and only a real kind belongs on the
        // wire — anything else would just fall through to prose matching anyway.
        const rejectionCode = err !== null && typeof err === 'object' && 'code' in err
          ? (err as { code?: unknown }).code
          : undefined;
        const code = isStreamErrorKind(rejectionCode) ? rejectionCode : undefined;
        await emit({ type: 'error', message, ...(code ? { code } : {}) });
      }
    } finally {
      trace.endRoot();
      await writer.close();
    }
  };

  void runPipeline();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Drive Phase A: invoke queryWithMcpStreaming, capture the tool calls and
 * the synthesis text, forward phase-boundary events as SSE. The composed
 * system prompt is built once in the caller so its hash anchors the trace
 * before any LLM call fires.
 */
async function runPhaseA(args: {
  query: string;
  portal: string;
  model: ModelIdentity;
  emit: (event: NotebookEvent) => Promise<void>;
  trace: TraceBuilder;
  systemPrompt: string;
  systemPromptHash: string;
}): Promise<CompletionResult> {
  const { query, portal, model, emit, trace, systemPrompt, systemPromptHash } = args;
  return new Promise<CompletionResult>((resolve, reject) => {
    let completionResult: CompletionResult | null = null;
    const sentToolCalls = new Set<string>();
    // 45s per individual tool call. The route states the value; the race and
    // the timer's disposal live in the loop core (#352).
    const MCP_TOOL_TIMEOUT_MS = 45_000;

    const callbacks: StreamCallbacks = {
      onProgress: (panel, message, opts) => {
        if (panel !== 'withMcp') return;
        // Every tool-phase line the loop reports, not only the start (#384
        // P8, F2): this used to forward `tool_start` alone, so a call's end
        // — and a rejection, which only an end event can carry — never
        // reached the notebook page. Hand-picked fields, so what the loop
        // recorded has to be carried here by name: the tool and its
        // operation type, absent when the loop derived none, and the
        // rejection, absent when the call was answered.
        if (opts?.phase === 'tool_start' || opts?.phase === 'tool_complete' || opts?.phase === 'tool_result') {
          void emit({
            type: 'phase_a_progress',
            message,
            phase: opts.phase,
            iteration: opts.iteration,
            ...(opts.toolName !== undefined ? { toolName: opts.toolName } : {}),
            ...(opts.operationType !== undefined ? { operationType: opts.operationType } : {}),
            ...(opts.failed !== undefined ? { failed: opts.failed } : {}),
            ...(opts.failureKind !== undefined ? { failureKind: opts.failureKind } : {}),
          });
        }
      },
      onToken: () => { /* swallowed for v1 — Phase 2a will surface */ },
      onComplete: (panel, result) => {
        if (panel !== 'withMcp') return;
        completionResult = result;
        for (const call of result.tools_called ?? []) {
          const key = `${call.name}:${JSON.stringify(call.args)}`;
          if (sentToolCalls.has(key)) continue;
          sentToolCalls.add(key);
          void emit({
            type: 'phase_a_tool_call',
            name: call.name,
            operationType: call.operationType,
            reason: call.reason,
            resultSummary: call.resultSummary,
            // #112: carry the verbatim arguments + timing so a publish from
            // this session can populate `toolCalls[].args` (the package's
            // `queries[].arguments`) instead of an empty skeleton.
            args: call.args,
            duration_ms: call.duration_ms,
            // #384 F5: a call the source rejected says so on this event too —
            // the notebook page publishes from what this stream carried, and
            // this emission used to pick every field but these two. Written
            // only when the record carried them; absent stays absent.
            ...(call.failed !== undefined ? { failed: call.failed } : {}),
            ...(call.failureKind !== undefined ? { failureKind: call.failureKind } : {}),
          });
        }
        void emit({ type: 'phase_a_answer', content: result.content });
      },
      onError: (panel, message, code) => {
        if (panel !== 'withMcp') return;
        // `message` is already reader-facing copy and `code` the classified
        // kind (#154). Carry the kind on the rejection so the client renders
        // the specific copy for it rather than re-deriving a kind from this
        // prefixed prose, which would flatten several kinds to the generic one.
        reject(Object.assign(new Error(`Phase A failed: ${message}`), { code }));
      },
    };

    queryWithMcpStreaming(
      query,
      model,
      mcpTools,
      // Just the transport. Portal injection and the timeout race are the loop
      // core's now (#359, #352): performed here they ran after the core had
      // recorded the call and stringified its arguments onto the span, and the
      // timer this file armed per tool call was never cleared.
      callMcpTool,
      systemPrompt,
      callbacks,
      { builder: trace, parentSpanId: trace.rootSpanId, systemPromptHash, resolveToolSource: (name) => routeTool(name).sourceId },
      { portal, toolTimeoutMs: MCP_TOOL_TIMEOUT_MS },
    )
      .then(() => {
        if (completionResult) resolve(completionResult);
        else reject(new Error('Phase A completed without a result'));
      })
      .catch(reject);
  });
}
