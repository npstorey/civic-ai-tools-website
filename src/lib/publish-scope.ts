// The publish OAuth scope, under both accepted names (civic-ai-tools#160 P3).
//
// Group G of the 2026-08-19 vocabulary settlement (Appendix J of the Typed
// Standards specification) renames the device-flow scope
// `evidence:publish` → `records:publish`, migration class
// `alias-and-deprecate`: the token endpoints accept both and mint the new one,
// both authorize identically, and the prior-era name drops only at a major
// version.
//
// TOKENS ARE THE REASON THIS IS AN ALIAS AND NOT A RENAME. A minted bearer
// token stores its scope as a string in the database and lives 90 days. Every
// token minted before this change carries `evidence:publish`, and there is no
// migration that could fix that without invalidating tokens people are
// actively using — so the ENFORCEMENT side must treat the two strings as one
// authorization, permanently enough that no live token ever stops working.
// That is what `scopesAuthorizePublish` is: one predicate, three call sites,
// no hand-rolled ORs to fall out of step with each other.
//
// THE MINT SIDE IS SEPARATE, and deliberately more permissive than "mint the
// new one". A client that explicitly ASKS for `evidence:publish` gets exactly
// that — accepted, and minted as requested — because the device-flow response
// echoes the granted scope and a client comparing it against what it asked for
// is doing the correct thing under RFC 8628. Silently upgrading its scope
// string would break that comparison for a client that has done nothing wrong.
// A client that asks for NOTHING gets the canonical name, which is how the
// default moves without anyone being surprised.
//
// Kept free of Next.js and database imports so it runs under `node --test`
// (which resolves neither the `@/` alias nor the request plumbing) — the same
// reason `src/lib/publisher-env.ts` is its own module. `src/lib/api-auth.ts`
// wraps it for route callers.

/** The scope minted by default and named in every "you need this" message. */
export const PUBLISH_SCOPE = 'records:publish';

/**
 * The prior-era spelling. Accepted for authorization indefinitely — live
 * tokens carry it — and still mintable on explicit request.
 */
export const PRIOR_ERA_PUBLISH_SCOPE = 'evidence:publish';

/**
 * Every scope string the device-flow start endpoint accepts, canonical first.
 * The order is the order a human reads them in an error message; nothing
 * depends on it for correctness.
 */
export const ACCEPTED_PUBLISH_SCOPES: readonly string[] = [
  PUBLISH_SCOPE,
  PRIOR_ERA_PUBLISH_SCOPE,
];

/**
 * The unscoped wildcard cookie auth holds. Browser flows are gated by
 * NextAuth and a user session rather than by scope, so `*` satisfies every
 * scope check — unchanged by the settlement, restated here so the publish
 * predicate below reads completely in one place.
 */
export const UNSCOPED_WILDCARD = '*';

/**
 * Does this set of held scopes authorize a publish?
 *
 * The one place the two spellings become one authorization. Pure over a list
 * of strings so it is unit-testable without a request, a session, or a
 * database row.
 */
export function scopesAuthorizePublish(scopes: readonly string[]): boolean {
  return scopes.some(
    (held) => held === UNSCOPED_WILDCARD || ACCEPTED_PUBLISH_SCOPES.includes(held),
  );
}

/**
 * The refusal a bearer token without publish authorization receives.
 *
 * Names the CANONICAL scope, because that is what a client should ask for
 * from here on, and names the prior-era one as still accepted, because a
 * client holding a token that carries it must not read this message as "your
 * token is the wrong kind" and go mint a new one it does not need.
 */
export const MISSING_PUBLISH_SCOPE_ERROR =
  `Token missing required scope: ${PUBLISH_SCOPE} ` +
  `(the prior-era name ${PRIOR_ERA_PUBLISH_SCOPE} is also accepted)`;

/** Is `scope` a string the device-flow start endpoint will grant? */
export function isAcceptedMintScope(scope: string): boolean {
  return ACCEPTED_PUBLISH_SCOPES.includes(scope);
}

/**
 * The scope to mint for a device-flow request.
 *
 * An explicit request is honored verbatim (see the mint-side note above); an
 * absent one takes the canonical name. Callers validate with
 * `isAcceptedMintScope` first — this function does not, so that an invalid
 * scope produces `invalid_scope` rather than being quietly replaced.
 */
export function resolveMintScope(requested: string | undefined): string {
  const trimmed = (requested ?? '').trim();
  return trimmed.length > 0 ? trimmed : PUBLISH_SCOPE;
}
