/**
 * The caller-supplied model key on the two attestation routes
 * (`POST /api/records/:slug/replay` and `.../evaluate`), and the failure copy
 * that goes with it.
 *
 * WHY A MODULE RATHER THAN TWO COPIES. Both routes take a key from the request
 * body, and both must accept two field names for it — see below. Two
 * hand-rolled copies of a two-name precedence rule is exactly the shape that
 * drifts: `scripts/preflight-env.mjs` carries its own copy of the *environment*
 * two-name rule only because it is `.mjs` and cannot import TypeScript, and
 * that duplication is already a known hazard. These two routes have no such
 * excuse. It is also why this file is pure — no `next/server`, no `openai` — so
 * the rule is unit-testable under `node --test`, which cannot load a route.
 *
 * THE RENAME (website#30 G0 D7). The wire field is `modelApiKey`.
 * `openRouterApiKey` is its prior-era name and is **accepted indefinitely** —
 * migration class `alias-permanent`, the same class as `/api/evidence/*` beside
 * `/api/records/*`. This is deliberately NOT an expand-then-flip: there is no
 * later phase that removes the old name, nothing warns on it, and nothing
 * errors on it. Anyone integrating against the old field keeps working, and a
 * client that sends both gets the canonical one used.
 *
 * WHY THE NAME CHANGED. The key is not an OpenRouter key. It is the key for
 * whatever chat-completions endpoint THIS instance is configured to call
 * (`MODEL_API_BASE_URL` / `MODEL_API_KIND`, resolved in `model-client.ts`).
 * Under the built-in default that endpoint happens to be OpenRouter; under a
 * deployment-routed dialect it is the operator's own resource, and the caller
 * must supply that resource's key. The old field name asserted a vendor the
 * request may never touch, and the copy below says plainly which key is wanted.
 *
 * PRECEDENCE mirrors the environment-side rule in `model-client.ts` and
 * `src/lib/publisher-env.ts`: the canonical name wins whenever it is DEFINED,
 * not merely whenever it is truthy. For a credential that is the safe reading —
 * a body that defines `modelApiKey` as an empty string is a client sending
 * nothing under the name it chose, and quietly reaching for the other field
 * would authenticate with a key the caller did not nominate.
 *
 * The failure copy lives here rather than in `src/lib/streaming.ts` on purpose.
 * `friendlyStreamError()`'s credential copy is written for the OPERATOR of a
 * self-hosted instance and names server environment variables (#178); on these
 * two routes the key belongs to the CALLER, so that copy would send a reader
 * off to check a variable that is not theirs and is not at fault. Same kinds
 * (`model_auth_rejected`, `model_rate_limited`), reader scoped correctly.
 */

import type { ModelErrorCode } from './streaming.ts';

/** The canonical wire field. */
export const CALLER_MODEL_KEY_FIELD = 'modelApiKey';

/** Its prior-era name, accepted indefinitely (G0 D7). Never deprecated. */
export const CALLER_MODEL_KEY_PRIOR_ERA_FIELD = 'openRouterApiKey';

export type CallerModelKeyResolution =
  | { ok: true; apiKey: string; field: string }
  | { ok: false; error: string };

const REQUIRED_MESSAGE =
  `A model API key is required — the key for the model endpoint this instance is configured to call, ` +
  `which is not necessarily any particular vendor's. ` +
  `Send it as "${CALLER_MODEL_KEY_FIELD}"; the prior-era field name "${CALLER_MODEL_KEY_PRIOR_ERA_FIELD}" is also accepted.`;

const notAStringMessage = (field: string) =>
  `"${field}" must be a non-empty string — the model API key for this instance's endpoint.`;

/**
 * Reader-facing copy for an upstream refusal of the CALLER's key. Distinct from
 * `friendlyStreamError('model_auth_rejected')`, which addresses the operator.
 */
export const CALLER_MODEL_KEY_REJECTED_MESSAGE =
  'The model endpoint rejected this API key. Check that the key you supplied is valid for the ' +
  "endpoint this instance calls — it is that endpoint's key that is needed, not any other service's.";

/**
 * Reader-facing copy for an upstream rate limit hit with the CALLER's key
 * (website#30 G0 D6). Deliberately does not mention a daily allowance: this is
 * the model service limiting the key, not this app limiting the reader.
 */
export const CALLER_MODEL_RATE_LIMITED_MESSAGE =
  'The model service is limiting requests for this API key right now, so this could not run. ' +
  'This is not a limit set by this site — please try again shortly.';

/**
 * Map a typed model failure to the reader-facing copy and HTTP status these two
 * routes answer with, or `null` for a code these routes have nothing special to
 * say about.
 *
 * `model_rate_limited` answers **502, not 429**, on purpose. A 429 from this app
 * means this app's own per-day limiter (see `src/lib/rate-limit.ts`), and these
 * routes have no such limiter; answering 429 for an upstream limit would
 * recreate on the HTTP layer exactly the confusion the new kind exists to end.
 * The `code` field carries the distinction for anything that reads it.
 */
export function callerModelKeyFailure(
  code: ModelErrorCode | null,
): { status: number; error: string; code: ModelErrorCode } | null {
  if (code === 'model_auth_rejected') {
    return { status: 401, error: CALLER_MODEL_KEY_REJECTED_MESSAGE, code };
  }
  if (code === 'model_rate_limited') {
    return { status: 502, error: CALLER_MODEL_RATE_LIMITED_MESSAGE, code };
  }
  // `model_not_configured` is not returned here: on these routes the key comes
  // from the caller, so the only way to reach that code is a malformed key that
  // the guard above has already refused with `REQUIRED_MESSAGE`.
  return null;
}

/**
 * Pull the caller's model API key out of a decoded request body under either
 * accepted field name.
 */
export function resolveCallerModelKey(body: unknown): CallerModelKeyResolution {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: REQUIRED_MESSAGE };
  }
  const source = body as Record<string, unknown>;

  for (const field of [CALLER_MODEL_KEY_FIELD, CALLER_MODEL_KEY_PRIOR_ERA_FIELD]) {
    const value = source[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, error: notAStringMessage(field) };
    }
    return { ok: true, apiKey: value, field };
  }

  return { ok: false, error: REQUIRED_MESSAGE };
}
