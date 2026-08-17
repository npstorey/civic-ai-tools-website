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
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit, incrementRateLimit, isRateLimited } from '@/lib/rate-limit';
import { mcpTools } from '@/lib/mcp/tools';
import { callMcpTool, routeTool } from '@/lib/mcp/client';
import { buildSystemPrompt } from '@/lib/mcp/socrata-skill';
import {
  queryWithMcpStreaming,
  type CompletionResult,
  type StreamCallbacks,
} from '@/lib/openrouter-streaming';
import { TraceBuilder, hash as traceHash, CIVICAITOOLS_TRACE_CONFIG } from '@/lib/evidence/trace';
import { getConfiguredKeyId } from '@/lib/evidence/signing';
import {
  type PhaseAToolCall,
  stampExecutedNotebook,
  synthesizeNotebook,
  validateExecutedNotebook,
} from '@/lib/notebook-author';
import { executeNotebook, NotebookExecutionError } from '@/lib/sandbox';

const DEFAULT_PORTAL = 'data.cityofnewyork.us';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

interface QueryNotebookRequest {
  query: string;
  portal?: string;
  model?: string;
}

type NotebookEvent =
  | { type: 'phase'; name: 'A' | 'B' | 'C' | 'D' | 'complete'; message: string }
  | { type: 'phase_a_progress'; message: string; phase?: string; iteration?: number }
  | { type: 'phase_a_tool_call'; name: string; operationType?: string; reason?: string; resultSummary?: { rows: number; columns: number }; args?: Record<string, unknown>; duration_ms?: number }
  | { type: 'phase_a_answer'; content: string }
  // `signingKeyId` is null when this instance has declared no EVIDENCE_KEY_ID:
  // the Signers section then shows honest absence rather than some other
  // deployment's kid. This is a DISPLAY surface, so it reads the non-throwing
  // probe; nothing here commits to the value.
  | { type: 'metadata'; composedSystemPrompt: string; composedSystemPromptHash: string; signingKeyId: string | null }
  | { type: 'notebook'; notebook: unknown; sandboxId: string; executionDuration_ms: number; validation: { ok: boolean; issues: { path: string; message: string }[] } }
  // Publish-path inputs (civic-ai-tools-website#112): everything the client
  // needs to publish the executed session through POST /api/evidence without
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
  | { type: 'error'; message: string };

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
  const model = body.model || DEFAULT_MODEL;

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
    'analysis.model': model,
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
        modelName: model,
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

      const validation = validateExecutedNotebook(stamped.notebook);
      await emit({
        type: 'notebook',
        notebook: stamped.notebook,
        sandboxId: execution.sandboxId,
        executionDuration_ms: Date.now() - execStart,
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
      // Log full stderr server-side (Vercel function logs) so the actual
      // preprocess_cell exception is recoverable for debugging — the SSE
      // payload only carries a tail of the traceback to keep the UI sane.
      if (err instanceof NotebookExecutionError) {
        console.error('[query-notebook] NotebookExecutionError', {
          exitCode: err.exitCode,
          message: err.message,
          stderr: err.stderr,
        });
      } else if (err instanceof Error) {
        console.error('[query-notebook] error', { message: err.message, stack: err.stack });
      } else {
        console.error('[query-notebook] unknown error', err);
      }

      // The Python exception nbconvert raises lives at the TAIL of stderr
      // (the cell traceback + `<exception type>: <message>` is the last
      // thing printed). Slice the last 8000 chars so the user sees the
      // smoking gun rather than the warmup boilerplate.
      const STDERR_TAIL_CHARS = 8000;
      const stderrTail = (s: string): string => {
        if (s.length <= STDERR_TAIL_CHARS) return s;
        return `…(stderr truncated; full output in server logs)…\n${s.slice(-STDERR_TAIL_CHARS)}`;
      };
      const message = err instanceof NotebookExecutionError
        ? `Notebook execution failed (exit ${err.exitCode ?? 'n/a'}): ${err.message}${err.stderr ? `\n${stderrTail(err.stderr)}` : ''}`
        : err instanceof Error ? err.message : 'Unknown error';
      await emit({ type: 'error', message });
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
  model: string;
  emit: (event: NotebookEvent) => Promise<void>;
  trace: TraceBuilder;
  systemPrompt: string;
  systemPromptHash: string;
}): Promise<CompletionResult> {
  const { query, portal, model, emit, trace, systemPrompt, systemPromptHash } = args;
  return new Promise<CompletionResult>((resolve, reject) => {
    let completionResult: CompletionResult | null = null;
    const sentToolCalls = new Set<string>();
    const MCP_TOOL_TIMEOUT_MS = 45_000;

    const callbacks: StreamCallbacks = {
      onProgress: (panel, message, opts) => {
        if (panel !== 'withMcp') return;
        if (opts?.phase === 'tool_start') {
          void emit({
            type: 'phase_a_progress',
            message,
            phase: opts.phase,
            iteration: opts.iteration,
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
          });
        }
        void emit({ type: 'phase_a_answer', content: result.content });
      },
      onError: (panel, message) => {
        if (panel !== 'withMcp') return;
        reject(new Error(`Phase A failed: ${message}`));
      },
    };

    queryWithMcpStreaming(
      query,
      model,
      mcpTools,
      async (name, toolArgs) => {
        if (name === 'get_data' && !toolArgs.portal) {
          toolArgs.portal = portal;
        }
        return Promise.race([
          callMcpTool(name, toolArgs),
          new Promise<never>((_, rj) =>
            setTimeout(
              () => rj(new Error(`MCP tool "${name}" timed out after ${MCP_TOOL_TIMEOUT_MS / 1000}s`)),
              MCP_TOOL_TIMEOUT_MS,
            ),
          ),
        ]);
      },
      systemPrompt,
      callbacks,
      { builder: trace, parentSpanId: trace.rootSpanId, systemPromptHash, resolveToolSource: (name) => routeTool(name).sourceId },
    )
      .then(() => {
        if (completionResult) resolve(completionResult);
        else reject(new Error('Phase A completed without a result'));
      })
      .catch(reject);
  });
}
