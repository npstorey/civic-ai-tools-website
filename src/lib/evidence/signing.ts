import crypto from 'crypto';
import { ed25519ph } from '@noble/curves/ed25519.js';
// The Rekor prehash is defined once in the browser-safe verify-core (WS2) so the
// producer (here) and the verifier compute one value; re-exported for the
// existing `./signing.ts` importers (e.g. signing.test.ts) and bound locally for
// `publishToRekor` below.
import { rekorHashForPackage } from './verify-core/signature.ts';

export { rekorHashForPackage };

// Signature algorithm identifier stored alongside each signature and
// embedded in the evidence package metadata. Rekor's hashedrekord
// verifier (sigstore/rekor@v1.x, 2024+) requires Ed25519ph (pre-hashed
// Ed25519 with SHA-512) for bare Ed25519 public keys rather than pure
// Ed25519 — see https://github.com/sigstore/rekor/pull/1945. Node's
// crypto.sign doesn't expose Ed25519ph, so we use @noble/curves for the
// sign/verify path. The key material on disk is unchanged: same Ed25519
// keypair, just a different signing algorithm.
const ALGORITHM = 'Ed25519ph';

// Default key identifier used when `EVIDENCE_KEY_ID` is not set. The
// `platform:` prefix leaves room for per-user scopes in the future
// (e.g. `user:<uuid>:<key-name>`) without a trust-registry schema migration —
// see Phase 5 of the security hardening plan.
const DEFAULT_KEY_ID = 'platform:evidence-2026-04';

/**
 * Envelope-side identity claim for the party that signed a node (spec
 * §8.1.1 `signer`, §8.5). Distinct from the `sig` envelope (publicKey +
 * algorithm + kid): `sig` answers *what was signed and by what key*;
 * `signer` answers *who claims to have signed it*. A verifier cross-checks
 * the two via the trust registry's `signerIdentity` (verify check #14).
 */
export interface SignerIdentity {
  bindingTier: string;
  identifier: string;
  displayName: string;
  verifiedAt?: string;
}

// Identity bound to the active platform signing key. The platform holds the
// key and signs on behalf of authors (spec §8.5 — users do not yet sign
// their own packages), so the envelope `signer` reflects the platform. These
// values MUST match the `signerIdentity` recorded for the active `kid` in the
// trust registry (`public/.well-known/evidence-public-keys.json`) so verify
// check #14 resolves — the kid and its identity are kept together here the
// same way `DEFAULT_KEY_ID` mirrors the registry's `kid`.
const PLATFORM_SIGNER_IDENTITY: SignerIdentity = {
  bindingTier: 'platform',
  identifier: 'platform:civic-ai-tools',
  displayName: 'Civic AI Tools Platform',
};

export interface SignResult {
  signature: string;   // base64
  publicKey: string;   // base64 (DER-encoded public key)
  algorithm: string;
  /** Stable key identifier — matches an entry in the trust registry at
   *  `/.well-known/evidence-public-keys.json`. */
  kid: string;
}

/**
 * Read the active key identifier. Returns `EVIDENCE_KEY_ID` when set, and
 * falls back to the default platform kid otherwise. The kid is not secret —
 * it's the registry lookup handle for the matching public key.
 */
export function getActiveKeyId(): string {
  return process.env.EVIDENCE_KEY_ID || DEFAULT_KEY_ID;
}

/**
 * Identity bound to the active signing key, for emission as the envelope-side
 * `signer` claim (spec §8.1.1). Returns the platform identity since the
 * platform key signs all packages today; mirrors the active key's
 * `signerIdentity` in the trust registry so verify check #14 cross-checks
 * cleanly.
 */
export function getActiveSigner(): SignerIdentity {
  return { ...PLATFORM_SIGNER_IDENTITY };
}

interface RekorResult {
  entryId: string;
  logIndex: number;
  inclusionProof: string; // JSON stringified
}

/**
 * Extract the 32-byte raw Ed25519 private key seed from a PKCS8 DER key.
 * Noble's Ed25519ph API takes raw seed bytes; Node's crypto produces
 * PKCS8 DER. We go through JWK because that's the supported
 * interchange format exposed by Node's KeyObject.
 */
function extractRawPrivateKey(privKeyB64Der: string): Uint8Array {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privKeyB64Der, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const jwk = privateKey.export({ format: 'jwk' });
  if (!jwk.d) throw new Error('Ed25519 private key JWK missing "d"');
  return Uint8Array.from(Buffer.from(jwk.d, 'base64url'));
}

/**
 * Derive the SPKI DER public key from a PKCS8 DER private key. Retained as
 * `publicKey` in SignResult (base64 DER) so on-disk and in-registry
 * encodings are stable across the Ed25519 / Ed25519ph switch; Rekor
 * submission re-encodes to PEM where required.
 */
function derivePublicKeyDer(privKeyB64Der: string): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privKeyB64Der, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const pubKeyDer = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return pubKeyDer.toString('base64');
}

/**
 * Sign a package hash with the platform Ed25519 key using Ed25519ph
 * (SHA-512 pre-hash). Returns null if EVIDENCE_SIGNING_KEY is not
 * configured.
 *
 * The signed message is the UTF-8 bytes of the package hex hash — same
 * convention used on the verify side. Ed25519ph prehashes this internally
 * with SHA-512 to produce the 64-byte digest that the signature commits
 * to, which is also what Rekor stores as `spec.data.hash`.
 */
export function signPackage(packageHash: string): SignResult | null {
  const privKeyB64 = process.env.EVIDENCE_SIGNING_KEY;
  if (!privKeyB64) {
    console.warn('[signing] EVIDENCE_SIGNING_KEY not set — skipping signature');
    return null;
  }

  const privBytes = extractRawPrivateKey(privKeyB64);
  const message = Buffer.from(packageHash, 'utf-8');
  const signature = ed25519ph.sign(message, privBytes);
  const pubKeyDerB64 = derivePublicKeyDer(privKeyB64);

  return {
    signature: Buffer.from(signature).toString('base64'),
    publicKey: pubKeyDerB64,
    algorithm: ALGORITHM,
    kid: getActiveKeyId(),
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
 * Re-encode a base64 SPKI-DER public key as a base64-wrapped PEM block.
 * Rekor's `x509.NewPublicKey` requires PEM — raw base64 DER is rejected
 * with "invalid public key: failure decoding PEM".
 */
function derPublicKeyToPemBase64(pubKeyDerB64: string): string {
  // PEM is the DER bytes in base64, line-wrapped to 64 chars, between
  // BEGIN/END banners. Rekor accepts either the raw PEM or a base64 of
  // the PEM; we use the latter because every other `content` field in
  // the submission body is base64-encoded.
  const pemBody = pubKeyDerB64.match(/.{1,64}/g)?.join('\n') ?? pubKeyDerB64;
  const pem = `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----\n`;
  return Buffer.from(pem).toString('base64');
}

/**
 * Publish package hash + signature to Sigstore Rekor transparency log.
 * Returns entry metadata, or null on failure.
 *
 * Rekor's hashedrekord v0.0.1 verifier applies Ed25519ph for bare
 * Ed25519 keys, which means:
 *   - `data.hash.algorithm` must be `sha512`
 *   - `data.hash.value` must be hex(SHA-512(signed message))
 *   - `signature.content` must be an Ed25519ph signature over the same
 *     signed message (see `signPackage` above)
 *   - `publicKey.content` must be base64(PEM-wrapped SPKI DER)
 *
 * The signed message in our system is the UTF-8 hex representation of
 * the SHA-256 package hash, preserved here so the Rekor-stored digest
 * can be independently reproduced from `basePackageHash`.
 */
export async function publishToRekor(
  packageHash: string,
  signature: string,
  publicKeyDerB64: string,
): Promise<RekorResult | null> {
  try {
    const sha512HashHex = rekorHashForPackage(packageHash);
    const pubKeyPemB64 = derPublicKeyToPemBase64(publicKeyDerB64);

    const body = {
      apiVersion: '0.0.1',
      kind: 'hashedrekord',
      spec: {
        data: {
          hash: { algorithm: 'sha512', value: sha512HashHex },
        },
        signature: {
          content: signature,
          publicKey: { content: pubKeyPemB64 },
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
