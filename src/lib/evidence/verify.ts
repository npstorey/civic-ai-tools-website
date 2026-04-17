import crypto from 'crypto';

/**
 * Verify an Ed25519 signature against a package hash.
 */
export function verifySignature(
  packageHash: string,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      null,
      Buffer.from(packageHash, 'utf-8'),
      publicKey,
      Buffer.from(signatureB64, 'base64'),
    );
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
 * Verify a Rekor transparency log entry matches the expected hash.
 */
export async function verifyRekorEntry(
  entryId: string,
  expectedHash: string,
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

    // Decode the body to check the hash
    const body = JSON.parse(
      Buffer.from(entry.body, 'base64').toString('utf-8'),
    );
    const recordedHash = body?.spec?.data?.hash?.value;
    const verified = recordedHash === expectedHash;

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
  | 'registry_unavailable'; // registry could not be loaded

export interface KeyTrustResult {
  status: KeyTrustStatus;
  /** `true` iff the status is `active` or `deprecated_valid`. */
  verified: boolean;
  kid: string;
  activatedAt?: string;
  deprecatedAt?: string | null;
  revokedAt?: string | null;
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

export async function loadTrustRegistry(
  url: string = getTrustRegistryUrl(),
): Promise<TrustRegistry | undefined> {
  const cached = registryCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.registry;
  }
  const fetched = await fetchTrustRegistry(url);
  registryCache.set(url, { registry: fetched, expiresAt: Date.now() + REGISTRY_TTL_MS });
  return fetched;
}

/** For tests / rotation drills: drop the in-memory cache. */
export function clearTrustRegistryCache(): void {
  registryCache.clear();
}

async function fetchTrustRegistry(url: string): Promise<TrustRegistry | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[verify] Trust registry fetch returned ${res.status}`);
      return undefined;
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.keys)) {
      console.warn('[verify] Trust registry has invalid shape');
      return undefined;
    }
    return data as TrustRegistry;
  } catch (err) {
    console.warn('[verify] Trust registry fetch failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}
