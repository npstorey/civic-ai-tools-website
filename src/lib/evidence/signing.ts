import crypto from 'crypto';

const ALGORITHM = 'Ed25519';

interface SignResult {
  signature: string;   // base64
  publicKey: string;   // base64 (DER-encoded public key)
  algorithm: string;
}

interface RekorResult {
  entryId: string;
  logIndex: number;
  inclusionProof: string; // JSON stringified
}

/**
 * Sign a package hash with the platform Ed25519 key.
 * Returns null if EVIDENCE_SIGNING_KEY is not configured.
 */
export function signPackage(packageHash: string): SignResult | null {
  const privKeyB64 = process.env.EVIDENCE_SIGNING_KEY;
  if (!privKeyB64) {
    console.warn('[signing] EVIDENCE_SIGNING_KEY not set — skipping signature');
    return null;
  }

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, Buffer.from(packageHash, 'utf-8'), privateKey);

  // Derive public key from private key
  const publicKey = crypto.createPublicKey(privateKey);
  const pubKeyDer = publicKey.export({ format: 'der', type: 'spki' });

  return {
    signature: signature.toString('base64'),
    publicKey: pubKeyDer.toString('base64'),
    algorithm: ALGORITHM,
  };
}

/**
 * Request an RFC 3161 timestamp from freetsa.org.
 * Returns the base64-encoded timestamp token, or null on failure.
 */
export async function getRfc3161Timestamp(packageHash: string): Promise<string | null> {
  try {
    // Build a minimal ASN.1 DER TimeStampReq
    const hashBytes = Buffer.from(packageHash, 'hex');
    const tsReq = buildTimestampRequest(hashBytes);

    const response = await fetch('https://freetsa.org/tsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: new Uint8Array(tsReq),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[signing] RFC 3161 TSA returned ${response.status}`);
      return null;
    }

    const tsrBytes = Buffer.from(await response.arrayBuffer());
    return tsrBytes.toString('base64');
  } catch (err) {
    console.warn('[signing] RFC 3161 timestamp failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Publish package hash + signature to Sigstore Rekor transparency log.
 * Returns entry metadata, or null on failure.
 */
export async function publishToRekor(
  packageHash: string,
  signature: string,
  publicKey: string,
): Promise<RekorResult | null> {
  try {
    // Rekor hashedrekord v0.0.1 format
    const body = {
      apiVersion: '0.0.1',
      kind: 'hashedrekord',
      spec: {
        data: {
          hash: { algorithm: 'sha256', value: packageHash },
        },
        signature: {
          content: signature,
          publicKey: { content: Buffer.from(publicKey, 'base64').toString('base64') },
        },
      },
    };

    const response = await fetch('https://rekor.sigstore.dev/api/v1/log/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(`[signing] Rekor returned ${response.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const result = await response.json();
    // Response is { [entryId]: { logIndex, ... } }
    const entryId = Object.keys(result)[0];
    const entry = result[entryId];

    return {
      entryId,
      logIndex: entry.logIndex,
      inclusionProof: JSON.stringify(entry.verification?.inclusionProof || {}),
    };
  } catch (err) {
    console.warn('[signing] Rekor publish failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// --- ASN.1 DER helpers for RFC 3161 ---

// SHA-256 OID: 2.16.840.1.101.3.4.2.1
const SHA256_OID = Buffer.from([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
]);

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
}

function derSequence(...items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), derLength(content.length), content]);
}

function derOctetString(data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), derLength(data.length), data]);
}

function derInteger(value: number): Buffer {
  return Buffer.from([0x02, 0x01, value]);
}

function derBoolean(value: boolean): Buffer {
  return Buffer.from([0x01, 0x01, value ? 0xff : 0x00]);
}

function buildTimestampRequest(hashBytes: Buffer): Buffer {
  // AlgorithmIdentifier for SHA-256
  const algId = derSequence(SHA256_OID);
  // MessageImprint
  const messageImprint = derSequence(algId, derOctetString(hashBytes));
  // TimeStampReq: version=1, messageImprint, certReq=true
  return derSequence(derInteger(1), messageImprint, derBoolean(true));
}
