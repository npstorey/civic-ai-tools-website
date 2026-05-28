import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { ed25519ph } from '@noble/curves/ed25519.js';
import { rekorHashForPackage, type SignerIdentity } from './signing.ts';
import { captureVocabForProfile, resolveProfileType } from './profiles.ts';
import type { CaptureMethod } from './packager.ts';
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
 * Recompute the SHA-256 hash of a package object.
 */
export function recomputePackageHash(pkg: Record<string, unknown>): string {
  const canonical = JSON.stringify(pkg);
  return crypto.createHash('sha256').update(canonical).digest('hex');
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
