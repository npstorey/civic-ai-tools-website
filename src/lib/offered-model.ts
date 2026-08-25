import { parseModelsResponse } from './model-list.ts';

/**
 * Resolves the first model this instance's `/api/models` catalog offers —
 * the id `McpFlowDiagram.tsx` hands to a live `/explore` query, which has no
 * model picker of its own (#314, website#30 P6 F1).
 *
 * WHY A FACTORY, NOT A HOOK. `McpFlowDiagram.tsx` is a client component with
 * JSX, which node:test's `--experimental-strip-types` runner cannot parse
 * (the same reason `parseModelsResponse` was pulled out into `model-list.ts`
 * in #283). This factory holds the retry/caching policy in a plain closure
 * so the policy itself, not just the response-shape guard, is unit-testable.
 *
 * THE DEFECT THIS REPLACES (website#30 P7, found in P6's version of this
 * code): the fetch used to be memoized in a ref holding the fetch's own
 * PROMISE, including a rejected one — `.catch()` resolved it to `''` without
 * ever clearing the ref. One failed or empty `/api/models` response at
 * mount — a deploy in flight, a blip on first paint, an operator restart —
 * then poisoned every later click for the rest of the page's life; only a
 * full reload cleared it.
 *
 * This factory instead caches only a RESOLVED, non-empty id. A failure —
 * network error, malformed body, or an empty catalog — leaves nothing
 * cached, so the next call to `resolve()` retries the network request
 * instead of replaying the old failure.
 */
export interface OfferedModelResolver {
  resolve(): Promise<string>;
}

export function createOfferedModelResolver(
  fetchImpl: typeof fetch = fetch,
): OfferedModelResolver {
  let cachedId: string | null = null;
  let inFlight: Promise<string> | null = null;

  function resolve(): Promise<string> {
    if (cachedId !== null) return Promise.resolve(cachedId);
    if (inFlight) return inFlight;

    inFlight = fetchImpl('/api/models')
      .then((res) => res.json())
      .then((data) => {
        const parsed = parseModelsResponse(data);
        if (parsed === null) {
          console.error('Failed to fetch models: response missing a `models` array');
          return '';
        }
        const id = parsed.length > 0 ? parsed[0].id : '';
        if (id) cachedId = id;
        return id;
      })
      .catch((error) => {
        console.error('Failed to fetch models:', error);
        return '';
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return { resolve };
}
