import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { ed25519ph } from '@noble/curves/ed25519.js';
import { rekorHashForPackage, type SignerIdentity } from './signing.ts';
import { captureVocabForProfile, resolveProfileType } from './profiles.ts';
import type { CaptureMethod } from './packager.ts';
import {
  computeEnvelopeHash,
  computeContentHashSha256,
  isMultihashContentHash,
  KNOWN_CANONICALIZATION_RULES,
  LEGACY_JSON_CANONICALIZATION,
  DATHERE_AG_JUPYTER_CANONICALIZATION,
} from './canonicalization.ts';
import {
  ATTESTATION_WITHDRAWS,
  ATTESTATION_REINSTATES,
  LIFECYCLE_ATTESTATION_TYPES,
} from './attestation.ts';
import {
  isBlobRef,
  verifyBlobRef,
  type BlobRef,
  type BlobRefVerifyReason,
} from './blob-ref.ts';

// Build-time import of the checked-in trust registry. This is the most
// reliable source on Vercel: a filesystem read relies on `process.cwd()`
// resolving to a directory that actually contains the bundled `public/`
// folder, and an HTTP fetch back to our own origin is blocked by
// preview-deployment auth walls. The static import has Next.js bundle
// the JSON into the function's module graph at build time so
// `loadTrustRegistry` can return a result synchronously.
import embeddedTrustRegistry from '../../../public/.well-known/evidence-public-keys.json' with { type: 'json' };

/**
 * Extract the raw 32-byte Ed25519 public key from a base64 SPKI DER
 * encoding via Node's JWK export. Noble's `ed25519ph.verify` wants raw
 * key bytes; Node's crypto surfaces them through JWK.
 */
function extractRawPublicKey(publicKeyB64Der: string): Uint8Array {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyB64Der, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x) throw new Error('Ed25519 public key JWK missing "x"');
  return Uint8Array.from(Buffer.from(jwk.x, 'base64url'));
}

/**
 * Verify an Ed25519ph signature against the package hash.
 *
 * The signed message is the UTF-8 bytes of the package hex hash — the
 * same convention used by `signPackage` in `signing.ts`. Ed25519ph
 * prehashes the message with SHA-512 before the Ed25519 verify, which
 * matches the format Rekor uses to validate the same signature.
 */
export function verifySignature(
  packageHash: string,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  try {
    const pubBytes = extractRawPublicKey(publicKeyB64);
    const sigBytes = Uint8Array.from(Buffer.from(signatureB64, 'base64'));
    const messageBytes = Uint8Array.from(Buffer.from(packageHash, 'utf-8'));
    return ed25519ph.verify(sigBytes, messageBytes, pubBytes);
  } catch (err) {
    console.error('[verify] Signature verification error:', err);
    return false;
  }
}

export interface RekorVerifyResult {
  verified: boolean;
  logIndex?: number;
  integratedTime?: number;
  logEntryUrl?: string;
}

/**
 * Verify that a Rekor transparency log entry is consistent with a
 * published package.
 *
 * The `packageHash` argument is the SHA-256 hash our system stores as
 * `basePackageHash`. Rekor's entry does NOT store that value directly —
 * it stores the SHA-512 prehash of the signed message
 * (see `rekorHashForPackage` in signing.ts), because the submission uses
 * Ed25519ph. We derive the expected Rekor hash here and compare.
 */
export async function verifyRekorEntry(
  entryId: string,
  packageHash: string,
): Promise<RekorVerifyResult> {
  try {
    const response = await fetch(
      `https://rekor.sigstore.dev/api/v1/log/entries/${entryId}`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!response.ok) {
      return { verified: false };
    }

    const result = await response.json();
    const entry = result[entryId] || Object.values(result)[0];
    if (!entry) return { verified: false };

    // Decode the body and cross-check both hash algorithm and value.
    const body = JSON.parse(
      Buffer.from(entry.body, 'base64').toString('utf-8'),
    );
    const recordedHash: string | undefined = body?.spec?.data?.hash?.value;
    const recordedAlgo: string | undefined = body?.spec?.data?.hash?.algorithm;
    const expectedHash = rekorHashForPackage(packageHash);
    const verified = recordedAlgo === 'sha512' && recordedHash === expectedHash;

    return {
      verified,
      logIndex: entry.logIndex,
      integratedTime: entry.integratedTime,
      logEntryUrl: `https://search.sigstore.dev/?logIndex=${entry.logIndex}`,
    };
  } catch (err) {
    console.error('[verify] Rekor verification error:', err);
    return { verified: false };
  }
}

/**
 * Recompute a package's envelope hash, routed by the §8.2 detection rule:
 * v0.1 packages (multihash `contentHash` present) hash via RFC 8785 JCS;
 * pre-v0.1 packages hash via the legacy insertion-order `JSON.stringify`.
 * Drives both check #1 (envelope integrity / `hashMatch`) and check #13
 * (`nodeId`). Delegates to the shared `computeEnvelopeHash` so the recomputed
 * value is guaranteed to match what the packager produced.
 */
export function recomputePackageHash(pkg: Record<string, unknown>): string {
  return computeEnvelopeHash(pkg);
}

// --- Content canonicalization & hashing checks (spec §9.2 checks #3, #4) ---
//
// These read the §8.2 `contentCanonicalization` + `contentHash` fields. Like
// the envelope checks below, each degrades gracefully for pre-v0.1 packages
// that omit the fields: check #3 infers the rule from the content profile,
// and check #4 relabels the package's historical external single-SHA-256
// rather than recomputing it under a v0.1 rule.

export type ContentCanonicalizationStatus =
  | 'ok'
  | 'implicit'
  | 'unknown_canonicalization_rule';

export interface ContentCanonicalizationResolution {
  status: ContentCanonicalizationStatus;
  /** The resolved canonicalization-rule URI — the explicit field value, or
   *  the rule inferred from the content profile for pre-v0.1 packages. */
  rule: string;
}

/**
 * Check #3 — content-canonicalization rule resolution (spec §9.2). Reads the
 * package's `contentCanonicalization` URI and resolves it against the local
 * rule registry. A known URI → `ok`. An unrecognized URI →
 * `unknown_canonicalization_rule` (renders; check #4 then cannot recompute).
 * An absent field on a pre-v0.1 package → `implicit`, inferring the rule from
 * contentProfile / producerProfile (datHere → dathere-ag-jupyter/v1;
 * otherwise legacy-json/v1).
 */
export function resolveContentCanonicalization(
  pkg: Record<string, unknown>,
): ContentCanonicalizationResolution {
  const raw = pkg['contentCanonicalization'];
  if (typeof raw === 'string' && raw.length > 0) {
    if (KNOWN_CANONICALIZATION_RULES.includes(raw)) {
      return { status: 'ok', rule: raw };
    }
    return { status: 'unknown_canonicalization_rule', rule: raw };
  }
  // Pre-v0.1: infer the rule from the content profile (the same datHere
  // legacy-alias logic the captureMethod resolver uses).
  const metadata = pkg['metadata'] as Record<string, unknown> | undefined;
  const contentProfile =
    typeof metadata?.['contentProfile'] === 'string'
      ? (metadata['contentProfile'] as string)
      : undefined;
  const producerProfile =
    typeof pkg['producerProfile'] === 'string'
      ? (pkg['producerProfile'] as string)
      : undefined;
  const isDatHere =
    contentProfile === 'datHere' ||
    (producerProfile?.startsWith('ai-assisted-analysis/datHere') ?? false);
  return {
    status: 'implicit',
    rule: isDatHere
      ? DATHERE_AG_JUPYTER_CANONICALIZATION
      : LEGACY_JSON_CANONICALIZATION,
  };
}

export type ContentHashStatus =
  | 'ok'
  | 'content_hash_mismatch'
  | 'contentHash_no_supported_algorithm'
  | 'unresolved_rule'
  | 'legacy_relabeled';

export interface ContentHashCheck {
  status: ContentHashStatus;
  /** Algorithm names listed in the package's multihash `contentHash`. */
  algorithms?: string[];
  /** The algorithm whose recomputed digest matched (status === 'ok'). */
  matched?: string;
  /** The multihash digest set the verifier reports for the package. For
   *  pre-v0.1 packages this is the legacy external single-SHA-256 relabeled
   *  as `{ sha256: <hex> }` per §8.2. */
  contentHash?: Record<string, string>;
}

/** Multihash algorithms this verifier can recompute today (spec §8.2 lists
 *  sha256 required + sha3-256 / blake3 as registered alternates). */
const SUPPORTED_CONTENT_HASH_ALGORITHMS: readonly string[] = ['sha256'];

/**
 * Check #4 — content-hash verification (spec §9.2, §8.2).
 *
 * v0.1 packages (multihash `contentHash` present): recompute the off-log
 * content's digest under the resolved canonicalization rule for every listed
 * algorithm this verifier supports, and confirm at least one matches.
 *   - at least one supported algorithm matches → `ok`.
 *   - a supported algorithm is present but none match → `content_hash_mismatch`
 *     (the off-log content was altered).
 *   - none of the listed algorithms are ones this verifier can compute →
 *     `contentHash_no_supported_algorithm` (degrades; the value is preserved).
 *   - the canonicalization rule could not be resolved (check #3 unknown) →
 *     `unresolved_rule` (cannot recompute).
 *
 * pre-v0.1 packages (no multihash `contentHash`): the historical external
 * single-SHA-256 (the package's slug / `basePackageHash`) is RELABELED as
 * `{ sha256: <hex> }` per §8.2 rather than recomputed under legacy-json/v1.
 * Its integrity is established by check #1 (the legacy envelope hash matches
 * the slug), so check #4 reports `legacy_relabeled` rather than re-deriving it.
 */
export function verifyContentHash(
  pkg: Record<string, unknown>,
  resolution: ContentCanonicalizationResolution,
  legacyExternalHash?: string,
): ContentHashCheck {
  const contentHash = pkg['contentHash'];
  if (!isMultihashContentHash(contentHash)) {
    return {
      status: 'legacy_relabeled',
      ...(legacyExternalHash ? { contentHash: { sha256: legacyExternalHash } } : {}),
    };
  }

  const algorithms = Object.keys(contentHash);
  if (resolution.status === 'unknown_canonicalization_rule') {
    return { status: 'unresolved_rule', algorithms, contentHash };
  }

  const checkable = algorithms.filter((a) =>
    SUPPORTED_CONTENT_HASH_ALGORITHMS.includes(a),
  );
  if (checkable.length === 0) {
    return {
      status: 'contentHash_no_supported_algorithm',
      algorithms,
      contentHash,
    };
  }

  for (const algo of checkable) {
    let recomputed: string | undefined;
    try {
      // sha256 is the only supported algorithm today; the off-log content is
      // recomputed under the resolved rule (legacy-json/v1 → package minus
      // contentHash; dathere-ag-jupyter/v1 → the executed notebook).
      recomputed =
        algo === 'sha256'
          ? computeContentHashSha256(pkg, resolution.rule)
          : undefined;
    } catch {
      // A structurally malformed package (e.g. a datHere package missing its
      // notebook extension) can't be recomputed — treat as non-matching
      // rather than throwing out of the whole verify pass.
      recomputed = undefined;
    }
    if (recomputed !== undefined && recomputed === contentHash[algo]) {
      return { status: 'ok', algorithms, matched: algo, contentHash };
    }
  }
  return { status: 'content_hash_mismatch', algorithms, contentHash };
}

// --- Lifecycle attestation checks (spec §9.2 check #10, §8.10) ---
//
// Lifecycle state (withdrawn / active) is derived from a chain of separately-
// signed `attestation/*` nodes referencing the content node by `targetNodeId`,
// each verified independently. Backwards-compat (§8.10.4): when no attestation
// envelopes are present, the legacy `withdrawnAt` / `reinstatedAt` DB columns
// are honored instead — the same dual-read shape as PR2's dual-chain hashing.
// The DB + blob fetch + per-node crypto orchestration lives in
// `lifecycle.ts`; the pure ordering / status-derivation logic lives here so it
// is unit-testable.

export type LifecycleStatus = 'active' | 'withdrawn';

/** A single verified lifecycle attestation, as surfaced in the chain. */
export interface LifecycleAttestationView {
  nodeId: string;
  type: string;
  signer?: SignerIdentity;
  /** Envelope timestamp (the node's `metadata.createdAt`) — the chain sort key. */
  createdAt: string;
  reason?: string;
  effectiveAt?: string;
  priorWithdrawalNodeId?: string;
  /** Ed25519ph signature over the recomputed nodeId; null when unsigned. */
  signatureValid: boolean | null;
  /** Recomputed envelope hash equals the stored nodeId (integrity). */
  nodeIdMatches: boolean;
  /** RFC 3161 timestamp token present (presence surfaced; full TSA-chain
   *  verification is the same out-of-scope item as for content nodes). */
  hasTimestamp: boolean;
  /** Rekor inclusion-proof entry present (presence only; per-attestation Rekor
   *  cryptographic verification is a follow-up). */
  hasRekor: boolean;
  /** Publisher-only conformance (§8.12.3): the attestation's signer.identifier
   *  matches the target content node's signer.identifier. */
  signerMatchesTarget: boolean;
}

export interface LifecycleResolution {
  status: LifecycleStatus;
  /** Which representation determined the status. `none` = never withdrawn,
   *  no attestations and no legacy columns. */
  source: 'attestation-chain' | 'legacy-columns' | 'none';
  /** The ordered lifecycle attestation chain (envelope-timestamp asc, ties by
   *  nodeId lexicographic). Empty for the legacy-columns / none sources. */
  chain: LifecycleAttestationView[];
  // Convenience fields for rendering, populated from whichever source won.
  withdrawnAt?: string;
  withdrawnReason?: string;
  reinstatedAt?: string;
  reinstatedReason?: string;
}

export interface AttestationVerifyResult {
  /** The recomputed envelope hash (= nodeId by construction). */
  nodeId: string;
  /** Recomputed envelope hash equals the stored nodeId. */
  nodeIdMatches: boolean;
  /** Ed25519ph signature verifies over the recomputed nodeId; null if unsigned. */
  signatureValid: boolean | null;
}

/**
 * Verify an attestation node independently (spec §8.10: "verify the
 * corresponding lifecycle signatures … for each attestation independently").
 * Recomputes the envelope hash via the shared dual-chain `computeEnvelopeHash`
 * (attestation nodes carry a multihash `contentHash`, so this is the JCS chain)
 * and verifies the Ed25519ph signature over it.
 */
export function verifyAttestationNode(
  node: Record<string, unknown>,
  storedNodeId: string,
  sigEnvelope: { signature?: string; publicKey?: string } | null,
): AttestationVerifyResult {
  const recomputed = computeEnvelopeHash(node);
  const nodeIdMatches = recomputed === storedNodeId;
  let signatureValid: boolean | null = null;
  if (sigEnvelope?.signature && sigEnvelope?.publicKey) {
    signatureValid = verifySignature(
      recomputed,
      sigEnvelope.signature,
      sigEnvelope.publicKey,
    );
  }
  return { nodeId: recomputed, nodeIdMatches, signatureValid };
}

/** Envelope-timestamp ascending, ties broken by nodeId lexicographic (§8.10.1). */
function compareLifecycleOrder(
  a: LifecycleAttestationView,
  b: LifecycleAttestationView,
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.nodeId === b.nodeId) return 0;
  return a.nodeId < b.nodeId ? -1 : 1;
}

/**
 * Check #10 (chain path) — derive lifecycle status from a set of verified
 * attestation views (spec §8.10.1, §8.10.3). The current status is the latest
 * signer-matched lifecycle attestation by envelope timestamp: `withdraws` →
 * withdrawn, `reinstates` → active. Non-signer-matched attestations are kept in
 * the surfaced chain for transparency but do NOT move the status (retention
 * asymmetry, §8.10.3 — a publisher's status label is bounded to their own
 * signer).
 */
export function resolveLifecycleFromChain(
  views: LifecycleAttestationView[],
): LifecycleResolution {
  const chain = views
    .filter((v) => LIFECYCLE_ATTESTATION_TYPES.includes(v.type))
    .slice()
    .sort(compareLifecycleOrder);

  const signerMatched = chain.filter((v) => v.signerMatchesTarget);
  const latest = signerMatched[signerMatched.length - 1];
  const status: LifecycleStatus =
    latest && latest.type === ATTESTATION_WITHDRAWS ? 'withdrawn' : 'active';

  const latestWithdraw = [...signerMatched]
    .reverse()
    .find((v) => v.type === ATTESTATION_WITHDRAWS);
  const latestReinstate = [...signerMatched]
    .reverse()
    .find((v) => v.type === ATTESTATION_REINSTATES);

  return {
    status,
    source: 'attestation-chain',
    chain,
    ...(latestWithdraw
      ? {
          withdrawnAt: latestWithdraw.effectiveAt ?? latestWithdraw.createdAt,
          withdrawnReason: latestWithdraw.reason,
        }
      : {}),
    ...(latestReinstate
      ? {
          reinstatedAt: latestReinstate.createdAt,
          reinstatedReason: latestReinstate.reason,
        }
      : {}),
  };
}

/**
 * Check #10 (legacy fallback) — derive lifecycle status from the pre-PR3
 * `withdrawnAt` / `reinstatedAt` DB columns (spec §8.10.4). Used when a content
 * node has no attestation envelopes. Mirrors the legacy single-cycle semantics:
 * withdrawn iff `withdrawnAt` is set and `reinstatedAt` is not.
 */
export function resolveLifecycleFromLegacyColumns(columns: {
  withdrawnAt?: string | null;
  withdrawnReason?: string | null;
  reinstatedAt?: string | null;
  reinstatedReason?: string | null;
}): LifecycleResolution {
  if (!columns.withdrawnAt) {
    return { status: 'active', source: 'none', chain: [] };
  }
  const reinstated = !!columns.reinstatedAt;
  return {
    status: reinstated ? 'active' : 'withdrawn',
    source: 'legacy-columns',
    chain: [],
    withdrawnAt: columns.withdrawnAt,
    ...(columns.withdrawnReason ? { withdrawnReason: columns.withdrawnReason } : {}),
    ...(columns.reinstatedAt ? { reinstatedAt: columns.reinstatedAt } : {}),
    ...(columns.reinstatedReason
      ? { reinstatedReason: columns.reinstatedReason }
      : {}),
  };
}

// --- Blob references (Phase B.6) ---
//
// Evidence packages can store large fields as content-addressable blobs
// rather than inlining the content. Verification downloads each blob and
// confirms the bytes hash to the advertised ref.

/** Field paths that the core verifier scans for BlobRef objects. */
const BLOB_REF_FIELDS = [
  'output',
  'trace',
  'skillMetadata.skillText',
] as const;

export type BlobRefField = (typeof BLOB_REF_FIELDS)[number];

export interface BlobRefVerification {
  field: BlobRefField;
  ref: string;
  url: string;
  size: number;
  contentType: string;
  ok: boolean;
  reason?: BlobRefVerifyReason;
}

function pickBlobRef(pkg: Record<string, unknown>, path: BlobRefField): BlobRef | null {
  const segments = path.split('.');
  let current: unknown = pkg;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return isBlobRef(current) ? current : null;
}

/**
 * Walk the package JSON for BlobRef fields, fetch each referenced blob,
 * and confirm the bytes hash to the advertised ref. Returns per-field
 * verification results. Used by the slug verify endpoint to surface
 * content-integrity per reference alongside the package-level signature
 * and Rekor checks.
 *
 * Runs fetches in parallel with a per-blob 15 s timeout. Failures are
 * reported in the result rather than thrown — one bad reference doesn't
 * fail the whole verify call.
 */
export async function verifyPackageBlobRefs(
  pkg: Record<string, unknown>,
): Promise<BlobRefVerification[]> {
  const refs = BLOB_REF_FIELDS
    .map((field) => {
      const ref = pickBlobRef(pkg, field);
      return ref ? { field, ref } : null;
    })
    .filter((x): x is { field: BlobRefField; ref: BlobRef } => x !== null);

  return Promise.all(
    refs.map(async ({ field, ref }) => {
      const result = await verifyBlobRef(ref);
      return {
        field,
        ref: ref.ref,
        url: ref.url,
        size: ref.size,
        contentType: ref.contentType,
        ok: result.ok,
        reason: result.reason,
      };
    }),
  );
}

// --- Trust registry ---
//
// The platform publishes its set of authorized signing keys at
// `/.well-known/evidence-public-keys.json`. Verification treats the registry
// as the source of truth for which `(kid, publicKey)` pairs are allowed and
// for their rotation state. Keys that don't appear, or appear as revoked,
// fail verification regardless of cryptographic correctness — a locally
// valid signature from an unrecognised key is still not "trusted evidence".

export type KeyLifecycleStatus = 'active' | 'deprecated' | 'revoked';

export interface TrustRegistryKey {
  kid: string;
  publicKey: string;
  status: KeyLifecycleStatus;
  activatedAt: string;
  deprecatedAt: string | null;
  revokedAt: string | null;
  /** Identity the `kid` is bound to (spec §8.3.3). Verify check #14
   *  cross-checks a package's envelope-side `signer.identifier` against this.
   *  Optional: legacy registries omit it, and verifiers then skip the
   *  cross-check (treating the binding as `legacy_embedded`). */
  signerIdentity?: SignerIdentity;
}

export interface TrustRegistry {
  keys: TrustRegistryKey[];
}

export type KeyTrustStatus =
  | 'active'                // active key — package is trusted
  | 'deprecated_valid'      // deprecated key, but package was signed before deprecation
  | 'deprecated_invalid'    // deprecated key, but package was signed after deprecation
  | 'revoked'               // revoked key — package is never trusted
  | 'unknown_key'           // (kid, publicKey) pair not found in registry
  | 'registry_unavailable'  // registry could not be loaded
  | 'legacy_embedded';      // signature predates the trust registry (no kid stored)

export interface KeyTrustResult {
  status: KeyTrustStatus;
  /** `true` iff the status is `active` or `deprecated_valid`. Legacy-embedded
   *  signatures are intentionally surfaced as `verified: false` because the
   *  trust registry cannot vouch for them — the UI renders them as neutral
   *  rather than failed. */
  verified: boolean;
  /** The registry `kid` when available. Omitted for `legacy_embedded` /
   *  pre-registry packages because the signature has no kid to report. */
  kid?: string;
  activatedAt?: string;
  deprecatedAt?: string | null;
  revokedAt?: string | null;
}

/**
 * Build a `KeyTrustResult` for a package whose signature predates the trust
 * registry — i.e. has a valid public key but no `kid`. We accept that the
 * embedded key verified the signature mathematically while making clear in
 * the UI that no registry check was performed.
 */
export function legacyEmbeddedKeyTrust(): KeyTrustResult {
  return { status: 'legacy_embedded', verified: false };
}

/**
 * Verify that a `(kid, publicKey)` pair is trusted by the platform registry,
 * applying the rotation semantics documented in the P5 plan:
 *   - `active` → trusted.
 *   - `deprecated` → trusted only when `packageIntegratedTime` precedes
 *     `deprecatedAt` (preventive rotation — pre-deprecation signatures
 *     remain valid, signatures after the rotation point do not).
 *   - `revoked` → never trusted (compromise — any signature during the
 *     exposure window is treated as suspect).
 *   - unknown pair → never trusted.
 *
 * The registry is passed in rather than fetched here so the caller can
 * cache it and so the function stays pure for unit testing.
 */
export function verifyKeyTrust(
  publicKey: string,
  kid: string,
  /** Rekor `integratedTime`, seconds since epoch. `undefined` when the
   *  package has no Rekor entry or when Rekor verification failed. */
  packageIntegratedTime: number | undefined,
  registry: TrustRegistry | undefined,
): KeyTrustResult {
  if (!registry) {
    return { status: 'registry_unavailable', verified: false, kid };
  }

  const match = registry.keys.find(
    (k) => k.kid === kid && k.publicKey === publicKey,
  );
  if (!match) {
    return { status: 'unknown_key', verified: false, kid };
  }

  if (match.status === 'revoked') {
    return {
      status: 'revoked',
      verified: false,
      kid,
      activatedAt: match.activatedAt,
      revokedAt: match.revokedAt,
    };
  }

  if (match.status === 'deprecated') {
    // Without a deprecation timestamp we cannot evaluate the time-bounded
    // rule, so fail closed.
    if (!match.deprecatedAt) {
      return { status: 'deprecated_invalid', verified: false, kid };
    }
    // Without a Rekor integratedTime we cannot prove the package was signed
    // before deprecation either — fail closed.
    if (packageIntegratedTime === undefined) {
      return {
        status: 'deprecated_invalid',
        verified: false,
        kid,
        activatedAt: match.activatedAt,
        deprecatedAt: match.deprecatedAt,
      };
    }
    const deprecationMs = new Date(match.deprecatedAt).getTime();
    const integratedMs = packageIntegratedTime * 1000;
    if (integratedMs < deprecationMs) {
      return {
        status: 'deprecated_valid',
        verified: true,
        kid,
        activatedAt: match.activatedAt,
        deprecatedAt: match.deprecatedAt,
      };
    }
    return {
      status: 'deprecated_invalid',
      verified: false,
      kid,
      activatedAt: match.activatedAt,
      deprecatedAt: match.deprecatedAt,
    };
  }

  return {
    status: 'active',
    verified: true,
    kid,
    activatedAt: match.activatedAt,
  };
}

// --- Typed-standards envelope checks (spec §9.2 checks #12, #14, #15) ---
//
// These read the consolidated-spec envelope fields (`type`, `signer`,
// `producerProfile`) added by the publish path. They run alongside the
// existing hash/signature/Rekor/key-trust checks. Each degrades gracefully
// for pre-v0.1 packages that omit the field, per the per-field
// backwards-compatibility rules.

// v0.1 ratified node type URIs (spec §8.12.1). Recognized so check #12
// resolves them; only `content/analysis/v1` (+ the withdraws/reinstates
// lifecycle sub-types in PR3) are operationalized today, but the full
// ratified set is registered so conformant packages don't render as
// `unknown_type`.
const KNOWN_TYPE_URIS: readonly string[] = [
  'content/analysis/v1',
  'attestation/withdraws/v1',
  'attestation/reinstates/v1',
  'attestation/supersedes/v1',
  'attestation/publishes/v1',
  'attestation/locatedAt/v1',
  'attestation/corroborates/v1',
  'attestation/contradicts/v1',
  'attestation/endorses/v1',
  'attestation/wasDerivedFrom/v1',
  'attestation/answersQuestion/v1',
  'attestation/supportedBy/v1',
  'attestation/opposedBy/v1',
  'attestation/certifies/v1',
  'attestation/evaluates/v1',
  'attestation/conforms/v1',
];

export type TypeResolutionStatus = 'ok' | 'implicit' | 'unknown_type';

export interface TypeResolution {
  status: TypeResolutionStatus;
  /** The resolved type URI (the implicit `content/analysis/v1` when omitted). */
  type: string;
}

/**
 * Check #12 — `type` resolution. Reads the node's family + sub-type so
 * per-sub-type rules can apply. An absent field resolves to the implicit
 * `content/analysis/v1` (pre-v0.1). An unrecognized URI reports
 * `unknown_type` and renders as such — it does NOT fail verification.
 */
export function resolvePackageType(pkg: Record<string, unknown>): TypeResolution {
  const raw = pkg['type'];
  if (typeof raw !== 'string' || raw.length === 0) {
    return { status: 'implicit', type: 'content/analysis/v1' };
  }
  if (KNOWN_TYPE_URIS.includes(raw)) {
    return { status: 'ok', type: raw };
  }
  return { status: 'unknown_type', type: raw };
}

export type SignerIdentityCheckStatus =
  | 'ok'
  | 'signer_identity_mismatch'
  | 'no_signer'
  | 'no_registry_identity';

export interface SignerIdentityCheck {
  status: SignerIdentityCheckStatus;
  /** The `signer.identifier` claimed in the envelope, when present. */
  claimed?: string;
  /** The identifier the registry records for the signing `kid`, when present. */
  registered?: string;
}

/**
 * Check #14 — `signer.identifier` ↔ trust-registry `signerIdentity`
 * cross-check (rules out a kid-swap-with-mismatched-identity attack).
 * `signer_identity_mismatch` is fatal. Pre-v0.1 packages carry no
 * envelope-side `signer` (`no_signer`) — the verifier derives the signer
 * from the registry and skips the cross-check. A registry entry without a
 * `signerIdentity` (legacy registry) yields `no_registry_identity`.
 */
export function checkSignerIdentity(
  pkg: Record<string, unknown>,
  kid: string | undefined,
  registry: TrustRegistry | undefined,
): SignerIdentityCheck {
  const signer = pkg['signer'] as SignerIdentity | undefined;
  if (!signer || typeof signer !== 'object' || typeof signer.identifier !== 'string') {
    return { status: 'no_signer' };
  }
  const entry = kid && registry ? registry.keys.find((k) => k.kid === kid) : undefined;
  const registered = entry?.signerIdentity?.identifier;
  if (!registered) {
    return { status: 'no_registry_identity', claimed: signer.identifier };
  }
  if (registered !== signer.identifier) {
    return { status: 'signer_identity_mismatch', claimed: signer.identifier, registered };
  }
  return { status: 'ok', claimed: signer.identifier, registered };
}

export type CaptureMethodVocabStatus =
  | 'ok'
  | 'captureMethod_unknown'
  | 'producerProfile_bundle_unresolved'
  | 'no_capture_method';

export interface CaptureMethodVocabCheck {
  status: CaptureMethodVocabStatus;
  captureMethod?: string;
  /** The resolved Producer Profile type whose vocabulary was consulted. */
  profileType: string;
}

/**
 * Check #15 — `captureMethod` per-profile vocabulary conformance. Resolves
 * the package's Producer Profile (or its legacy-alias / pre-v0.1 fallback)
 * and confirms `metadata.captureMethod` is in the declared vocabulary.
 * A value not in the vocabulary reports `captureMethod_unknown` (rejects).
 * An unresolvable profile bundle reports `producerProfile_bundle_unresolved`
 * and degrades gracefully — the value is preserved, structural checks still
 * pass, only the vocabulary-conformance assertion is unverified. A null
 * captureMethod (pre-v0.1) is neutral (`no_capture_method`).
 */
export function checkCaptureMethodVocab(pkg: Record<string, unknown>): CaptureMethodVocabCheck {
  const metadata = pkg['metadata'] as Record<string, unknown> | undefined;
  const captureMethod =
    typeof metadata?.['captureMethod'] === 'string'
      ? (metadata['captureMethod'] as string)
      : undefined;
  const producerProfile =
    typeof pkg['producerProfile'] === 'string' ? (pkg['producerProfile'] as string) : undefined;
  const contentProfile =
    typeof metadata?.['contentProfile'] === 'string'
      ? (metadata['contentProfile'] as string)
      : undefined;
  const profileType = resolveProfileType(producerProfile, contentProfile);

  if (!captureMethod) {
    return { status: 'no_capture_method', profileType };
  }
  const vocab = captureVocabForProfile(producerProfile, contentProfile);
  if (!vocab) {
    return { status: 'producerProfile_bundle_unresolved', captureMethod, profileType };
  }
  return {
    status: vocab.includes(captureMethod as CaptureMethod) ? 'ok' : 'captureMethod_unknown',
    captureMethod,
    profileType,
  };
}

// --- Registry loader ---
//
// Module-level TTL cache around the HTTP fetch. Keeps per-request latency low
// without calling out for every `/evidence/[slug]` page load. The verify
// route calls `loadTrustRegistry()` and passes the result into
// `verifyKeyTrust` above.

const REGISTRY_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  registry: TrustRegistry | undefined;
  expiresAt: number;
}

const registryCache: Map<string, CacheEntry> = new Map();

/** Resolve the URL for the platform trust registry. Can be overridden via
 *  `EVIDENCE_TRUST_REGISTRY_URL` for previews or local dev. */
export function getTrustRegistryUrl(): string {
  const override = process.env.EVIDENCE_TRUST_REGISTRY_URL;
  if (override) return override;
  const site = process.env.NEXTAUTH_URL || 'https://civicaitools.org';
  return `${site.replace(/\/$/, '')}/.well-known/evidence-public-keys.json`;
}

/** Filesystem location of the registry within the Next.js build output. */
const REGISTRY_PUBLIC_PATH = path.join('public', '.well-known', 'evidence-public-keys.json');

export async function loadTrustRegistry(
  url: string = getTrustRegistryUrl(),
): Promise<TrustRegistry | undefined> {
  const cached = registryCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.registry;
  }
  // Resolution order:
  //   1. Build-time bundled JSON (always present in the deploy artifact)
  //   2. On-disk read (dev server, tests running from project root)
  //   3. HTTP fetch (external verifiers / cross-origin)
  // The HTTP path exists for external adopters; our own verify route
  // should never need it because the bundled import is authoritative.
  const resolved =
    validateRegistry(embeddedTrustRegistry as unknown) ??
    (await readTrustRegistryFromDisk()) ??
    (await fetchTrustRegistry(url));
  registryCache.set(url, { registry: resolved, expiresAt: Date.now() + REGISTRY_TTL_MS });
  return resolved;
}

function validateRegistry(data: unknown): TrustRegistry | undefined {
  if (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { keys?: unknown[] }).keys) &&
    (data as { keys: TrustRegistryKey[] }).keys.every((k) => typeof k?.kid === 'string' && typeof k?.publicKey === 'string')
  ) {
    return data as TrustRegistry;
  }
  return undefined;
}

/** For tests / rotation drills: drop the in-memory cache. */
export function clearTrustRegistryCache(): void {
  registryCache.clear();
}

async function readTrustRegistryFromDisk(): Promise<TrustRegistry | undefined> {
  try {
    const localPath = path.join(process.cwd(), REGISTRY_PUBLIC_PATH);
    const json = await fs.readFile(localPath, 'utf-8');
    return validateRegistry(JSON.parse(json));
  } catch (err) {
    // Not all runtimes have the file at the expected path (e.g. unit
    // tests run from a different cwd). Silently fall through so callers
    // can still try the HTTP URL.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[verify] Failed to read trust registry from disk:', err instanceof Error ? err.message : err);
    }
    return undefined;
  }
}

async function fetchTrustRegistry(url: string): Promise<TrustRegistry | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[verify] Trust registry fetch returned ${res.status}`);
      return undefined;
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      // Vercel preview protection returns an HTML auth wall with 200 OK.
      // Refuse to treat that as the registry.
      console.warn(`[verify] Trust registry fetch returned unexpected content-type "${ct}"`);
      return undefined;
    }
    return validateRegistry(await res.json());
  } catch (err) {
    console.warn('[verify] Trust registry fetch failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}
