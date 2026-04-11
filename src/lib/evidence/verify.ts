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
