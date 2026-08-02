// Site-wide external URLs. Import from here rather than hard-coding hrefs so
// each destination can be changed in one place.

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
