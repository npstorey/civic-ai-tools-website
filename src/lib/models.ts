/**
 * Model pricing and display helpers, for rendering a model id that is ALREADY
 * RECORDED — `cost.model` inside a signed package, or the model name on an
 * executed notebook. Both are history: the record outlives the roster.
 *
 * The tables these read moved into `model-catalog.ts` (civic-ai-tools-website#30
 * P2). Two of the three callers here are client components
 * (`ProvenanceChain`, `ChatNotebookOutput`), which is why this file reaches the
 * PURE half of the catalog and never the resolver — the resolver reads
 * `node:fs` and cannot be bundled for a browser.
 *
 * LIMITATION, stated because it is invisible at the call site: these consult
 * the BUILT-IN catalog and the historical table only. On an instance running a
 * configured `MODEL_CATALOG`, its ids fall through to the honest fallbacks —
 * the raw id, and no cost estimate — rather than to a wrong name or a wrong
 * price. Routing a configured catalog's display data to the client would need a
 * server-side projection through the record page; it is not this phase's, and
 * it intersects P3's change to what `cost.model` holds.
 */

import { builtInDisplayName, builtInPricing } from './model-catalog.ts';

/**
 * Estimate the USD cost of an LLM call given the model ID and token counts.
 * Returns null when no pricing is known for the id — an honest blank rather
 * than a guessed number.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const pricing = builtInPricing(model);
  if (!pricing) return null;
  return (
    (promptTokens / 1_000_000) * pricing.input +
    (completionTokens / 1_000_000) * pricing.output
  );
}

/**
 * Format a model ID as a human-readable name.
 * Falls back to the raw ID if unknown.
 */
export function formatModelName(id: string): string {
  return builtInDisplayName(id) ?? id;
}
