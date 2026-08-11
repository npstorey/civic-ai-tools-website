/**
 * Model pricing and display helpers.
 *
 * Prices per 1M tokens (USD) — current OpenRouter pricing as of 2026-08-11.
 * Update when OpenRouter pricing changes. Every id offered in `availableModels`
 * (src/lib/mcp/tools.ts) must have an entry here — see models.test.ts.
 */

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o':                  { input: 2.50, output: 10.00 },
  'openai/gpt-5.4':                 { input: 2.50, output: 15.00 },
  'google/gemini-3.5-flash-lite':   { input: 0.30, output: 2.50 },
  'anthropic/claude-sonnet-4':      { input: 3.00, output: 15.00 },
  'anthropic/claude-sonnet-4-6':    { input: 3.00, output: 15.00 },
  'anthropic/claude-opus-5':        { input: 5.00, output: 25.00 },
  'anthropic/claude-haiku-4.5':     { input: 1.00, output: 5.00 },
};

/**
 * Estimate the USD cost of an LLM call given the model ID and token counts.
 * Returns null if the model isn't in the pricing table.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (
    (promptTokens / 1_000_000) * pricing.input +
    (completionTokens / 1_000_000) * pricing.output
  );
}

/**
 * Format an OpenRouter model ID as a human-readable name.
 * Falls back to the raw ID if unknown.
 */
export function formatModelName(id: string): string {
  const map: Record<string, string> = {
    'openai/gpt-4o':                  'GPT-4o',
    'openai/gpt-5.4':                 'GPT-5.4',
    'google/gemini-3.5-flash-lite':   'Gemini 3.5 Flash Lite',
    'anthropic/claude-sonnet-4':      'Claude Sonnet 4',
    'anthropic/claude-sonnet-4-6':    'Claude Sonnet 4.6',
    'anthropic/claude-opus-5':        'Claude Opus 5',
    'anthropic/claude-haiku-4.5':     'Claude Haiku 4.5',
  };
  return map[id] || id;
}
