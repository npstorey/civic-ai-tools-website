import { NextRequest, NextResponse } from 'next/server';
import { classifyModelError } from '@/lib/model-client';
import {
  CALLER_MODEL_KEY_REJECTED_MESSAGE,
  callerModelKeyFailure,
  resolveCallerModelKey,
} from '@/lib/caller-model-key';
import { modelIdentityForValue } from '@/lib/model-resolver';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import { canReadRecord } from '@/lib/evidence/sealed-access';
import type { EvidencePackage } from '@/lib/evidence/packager';
// The rubric call itself is shared with the publication gate
// (civic-ai-tools#72 Phase 3) — this route reaches it through
// `runAdversarialEval` rather than assembling its own copy (#348).
import { runAdversarialEval } from '@/lib/evidence/adversarial-eval';

/**
 * POST /api/evidence/[slug]/evaluate
 *
 * Sends the evidence package to an evaluator model with a structured rubric.
 * Uses a model API key the caller supplies — the key for whatever
 * chat-completions endpoint THIS instance is configured to call, not any
 * particular vendor's. Never stored.
 *
 * Body: { modelApiKey: string, evaluatorModel: string }
 *   `openRouterApiKey` is the prior-era name for the key field and is accepted
 *   indefinitely (website#30 G0 D7) — see `src/lib/caller-model-key.ts`.
 * Returns: { rubric, overallScore, assessment, evaluatorModel }
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
  const { evaluatorModel } = body;
  const callerKey = resolveCallerModelKey(body);
  if (!callerKey.ok) {
    return NextResponse.json({ error: callerKey.error }, { status: 400 });
  }
  if (!evaluatorModel || typeof evaluatorModel !== 'string') {
    return NextResponse.json({ error: 'Evaluator model required' }, { status: 400 });
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

  if (!record.basePackageStorageKey) {
    return NextResponse.json({ error: 'No record package available' }, { status: 400 });
  }
  const pkg = (await getPackage(record.basePackageStorageKey)) as EvidencePackage | null;
  if (!pkg) {
    return NextResponse.json({ error: 'Record package not found in storage' }, { status: 404 });
  }

  // website#30 P3, unchanged by P4. Resolved tolerantly: this preview runs on a
  // caller's own key, and the route has never validated the id against the
  // catalog, so an unoffered id is carried through exactly as before rather
  // than newly refused. P4 removed the reason this was most likely to happen —
  // the dialog now offers this instance's own catalog rather than a stale
  // hardcoded five — but the route is an API, not only the dialog's backend,
  // and tightening it is a product change that belongs with the same decision
  // for `/api/compare*`. Independence is checked declared-against-declared —
  // `pkg.cost.model` is a recorded identity, and comparing it to a catalog id
  // compares two namespaces.
  const evaluator = modelIdentityForValue(evaluatorModel);

  // Evaluator model must differ from analysis model
  if (evaluator.declared === pkg.cost.model) {
    return NextResponse.json(
      { error: 'Evaluator model must differ from the analysis model' },
      { status: 400 },
    );
  }

  try {
    // #348: this route used to carry its own copy of the rubric call — same
    // rubric, same prompt builder, same max_tokens as
    // `runAdversarialEval`, differing only in where the key came from and how
    // errors were handled. Neither of those is a reason for a second call
    // site: the key is a parameter of the one function (`opts.apiKey`, already
    // optional so the publication gate can let `createModelClient` resolve the
    // platform credential itself), and the error handling is this route's
    // catch block, which is where it always was. So the copy is gone and the
    // model-call registry is one entry shorter.
    //
    // The wire gets the endpoint string; the response below reports the
    // declared identity, which is what a reader would compare a record to.
    const parsed = await runAdversarialEval(pkg, {
      apiKey: callerKey.apiKey,
      evaluatorModel: evaluator,
    });

    // The structural check that makes the bare `content || ''` extraction
    // inside `runAdversarialEval` safe. A narration that is not a well-formed
    // rubric response fails the parse and is refused here — it is never
    // rendered as an evaluation and never reaches a published record.
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, raw: parsed.raw }, { status: 502 });
    }
    const { perCriterion, overallScore, assessment } = parsed.results;

    return NextResponse.json({
      rubric: {
        dataSourceIdentification: perCriterion.dataSourceIdentification,
        quantitativeClaimSupport: perCriterion.quantitativeClaimSupport,
        confoundersAndBias: perCriterion.confoundersAndBias,
        geographicScope: perCriterion.geographicScope,
        limitationsNoted: perCriterion.limitationsNoted,
        contradictoryConclusion: perCriterion.contradictoryConclusion,
      },
      overallScore,
      assessment,
      evaluatorModel: evaluator.declared,
    });
  } catch (error) {
    console.error('[evaluate] Error:', error);
    // Same structural-first handling as the replay route (website#30 P4): the
    // SDK's status classifies an upstream refusal, which is what keeps the
    // model service's 429 apart from this app's own per-day limiter and keeps
    // the copy addressed to the CALLER whose key it is. The text probe stays as
    // a fallback for shapes that carry only a message.
    const typed = callerModelKeyFailure(classifyModelError(error));
    if (typed) {
      return NextResponse.json({ error: typed.error, code: typed.code }, { status: typed.status });
    }
    const message = error instanceof Error ? error.message : 'Evaluation failed';
    if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid')) {
      return NextResponse.json(
        { error: CALLER_MODEL_KEY_REJECTED_MESSAGE, code: 'model_auth_rejected' },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
