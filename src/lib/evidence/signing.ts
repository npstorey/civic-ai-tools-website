// Signing path — app-side adapter over @typedstandards/produce-core (S3a P2,
// #166; the verify-core shim pattern of #116-WS3 applied to the signing leg).
//
// The FORMAT half lives in produce-core (ADR-0021 §A): the Ed25519ph signing
// mechanism (`signEnvelopeHash` — spec §8.3.1, the UTF-8 bytes of the
// envelope-hash hex string, key material passed in), the RFC 3161
// `TimeStampReq` DER builder, and the Rekor `hashedrekord` proposal/response
// codecs. What stays HERE is deliberately implementation-side (ADR-0021 §B):
//
//   - CUSTODY — the signing-key env read and the warn-and-null
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
// Two accepted names per publisher variable since the 2026-08-19 vocabulary
// settlement: `PUBLISHER_SIGNING_KEY` / `PUBLISHER_KEY_ID` canonically, with
// the prior-era `EVIDENCE_*` spellings still honored (Appendix J; see
// `src/lib/publisher-env.ts` for the precedence rule and the warning).
import {
  canonicalEnvName,
  priorEraEnvName,
  readPublisherEnv,
  type EnvRecord,
} from '../publisher-env.ts';
import { isSigningKeyIdConfigured } from './unsigned-tier.ts';
import { errorLogFacts } from '../streaming.ts';

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

// THERE IS NO DEFAULT KEY ID. The kid is the registry lookup handle a
// verifier uses to find the public key that must validate this instance's
// signature, so it is an identity claim, not a formatting detail. A coded
// default here used to substitute the REFERENCE deployment's kid whenever
// the key id was unset — which meant any instance with a signing key
// and no kid signed with its own key and labeled the result with someone
// else's identifier. Such a package cannot verify (the registry entry for
// that kid holds a different public key) and misattributes the publisher.
// The private key was never at risk; the damage was misattribution and
// unverifiable evidence. So: an instance emits the kid it configured, or it
// does not sign. See docs/instance-setup.md.

/** The one message every "no kid configured" failure carries. Platform-
 *  neutral on purpose — instances run on containers, VMs, and PaaS hosts
 *  alike, so it names the variable and the guide, never a hosting product. */
export const MISSING_KEY_ID_MESSAGE =
  `${canonicalEnvName('KEY_ID')} is not set in this environment (nor its ` +
  `prior-era name ${priorEraEnvName('KEY_ID')}, which is still accepted). ` +
  'This instance has no signing key id to emit and will not substitute one: a ' +
  'package labeled with a kid it never configured cannot verify and ' +
  `misattributes the publisher. Set ${canonicalEnvName('KEY_ID')} to the kid ` +
  "of the active entry in this instance's trust registry — see " +
  'docs/instance-setup.md.';

/**
 * The configured key identifier, or `null` when none is set.
 *
 * The non-throwing probe, for surfaces that DISPLAY the active kid rather
 * than commit to it (they can render honest absence). The value is returned
 * verbatim — presence is tested after trimming, but the string itself is
 * never normalized, because silently rewriting a value that lands in a
 * signed field is its own defect. The kid is not secret: it is the registry
 * lookup handle for the matching public key.
 */
export function getConfiguredKeyId(): string | null {
  return isSigningKeyIdConfigured(process.env)
    ? (readPublisherEnv('KEY_ID') as string)
    : null;
}

/**
 * The active key identifier for anything that COMMITS to it — the value
 * emitted into `metadata.signingKeyId` (covered by the envelope hash) and
 * into the signature envelope's `kid`.
 *
 * Throws when unset, rather than returning `undefined`, because every caller
 * writes the result into a required envelope field: returning an absent value
 * would only move the same guess out to each call site (and the format layer
 * types the field as a required `string`, so there is no honest empty to
 * emit). Callers reach this only behind `evaluateSealCommitGate`, which turns
 * the same condition into a specific, actionable refusal; this throw is the
 * last-resort guard for any path that forgets the gate.
 */
export function getActiveKeyId(): string {
  const kid = getConfiguredKeyId();
  if (kid === null) throw new Error(`[signing] ${MISSING_KEY_ID_MESSAGE}`);
  return kid;
}

/**
 * Identity bound to the active signing key, for emission as the envelope-side
 * `signer` claim (spec §8.1.1). Resolved from instance config (ADR-0020;
 * the `PUBLISHER_SIGNER_*` triple — REQUIRED identity as of #258, no coded
 * default: throws `InstanceIdentityError` naming the missing variables when
 * the triple is incomplete; callers reach this only behind
 * `evaluateSealCommitGate`). It MUST mirror the active key's
 * `signerIdentity` in the instance's trust registry so verify check #14
 * cross-checks cleanly. Display surfaces that can render honest absence use
 * site-config's `getConfiguredSignerIdentity()` instead.
 */
export function getActiveSigner(): SignerIdentity {
  return getEvidenceSignerIdentity();
}

/**
 * Sign a package hash with the instance's Ed25519 key using Ed25519ph
 * (SHA-512 pre-hash). Returns null if the signing key is not configured under
 * either accepted name — the unsigned dev tier (ADR-0020 §B).
 *
 * The signed message is the UTF-8 bytes of the package hex hash — same
 * convention used on the verify side. Ed25519ph prehashes this internally
 * with SHA-512 to produce the 64-byte digest that the signature commits
 * to, which is also what Rekor stores as `spec.data.hash`. The mechanism
 * (and the SPKI public-key derivation retained in `SignResult.publicKey`)
 * is produce-core's; only the key custody lives here.
 *
 * Null is the answer for "no key" ONLY. With a key but no configured key id
 * this throws via `getActiveKeyId` instead of degrading: silently skipping
 * the signature there would hide a misconfiguration behind a state
 * (deliberately unsigned) that the operator did not choose.
 */
export function signPackage(packageHash: string): SignResult | null {
  const privKeyB64 = readPublisherEnv('SIGNING_KEY');
  if (!privKeyB64) {
    console.warn(
      `[signing] ${canonicalEnvName('SIGNING_KEY')} not set — skipping signature`,
    );
    return null;
  }
  return signEnvelopeHash(packageHash, privKeyB64, getActiveKeyId());
}

// --- THE TWO SIGNING-SERVICE ADDRESSES (#445) --------------------------------
//
// Both are configuration with a default, not literals. An instance behind an
// egress allowlist — or one running its own RFC 3161 authority, or its own
// transparency log — points these at services it operates. An instance that
// sets neither reaches exactly the two addresses this file reached before
// #445, byte for byte. `signing-addresses.test.ts` asserts both halves: the
// configured address is the one requested (over a real loopback stub, counted
// at the stub), and the unconfigured pair equals the prior literals.
//
// NOT IN THE `PUBLISHER_*` FAMILY, deliberately. That prefix is not decoration:
// it is the Appendix J census of thirteen publishing-IDENTITY variables, each
// with an `EVIDENCE_*` prior-era twin that `readPublisherEnv` still honours,
// and `src/lib/publisher-env.test.ts` pins that census against `ENV_SPEC` in
// both directions — a fourteenth `PUBLISHER_*` row in `ENV_SPEC` fails it
// ("the scripts-side census matches this one, name for name"), and passing it
// would mean inventing an `EVIDENCE_*` spelling for a name that has no prior
// era. These two name a SERVICE ENDPOINT rather than this publisher, so they
// follow the file's other external-address variables — `SOCRATA_MCP_URL`,
// `MODEL_API_BASE_URL` — and carry no family prefix.
//
// READ AT CALL TIME, not captured at module load: a resolver that froze the
// value on first import would answer differently depending on when something
// first imported this module, and nothing else here reads configuration that
// way (`signPackage` reads its key per call for the same reason).
//
// EMPTY MEANS UNSET HERE, and that is the opposite of
// `PUBLISHER_TRUST_REGISTRY_LEGACY_URL`, where the empty string is the
// documented instruction to OMIT a signed field. There is no analogous meaning
// for an address: an empty endpoint cannot be requested, so an empty or
// whitespace-only value is treated as absent and the default answers — the
// `isPresent` convention this repository already uses for endpoint-shaped
// variables.
//
// A CONFIGURED ADDRESS IS USED VERBATIM AND NEVER SECOND-GUESSED. It is not
// URL-validated, and a value that fetch cannot use takes the degrade-to-null
// path documented on each function below. Falling back to the public default
// on a value that looks wrong would be the one behaviour an egress-restricted
// instance must never get: traffic to a host its operator deliberately did not
// configure.

/** Environment variable naming the RFC 3161 timestamp authority endpoint. */
export const TIMESTAMP_AUTHORITY_ENV_NAME = 'TIMESTAMP_AUTHORITY_URL';

/** Environment variable naming the transparency log's entries endpoint. */
export const TRANSPARENCY_LOG_ENV_NAME = 'TRANSPARENCY_LOG_URL';

/** The timestamp authority requested when `TIMESTAMP_AUTHORITY_URL` is unset. */
export const DEFAULT_TIMESTAMP_AUTHORITY_URL = 'https://freetsa.org/tsr';

/** The transparency log requested when `TRANSPARENCY_LOG_URL` is unset. */
export const DEFAULT_TRANSPARENCY_LOG_URL = 'https://rekor.sigstore.dev/api/v1/log/entries';

/** One address: the configured value when present, the default otherwise. */
function configuredServiceUrl(name: string, fallback: string, env: EnvRecord): string {
  const raw = env[name];
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * The RFC 3161 timestamp authority this instance submits package hashes to.
 * The full endpoint URL, POSTed to as `application/timestamp-query`.
 */
export function timestampAuthorityUrl(env: EnvRecord = process.env): string {
  return configuredServiceUrl(
    TIMESTAMP_AUTHORITY_ENV_NAME,
    DEFAULT_TIMESTAMP_AUTHORITY_URL,
    env,
  );
}

/**
 * The transparency log's ENTRIES endpoint — the collection this instance POSTs
 * a proposed entry to, and the one an entry id is appended to when a single
 * entry is read back (`scripts/backfill-rekor-entry-body.ts`). The whole URL,
 * not a base: the Rekor default's `/api/v1/log/entries` path is part of the
 * address a substitute has to answer, and a substitute may sit under any path.
 */
export function transparencyLogUrl(env: EnvRecord = process.env): string {
  return configuredServiceUrl(TRANSPARENCY_LOG_ENV_NAME, DEFAULT_TRANSPARENCY_LOG_URL, env);
}

/**
 * One entry of the configured transparency log, by id — the entries endpoint
 * with the id appended, which is the address Rekor's API serves a single entry
 * at and the only read this repository makes of the log
 * (`scripts/backfill-rekor-entry-body.ts`).
 *
 * The id is interpolated raw, not percent-encoded, so that the default
 * composition is byte-for-byte the literal that script used before #445; Rekor
 * entry ids are hex. That operator tool is in this seam rather than beside it
 * because it reaches the SAME service: an instance that runs its own log would
 * otherwise have its backfill read entries from a log that never held them,
 * and the default address would live in two places instead of one.
 */
export function transparencyLogEntryUrl(entryId: string, env: EnvRecord = process.env): string {
  return `${transparencyLogUrl(env)}/${entryId}`;
}

/**
 * Request an RFC 3161 timestamp from the configured timestamp authority
 * (freetsa.org when `TIMESTAMP_AUTHORITY_URL` is unset).
 * Returns the base64-encoded timestamp token, or null on failure.
 * The ASN.1 DER `TimeStampReq` codec is produce-core's; the network
 * submission (and its best-effort degradation) stays app-side.
 */
export async function getRfc3161Timestamp(packageHash: string): Promise<string | null> {
  try {
    const tsReq = buildTimestampRequest(packageHash);

    const response = await fetch(timestampAuthorityUrl(), {
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
    console.warn('[signing] RFC 3161 timestamp failed:', errorLogFacts(err));
    return null;
  }
}

/**
 * Publish package hash + signature to the configured transparency log
 * (Sigstore Rekor when `TRANSPARENCY_LOG_URL` is unset).
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

    const response = await fetch(transparencyLogUrl(), {
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
    console.warn('[signing] Rekor publish failed:', errorLogFacts(err));
    return null;
  }
}
