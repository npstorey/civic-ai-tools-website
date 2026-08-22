// Signing + persistence for `attestation_packages` rows — the reviews and
// machine attestations attached to a record (civic-ai-tools-website#294 P1).
//
// WHAT THIS FIXES. The attestations route used to call `signPackage(hash)`
// WITHOUT awaiting it and discard the return value, then await
// `getRfc3161Timestamp(hash)` and discard that too, then insert a row into a
// table with no column to hold either. A signature was computed on every
// submission and thrown away, so every review stored between the feature
// shipping and this module landing WAS content-addressed, hash-bound to its
// base package, and unsigned — while four surfaces told readers it was signed.
// Migration 0016 adds the columns; this module makes the write path actually
// use them, and P2's backfill (`attestation-backfill.ts`) signed the rows that
// were already there.
//
// WHY THE ORCHESTRATION LIVES HERE RATHER THAN IN THE ROUTE. Two reasons, one
// of them load-bearing:
//
//   1. ORDERING IS A CORRECTNESS PROPERTY NOW. The old route wrote the blob
//      BEFORE signing. That was harmless while signing could not fail the
//      request; it is not harmless now that a signing failure REFUSES, because
//      the blob would already be written and the refusal would orphan it on
//      every attempt. The refusal must happen before any external write, and
//      "before" is exactly the kind of claim that rots silently unless a test
//      can assert it.
//   2. IT MAKES THAT ASSERTION POSSIBLE. The route module cannot be imported
//      by this repo's test runner (`node --test --experimental-strip-types`):
//      it pulls in `next/server`, `next-auth`, and a live Postgres client
//      through the `@/` path alias, none of which resolve there. Every test in
//      `src/lib/evidence/` is a pure unit test over a library module for that
//      reason. So the I/O is injected as ports and the tests hand in spies —
//      "nothing was persisted" is then a direct assertion (`putPackage` never
//      called, `insertRow` never called) rather than a claim about code shape.
//
// THE THREE-WAY SPLIT. A missing signature is not one condition:
//
//   - NO SIGNING KEY  → STORE, labeled unsigned with the reason. ADR-0020 §B's
//     intended unsigned tier: this repo's own CI builds keyless, and every
//     first-run self-hoster is keyless. Refusing here would take the review
//     feature away from all of them to no benefit — nothing is misrepresented,
//     because the row records why it is unsigned and the UI says so.
//   - SIGNING FAILS with a key present → REFUSE, named. The operator intends
//     to sign and something is wrong. Storing the review anyway would produce
//     a row indistinguishable from the keyless tier, quietly recording a
//     misconfiguration as if it were a choice.
//   - TIMESTAMP FAILS → STORE, signed-not-timestamped. The TSA is a free
//     third-party service on a 10s timeout. Coupling whether a reviewer can
//     submit to a third party's uptime would be a worse failure than the
//     missing timestamp, and the signature is unaffected by its absence.
//
// Rekor is deliberately NOT in scope for reviews in this phase: no column, no
// call. The transparency-log leg is a record-level commitment and pulling it
// in here would widen both the failure surface and the spec question.

import { signPackage, getRfc3161Timestamp } from './signing.ts';
import {
  evaluateSealCommitGate,
  isSigningKeyConfigured,
  type SealCommitGateRefusal,
} from './unsigned-tier.ts';
import {
  REVIEW_UNSIGNED_REASON_NO_KEY,
  type ReviewUnsignedReason,
} from './trust-signal.ts';

type EnvLike = Record<string, string | undefined>;

/** The machine-readable code a signing failure carries. Follows the
 *  established snake_case codes on this path (`unsigned_tier`,
 *  `signing_key_id_missing`, `instance_identity_missing`, `unsigned_package`). */
export const ATTESTATION_SIGNING_FAILED_CODE = 'attestation_signing_failed';

/**
 * The refusal a submission receives when this instance holds a signing key but
 * could not produce a signature.
 *
 * 500, matching the two sibling misconfiguration refusals in
 * `evaluateSealCommitGate`. The reviewer's submission was well-formed and
 * would have succeeded against a correctly configured instance, so this is not
 * a 4xx; and it is not transient, so it is not a 503 — retrying changes
 * nothing until an operator fixes the key.
 *
 * The message names WHAT is misconfigured and where to look, and carries no
 * key material and no raw infrastructure detail (no status codes, stack text,
 * or underlying exception message) — those go to the server log only. Callers
 * are expected to log the cause themselves.
 */
export function attestationSigningFailedRefusal(): SealCommitGateRefusal {
  return {
    status: 500,
    body: {
      error:
        'This instance has a signing key configured but could not produce a ' +
        'signature for this submission, so the review was not stored. A ' +
        'review is never stored unsigned on an instance that is supposed to ' +
        'sign: an unsigned row there is indistinguishable from one written by ' +
        'an instance that deliberately runs without a key, which would record ' +
        'a misconfiguration as though it were a choice. The signing key ' +
        'itself has not been disclosed by this failure. An operator should ' +
        'check that the configured signing key is a valid Ed25519 private key ' +
        '— see docs/instance-setup.md.',
      code: ATTESTATION_SIGNING_FAILED_CODE,
    },
  };
}

/**
 * The gate for storing an attestation package.
 *
 * A DELIBERATE NARROWING of `evaluateSealCommitGate`, which this route used to
 * apply unchanged. That gate refuses ALL THREE of its situations, including
 * the keyless tier (403 `unsigned_tier`) — which meant a first-run or CI
 * instance could not accept a review at all. Sealing and publishing are
 * genuinely unreachable unsigned (ADR-0020 Decision C bounds what an unsigned
 * RECORD may reach), but attaching a review neither seals nor publishes
 * anything: the review inherits the visibility of the record it is attached
 * to, and carries no visibility state of its own. So the keyless tier passes
 * here and the row is labeled, which is guard 2 (mandatory labeling) doing
 * exactly its job.
 *
 * The two MISCONFIGURATION refusals are kept verbatim, by delegation rather
 * than restatement, so their messages cannot drift from the sibling routes':
 *
 *   - `signing_key_id_missing`   — a key with no configured kid (#251).
 *   - `instance_identity_missing` — a signing pair with no declared identity.
 *
 * Both are situations where the operator intends to sign and the instance
 * cannot do so honestly.
 */
export function evaluateAttestationSigningGate(
  env: EnvLike = process.env,
): SealCommitGateRefusal | null {
  // No key at all is the legitimate unsigned tier, not a misconfiguration.
  if (!isSigningKeyConfigured(env)) return null;
  // A key IS present: every remaining refusal in the shared gate applies.
  return evaluateSealCommitGate(env);
}

/** The five columns migration 0016 added, as the write path computes them. */
export interface AttestationSignatureColumns {
  /** Signature envelope JSON, or null when this instance did not sign.
   *  Shape matches `evidence_records.base_package_signature` as the publish
   *  route writes it: `{signature, publicKey, algorithm, kid}`. */
  signature: string | null;
  /** The `kid` again, as its own column so it is queryable without JSON
   *  extraction. Null exactly when `signature` is null. */
  signingKeyId: string | null;
  /** Base64 RFC 3161 token, or null when the TSA was unavailable. */
  rfc3161Timestamp: string | null;
  /** When the signature was produced. Null exactly when `signature` is null —
   *  this column never claims a signing time for a row that has no signature. */
  signedAt: Date | null;
  /** Why this row is unsigned, recorded at the moment the decision was made.
   *  Null for signed rows AND for rows written before 0016 — see
   *  `resolveReviewSignature` for why that asymmetry is what makes the two
   *  unsigned states distinguishable at all.
   *
   *  Typed as the CLOSED vocabulary (`ReviewUnsignedReason`), not as `string`:
   *  the write path is structurally incapable of inventing a reason that the
   *  read path has no copy for. New reasons are added to
   *  `REVIEW_UNSIGNED_REASONS` in `trust-signal.ts`, which is the single
   *  source of truth for both sides — P2's backfill added
   *  `backfill_signing_failed` there for a row it reaches and cannot sign. */
  unsignedReason: ReviewUnsignedReason | null;
}

export interface AttestationSigningPorts {
  /** Writes the canonical package body to blob storage, returning its URL. */
  putPackage: (key: string, body: Record<string, unknown>) => Promise<string>;
  /** Inserts the DB row, given the storage key and the signature columns. */
  insertRow: (
    columns: AttestationSignatureColumns & { storageKey: string },
  ) => Promise<void>;
  /** Overridable for tests; defaults to the real signing path. */
  signPackage?: typeof signPackage;
  /** Overridable for tests; defaults to the real TSA submission. */
  getRfc3161Timestamp?: typeof getRfc3161Timestamp;
  now?: () => Date;
  env?: EnvLike;
}

export type AttestationSigningResult =
  | { ok: true; storageKey: string; columns: AttestationSignatureColumns }
  | { ok: false; refusal: SealCommitGateRefusal; cause?: unknown };

/**
 * Sign, timestamp, store, and insert one attestation package — in that order,
 * and only ever in that order.
 *
 * The signing decision runs FIRST and completes BEFORE the blob write, so a
 * refusal leaves nothing behind: no blob, no row. This is the ordering fix; it
 * is asserted directly in `attestation-signing.test.ts` by handing in ports
 * that record whether they were called.
 *
 * Once past the signing decision the request cannot be refused any more: the
 * timestamp is best-effort by construction (`getRfc3161Timestamp` already
 * resolves null on any failure, and the extra `.catch` here is belt-and-braces
 * against a future rewrite that lets it reject), and the blob write and row
 * insert throw to the caller's error handler as they always did.
 */
export async function signAndStoreAttestationPackage(
  input: {
    packageHash: string;
    attestationPkg: Record<string, unknown>;
    storageKeyPrefix?: string;
  },
  ports: AttestationSigningPorts,
): Promise<AttestationSigningResult> {
  const env = ports.env ?? process.env;
  const sign = ports.signPackage ?? signPackage;
  const timestamp = ports.getRfc3161Timestamp ?? getRfc3161Timestamp;
  const now = ports.now ?? (() => new Date());

  // --- 1. The signing decision. Nothing external has been written yet. ---
  let columns: AttestationSignatureColumns;
  try {
    const signResult = sign(input.packageHash);
    if (signResult) {
      columns = {
        signature: JSON.stringify({
          signature: signResult.signature,
          publicKey: signResult.publicKey,
          algorithm: signResult.algorithm,
          kid: signResult.kid,
        }),
        signingKeyId: signResult.kid,
        rfc3161Timestamp: null,
        signedAt: now(),
        unsignedReason: null,
      };
    } else {
      // Null means "no signing key" and ONLY that — `signPackage` throws for
      // every other refusal, including a key with no kid. The unsigned tier.
      columns = {
        signature: null,
        signingKeyId: null,
        rfc3161Timestamp: null,
        signedAt: null,
        unsignedReason: REVIEW_UNSIGNED_REASON_NO_KEY,
      };
    }
  } catch (cause) {
    // A key is configured and signing still failed. Refuse before writing.
    return { ok: false, refusal: attestationSigningFailedRefusal(), cause };
  }

  // Defensive: `signPackage` returning null while a key IS configured would
  // mean the unsigned tier had been entered by an instance that is supposed to
  // sign — a state that would be stored as a deliberate choice. Treat it as
  // the failure it would be rather than mislabeling the row.
  if (columns.signature === null && isSigningKeyConfigured(env)) {
    return { ok: false, refusal: attestationSigningFailedRefusal() };
  }

  // --- 2. Past the point of refusal. External writes may now happen. ---
  // The timestamp is only meaningful over something signed, and never blocks.
  const [rfc3161Token, storageKey] = await Promise.all([
    columns.signature
      ? timestamp(input.packageHash).catch(() => null)
      : Promise.resolve(null),
    ports.putPackage(
      `${input.storageKeyPrefix ?? 'attestation-'}${input.packageHash}`,
      input.attestationPkg,
    ),
  ]);

  const finalColumns: AttestationSignatureColumns = {
    ...columns,
    rfc3161Timestamp: rfc3161Token,
  };
  await ports.insertRow({ ...finalColumns, storageKey });

  return { ok: true, storageKey, columns: finalColumns };
}
