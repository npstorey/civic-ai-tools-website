// The system prompts a run's trace states, by hash (R10 P1b, #694).
//
// Each `llm_inference` span carries `gen_ai.system_prompt_hash`, the hash of
// the system prompt its request sent (`run-tool-loop.ts`). Under in-loop
// routing every request states its own, so a run that loads sources in more
// than one turn states several; under all-sources only the first request
// states one, and the prompt never changes. So the LAST span that states a
// hash names the final request's prompt in both modes (measured, P1b-f: it
// equals the comparison's `skill.text_hash`, and the SHA-256 of the final
// request's system text).
//
// Pure and browser-safe: the record adapter and the run adapters read it.
// Spans are read in the order the trace lists them, which is the order the
// loop opened them.

interface SpanShape {
  name?: unknown;
  attributes?: unknown;
}

const PROMPT_HASH_KEY = 'gen_ai.system_prompt_hash';

function spansOf(trace: unknown): SpanShape[] {
  const out: SpanShape[] = [];
  const resourceSpans = (trace as { resourceSpans?: unknown } | null)?.resourceSpans;
  if (!Array.isArray(resourceSpans)) return out;
  for (const rs of resourceSpans) {
    const scopeSpans = (rs as { scopeSpans?: unknown } | null)?.scopeSpans;
    if (!Array.isArray(scopeSpans)) continue;
    for (const ss of scopeSpans) {
      const spans = (ss as { spans?: unknown } | null)?.spans;
      if (Array.isArray(spans)) out.push(...(spans as SpanShape[]));
    }
  }
  return out;
}

/** Every stated prompt hash, one per `llm_inference` span that states one, in span order. */
function statedPromptHashes(trace: unknown): string[] {
  const out: string[] = [];
  for (const span of spansOf(trace)) {
    if (span?.name !== 'llm_inference' || !Array.isArray(span.attributes)) continue;
    for (const a of span.attributes as Array<{ key?: unknown; value?: { stringValue?: unknown } } | null>) {
      if (a?.key === PROMPT_HASH_KEY && typeof a.value?.stringValue === 'string' && a.value.stringValue.length > 0) {
        out.push(a.value.stringValue);
      }
    }
  }
  return out;
}

/** The distinct system prompt hashes the trace states, in the order each first appears. */
export function systemPromptHashesOfTrace(trace: unknown): string[] {
  return [...new Set(statedPromptHashes(trace))];
}

/** The final request's system prompt hash: the last one a span states, or null when none does. */
export function finalSystemPromptHashOfTrace(trace: unknown): string | null {
  const stated = statedPromptHashes(trace);
  return stated.length > 0 ? stated[stated.length - 1] : null;
}

/**
 * The prompts the model saw before the one a section shows: every distinct
 * stated hash other than `shown`, in order. Only when `shown` IS the trace's
 * last stated hash (fix round 1, item 7): a section showing any other hash —
 * an earlier prompt's, or one the trace never states — gets no list, never a
 * list labelled "earlier" that is not. Empty, too, when the trace states one
 * prompt or none, or when nothing is shown.
 */
export function earlierSystemPromptHashes(trace: unknown, shown: string | null): string[] {
  if (shown === null || shown !== finalSystemPromptHashOfTrace(trace)) return [];
  const distinct = systemPromptHashesOfTrace(trace);
  return distinct.length > 1 ? distinct.filter((hash) => hash !== shown) : [];
}
