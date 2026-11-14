import { parseModelsResponse, type Model } from './model-list.ts';

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
 *
 * UX-2 P3b-2 (fix 8): `/explore`'s harness menu lists the catalog, so the
 * resolver also returns the parsed list (`list()`), under the same rule: only
 * a resolved, non-empty list is cached; a failure caches nothing. `resolve()`
 * is the list's first id. The menu fetches nothing of its own.
 */
export interface OfferedModelResolver {
  resolve(): Promise<string>;
  list(): Promise<Model[]>;
}

export function createOfferedModelResolver(
  fetchImpl: typeof fetch = fetch,
): OfferedModelResolver {
  let cached: Model[] | null = null;
  let inFlight: Promise<Model[]> | null = null;

  function list(): Promise<Model[]> {
    if (cached !== null) return Promise.resolve(cached);
    if (inFlight) return inFlight;

    inFlight = fetchImpl('/api/models')
      .then((res) => res.json())
      .then((data) => {
        const parsed = parseModelsResponse(data);
        if (parsed === null) {
          console.error('Failed to fetch models: response missing a `models` array');
          return [];
        }
        if (parsed.length > 0) cached = parsed;
        return parsed;
      })
      .catch((error) => {
        console.error('Failed to fetch models:', error);
        return [] as Model[];
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  function resolve(): Promise<string> {
    return list().then((models) => (models.length > 0 ? models[0].id : ''));
  }

  return { resolve, list };
}
