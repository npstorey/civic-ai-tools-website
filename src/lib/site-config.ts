// Site-wide external URLs. Import from here rather than hard-coding hrefs so
// each destination can be changed in one place.

// Relative, extension-bearing import: this module is in the `node --test`
// graph (via the evidence modules), which resolves neither the `@/` alias nor
// extensionless specifiers — the same convention as evidence/verify.ts.
import { describeContentSource, type ContentProvenance } from './content-source.ts';
// The two-name resolver for the publisher-identity variables (Group A of the
// 2026-08-19 vocabulary settlement): `PUBLISHER_*` first, `EVIDENCE_*` as the
// prior-era fallback, with a once-per-variable deprecation warning. Every
// getter below reads through it rather than touching `process.env` directly.
import {
  canonicalEnvName,
  readPublisherEnv,
  type PublisherEnvSuffix,
} from './publisher-env.ts';

/** The Typed Standards protocol site — spec home and neutral verifier. */
export const TYPED_STANDARDS_URL = 'https://typedstandards.org';

/**
 * Where "express interest" / contact links point.
 *
 * WS3 swap point: when a dedicated express-interest destination exists,
 * changing this one line re-points every contact entry on the site
 * (home positioning band + /about + /project). Links out only — no embedded form.
 */
export const EXPRESS_INTEREST_URL = 'mailto:civicaitools@metagov.org';

// --- Sponsor acknowledgment (#259 P4, portability finding D4) --------------

/** A resolved sponsor acknowledgment. `url` is optional: a sponsor with no
 *  link renders as plain text. */
export interface SponsorAcknowledgment {
  /** Leading words, e.g. "Fiscally sponsored by". */
  prefix: string;
  /** The sponsor's name — the linked span when `url` is present. */
  name: string;
  /** Where the name links, or `null` to render it unlinked. */
  url: string | null;
}

/**
 * The words in front of the sponsor's name when the operator does not supply
 * their own. Generic phrasing, not an identity: it names a RELATIONSHIP, and
 * only ever renders beside a name the operator configured.
 */
export const DEFAULT_SPONSOR_PREFIX = 'Fiscally sponsored by';

/**
 * This instance's sponsor acknowledgment, or `null` when it has none —
 * rendered in the global footer and the /about "Who built this" section via
 * components/SponsorLine.
 *
 * WHY THIS IS CONFIG AND NOT A CONSTANT. It was a hardcoded non-null literal
 * naming the reference deployment's fiscal sponsor, and the root layout
 * renders the footer on `(app)` surfaces too — so every instance, including
 * one with no marketing site at all, told its users it was fiscally
 * sponsored by an organization that has no relationship with it. A sponsor
 * acknowledgment is a factual claim about who funds THIS deployment; there
 * is no honest default for it, so unset means the line does not render and
 * the reference deployment declares its sponsor like any other instance.
 *
 * Envs: `SITE_SPONSOR_NAME` (required — no name, no line), `SITE_SPONSOR_URL`
 * (optional link target), `SITE_SPONSOR_PREFIX` (optional wording override).
 * Read at CALL time, matching the rest of this file.
 *
 * Chrome, not evidence: nothing here is ever signed or emitted into a
 * package. It sits in this module rather than brand-config.ts because it is
 * a statement about the deployment's funding rather than a theming knob.
 */
export function getSponsor(): SponsorAcknowledgment | null {
  const name = process.env.SITE_SPONSOR_NAME;
  if (!name) return null;
  return {
    prefix: process.env.SITE_SPONSOR_PREFIX || DEFAULT_SPONSOR_PREFIX,
    name,
    url: process.env.SITE_SPONSOR_URL || null,
  };
}

// --- Instance content sources (#241) ----------------------------------------
//
// Where THIS deployment's `/directory` and `/roadmap` pages get their content
// resolves through the getters below. UNSET here means one thing only: "this
// instance has no content source of its own." No getter falls back to another
// project's roadmap, and the reference deployment configures itself
// explicitly like any other instance — see docs/deploy.md.
//
// The two pages then diverge, because the two kinds of content do:
//
//   /directory — a curated index of public MCP servers is a shared community
//     resource, useful to any instance. With no instance source configured
//     the page keeps serving the community index (below) and says so, with
//     visible attribution to the project that maintains it.
//
//   /roadmap — a roadmap is inherently first-person ("our plans"). Another
//     project's roadmap under an operator's brand is wrong even when
//     attributed, so with no instance source configured `getRoadmapSource()`
//     returns null: the page renders as unpublished and the nav drops the
//     link, rather than presenting someone else's plans as this site's.
//
// Values are read at CALL time (not module load), matching the rest of this
// file.

/**
 * The shared community MCP-server index this codebase ships against — the
 * civic-ai-tools hub repo's curated directory. Not a "demo default" in the
 * sense the rest of this file uses: it is the deliberate content of the
 * unconfigured `/directory` page, rendered with attribution rather than as
 * the instance's own list.
 */
export const COMMUNITY_DIRECTORY_DATA_URL =
  'https://raw.githubusercontent.com/npstorey/civic-ai-tools/main/data/mcp-servers.json';

/**
 * Where a submission to the community index above goes — the same hub repo's
 * issue template. Paired with the data URL on purpose (#259 P4, D7): the
 * footer's "Suggest a Server" link is a funnel into THAT list, so the two
 * URLs describing one shared resource live side by side and cannot drift.
 *
 * The footer renders the link only for an instance that both serves a
 * `/directory` page and is serving the community index on it; an instance
 * with `DIRECTORY_DATA_URL` set curates its own list, and an app-only
 * instance has no directory page at all. Neither should be funnelling its
 * users into another project's issue tracker.
 */
export const COMMUNITY_DIRECTORY_SUBMIT_URL =
  'https://github.com/npstorey/civic-ai-tools/issues/new?template=suggest-server.yml&labels=directory-submission';

/** Resolved `/directory` data source, and whether it belongs to this site. */
export interface DirectorySource {
  /** URL fetched for the MCP-server list (JSON, `McpServerEntry[]`). */
  url: string;
  /** `'instance'` when `DIRECTORY_DATA_URL` is set, else `'community'`. */
  provenance: Extract<ContentProvenance, 'instance' | 'community'>;
}

/**
 * Source the `/directory` page fetches its MCP-server list from. Env:
 * `DIRECTORY_DATA_URL`; unset yields the community index above, marked as
 * such so the page can attribute it. On fetch failure the page falls back to
 * the checked-in `directory-fallback.json` snapshot either way, and says so —
 * see `src/lib/mcp/directory-data.ts`.
 */
export function getDirectorySource(): DirectorySource {
  const configured = process.env.DIRECTORY_DATA_URL;
  return configured
    ? { url: configured, provenance: 'instance' }
    : { url: COMMUNITY_DIRECTORY_DATA_URL, provenance: 'community' };
}

/** Resolved `/roadmap` source: what to fetch, where to link, what to call it. */
export interface RoadmapSource {
  /** URL the page fetches the roadmap markdown from. */
  rawUrl: string;
  /** Human-viewable URL behind the "Renders from …" byline. */
  viewUrl: string;
  /** The byline's visible label, derived from the URL it links to. */
  label: string;
}

/**
 * This instance's own roadmap source, or `null` when it has none.
 *
 * Env: `ROADMAP_RAW_URL` (the markdown) and optionally `ROADMAP_GITHUB_URL`
 * (where the byline links). With `ROADMAP_GITHUB_URL` unset the view URL is
 * derived from the raw URL — a GitHub raw URL resolves to its file page — so
 * an instance that sets one variable never links out to a *different*
 * project's roadmap. `label` is derived from whichever URL the byline links
 * to, which is what keeps label and link from drifting apart.
 *
 * `null` is a first-class state, not a misconfiguration: it is what every
 * instance that has not published a roadmap looks like.
 */
export function getRoadmapSource(): RoadmapSource | null {
  const rawUrl = process.env.ROADMAP_RAW_URL;
  if (!rawUrl) return null;
  const explicitViewUrl = process.env.ROADMAP_GITHUB_URL;
  const described = describeContentSource(explicitViewUrl || rawUrl);
  return {
    rawUrl,
    viewUrl: explicitViewUrl || described.href,
    label: described.label,
  };
}

// --- The instance's default portal (#407) -----------------------------------

/**
 * The open-data portal a run uses when its caller named none, or `null` when
 * this instance has declared no default. Env: `SITE_DEFAULT_PORTAL`, a bare
 * portal hostname with no scheme and no trailing path, read at CALL time like
 * everything else in this file.
 *
 * WHY THIS IS CONFIG AND NOT A CONSTANT. It was one deployment's own portal,
 * written as a literal at nine sites — two query routes, the notebook route,
 * the query surface, the live-trace diagram, the example-query list, and the
 * notebook download button. Every instance built from this repository
 * therefore answered an unqualified question against one deployment's city,
 * and said so in places that outlive the run: `analysis.portal` on the root
 * span of a trace that a publish carries into a SIGNED package, and the
 * `**Portal:**` line of a notebook a reader downloads. A portal a run did not
 * touch, asserted in bytes that claim to record what it did, is the defect
 * this seam closes — the same shape as a hex colour written past a design
 * token (#217): invisible on the reference instance, wrong on every other one.
 *
 * WHY NULLABLE, AND WHY THAT NEVER REFUSES. `null` is a first-class state,
 * not a misconfiguration — the `getInstanceAttribution` disposition, not the
 * `INSTANCE_IDENTITY_REQUIRED_VARS` one. A missing portal must never fail
 * instance bring-up, and it does not: the run simply carries no default, and
 * every surface that would have named a portal omits it instead. That path
 * was already built and already honest before this variable existed —
 * `buildSystemPrompt(portal?)` composes with no portal-specific section and
 * names no default (#384 F2); `runToolLoop` injects a portal only when it has
 * one (`run-tool-loop.ts`), so `tool.portal_domain` is absent on exactly the
 * calls that were given none; `uniquePortals` adds a falsy fallback to
 * nothing. The model then names its own portal on each call, and what the
 * record reports is what the call actually carried.
 *
 * WHY `SITE_*` AND PLAIN `process.env`. Two env families live in this tree
 * and they are not interchangeable. `PUBLISHER_*` variables are read through
 * `readPublisherEnv`, carry a prior-era `EVIDENCE_*` alias, and name this
 * deployment INSIDE signed output. A default portal is neither: it is a
 * configuration seam like `SITE_SPONSOR_NAME` above, so it is read the way
 * `getSponsor` reads its own — one name, plain `process.env`. Registering a
 * suffix in `PUBLISHER_ENV_SUFFIXES` would mint an `EVIDENCE_DEFAULT_PORTAL`
 * alias that never existed and that nothing should honour.
 *
 * Client components cannot read this getter. The root layout resolves it and
 * threads it through `components/DefaultPortalProvider` — the
 * `McpRoutingProvider` precedent, and for the same reason: one configured
 * value reaches server and client, so the two can never disagree about where
 * a query goes. It must never become `NEXT_PUBLIC_*`; build-time client
 * inlining is what breaks runtime container configuration.
 */
export function getDefaultPortal(): string | null {
  const raw = process.env.SITE_DEFAULT_PORTAL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// --- Publisher instance identity (ADR-0020: config, not code; #258:
//     required for signing, never defaulted) --------------------------------
//
// TWO ACCEPTED NAMES PER VARIABLE, and the rule is stated here once rather
// than repeated at every getter. The 2026-08-19 vocabulary settlement
// (Appendix J of the Typed Standards specification; civic-ai-tools#160) moves
// this set from the `EVIDENCE_` prefix to `PUBLISHER_`, under the
// `expand-then-flip` migration class. Every getter below reads
// `PUBLISHER_<NAME>` first and falls back to `EVIDENCE_<NAME>`, warning once
// per variable when the prior-era name is what answered — see
// `src/lib/publisher-env.ts`, which owns the census and the precedence rule.
// Variable names written below are the CANONICAL ones; the prior-era spelling
// of each is the same name under the other prefix, and it still works.
//
// Every value that names THIS deployment inside emitted record surfaces —
// the proof sidecar's trust-registry URLs, the envelope `signer` claim, the
// publication host label, the PROV platform agent, notebook attribution —
// resolves through the getters below, from the ENVIRONMENT ONLY. There are
// no coded identity defaults (#258, findings A1/A2 of the portability
// audit): an instance that has not declared who it is cannot have another
// deployment's name substituted into its output. The reference deployment
// configures itself explicitly like any other instance; its historical
// values survive only as an explicitly-injected test fixture
// (`src/lib/evidence/reference-identity-fixture.ts`).
//
// Three dispositions, by the consuming path's nature:
//
//   - SIGNING / EMISSION paths (packager, publication pair, sidecar) REFUSE:
//     the seal/commit gate (src/lib/evidence/unsigned-tier.ts, error code
//     `instance_identity_missing`) refuses before anything signs, and the
//     strict resolvers here throw `InstanceIdentityError` as the last-resort
//     guard for any path that forgets the gate — the `getActiveKeyId`
//     pattern.
//   - UNSIGNED display surfaces (downloaded skeleton notebooks, copied chat
//     output, skill text, page metadata) honestly OMIT: the nullable getters
//     return `null` and each surface drops its attribution rather than
//     inventing one. No sentinel values, ever.
//   - DERIVATION from explicit config stays: host from origin, registry URLs
//     from origin, platform-agent URL from origin. Operator-supplied values
//     may ground derived values; reference constants may not.
//
// An instance sets `PUBLISHER_SITE_ORIGIN` plus the signer/key variables and
// every derived surface follows; each item is also individually overridable
// for split-host deployments. Values are read at CALL time (not module load)
// so tests and rotation drills can vary them per-process.
//
// Setup walkthrough (keygen, registry template, variable table):
// docs/instance-setup.md. Vocabulary identifiers (`civic:` namespace,
// `org.civicaitools.*` extension keys) are NOT instance identity and must
// never be parameterized — see the same doc's "Do not parameterize" section.

/**
 * The variables an instance MUST set before any signed emission — the
 * identity half of the go-to-production step (the custody half is the
 * signing-key + key-id pair in unsigned-tier.ts). Everything else in the
 * identity set derives from these (host and URLs from the origin, the agent id
 * from the host) or is a per-item override.
 *
 * Declared by SUFFIX because each one has two accepted names since the
 * 2026-08-19 vocabulary settlement — `PUBLISHER_SITE_ORIGIN` canonically, with
 * `EVIDENCE_SITE_ORIGIN` still honored. Presence is therefore a two-name
 * question, and the one place that answers it is
 * `missingInstanceIdentityVars` in unsigned-tier.ts.
 */
export const INSTANCE_IDENTITY_REQUIRED_SUFFIXES = [
  'SITE_ORIGIN',
  'SIGNER_BINDING_TIER',
  'SIGNER_IDENTIFIER',
  'SIGNER_DISPLAY_NAME',
  'PLATFORM_AGENT_TITLE',
] as const satisfies readonly PublisherEnvSuffix[];

/**
 * The same five variables under their CANONICAL names — what a refusal names
 * and what an operator should set. `evaluateSealCommitGate` refuses with
 * exactly the missing names from this list, noting that the prior-era
 * `EVIDENCE_*` spellings are still accepted.
 */
export const INSTANCE_IDENTITY_REQUIRED_VARS: readonly string[] =
  INSTANCE_IDENTITY_REQUIRED_SUFFIXES.map(canonicalEnvName);

/**
 * Thrown when an identity-bearing emission path runs without the instance
 * identity it needs. Carries the exact missing variable names so refusals
 * are actionable. Last-resort guard only — user-reachable paths refuse
 * earlier and more politely via `evaluateSealCommitGate`
 * (`instance_identity_missing`).
 */
export class InstanceIdentityError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[], surface: string) {
    super(
      `[instance-identity] This instance has not declared its identity: ` +
        `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set ` +
        `in this environment. Refusing to emit ${surface} rather than ` +
        `substitute another deployment's identity — see docs/instance-setup.md.`,
    );
    this.name = 'InstanceIdentityError';
    this.missing = missing;
  }
}

/** THE presence test — non-empty after trim, matching unsigned-tier.ts and
 *  the preflight. Whitespace-only is absent. */
function presentOrNull(raw: string | undefined): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

/**
 * Public origin of this instance for record emission (absolute URLs inside
 * emitted proofs and signed output). Env: `PUBLISHER_SITE_ORIGIN`; `null`
 * when unset — the caller omits (display surfaces) or refuses (emission
 * paths; those sit behind the seal/commit gate). Trailing slash is trimmed
 * so derived URLs stay canonical.
 */
export function getEvidenceSiteOrigin(): string | null {
  const raw = presentOrNull(readPublisherEnv('SITE_ORIGIN'));
  return raw === null ? null : raw.replace(/\/$/, '');
}

/**
 * Host label of this instance — the `publicationHost` on
 * `attestation/publishes/v1` nodes, the datHere environment extension's
 * `host` field, and the "via …" attribution host. Env:
 * `PUBLISHER_PUBLICATION_HOST`; derives from the host of
 * `getEvidenceSiteOrigin()` when unset; `null` when neither is configured.
 */
export function getPublicationHost(): string | null {
  const explicit = presentOrNull(readPublisherEnv('PUBLICATION_HOST'));
  if (explicit) return explicit;
  const origin = getEvidenceSiteOrigin();
  if (origin === null) return null;
  try {
    return new URL(origin).host;
  } catch {
    // A non-URL origin (misconfiguration) still names the instance the
    // operator declared — better than pretending nothing is configured.
    return origin;
  }
}

/**
 * Strict form of `getPublicationHost()` for paths that COMMIT the host into
 * signed output (the packager's datHere environment extension, the
 * publication pair). Throws `InstanceIdentityError` when unresolvable —
 * callers reach this only behind `evaluateSealCommitGate`.
 */
export function requirePublicationHost(): string {
  const host = getPublicationHost();
  if (host === null) {
    throw new InstanceIdentityError(
      [canonicalEnvName('SITE_ORIGIN')],
      'a publication host label inside signed output',
    );
  }
  return host;
}

/**
 * Trust-registry URLs emitted into the proof sidecar (spec §8.8.1) — the TOP
 * ADR-0020 correctness item: an instance shipping another deployment's URLs
 * emits proofs pointing at a registry that lacks its key. Envs:
 * `PUBLISHER_TRUST_REGISTRY_CANONICAL_URL` /
 * `PUBLISHER_TRUST_REGISTRY_LEGACY_URL`;
 * both default to well-known paths on `getEvidenceSiteOrigin()` (the app
 * parallel-serves both paths from one registry file). Set the legacy var to
 * an empty string to omit `trustRegistryUrlLegacy` entirely — an instance
 * with no pre-ADR-0012 client base has no legacy path to honor.
 *
 * Throws `InstanceIdentityError` when the canonical URL is unresolvable
 * (no origin and no explicit override): the sidecar's `trustRegistryUrl` is
 * a REQUIRED per-publisher field with no honest absent form, so the serving
 * routes refuse (`instance_identity_missing`) rather than emit a pointer at
 * someone else's registry.
 */
export function getSidecarTrustRegistryUrls(): {
  canonical: string;
  legacy: string | undefined;
} {
  const origin = getEvidenceSiteOrigin();
  const canonical =
    presentOrNull(readPublisherEnv('TRUST_REGISTRY_CANONICAL_URL')) ??
    (origin !== null ? `${origin}/.well-known/typed-publisher.json` : null);
  if (canonical === null) {
    throw new InstanceIdentityError(
      [canonicalEnvName('SITE_ORIGIN')],
      "the proof sidecar's trust-registry URL",
    );
  }
  const legacyRaw = readPublisherEnv('TRUST_REGISTRY_LEGACY_URL');
  const legacy =
    legacyRaw === ''
      ? undefined
      : legacyRaw ||
        (origin !== null
          ? `${origin}/.well-known/evidence-public-keys.json`
          : undefined);
  return { canonical, legacy };
}

/**
 * Envelope-side signer identity claim for this instance (spec §8.1.1, §8.5)
 * — emitted verbatim inside signed output. Envs:
 * `PUBLISHER_SIGNER_BINDING_TIER` / `PUBLISHER_SIGNER_IDENTIFIER` /
 * `PUBLISHER_SIGNER_DISPLAY_NAME`. These MUST match the `signerIdentity`
 * recorded for the active `PUBLISHER_KEY_ID` in the instance's trust registry
 * (verify check #14 cross-checks the two).
 *
 * Throws `InstanceIdentityError` naming exactly the missing variables when
 * the triple is incomplete — a partial signer identity is not an identity,
 * and there is no coded default to fill it with. Callers reach this only
 * behind `evaluateSealCommitGate`; display surfaces that can render honest
 * absence use `getConfiguredSignerIdentity()` instead.
 */
export function getEvidenceSignerIdentity(): {
  bindingTier: string;
  identifier: string;
  displayName: string;
} {
  const bindingTier = presentOrNull(readPublisherEnv('SIGNER_BINDING_TIER'));
  const identifier = presentOrNull(readPublisherEnv('SIGNER_IDENTIFIER'));
  const displayName = presentOrNull(readPublisherEnv('SIGNER_DISPLAY_NAME'));
  const missing: string[] = [];
  if (bindingTier === null) missing.push(canonicalEnvName('SIGNER_BINDING_TIER'));
  if (identifier === null) missing.push(canonicalEnvName('SIGNER_IDENTIFIER'));
  if (displayName === null) missing.push(canonicalEnvName('SIGNER_DISPLAY_NAME'));
  if (missing.length > 0) {
    throw new InstanceIdentityError(
      missing,
      'an envelope signer identity claim',
    );
  }
  return {
    bindingTier: bindingTier as string,
    identifier: identifier as string,
    displayName: displayName as string,
  };
}

/**
 * The configured signer identity, or `null` when the triple is incomplete —
 * the non-throwing probe, for surfaces that DISPLAY or cross-check the
 * platform signer rather than commit to it (they can render honest absence).
 * The `getConfiguredKeyId` / `getActiveKeyId` split, applied to the signer.
 */
export function getConfiguredSignerIdentity(): {
  bindingTier: string;
  identifier: string;
  displayName: string;
} | null {
  try {
    return getEvidenceSignerIdentity();
  } catch (err) {
    if (err instanceof InstanceIdentityError) return null;
    throw err;
  }
}

/**
 * Display name of this instance for attribution surfaces — the "Generated
 * by …" lines in authored/downloaded notebooks. Reuses
 * `PUBLISHER_PLATFORM_AGENT_TITLE` (one variable names the instance in both
 * the PROV agent and the human-readable attribution); `null` when unset —
 * attribution surfaces then omit their "Generated by …" line rather than
 * claim a name (#258 A2). Client-rendered surfaces (the notebook download
 * button) receive the server-resolved value via `EvidenceOriginProvider`;
 * this getter reads nothing useful in the browser bundle.
 */
export function getPlatformTitle(): string | null {
  return presentOrNull(readPublisherEnv('PLATFORM_AGENT_TITLE'));
}

/**
 * Overrides for the PROV platform agent (WHO published, as a prov:Agent
 * inside the signed provenance graph). Envs: `PUBLISHER_PLATFORM_AGENT_ID` /
 * `PUBLISHER_PLATFORM_AGENT_TITLE` / `PUBLISHER_PLATFORM_AGENT_URL`; the agent
 * URL follows `PUBLISHER_SITE_ORIGIN` when unset, so a one-variable instance
 * setup re-points the agent too. `undefined` members mean "not configured" —
 * the packager (the sole signing-path consumer) requires title + url and
 * derives a missing id from the publication host; it never substitutes a
 * reference value (see `instanceProvenanceConfig` in evidence/packager.ts).
 */
export function getPlatformAgentOverrides(): {
  id?: string;
  title?: string;
  url?: string;
} {
  return {
    id: presentOrNull(readPublisherEnv('PLATFORM_AGENT_ID')) ?? undefined,
    title: getPlatformTitle() ?? undefined,
    url:
      presentOrNull(readPublisherEnv('PLATFORM_AGENT_URL')) ??
      getEvidenceSiteOrigin() ??
      undefined,
  };
}

/**
 * The instance's attribution identity for display surfaces, all members
 * nullable — `null` means "not configured", and the consuming surface omits
 * its attribution line (honest absence, never a placeholder). Resolved
 * server-side (layout.tsx) and carried to client components via
 * `EvidenceOriginProvider`, so the browser bundle never needs the env.
 */
export interface InstanceAttribution {
  /** Public origin (`PUBLISHER_SITE_ORIGIN`), e.g. `https://example.org`. */
  origin: string | null;
  /** Host label (`PUBLISHER_PUBLICATION_HOST` or derived from the origin). */
  host: string | null;
  /** Display name (`PUBLISHER_PLATFORM_AGENT_TITLE`). */
  platformTitle: string | null;
}

/** Server-side resolution of `InstanceAttribution` from the environment. */
export function getInstanceAttribution(): InstanceAttribution {
  return {
    origin: getEvidenceSiteOrigin(),
    host: getPublicationHost(),
    platformTitle: getPlatformTitle(),
  };
}
