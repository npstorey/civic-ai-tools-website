// Signing path — app-side adapter over @typedstandards/produce-core (S3a P2,
// #166; the verify-core shim pattern of #116-WS3 applied to the signing leg).
//
// The FORMAT half lives in produce-core (ADR-0021 §A): the Ed25519ph signing
// mechanism (`signEnvelopeHash` — spec §8.3.1, the UTF-8 bytes of the
// envelope-hash hex string, key material passed in), the RFC 3161
// `TimeStampReq` DER builder, and the Rekor `hashedrekord` proposal/response
// codecs. What stays HERE is deliberately implementation-side (ADR-0021 §B):
//
//   - CUSTODY — the `EVIDENCE_SIGNING_KEY` env read and the warn-and-null
//     unsigned fallback (ADR-0021 §E: the core has no env probe; the app's
//     decision not to sign IS the unsigned tier);
//   - SUBMISSION — the TSA and Rekor `fetch` legs (no network in the core);
//   - INSTANCE IDENTITY — the active kid and the envelope-side signer claim,
//     resolved from config (ADR-0020: per-instance keys; identity is config,
//     not code — see `src/lib/site-config.ts` and docs/instance-setup.md).
//
// The Rekor prehash is defined once in the browser-safe verify-core so the
// producer (here) and the verifier compute one value; re-exported for the
// existing `./signing.ts` importers (e.g. signing.test.ts).

import {
  signEnvelopeHash,
  buildTimestampRequest,
  buildRekorProposal,
  parseRekorResponse,
  type SignResult,
  type RekorResult,
  type SignerIdentity,
} from '@typedstandards/produce-core';
import { rekorHashForPackage } from './verify-core/signature.ts';
import { getEvidenceSignerIdentity } from '../site-config.ts';

export { rekorHashForPackage };

/**
 * Envelope-side identity claim for the party that signed a node (spec
 * §8.1.1 `signer`, §8.5). Distinct from the `sig` envelope (publicKey +
 * algorithm + kid): `sig` answers *what was signed and by what key*;
 * `signer` answers *who claims to have signed it*. A verifier cross-checks
 * the two via the trust registry's `signerIdentity` (verify check #14).
 * Re-exported from produce-core (structurally identical to the historical
 * local interface).
 */
export type { SignerIdentity, SignResult };

// Default key identifier used when `EVIDENCE_KEY_ID` is not set — the DEMO
// deployment's active kid (it mirrors the registry's `kid` the same way the
// demo signer identity in site-config mirrors the registry's
// `signerIdentity`). The `platform:` prefix leaves room for per-user scopes
// in the future (e.g. `user:<uuid>:<key-name>`) without a trust-registry
// schema migration. An instance sets `EVIDENCE_KEY_ID` to its own kid —
// see docs/instance-setup.md.
const DEFAULT_KEY_ID = 'platform:evidence-2026-04';

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
 * `signer` claim (spec §8.1.1). Resolved from instance config (ADR-0020;
 * `EVIDENCE_SIGNER_*` env vars, demo defaults when unset) — it MUST mirror
 * the active key's `signerIdentity` in the instance's trust registry so
 * verify check #14 cross-checks cleanly.
 */
export function getActiveSigner(): SignerIdentity {
  return getEvidenceSignerIdentity();
}

/**
 * Sign a package hash with the instance's Ed25519 key using Ed25519ph
 * (SHA-512 pre-hash). Returns null if EVIDENCE_SIGNING_KEY is not
 * configured — the unsigned dev tier (ADR-0020 §B).
 *
 * The signed message is the UTF-8 bytes of the package hex hash — same
 * convention used on the verify side. Ed25519ph prehashes this internally
 * with SHA-512 to produce the 64-byte digest that the signature commits
 * to, which is also what Rekor stores as `spec.data.hash`. The mechanism
 * (and the SPKI public-key derivation retained in `SignResult.publicKey`)
 * is produce-core's; only the key custody lives here.
 */
export function signPackage(packageHash: string): SignResult | null {
  const privKeyB64 = process.env.EVIDENCE_SIGNING_KEY;
  if (!privKeyB64) {
    console.warn('[signing] EVIDENCE_SIGNING_KEY not set — skipping signature');
    return null;
  }
  return signEnvelopeHash(packageHash, privKeyB64, getActiveKeyId());
}

/**
 * Request an RFC 3161 timestamp from freetsa.org.
 * Returns the base64-encoded timestamp token, or null on failure.
 * The ASN.1 DER `TimeStampReq` codec is produce-core's; the network
 * submission (and its best-effort degradation) stays app-side.
 */
export async function getRfc3161Timestamp(packageHash: string): Promise<string | null> {
  try {
    const tsReq = buildTimestampRequest(packageHash);

    const response = await fetch('https://freetsa.org/tsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      // Re-wrap so TS sees a Uint8Array backed by a plain ArrayBuffer (the
      // DOM `BodyInit` shape) — same bytes, same as the pre-adapter code.
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
 *
 * The `hashedrekord` v0.0.1 proposal body and the response parsing are
 * produce-core codecs (which carry the Ed25519ph invariants: `sha512`
 * data-hash over the signed message, PEM-wrapped SPKI public key). The
 * network submission — and the degrade-to-null posture on any failure,
 * including a response the parser rejects — stays app-side.
 */
export async function publishToRekor(
  packageHash: string,
  signature: string,
  publicKeyDerB64: string,
): Promise<RekorResult | null> {
  try {
    const body = buildRekorProposal(packageHash, signature, publicKeyDerB64);

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

    return parseRekorResponse(await response.json());
  } catch (err) {
    console.warn('[signing] Rekor publish failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
