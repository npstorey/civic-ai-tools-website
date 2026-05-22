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
import { TraceBuilder, hash as traceHash } from '@/lib/evidence/trace';
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
  | { type: 'phase_a_tool_call'; name: string; operationType?: string; reason?: string; resultSummary?: { rows: number; columns: number } }
  | { type: 'phase_a_answer'; content: string }
  | { type: 'notebook'; notebook: unknown; sandboxId: string; executionDuration_ms: number; validation: { ok: boolean; issues: { path: string; message: string }[] } }
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

  const trace = new TraceBuilder();
  trace.startRoot('executed_notebook', {
    'analysis.prompt_hash': traceHash(body.query),
    'analysis.model': model,
    'analysis.portal': portal,
  });

  const runPipeline = async () => {
    try {
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
    } catch (err) {
      const message = err instanceof NotebookExecutionError
        ? `Notebook execution failed (exit ${err.exitCode ?? 'n/a'}): ${err.message}${err.stderr ? `\n${err.stderr.slice(0, 4000)}` : ''}`
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
