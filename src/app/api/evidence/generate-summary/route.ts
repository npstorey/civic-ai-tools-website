import { NextRequest, NextResponse } from 'next/server';
import { createModelClient, ModelConfigurationError } from '@/lib/model-client';
import { getSummarizerModel } from '@/lib/model-resolver';
import { modelIdentity, type ModelIdentity } from '@/lib/model-catalog';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  rejectedRequestCount,
  summaryDataSourcesLine,
  type SummarySourceInput,
} from '@/lib/evidence/summary-sources';

const SYSTEM_PROMPT = `You are writing a one-paragraph summary of an AI-assisted civic data analysis for a non-technical reader (journalist, community board member, city staff).

VOICE: Neutral, third-person. Do NOT use first-person (we, our, us, I). Do NOT use second-person (you, your). Start with "This analysis..." or a subject-first construction ("NYC 311 data shows...").

CONTENT: Cover what question was examined, what the data showed, what sources were used, and any limitations. Max 3 sentences. No technical jargon (avoid: SoQL, API, tool calls, LLM, etc.).

TONE: Factual and descriptive, like a dataset abstract or report description. Not promotional. Not narrative.`;

/**
 * What the dialog posts per tool call: the name, the arguments, and — when
 * the loop recorded the call as rejected — `failed`/`failureKind` (#384 P8,
 * F1). The type used to admit only `{ name; args }`, so a rejection could not
 * reach this route even when the caller carried one.
 */
type ToolCallSummary = SummarySourceInput;

/**
 * POST /api/evidence/generate-summary
 *
 * Generates a one-paragraph non-technical summary of an analysis.
 * Uses the platform model credential (convenience feature, not an attestation).
 *
 * The model is this instance's `summarizer` catalog entry, or its default when
 * no entry claims that role (website#30 P3). It was a slug hardcoded in this
 * file — the fifth such table, missed by P2's inventory and routed here — which
 * meant this route could call an id the instance does not offer, could not be
 * configured per instance, and was invisible to catalog validation.
 *
 * Body: { prompt: string, output: string, toolCalls: ToolCallSummary[] }
 * Returns: { summary: string }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();
  const { prompt, output, toolCalls } = body as {
    prompt: string;
    output: string;
    toolCalls: ToolCallSummary[];
  };

  if (!prompt || !output) {
    return NextResponse.json({ error: 'prompt and output are required' }, { status: 400 });
  }

  // The source list is built by the one function a test can read
  // (`summary-sources.ts`, #384 P8 F1): a call the loop recorded as rejected
  // used no data and names no source. A rejection is stated as a count — a
  // limitation the summary is asked to cover — in one neutral clause.
  const calls = toolCalls || [];
  const sourceList = summaryDataSourcesLine(calls);
  const rejected = rejectedRequestCount(calls);
  const rejectedLine = rejected > 0
    ? `\nRequests that did not complete: ${rejected} — a data source did not answer ${rejected === 1 ? 'it' : 'them'}, so no figures came from ${rejected === 1 ? 'it' : 'them'}.\n`
    : '';

  const userMessage = `Original question: ${prompt}

Data sources used: ${sourceList}
${rejectedLine}
Analysis output:
${output.slice(0, 4000)}`;

  // A catalog this instance cannot read is an operator failure, not a caller
  // failure: 503, and the publish dialog falls back to a hand-written summary.
  let summarizer: ModelIdentity;
  try {
    summarizer = modelIdentity(getSummarizerModel());
  } catch (error) {
    if (error instanceof ModelConfigurationError) {
      console.error('[generate-summary]', error.message);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    throw error;
  }

  try {
    const openrouter = createModelClient();

    const response = await openrouter.chat.completions.create({
      // The wire gets `endpointModel`. Nothing this route produces is signed —
      // the publisher edits the draft before publishing — so no identity is
      // recorded here.
      model: summarizer.endpointModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 300,
    });

    const summary = response.choices[0]?.message?.content?.trim() || '';
    if (!summary) {
      return NextResponse.json({ error: 'Empty summary returned' }, { status: 502 });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('[generate-summary] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Summary generation failed' },
      { status: 500 },
    );
  }
}
