import { NextRequest, NextResponse } from 'next/server';
import { createModelClient } from '@/lib/model-client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import { canReadRecord } from '@/lib/evidence/committed-access';
import type { EvidencePackage } from '@/lib/evidence/packager';
// Rubric, prompt builder, and response parsing are shared with the
// publication gate (civic-ai-tools#72 Phase 3) via the adversarial-eval lib.
import {
  EVALUATION_RUBRIC,
  buildEvaluationPrompt,
  parseEvaluationResponse,
} from '@/lib/evidence/adversarial-eval';

/**
 * POST /api/evidence/[slug]/evaluate
 *
 * Sends the evidence package to an evaluator model with a structured rubric.
 * Uses the caller's OpenRouter API key — never stored.
 *
 * Body: { openRouterApiKey: string, evaluatorModel: string }
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
  const { openRouterApiKey, evaluatorModel } = body;
  if (!openRouterApiKey || typeof openRouterApiKey !== 'string') {
    return NextResponse.json({ error: 'OpenRouter API key required' }, { status: 400 });
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
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }
  const record = records[0];

  // Committed records are creator-only on this content-bearing surface
  // (civic-ai-tools#71).
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }

  if (!record.basePackageStorageKey) {
    return NextResponse.json({ error: 'No evidence package available' }, { status: 400 });
  }
  const pkg = (await getPackage(record.basePackageStorageKey)) as EvidencePackage | null;
  if (!pkg) {
    return NextResponse.json({ error: 'Evidence package not found in storage' }, { status: 404 });
  }

  // Evaluator model must differ from analysis model
  if (evaluatorModel === pkg.cost.model) {
    return NextResponse.json(
      { error: 'Evaluator model must differ from the analysis model' },
      { status: 400 },
    );
  }

  const openrouter = createModelClient({ apiKey: openRouterApiKey });

  try {
    const evaluationContent = buildEvaluationPrompt(pkg);

    const response = await openrouter.chat.completions.create({
      model: evaluatorModel,
      messages: [
        { role: 'system', content: EVALUATION_RUBRIC },
        { role: 'user', content: evaluationContent },
      ],
      max_tokens: 2000,
    });

    const raw = response.choices[0]?.message?.content || '';

    const parsed = parseEvaluationResponse(raw);
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
      evaluatorModel,
    });
  } catch (error) {
    console.error('[evaluate] Error:', error);
    const message = error instanceof Error ? error.message : 'Evaluation failed';
    if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid')) {
      return NextResponse.json({ error: 'Invalid OpenRouter API key' }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
