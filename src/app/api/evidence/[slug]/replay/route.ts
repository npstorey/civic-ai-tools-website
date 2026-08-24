import { NextRequest, NextResponse } from 'next/server';
import { createModelClient, classifyModelError } from '@/lib/model-client';
import {
  CALLER_MODEL_KEY_REJECTED_MESSAGE,
  callerModelKeyFailure,
  resolveCallerModelKey,
} from '@/lib/caller-model-key';
import { endpointModelForDeclared } from '@/lib/model-resolver';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import { canReadRecord } from '@/lib/evidence/sealed-access';
import { mcpTools } from '@/lib/mcp/tools';
import { callMcpTool } from '@/lib/mcp/client';
import { getMissingMcpRoutingError } from '@/lib/mcp/registry';
import { buildSystemPrompt } from '@/lib/mcp/socrata-skill';
import type { EvidencePackage } from '@/lib/evidence/packager';

const MAX_TOOL_RESULT_CHARS = 50_000;
const MAX_ITERATIONS = 20;
const MCP_TOOL_TIMEOUT_MS = 45_000;

function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const sampleRow = JSON.stringify(parsed[0]);
      const rowSize = sampleRow.length + 2;
      const maxRows = Math.max(5, Math.floor(MAX_TOOL_RESULT_CHARS / rowSize));
      const truncated = parsed.slice(0, maxRows);
      return JSON.stringify(truncated) +
        `\n[Truncated: showing ${truncated.length} of ${parsed.length} rows]`;
    }
  } catch { /* fall through */ }
  return result.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n[Truncated: result was ${result.length} characters]`;
}

/**
 * POST /api/evidence/[slug]/replay
 *
 * Runs one full MCP-enabled analysis replay using a model API key the caller
 * supplies — the key for whatever chat-completions endpoint THIS instance is
 * configured to call, not any particular vendor's. Never stored.
 * Used by the consistency test flow — the client calls this N times and aggregates results.
 *
 * Body: { modelApiKey: string }
 *   `openRouterApiKey` is the prior-era name for that field and is accepted
 *   indefinitely (website#30 G0 D7) — see `src/lib/caller-model-key.ts`.
 * Returns: { toolCalls, output, tokenUsage, durationMs }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();
  const callerKey = resolveCallerModelKey(body);
  if (!callerKey.ok) {
    return NextResponse.json({ error: callerKey.error }, { status: 400 });
  }

  // A replay runs live MCP tool calls, so it needs a configured MCP endpoint
  // exactly like the query routes (#258 C4): SOCRATA_MCP_URL has no coded
  // fallback, and an unconfigured instance refuses rather than replaying
  // through another deployment's infrastructure.
  const mcpRoutingError = getMissingMcpRoutingError();
  if (mcpRoutingError) {
    console.error('[replay]', mcpRoutingError.message);
    return NextResponse.json(
      { error: mcpRoutingError.message, code: mcpRoutingError.code },
      { status: 503 },
    );
  }

  // Fetch evidence record
  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  const record = records[0];

  // Sealed records are creator-only on this content-bearing surface
  // (civic-ai-tools#71).
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  // Fetch evidence package
  if (!record.basePackageStorageKey) {
    return NextResponse.json({ error: 'No record package available' }, { status: 400 });
  }
  const pkg = (await getPackage(record.basePackageStorageKey)) as EvidencePackage | null;
  if (!pkg) {
    return NextResponse.json({ error: 'Record package not found in storage' }, { status: 404 });
  }

  // Require full prompt text for replay
  if (!pkg.prompt.text) {
    return NextResponse.json(
      { error: 'Cannot replay: prompt text not available (hash-only visibility)' },
      { status: 400 },
    );
  }

  const prompt = pkg.prompt.text;
  // website#30 P3, the split read in reverse. `pkg.cost.model` is a DECLARED
  // identity — under a catalog where the two strings differ it is not a string
  // any endpoint answers to, so replaying it verbatim would fail the request.
  // Mapped back to the wire string this instance reaches that model with;
  // carried through unchanged when no entry declares it, which is what a record
  // naming a model this instance no longer offers has always done.
  const model = endpointModelForDeclared(pkg.cost.model);
  const portal = pkg.dataSources[0]?.portalUrl?.replace('https://', '') || 'data.cityofnewyork.us';

  // Build system prompt (regenerated fresh — may differ slightly if guidance updated)
  const systemPrompt = await buildSystemPrompt(portal);

  // Create a model client with the user's API key
  const openrouter = createModelClient({ apiKey: callerKey.apiKey });

  const startTime = Date.now();
  const toolsCalled: { name: string; args: Record<string, unknown> }[] = [];
  let cumulativeTokens = 0;
  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;

  try {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    let response = await openrouter.chat.completions.create({
      model,
      messages,
      tools: mcpTools,
      tool_choice: 'auto',
      max_tokens: 4000,
    });

    cumulativeTokens += response.usage?.total_tokens || 0;
    cumulativePromptTokens += response.usage?.prompt_tokens || 0;
    cumulativeCompletionTokens += response.usage?.completion_tokens || 0;

    let iterations = 0;

    // Tool-calling loop
    while (response.choices[0]?.message?.tool_calls && iterations < MAX_ITERATIONS) {
      const assistantMessage = response.choices[0].message;
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls!) {
        if (toolCall.type !== 'function') continue;

        const args = JSON.parse(toolCall.function.arguments);
        // Socrata's get_data expects a portal; Data Commons tools don't — only inject for Socrata.
        if (toolCall.function.name === 'get_data' && !args.portal) args.portal = portal;
        toolsCalled.push({ name: toolCall.function.name, args });

        try {
          const result = await Promise.race([
            callMcpTool(toolCall.function.name, args),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`MCP tool timed out after ${MCP_TOOL_TIMEOUT_MS / 1000}s`)),
                MCP_TOOL_TIMEOUT_MS,
              ),
            ),
          ]);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: truncateToolResult(result),
          });
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      }

      // Token budget check
      if (cumulativeTokens >= 200_000) break;

      response = await openrouter.chat.completions.create({
        model,
        messages,
        tools: mcpTools,
        tool_choice: 'auto',
        max_tokens: 4000,
      });

      cumulativeTokens += response.usage?.total_tokens || 0;
      cumulativePromptTokens += response.usage?.prompt_tokens || 0;
      cumulativeCompletionTokens += response.usage?.completion_tokens || 0;
      iterations++;
    }

    // Extract final output
    let output = response.choices[0]?.message?.content || '';

    // If still pending tool calls, force a final response
    if (!output && response.choices[0]?.message?.tool_calls) {
      messages.push(response.choices[0].message);
      for (const tc of response.choices[0].message.tool_calls) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: 'Limit reached. Please summarize based on data collected.',
        });
      }
      const finalResponse = await openrouter.chat.completions.create({
        model,
        messages: [
          ...messages,
          { role: 'user', content: 'Based on the data collected, please provide a comprehensive answer.' },
        ],
        max_tokens: 4000,
      });
      output = finalResponse.choices[0]?.message?.content || '';
      cumulativeTokens += finalResponse.usage?.total_tokens || 0;
      cumulativePromptTokens += finalResponse.usage?.prompt_tokens || 0;
      cumulativeCompletionTokens += finalResponse.usage?.completion_tokens || 0;
    }

    return NextResponse.json({
      toolCalls: toolsCalled,
      output,
      tokenUsage: {
        promptTokens: cumulativePromptTokens,
        completionTokens: cumulativeCompletionTokens,
        totalTokens: cumulativeTokens,
      },
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[replay] Error:', error);
    // Structural first (website#30 P4): an SDK `APIError` carries a status, so
    // an upstream refusal is classified by shape rather than guessed from
    // wording — which also separates the model service's 429 from this app's
    // own per-day limiter, and returns copy scoped to the CALLER's key rather
    // than to a server environment variable that is not at fault here. The
    // text probe below is kept as a fallback for error shapes that carry only a
    // message; it is deliberately narrower than the classifier, not a
    // replacement for it.
    const typed = callerModelKeyFailure(classifyModelError(error));
    if (typed) {
      return NextResponse.json({ error: typed.error, code: typed.code }, { status: typed.status });
    }
    const message = error instanceof Error ? error.message : 'Replay failed';
    if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid')) {
      return NextResponse.json(
        { error: CALLER_MODEL_KEY_REJECTED_MESSAGE, code: 'model_auth_rejected' },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
