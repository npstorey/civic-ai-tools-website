import { NextResponse } from 'next/server';
import { getOfferedModels } from '@/lib/model-resolver';
import { ModelConfigurationError } from '@/lib/model-client';

/**
 * GET /api/models — the models this instance offers, for the selector.
 *
 * The response shape is unchanged (civic-ai-tools-website#283 pins it through
 * `parseModelsResponse`); only its source moved, from a hardcoded array to the
 * instance's catalog. Under the built-in endpoint with no catalog configured
 * the body is byte-identical to the pre-catalog one — `model-catalog.test.ts`
 * asserts that against a frozen literal.
 *
 * A catalog this instance cannot read is a 503, not an empty list: an empty
 * `models` array is a valid body meaning "no models offered", and answering it
 * would turn an operator's misconfiguration into a reader-facing silence.
 */
export async function GET() {
  try {
    return NextResponse.json({
      models: getOfferedModels(),
    });
  } catch (error) {
    if (error instanceof ModelConfigurationError) {
      console.error('[api/models]', error.message);
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    }
    throw error;
  }
}
