import { NextRequest, NextResponse } from 'next/server';
import { createModelClient, classifyModelError } from '@/lib/model-client';
import {
  CALLER_MODEL_KEY_REJECTED_MESSAGE,
  callerModelKeyFailure,
  resolveCallerModelKey,
} from '@/lib/caller-model-key';
import { endpointModelForDeclared } from '@/lib/model-resolver';
import { runToolLoop } from '@/lib/model-loop/run-tool-loop';
import { replayLoopOptions, replayPortalForPackage } from '@/lib/model-loop/replay-loop';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import { canReadRecord } from '@/lib/evidence/sealed-access';
import { getMissingMcpRoutingError } from '@/lib/mcp/registry';
import { buildSystemPrompt } from '@/lib/mcp/socrata-skill';
import type { EvidencePackage } from '@/lib/evidence/packager';

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
  // The portal the record's own calls named, or none (#384, F2). A record
  // that named no portal — a search/fetch-only run has no data-source entry —
  // replays with nothing injected and a system prompt that names no default
  // portal, rather than on a domain the record never mentioned; absence is
  // recorded as absence in the replayed calls' arguments, and so in the
  // identity keys the consistency attestation is computed over.
  const portal = replayPortalForPackage(pkg);

  // Build system prompt (regenerated fresh — may differ slightly if guidance updated)
  const systemPrompt = await buildSystemPrompt(portal);

  // Create a model client with the user's API key
  const openrouter = createModelClient({ apiKey: callerKey.apiKey });

  try {
    // The shared tool-calling loop (#345). Replay carried its own copy until
    // P3: the same loop, with its own exit condition, its own truncation and
    // its own error-to-model path — and each of those was a filed defect
    // (#338, #347, #331) that had already been fixed on the other copy.
    // Everything the loop is GIVEN lives in `replayLoopOptions`; nothing about
    // how it runs is decided here.
    const result = await runToolLoop(replayLoopOptions({
      client: openrouter,
      endpointModel: model,
      prompt,
      systemPrompt,
      portal,
    }));

    // The consistency-test payload, unchanged in shape. `toolCalls` entries
    // now additionally carry `operationType`, `reason`, `resultSummary`,
    // `duration_ms` and — for a call that failed — `failed`/`failureKind`
    // (#338). The identity fields the client keys a run on
    // (`name`, `args.type`, `args.dataset_id`, `args.portal`, the last of
    // which this route injects when the record named one) are byte-identical
    // to what it read before.
    return NextResponse.json({
      toolCalls: result.toolCalls,
      output: result.content,
      tokenUsage: result.usage,
      durationMs: result.durationMs,
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
