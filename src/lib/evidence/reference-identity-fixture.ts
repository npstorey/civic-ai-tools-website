// Reference-deployment identity FIXTURE (#258 — findings A1/A2 of the
// portability audit).
//
// These are the civicaitools.org reference deployment's identity values.
// They used to live in src/lib/site-config.ts as `DEMO_*` constants that the
// identity getters silently defaulted through — which meant an unconfigured
// instance emitted the REFERENCE deployment's origin, signer, registry URLs,
// and attribution inside its own signed output. That default path is gone:
// the getters resolve from the environment only, signing paths refuse
// (`instance_identity_missing`), and unsigned surfaces honestly omit.
//
// TEST / REHEARSAL INPUT ONLY. Nothing in the runtime import graph may
// import this module. Byte-parity tests inject `REFERENCE_IDENTITY_ENV`
// explicitly as environment — proving that the reference deployment, which
// sets exactly these variables in its real environment, emits bytes
// identical to its historical output. That injection is the parity proof,
// not a defect.

/** The reference deployment's public origin. */
export const REFERENCE_SITE_ORIGIN = 'https://civicaitools.org';

/** The reference deployment's host label (the origin's host). */
export const REFERENCE_PUBLICATION_HOST = 'civicaitools.org';

/** Canonical trust-registry URL (spec §8.3.3, ADR-0012 §3). */
export const REFERENCE_TRUST_REGISTRY_CANONICAL_URL =
  'https://civicaitools.org/.well-known/typed-publisher.json';

/** Legacy trust-registry URL (pre-ADR-0012 path, parallel-served). */
export const REFERENCE_TRUST_REGISTRY_LEGACY_URL =
  'https://civicaitools.org/.well-known/evidence-public-keys.json';

/** Platform display name — notebook attribution + PROV platform-agent title.
 *  Anti-drift-pinned against the harness's `CIVICAITOOLS_PLATFORM_AGENT.title`
 *  in instance-config.test.ts. */
export const REFERENCE_PLATFORM_TITLE = 'Civic AI Tools';

/** PROV platform-agent id — pinned against the harness's
 *  `CIVICAITOOLS_PLATFORM_AGENT.id` in instance-config.test.ts. */
export const REFERENCE_PLATFORM_AGENT_ID = 'civic-ai-tools';

/** Envelope-side signer identity claim (spec §8.5) recorded for the
 *  reference deployment's active kid in its trust registry. */
export const REFERENCE_SIGNER_IDENTITY = {
  bindingTier: 'platform',
  identifier: 'platform:civic-ai-tools',
  displayName: 'Civic AI Tools Platform',
} as const;

/**
 * The reference identity as ready-to-inject environment — the same variables
 * the reference deployment sets in its real environment. Deliberately the
 * MINIMAL explicit set: publication host, registry URLs, and the platform-
 * agent URL are left to derive from the origin, so injecting this set also
 * exercises the derivation chain and must reproduce the historical values
 * byte-identically.
 */
export const REFERENCE_IDENTITY_ENV = {
  EVIDENCE_SITE_ORIGIN: REFERENCE_SITE_ORIGIN,
  EVIDENCE_SIGNER_BINDING_TIER: REFERENCE_SIGNER_IDENTITY.bindingTier,
  EVIDENCE_SIGNER_IDENTIFIER: REFERENCE_SIGNER_IDENTITY.identifier,
  EVIDENCE_SIGNER_DISPLAY_NAME: REFERENCE_SIGNER_IDENTITY.displayName,
  EVIDENCE_PLATFORM_AGENT_TITLE: REFERENCE_PLATFORM_TITLE,
  EVIDENCE_PLATFORM_AGENT_ID: REFERENCE_PLATFORM_AGENT_ID,
} as const;
