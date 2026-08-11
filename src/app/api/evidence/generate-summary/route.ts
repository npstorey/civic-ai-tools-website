import { NextRequest, NextResponse } from 'next/server';
import { createModelClient } from '@/lib/model-client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const SUMMARY_MODEL = 'google/gemini-3.5-flash-lite';

const SYSTEM_PROMPT = `You are writing a one-paragraph summary of an AI-assisted civic data analysis for a non-technical reader (journalist, community board member, city staff).

VOICE: Neutral, third-person. Do NOT use first-person (we, our, us, I). Do NOT use second-person (you, your). Start with "This analysis..." or a subject-first construction ("NYC 311 data shows...").

CONTENT: Cover what question was examined, what the data showed, what sources were used, and any limitations. Max 3 sentences. No technical jargon (avoid: SoQL, API, tool calls, LLM, etc.).

TONE: Factual and descriptive, like a dataset abstract or report description. Not promotional. Not narrative.`;

interface ToolCallSummary {
  name: string;
  args: Record<string, unknown>;
}

/**
 * POST /api/evidence/generate-summary
 *
 * Generates a one-paragraph non-technical summary of an analysis.
 * Uses the platform OpenRouter key (convenience feature, not an attestation).
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

  // Build a compact tool call summary for the user message
  const uniqueSources = new Map<string, { portal: string; datasetId: string }>();
  for (const tc of toolCalls || []) {
    const datasetId = tc.args?.dataset_id as string | undefined;
    const portal = tc.args?.portal as string | undefined;
    if (datasetId && portal && !uniqueSources.has(datasetId)) {
      uniqueSources.set(datasetId, { portal, datasetId });
    }
  }
  const sourceList = Array.from(uniqueSources.values())
    .map(s => `${s.portal} / ${s.datasetId}`)
    .join(', ');

  const userMessage = `Original question: ${prompt}

Data sources used: ${sourceList || '(none)'}

Analysis output:
${output.slice(0, 4000)}`;

  try {
    const openrouter = createModelClient();

    const response = await openrouter.chat.completions.create({
      model: SUMMARY_MODEL,
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
