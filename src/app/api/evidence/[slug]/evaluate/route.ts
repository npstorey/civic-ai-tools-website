import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import { canReadRecord } from '@/lib/evidence/committed-access';
import type { EvidencePackage } from '@/lib/evidence/packager';

const EVALUATION_RUBRIC = `You are an independent evaluator assessing an AI-generated civic data analysis.

You will receive:
1. The original prompt (question asked)
2. The tool calls made (MCP queries to Socrata open data portals)
3. The AI's final output/analysis

Evaluate the analysis against these 6 criteria, scoring each 1-10:

a) **Data Source Identification** (1-10): Does the output correctly identify the data source(s) and time period? Are dataset IDs, portal domains, and date ranges accurate?

b) **Quantitative Claim Support** (1-10): Are the quantitative claims (numbers, percentages, rankings) supported by the data returned in the tool calls? Cross-check key figures against the raw data.

c) **Confounders and Bias** (1-10): Does the analysis acknowledge obvious confounders, selection biases, or framing issues? Are there lurking variables or cherry-picked timeframes?

d) **Geographic Scope** (1-10): Is the geographic scope appropriate for the question? Does the analysis avoid over-generalizing from one jurisdiction?

e) **Limitations Noted** (1-10): Are limitations and caveats noted? Does the analysis flag data quality issues, missing fields, or incomplete coverage?

f) **Contradictory Conclusion** (1-10): Could the same data reasonably support a contradictory conclusion? Does the analysis consider alternative interpretations?

Respond in this exact JSON format (no markdown fences, just raw JSON):
{
  "dataSourceIdentification": { "score": <1-10>, "comment": "<1-2 sentences>" },
  "quantitativeClaimSupport": { "score": <1-10>, "comment": "<1-2 sentences>" },
  "confoundersAndBias": { "score": <1-10>, "comment": "<1-2 sentences>" },
  "geographicScope": { "score": <1-10>, "comment": "<1-2 sentences>" },
  "limitationsNoted": { "score": <1-10>, "comment": "<1-2 sentences>" },
  "contradictoryConclusion": { "score": <1-10>, "comment": "<1-2 sentences>" },
  "overallScore": <average of all 6 scores, one decimal>,
  "assessment": "<2-4 sentence overall assessment>"
}`;

function buildEvaluationPrompt(pkg: EvidencePackage): string {
  const toolCallSummary = pkg.queries
    .map((q, i) => {
      const argStr = Object.entries(q.arguments)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      return `  ${i + 1}. ${q.tool}(${argStr}) → ${q.resultRows ?? '?'} rows`;
    })
    .join('\n');

  const dataSources = pkg.dataSources
    .map(ds => `  - ${ds.datasetUrl} (accessed ${ds.accessTimestamp})`)
    .join('\n');

  return `## Original Prompt
${pkg.prompt.text || '[prompt text not available]'}

## Tool Calls Made (${pkg.queries.length} total)
${toolCallSummary || '  (none)'}

## Data Sources
${dataSources || '  (none)'}

## Model Used
${pkg.cost.model}

## AI Output
${pkg.output}`;
}

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

  const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openRouterApiKey,
  });

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

    // Parse JSON response — strip markdown fences if present
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: 'Evaluator returned invalid JSON', raw },
        { status: 502 },
      );
    }

    // Validate rubric structure
    const criteria = [
      'dataSourceIdentification', 'quantitativeClaimSupport', 'confoundersAndBias',
      'geographicScope', 'limitationsNoted', 'contradictoryConclusion',
    ];
    for (const key of criteria) {
      if (!parsed[key] || typeof parsed[key].score !== 'number') {
        return NextResponse.json(
          { error: `Missing or invalid rubric criterion: ${key}`, raw },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({
      rubric: {
        dataSourceIdentification: parsed.dataSourceIdentification,
        quantitativeClaimSupport: parsed.quantitativeClaimSupport,
        confoundersAndBias: parsed.confoundersAndBias,
        geographicScope: parsed.geographicScope,
        limitationsNoted: parsed.limitationsNoted,
        contradictoryConclusion: parsed.contradictoryConclusion,
      },
      overallScore: parsed.overallScore ?? (
        criteria.reduce((sum, k) => sum + parsed[k].score, 0) / criteria.length
      ),
      assessment: parsed.assessment || '',
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
