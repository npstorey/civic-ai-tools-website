import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { queryWithoutMcp, queryWithMcp } from '@/lib/openrouter';
import { opengovMcpTools } from '@/lib/mcp/tools';
import { callMcpTool } from '@/lib/mcp/client';
import { buildSystemPrompt } from '@/lib/mcp/opengov-skill';
import { checkRateLimit, incrementRateLimit, isRateLimited } from '@/lib/rate-limit';
import { headers } from 'next/headers';

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
      return NextResponse.json(
        { error: 'Query and model are required' },
        { status: 400 }
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
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          rateLimit: rateLimitInfo,
        },
        { status: 429 }
      );
    }

    // Increment rate limit
    await incrementRateLimit(identifier, isAuthenticated);

    // System prompt for the MCP-enabled query - uses skill module
    const systemPromptWithMcp = buildSystemPrompt(portal);

    // System prompt for the non-MCP query (to make it fair)
    const systemPromptWithoutMcp = `You are a helpful assistant.
When answering questions about civic data, government statistics, or local information,
do your best to provide helpful information based on your training data.
Be honest if you don't have access to current or real-time data.`;

    // Run both queries in parallel
    const [withoutMcpResult, withMcpResult] = await Promise.all([
      queryWithoutMcp(query, model, systemPromptWithoutMcp),
      queryWithMcp(
        query,
        model,
        opengovMcpTools,
        async (name, args) => {
          // Inject default portal if not specified
          if (!args.portal) {
            args.portal = portal;
          }
          return callMcpTool(name, args);
        },
        systemPromptWithMcp
      ),
    ]);

    return NextResponse.json({
      withoutMcp: withoutMcpResult,
      withMcp: withMcpResult,
    });
  } catch (error) {
    console.error('Compare API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
