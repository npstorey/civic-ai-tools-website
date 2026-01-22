import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { queryWithoutMcpStreaming, queryWithMcpStreaming, type StreamCallbacks } from '@/lib/openrouter-streaming';
import { opengovMcpTools } from '@/lib/mcp/tools';
import { callMcpTool } from '@/lib/mcp/client';
import { buildSystemPrompt } from '@/lib/mcp/opengov-skill';
import { checkRateLimit, incrementRateLimit, isRateLimited } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { encodeSSE, type PanelType, type StreamEvent } from '@/lib/streaming';

interface CompareRequest {
  query: string;
  model: string;
  portal?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CompareRequest = await request.json();
    const { query, model, portal = 'data.cityofnewyork.us' } = body;

    if (!query || !model) {
      return new Response(
        JSON.stringify({ error: 'Query and model are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

    // System prompts
    const systemPromptWithMcp = buildSystemPrompt(portal);
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
      onProgress: (panel: PanelType, message: string) => {
        writeEvent({ type: 'progress', panel, message } as StreamEvent & { message: string });
      },
      onToken: (panel: PanelType, content: string) => {
        writeEvent({ type: 'token', panel, content } as StreamEvent & { content: string });
      },
      onComplete: (panel: PanelType, result) => {
        writeEvent({ type: 'complete', panel, data: result });
      },
      onError: (panel: PanelType, message: string) => {
        writeEvent({ type: 'error', panel, message } as StreamEvent & { message: string });
      },
    };

    // Run both queries in parallel (don't await here - let them stream)
    const runQueries = async () => {
      try {
        await Promise.all([
          queryWithoutMcpStreaming(query, model, systemPromptWithoutMcp, callbacks),
          queryWithMcpStreaming(
            query,
            model,
            opengovMcpTools,
            async (name, args) => {
              if (!args.portal) {
                args.portal = portal;
              }
              return callMcpTool(name, args);
            },
            systemPromptWithMcp,
            callbacks
          ),
        ]);
      } catch (error) {
        console.error('Stream error:', error);
      } finally {
        await writer.close();
      }
    };

    // Start the queries (non-blocking)
    runQueries();

    // Return the readable stream as SSE
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Compare stream API error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
