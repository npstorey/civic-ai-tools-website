import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { queryWithoutMcpStreaming, queryWithMcpStreaming, type StreamCallbacks, type ProgressOpts } from '@/lib/openrouter-streaming';
import { mcpTools } from '@/lib/mcp/tools';
import { callMcpTool, routeTool } from '@/lib/mcp/client';
import { buildSystemPrompt } from '@/lib/mcp/socrata-skill';
import { checkRateLimit, incrementRateLimit, isRateLimited } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { encodeSSE, panelsForRun, type StreamErrorCode, type PanelType, type StreamEvent } from '@/lib/streaming';
import { getMissingModelCredentialError } from '@/lib/model-client';
import { getMissingMcpRoutingError, readMcpEnvFromProcess, skillRoutingTraceAttributes } from '@/lib/mcp/registry';
import { TraceBuilder, hash, CIVICAITOOLS_TRACE_CONFIG } from '@/lib/evidence/trace';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
} as const;

interface CompareRequest {
  query: string;
  model: string;
  portal?: string;
  mcpOnly?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: CompareRequest = await request.json();
    const { query, model, portal: rawPortal = 'data.cityofnewyork.us', mcpOnly = false } = body;
    const portal = rawPortal || 'data.cityofnewyork.us';

    if (!query || !model) {
      return new Response(
        JSON.stringify({ error: 'Query and model are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fail fast when the instance has no model credential (#178). Checked
    // before rate limiting (a misconfigured instance must not burn quota) and
    // before any upstream work (skill fetch, MCP init). Surfaced as typed SSE
    // error events — the channel the client already renders — plus a server
    // log line for the operator.
    const credentialError = getMissingModelCredentialError();
    if (credentialError) {
      console.error('[compare-stream]', credentialError.message);
      const encoder = new TextEncoder();
      const body = panelsForRun(mcpOnly)
        .map((panel) =>
          encodeSSE({
            type: 'error',
            panel,
            message: credentialError.message,
            code: credentialError.code,
          } as StreamEvent & { message: string; code: StreamErrorCode })
        )
        .join('');
      return new Response(encoder.encode(body), { headers: SSE_HEADERS });
    }

    // Fail fast when the instance names no MCP endpoint for the primary data
    // source (#258 C4). SOCRATA_MCP_URL has no coded fallback — an
    // unconfigured instance refuses the query rather than routing it through
    // another deployment's infrastructure. Same shape and ordering rationale
    // as the model-credential guard above.
    const mcpRoutingError = getMissingMcpRoutingError();
    if (mcpRoutingError) {
      console.error('[compare-stream]', mcpRoutingError.message);
      const encoder = new TextEncoder();
      const body = panelsForRun(mcpOnly)
        .map((panel) =>
          encodeSSE({
            type: 'error',
            panel,
            message: mcpRoutingError.message,
            code: mcpRoutingError.code,
          } as StreamEvent & { message: string; code: StreamErrorCode })
        )
        .join('');
      return new Response(encoder.encode(body), { headers: SSE_HEADERS });
    }

    // Get session and identifier for rate limiting
    const session = await getServerSession(authOptions);
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0] || 'unknown';
    const identifier = session?.user?.id || ip;
    const isAuthenticated = !!session?.user?.id;

    // Check rate limit
    const rateLimitInfo = await checkRateLimit(identifier, isAuthenticated);
    if (isRateLimited(rateLimitInfo)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', rateLimit: rateLimitInfo }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Increment rate limit
    await incrementRateLimit(identifier, isAuthenticated);

    // --- Evidence trace: initialize ---
    const trace = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
    trace.startRoot('analysis', {
      'analysis.prompt_hash': hash(query),
      'analysis.model': model,
      'analysis.portal': portal,
    });

    // Fetch skill guidance (with trace span). The composed prompt spans both
    // MCP sources (Socrata + Data Commons), so record both server URLs — as
    // CONFIGURED, never defaulted (#258 A9): the signed trace records only
    // routing this instance explicitly set, and honestly omits the Socrata
    // field when unset (the guard above refused the query in that state).
    const skillFetchSpanId = trace.startSpan('skill_fetch');
    const systemPromptWithMcp = await buildSystemPrompt(portal);
    const systemPromptHash = hash(systemPromptWithMcp);
    trace.endSpan(skillFetchSpanId, {
      'skill.text_hash': systemPromptHash,
      'skill.text': systemPromptWithMcp,
      ...skillRoutingTraceAttributes(readMcpEnvFromProcess()),
    });

    const systemPromptWithoutMcp = `You are a helpful assistant.
When answering questions about civic data, government statistics, or local information,
do your best to provide helpful information based on your training data.
Be honest if you don't have access to current or real-time data.`;

    // Create a TransformStream for SSE
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Helper to write SSE events
    const writeEvent = async (event: StreamEvent) => {
      await writer.write(encoder.encode(encodeSSE(event)));
    };

    // Create callbacks for streaming
    const callbacks: StreamCallbacks = {
      onProgress: (panel: PanelType, message: string, opts?: ProgressOpts) => {
        writeEvent({ type: 'progress', panel, message, ...opts } as StreamEvent & { message: string });
      },
      onToken: (panel: PanelType, content: string) => {
        writeEvent({ type: 'token', panel, content } as StreamEvent & { content: string });
      },
      onComplete: (panel: PanelType, result) => {
        writeEvent({ type: 'complete', panel, data: result });
      },
      onError: (panel: PanelType, message: string, code?: StreamErrorCode) => {
        writeEvent({
          type: 'error',
          panel,
          message,
          ...(code ? { code } : {}),
        } as StreamEvent & { message: string; code?: StreamErrorCode });
      },
    };

    // Run queries (both in parallel, or MCP-only when mcpOnly flag is set)
    const runQueries = async () => {
      try {
        const MCP_TOOL_TIMEOUT_MS = 45_000; // 45s timeout per individual tool call

        const mcpQuery = queryWithMcpStreaming(
          query,
          model,
          mcpTools,
          async (name, args) => {
            // Socrata tools expect a portal; Data Commons tools don't.
            if (name === 'get_data' && !args.portal) {
              args.portal = portal;
            }
            // Race the MCP call against a timeout so one slow tool call
            // cannot hang the entire SSE stream indefinitely.
            const result = await Promise.race([
              callMcpTool(name, args),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`MCP tool "${name}" timed out after ${MCP_TOOL_TIMEOUT_MS / 1000}s`)),
                  MCP_TOOL_TIMEOUT_MS,
                )
              ),
            ]);
            return result;
          },
          systemPromptWithMcp,
          callbacks,
          { builder: trace, parentSpanId: trace.rootSpanId, systemPromptHash, resolveToolSource: (name) => routeTool(name).sourceId },
        );

        if (mcpOnly) {
          await mcpQuery;
        } else {
          await Promise.all([
            queryWithoutMcpStreaming(query, model, systemPromptWithoutMcp, callbacks),
            mcpQuery,
          ]);
        }
      } catch (error) {
        console.error('Stream error:', error);
      } finally {
        // Finalize trace and send as final SSE event
        trace.endRoot();
        const traceJson = trace.finalize();
        await writeEvent({ type: 'trace' as StreamEvent['type'], panel: 'withMcp', data: traceJson });
        await writer.close();
      }
    };

    // Start the queries (non-blocking)
    runQueries();

    // Return the readable stream as SSE
    return new Response(stream.readable, { headers: SSE_HEADERS });
  } catch (error) {
    console.error('Compare stream API error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
