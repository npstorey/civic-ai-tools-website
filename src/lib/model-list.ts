/**
 * The `/api/models` response shape and its validation, used by QueryForm's
 * model-picker fetch.
 *
 * Extracted out of QueryForm.tsx — a client component with JSX, which
 * node:test's `--experimental-strip-types` runner cannot parse — so the
 * response-shape guard can be unit-tested directly (#283).
 *
 * The defect this guards: `/api/models` always returns `{ models: [...] }`
 * today, but nothing enforced that shape at the call site. A 200 response
 * missing the `models` key would set `models` to `undefined`, and the render
 * path's `models.find(...)` would throw. `parseModelsResponse` turns a
 * malformed body into `null` instead, so the caller can route it through the
 * same failure path as a network/JSON error rather than crash at render.
 */

export interface Model {
  id: string;
  name: string;
  tag?: string;
  provider: string;
  description?: string;
}

/**
 * Validate a decoded `/api/models` JSON body into a `Model[]`, or `null` if
 * the body doesn't carry a usable `models` array. Only checks that `models`
 * is present and is an array — it does not deep-validate individual entries,
 * since a malformed entry degrades gracefully at the render sites that read
 * it (`.find`, `.map`) rather than throwing.
 */
export function parseModelsResponse(data: unknown): Model[] | null {
  if (data === null || typeof data !== 'object') return null;
  const models = (data as { models?: unknown }).models;
  return Array.isArray(models) ? (models as Model[]) : null;
}
