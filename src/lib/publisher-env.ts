// Publisher-instance environment names, new-then-old (civic-ai-tools#160 P3).
//
// WHAT THIS IS. The 2026-08-19 vocabulary settlement (Appendix J of the Typed
// Standards specification) retires "evidence" from the infrastructure brand.
// The thirteen variables that name THIS deployment's publishing identity move
// from the `EVIDENCE_` prefix to `PUBLISHER_`, under the settlement's
// `expand-then-flip` migration class. (Appendix J's shipped environment row
// still says fourteen and still lists `EVIDENCE_TRUST_REGISTRY_URL` — that
// variable was retired outright, not renamed, by civic-ai-tools#155 P1b;
// reconciling the spec's census is a follow-up owner decision, not done
// here.)
//
//   EXPAND (this module, this phase) — every runtime read accepts BOTH names,
//   canonical first, and says so out loud when the prior-era name is the one
//   that answered. Nothing an operator has configured stops working, and an
//   operator who has already moved gets the new names honored.
//
//   FLIP (a later phase) — the deployment guides, `.env.example` and
//   `docker-compose.yml` start naming `PUBLISHER_*`; the operator adds the new
//   names, removes the old.
//
//   DROP (a later major) — the fallback in `lookupPublisherEnv` goes away.
//
// ONE HELPER, NOT THIRTEEN FALLBACKS. Hand-rolling `process.env.PUBLISHER_X ??
// process.env.EVIDENCE_X` at each of the ~20 read sites would put the
// migration rule in twenty places and the deprecation warning in none of them.
// Everything that reads one of these variables goes through here, which is
// also what makes the eventual drop a one-line edit.
//
// THE PRECEDENCE RULE IS `DEFINED`, NOT `TRUTHY`, AND THAT IS DELIBERATE.
// The canonical name wins whenever it is set to a string — including the EMPTY
// string — and only an entirely unset canonical name falls through. Truthiness
// would be wrong: `EVIDENCE_TRUST_REGISTRY_LEGACY_URL=""` is the documented
// way to OMIT the legacy registry URL from signed output (see
// `getSidecarTrustRegistryUrls` in site-config.ts), so empty is a value here
// and not an absence. `scripts/check-compose-env.mjs` exists to protect the
// same distinction on the compose path. The consequence, stated plainly: an
// operator who sets the canonical name to empty shadows a prior-era name that
// still holds a value — which is the right reading of an explicit setting, and
// is why the fallback is documented rather than silent.
//
// PRESENCE-VS-VALUE stays with the CALLER. This module resolves WHICH NAME
// answered and hands back the raw string; whether whitespace-only counts as
// absent is the consuming module's convention (`presentOrNull` in
// site-config.ts, `isPresent` in unsigned-tier.ts and the preflight — all
// three trim). Nothing here trims, normalizes, or inspects a value: several of
// these variables are secrets, and one of them lands verbatim in a signed
// field.
//
// THE SCRIPTS SIDE IS SEPARATE ON PURPOSE. `scripts/preflight-env.mjs` is run
// as a bare `node scripts/preflight-env.mjs`, so it cannot import a TypeScript
// module; it carries the same rule in its own idiom, keyed off its ENV_SPEC's
// `priorEraName` field. The two lists are cross-referenced in both directions
// and pinned against each other by `src/lib/publisher-env.test.ts`, so they
// cannot drift.

/**
 * The settlement-era prefix — the canonical name of every variable below.
 * "Publisher" rather than "record": these variables name the PUBLISHER (its
 * origin, signer, key, platform agent, registry), not the artifact.
 */
export const CANONICAL_ENV_PREFIX = 'PUBLISHER_';

/** The prior-era prefix, accepted for the whole of the expand phase. */
export const PRIOR_ERA_ENV_PREFIX = 'EVIDENCE_';

/**
 * The thirteen variables in the settlement's Group A, by the suffix the two
 * prefixes share. This list IS the census (Appendix J's environment row); it
 * is not derived from anything, so adding a fourteenth publisher variable
 * means adding it here.
 *
 * `PUBLIC_KEY` is the odd one: nothing reads it at run time — the key-
 * generation script WRITES it, and the deployment guide documents it. It is
 * listed because the settlement lists it, and because the writer emits the
 * canonical name from this list rather than a literal of its own.
 *
 * `TRUST_REGISTRY_URL` used to be the fourteenth entry — the verify-side
 * consume override. civic-ai-tools#155 P1b retired it outright (not renamed):
 * `readPublisherEnv('TRUST_REGISTRY_URL')` had exactly one caller
 * (`getTrustRegistryUrl` in `src/lib/evidence/verify.ts`), which P1 measured
 * as feeding dead code, and P1b deleted along with it. Appendix J's shipped
 * environment row still lists it and still says fourteen; reconciling that is
 * a follow-up spec decision, not done here.
 */
export const PUBLISHER_ENV_SUFFIXES = [
  'SIGNING_KEY',
  'KEY_ID',
  'PUBLIC_KEY',
  'SIGNER_BINDING_TIER',
  'SIGNER_IDENTIFIER',
  'SIGNER_DISPLAY_NAME',
  'PLATFORM_AGENT_ID',
  'PLATFORM_AGENT_TITLE',
  'PLATFORM_AGENT_URL',
  'PUBLICATION_HOST',
  'SITE_ORIGIN',
  'TRUST_REGISTRY_CANONICAL_URL',
  'TRUST_REGISTRY_LEGACY_URL',
] as const;

/** One of the thirteen suffixes above. */
export type PublisherEnvSuffix = (typeof PUBLISHER_ENV_SUFFIXES)[number];

/** An env-shaped record. Always passed in, never reached for implicitly. */
export type EnvRecord = Record<string, string | undefined>;

/** The settlement-era variable name for a suffix, e.g. `PUBLISHER_KEY_ID`. */
export function canonicalEnvName(suffix: PublisherEnvSuffix): string {
  return `${CANONICAL_ENV_PREFIX}${suffix}`;
}

/** The prior-era variable name for a suffix, e.g. `EVIDENCE_KEY_ID`. */
export function priorEraEnvName(suffix: PublisherEnvSuffix): string {
  return `${PRIOR_ERA_ENV_PREFIX}${suffix}`;
}

/** The canonical names, in census order — the list an operator should set. */
export const PUBLISHER_ENV_NAMES: readonly string[] =
  PUBLISHER_ENV_SUFFIXES.map(canonicalEnvName);

/** The prior-era names, in census order. */
export const PRIOR_ERA_ENV_NAMES: readonly string[] =
  PUBLISHER_ENV_SUFFIXES.map(priorEraEnvName);

/** The outcome of one two-name lookup. */
export interface PublisherEnvLookup {
  /** The raw string, verbatim and untrimmed, or `undefined` if neither name is set. */
  value: string | undefined;
  /** The variable name that answered, or the canonical name when neither did. */
  name: string;
  /** True when the prior-era name supplied the value. */
  viaPriorEra: boolean;
}

/**
 * Variables already warned about in this process. Module-level so the warning
 * is once-per-variable rather than once-per-read: `getEvidenceSiteOrigin()`
 * alone is called several times per request, and a log line per call would
 * bury the signal it exists to raise.
 */
const warned = new Set<string>();

/** Drop the once-per-variable memo. For tests and rehearsal drills only. */
export function resetPriorEraEnvWarnings(): void {
  warned.clear();
}

/** The names warned about so far in this process — the memo, read-only. */
export function priorEraEnvNamesWarned(): string[] {
  return [...warned].sort();
}

/**
 * Emit the once-per-variable deprecation notice.
 *
 * SERVER-SIDE AND OPERATOR-FACING, never user-facing: it is a `console.warn`
 * from a module that only resolves configuration, and no response body, page,
 * or streamed message carries it. In a browser bundle it cannot fire at all —
 * neither name is a `NEXT_PUBLIC_` variable, so both read as `undefined` there
 * and the prior-era branch is unreachable.
 */
function warnPriorEra(suffix: PublisherEnvSuffix): void {
  const oldName = priorEraEnvName(suffix);
  if (warned.has(oldName)) return;
  warned.add(oldName);
  console.warn(
    `[publisher-env] ${oldName} is the prior-era name for ` +
      `${canonicalEnvName(suffix)} and supplied this instance's value. Both ` +
      `names work today; the prior-era one is removed at a future major ` +
      `version. Rename it in this instance's environment when convenient — ` +
      `see the 2026-08-19 vocabulary settlement (Appendix J of the Typed ` +
      `Standards specification).`,
  );
}

/**
 * Resolve one publisher variable across both names, reporting which answered.
 *
 * Use this when the caller needs to NAME the variable (a refusal message, a
 * report row). Callers that only need the value use `readPublisherEnv`.
 *
 * @param suffix the shared suffix, e.g. `'KEY_ID'`
 * @param env the environment to read; pass a fixture in tests
 * @param warn set false to resolve without emitting the deprecation notice —
 *   for probes that inspect configuration without consuming it
 */
export function lookupPublisherEnv(
  suffix: PublisherEnvSuffix,
  env: EnvRecord,
  warn = true,
): PublisherEnvLookup {
  const canonical = env[canonicalEnvName(suffix)];
  if (typeof canonical === 'string') {
    return { value: canonical, name: canonicalEnvName(suffix), viaPriorEra: false };
  }
  const priorEra = env[priorEraEnvName(suffix)];
  if (typeof priorEra === 'string') {
    if (warn) warnPriorEra(suffix);
    return { value: priorEra, name: priorEraEnvName(suffix), viaPriorEra: true };
  }
  return { value: undefined, name: canonicalEnvName(suffix), viaPriorEra: false };
}

/**
 * The value of one publisher variable under either name — the read every
 * runtime consumer wants. Verbatim and untrimmed; `undefined` when neither
 * name is set.
 */
export function readPublisherEnv(
  suffix: PublisherEnvSuffix,
  env: EnvRecord = process.env,
): string | undefined {
  return lookupPublisherEnv(suffix, env).value;
}
