// Site-wide external URLs. Import from here rather than hard-coding hrefs so
// each destination can be changed in one place.

// Relative, extension-bearing import: this module is in the `node --test`
// graph (via the evidence modules), which resolves neither the `@/` alias nor
// extensionless specifiers — the same convention as evidence/verify.ts.
import { describeContentSource, type ContentProvenance } from './content-source.ts';

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

/**
 * Optional sponsor acknowledgment, rendered in the global footer and the
 * /about "Who built this" section when non-null (via components/SponsorLine,
 * as "{prefix} {name}." with the name linked to {url}). While null, both
 * mounts render nothing — zero visual change.
 *
 * The approved wording arrives from the comms side; do not draft or guess it
 * here. When it lands, it is additive to — never a replacement for — the
 * existing "Personal project · Not affiliated with any employer." line.
 */
export const SPONSOR: { prefix: string; name: string; url: string } | null = {
  prefix: 'Fiscally sponsored by',
  name: 'Metagov',
  url: 'https://metagov.org',
};

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

// --- Evidence instance identity (ADR-0020: config, not code) ----------------
//
// Every value that names THIS deployment inside emitted evidence surfaces —
// the proof sidecar's trust-registry URLs, the envelope `signer` claim, the
// publication host label, the PROV platform agent — resolves through the
// getters below. The demo defaults are the civicaitools.org reference
// deployment's historical hardcoded values, so with NO environment set the
// emitted bytes are byte-identical to before (the S3a byte-parity bar).
//
// An instance sets `EVIDENCE_SITE_ORIGIN` plus the signer/key variables and
// every derived surface follows; each item is also individually overridable
// for split-host deployments. Values are read at CALL time (not module load)
// so tests and rotation drills can vary them per-process.
//
// Setup walkthrough (keygen, registry template, variable table):
// docs/instance-setup.md. Vocabulary identifiers (`civic:` namespace,
// `org.civicaitools.*` extension keys) are NOT instance identity and must
// never be parameterized — see the same doc's "Do not parameterize" section.

/** Demo default origin — the civicaitools.org reference deployment. */
export const DEMO_SITE_ORIGIN = 'https://civicaitools.org';

/** Demo default host label (the origin's host). */
export const DEMO_PUBLICATION_HOST = 'civicaitools.org';

/** Demo default canonical trust-registry URL (spec §8.3.3, ADR-0012 §3). */
export const DEMO_TRUST_REGISTRY_CANONICAL_URL =
  'https://civicaitools.org/.well-known/typed-publisher.json';

/** Demo default legacy trust-registry URL (pre-ADR-0012 path, parallel-served). */
export const DEMO_TRUST_REGISTRY_LEGACY_URL =
  'https://civicaitools.org/.well-known/evidence-public-keys.json';

/** Demo default platform display name — the attribution name inside authored
 *  notebooks and the PROV platform-agent title. Anti-drift-pinned against the
 *  harness's `CIVICAITOOLS_PLATFORM_AGENT.title` in instance-config.test.ts. */
export const DEMO_PLATFORM_TITLE = 'Civic AI Tools';

/** Demo default envelope-side signer identity (spec §8.5). MUST match the
 *  `signerIdentity` recorded for the active kid in the trust registry so
 *  verify check #14 resolves. */
export const DEMO_SIGNER_IDENTITY = {
  bindingTier: 'platform',
  identifier: 'platform:civic-ai-tools',
  displayName: 'Civic AI Tools Platform',
} as const;

/**
 * Public origin of this instance for evidence emission (absolute URLs inside
 * emitted proofs and signed output). Env: `EVIDENCE_SITE_ORIGIN`. Trailing
 * slash is trimmed so derived URLs stay canonical.
 */
export function getEvidenceSiteOrigin(): string {
  return (process.env.EVIDENCE_SITE_ORIGIN || DEMO_SITE_ORIGIN).replace(/\/$/, '');
}

/**
 * Host label of this instance — the `publicationHost` on
 * `attestation/publishes/v1` nodes and the datHere environment extension's
 * `host` field. Env: `EVIDENCE_PUBLICATION_HOST`; defaults to the host of
 * `getEvidenceSiteOrigin()`.
 */
export function getPublicationHost(): string {
  const explicit = process.env.EVIDENCE_PUBLICATION_HOST;
  if (explicit) return explicit;
  try {
    return new URL(getEvidenceSiteOrigin()).host;
  } catch {
    return DEMO_PUBLICATION_HOST;
  }
}

/**
 * Trust-registry URLs emitted into the proof sidecar (spec §8.8.1) — the TOP
 * ADR-0020 correctness item: an instance shipping the demo URLs unchanged
 * emits proofs pointing at a registry that lacks its key. Envs:
 * `EVIDENCE_TRUST_REGISTRY_CANONICAL_URL` / `EVIDENCE_TRUST_REGISTRY_LEGACY_URL`;
 * both default to well-known paths on `getEvidenceSiteOrigin()` (the app
 * parallel-serves both paths from one registry file). Set the legacy var to
 * an empty string to omit `trustRegistryUrlLegacy` entirely — an instance
 * with no pre-ADR-0012 client base has no legacy path to honor.
 */
export function getSidecarTrustRegistryUrls(): {
  canonical: string;
  legacy: string | undefined;
} {
  const origin = getEvidenceSiteOrigin();
  const canonical =
    process.env.EVIDENCE_TRUST_REGISTRY_CANONICAL_URL ||
    `${origin}/.well-known/typed-publisher.json`;
  const legacyRaw = process.env.EVIDENCE_TRUST_REGISTRY_LEGACY_URL;
  const legacy =
    legacyRaw === ''
      ? undefined
      : legacyRaw || `${origin}/.well-known/evidence-public-keys.json`;
  return { canonical, legacy };
}

/**
 * Envelope-side signer identity claim for this instance (spec §8.1.1, §8.5)
 * — emitted verbatim inside signed output. Envs:
 * `EVIDENCE_SIGNER_BINDING_TIER` / `EVIDENCE_SIGNER_IDENTIFIER` /
 * `EVIDENCE_SIGNER_DISPLAY_NAME`. These MUST match the `signerIdentity`
 * recorded for the active `EVIDENCE_KEY_ID` in the instance's trust registry
 * (verify check #14 cross-checks the two).
 */
export function getEvidenceSignerIdentity(): {
  bindingTier: string;
  identifier: string;
  displayName: string;
} {
  return {
    bindingTier:
      process.env.EVIDENCE_SIGNER_BINDING_TIER || DEMO_SIGNER_IDENTITY.bindingTier,
    identifier:
      process.env.EVIDENCE_SIGNER_IDENTIFIER || DEMO_SIGNER_IDENTITY.identifier,
    displayName:
      process.env.EVIDENCE_SIGNER_DISPLAY_NAME || DEMO_SIGNER_IDENTITY.displayName,
  };
}

/**
 * Display name of this instance for attribution surfaces — the "Generated
 * by …" lines in authored/downloaded notebooks. Reuses
 * `EVIDENCE_PLATFORM_AGENT_TITLE` (one variable names the instance in both
 * the PROV agent and the human-readable attribution), demo default
 * 'Civic AI Tools'. NOTE: on client-rendered surfaces (the notebook
 * download button) non-NEXT_PUBLIC env is not inlined into the browser
 * bundle, so the demo default renders there regardless of server config —
 * see the flag in the S3a P2 phase record.
 */
export function getPlatformTitle(): string {
  return process.env.EVIDENCE_PLATFORM_AGENT_TITLE || DEMO_PLATFORM_TITLE;
}

/**
 * Overrides for the PROV platform agent (WHO published, as a prov:Agent
 * inside the signed provenance graph). Envs: `EVIDENCE_PLATFORM_AGENT_ID` /
 * `EVIDENCE_PLATFORM_AGENT_TITLE` / `EVIDENCE_PLATFORM_AGENT_URL`. All
 * `undefined` (→ the harness's demo defaults) when unset; the agent URL
 * follows `EVIDENCE_SITE_ORIGIN` when that is set, so a one-variable
 * instance setup re-points the agent too.
 */
export function getPlatformAgentOverrides(): {
  id?: string;
  title?: string;
  url?: string;
} {
  return {
    id: process.env.EVIDENCE_PLATFORM_AGENT_ID || undefined,
    title: process.env.EVIDENCE_PLATFORM_AGENT_TITLE || undefined,
    url:
      process.env.EVIDENCE_PLATFORM_AGENT_URL ||
      (process.env.EVIDENCE_SITE_ORIGIN ? getEvidenceSiteOrigin() : undefined),
  };
}
