import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { queryWithoutMcp, queryWithMcp } from '@/lib/openrouter';
import { mcpTools } from '@/lib/mcp/tools';
import { callMcpTool } from '@/lib/mcp/client';
import { buildSystemPrompt } from '@/lib/mcp/socrata-skill';
import { checkRateLimit, incrementRateLimit, isRateLimited } from '@/lib/rate-limit';
import { getMissingModelCredentialError, classifyModelError, ModelConfigurationError } from '@/lib/model-client';
import { resolveModelIdentity, ModelNotOfferedError } from '@/lib/model-resolver';
import type { ModelIdentity } from '@/lib/model-catalog';
import { streamErrorPayload } from '@/lib/streaming';
import { getMissingMcpRoutingError } from '@/lib/mcp/registry';
import { headers } from 'next/headers';

interface CompareRequest {
  query: string;
  model: string;
  portal?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CompareRequest = await request.json();
    const { query, model: modelId, portal: rawPortal = 'data.cityofnewyork.us' } = body;
    const portal = rawPortal || 'data.cityofnewyork.us';

    if (!query || !modelId) {
      return NextResponse.json(
        { error: 'Query and model are required' },
        { status: 400 }
      );
    }

    // Fail fast when the instance has no model credential (#178) — same shared
    // guard as the streaming route, before rate limiting or any upstream call.
    const credentialError = getMissingModelCredentialError();
    if (credentialError) {
      console.error('[compare]', credentialError.message);
      return NextResponse.json(
        { error: credentialError.message, code: credentialError.code },
        { status: 503 }
      );
    }

    // Fail fast when no MCP endpoint is configured for the primary data
    // source (#258 C4) — same guard as the streaming route: SOCRATA_MCP_URL
    // has no coded fallback, so an unconfigured instance refuses rather than
    // routing the query through another deployment's infrastructure.
    const mcpRoutingError = getMissingMcpRoutingError();
    if (mcpRoutingError) {
      console.error('[compare]', mcpRoutingError.message);
      return NextResponse.json(
        { error: mcpRoutingError.message, code: mcpRoutingError.code },
        { status: 503 }
      );
    }

    // website#30 P3 split the wire string from the recorded identity; P6 F1
    // made the resolution STRICT and moved it here, above everything that
    // costs anything. An id this instance does not offer is refused before the
    // skill fetch, before rate limiting and before any model call — the same
    // refusal, shape and reader copy the notebook route already raises (400
    // for a caller's bad id, 503 for an operator's unreadable catalog).
    //
    // This route records no identity of its own, but it is one of a pair with
    // /api/compare-stream, which does; a caller-supplied id that this route
    // accepted and its twin signed would be the same defect with an extra
    // step. The UI reaches neither refusal — `QueryForm` offers only ids from
    // /api/models, and `/explore` reads the same list since #314; both were
    // checked rather than assumed, because /explore's hardcoded id was
    // precisely what tolerant resolution had been hiding.
    let model: ModelIdentity;
    try {
      model = resolveModelIdentity(modelId);
    } catch (error) {
      if (error instanceof ModelNotOfferedError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof ModelConfigurationError) {
        console.error('[compare]', error.message);
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 503 }
        );
      }
      throw error;
    }

    // Get session and identifier for rate limiting
    const session = await getServerSession(authOptions);
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0] || 'unknown';
    const identifier = session?.user?.id || ip;
    const isAuthenticated = !!session?.user?.id;

    // THIS APP's own per-day request budget — never the model endpoint's.
    // It answers HTTP 429 and classifies as `rate_limit`; an endpoint's 429 is
    // `model_rate_limited` and is handled in the catch below (website#30 G0 D6).
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
    const systemPromptWithMcp = await buildSystemPrompt(portal);

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
        mcpTools,
        async (name, args) => {
          // Socrata tools expect a portal; Data Commons tools don't — only inject the default for Socrata's `get_data`.
          if (name === 'get_data' && !args.portal) {
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
    // Distinguish an upstream auth rejection (configured but refused key)
    // from other failures so the operator gets a typed, actionable response.
    const code = classifyModelError(error);
    if (code) {
      // website#30 P4: `model_rate_limited` joins the two credential codes here,
      // so an upstream rate limit is no longer reported as an unclassified 500.
      //
      // What the body says depends on whose message it is. A
      // `ModelConfigurationError` is THIS app's own typed, operator-actionable
      // text and names the variable to fix — it stays, verbatim. Anything else
      // classified here came from the endpoint, so the body carries the calm
      // reader-facing copy instead: the same #154 rule the streaming path
      // follows, applied to this JSON path, which is what keeps upstream status
      // codes and server names out of an API response.
      const message =
        error instanceof ModelConfigurationError
          ? error.message
          : streamErrorPayload(code).message;
      return NextResponse.json(
        { error: message, code },
        { status: code === 'model_not_configured' ? 503 : 502 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
