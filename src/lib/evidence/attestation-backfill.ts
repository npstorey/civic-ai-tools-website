// The one-time signing pass over `attestation_packages` rows that predate
// migration 0016 (civic-ai-tools-website#294 P2).
//
// WHAT THIS FINISHES. P1 made the WRITE path sign new reviews and gave the
// table five columns to hold the result. It did nothing for the rows already
// there: every review submitted between the feature shipping and P1 merging is
// content-addressed, hash-bound to its base package, and unsigned, with
// `unsigned_reason` NULL because nothing was writing that column yet. This
// module signs those rows. Until it runs, the home-page copy has to carry a
// qualifying clause about them, and that clause is the honest reading.
//
// WHY THE LOGIC LIVES HERE RATHER THAN IN THE SCRIPT. The same reason P1 put
// the write path in `attestation-signing.ts`: this repo's test runner
// (`node --test --experimental-strip-types`) cannot import a script that opens
// a Postgres connection at module scope, and the properties that matter here
// are precisely the ones that need asserting — that a keyless run touches
// NOTHING, that a dry run writes NOTHING, that `signed_at` is never
// `created_at`, that a second run is a no-op. Each of those is a claim about
// what was and was not called, so the I/O is injected as ports and the tests
// hand in recorders. `scripts/backfill-attestation-signatures.ts` is a thin
// shell over `runAttestationSignatureBackfill`, holding only the real database
// wiring and the process exit code.
//
// --- THE KEYLESS REFUSAL, which is the load-bearing decision here ---
//
// A backfill run with no signing key configured REFUSES OUTRIGHT and touches
// no row. It does not fall back to labeling rows `no_signing_key`.
//
// This inverts P1's write-path rule, deliberately, because the two situations
// are not the same one. When a keyless instance RECORDS a review, it knows
// something true at that moment — this instance has no key right now — and
// writing `no_signing_key` records that fact honestly. A backfill knows no
// such thing about the past. The rows it is walking were written under a
// configuration it cannot observe, possibly years earlier, possibly by an
// instance that did have a key. Stamping `no_signing_key` across them would
// take the operator's CURRENT environment and assert it retroactively over
// every historical row: it would convert "the signing pass has not reached
// this" into "this instance has no signing key" — a specific, checkable,
// and quite possibly false claim about the past — and it would do so
// irreversibly, since the NULL it overwrote was the only record that the row's
// state was unknown. That is the exact failure this whole sprint exists to
// correct, so the run stops instead.
//
// --- WHAT A ROW IT CANNOT SIGN GETS, and why never NULL ---
//
// `backfill_signing_failed`, written at decision time, with all four signature
// columns left NULL. Leaving `unsigned_reason` NULL on a row the pass reached
// and failed would make it byte-identical to a row the pass never reached,
// reintroducing the ambiguity `unsigned_reason` exists to remove. The row
// stays unsigned either way; what differs is whether the record says an
// attempt happened. It did, so it says so.
//
// --- `signed_at` IS THE SIGNING TIME, NEVER `created_at` (decision D2) ---
//
// Every row this pass signs gets `signed_at` = the moment the signature was
// actually produced. Backdating it to `created_at` would assert a moment that
// did not happen — a signature that did not exist in 2026-04 would claim to,
// and the gap between review and signature (the very thing that makes this
// backfill a disclosable correction rather than a quiet rewrite) would vanish
// from the record. The detail page shows the two dates as distinct for exactly
// this reason.

import { signPackage, getRfc3161Timestamp } from './signing.ts';
import {
  evaluateSealCommitGate,
  isSigningKeyConfigured,
  type SealCommitGateRefusal,
} from './unsigned-tier.ts';
import {
  REVIEW_UNSIGNED_REASON_BACKFILL_FAILED,
  type ReviewUnsignedReason,
} from './trust-signal.ts';
import { canonicalEnvName, priorEraEnvName } from '../publisher-env.ts';

type EnvLike = Record<string, string | undefined>;

/** Refusal codes this module emits. Each means "do not proceed", and each maps
 *  to a non-zero exit in the script. Snake_case, matching the established
 *  codes on this path. */
export const BACKFILL_NO_SIGNING_KEY_CODE = 'backfill_no_signing_key';
export const BACKFILL_ROWS_VANISHED_CODE = 'backfill_rows_vanished';

/**
 * The refusal a keyless backfill run receives.
 *
 * Names what is missing and what would have happened otherwise, because the
 * operator's next move depends on knowing this is a refusal to GUESS rather
 * than a plain misconfiguration stop. Carries no key material.
 */
export function backfillNoSigningKeyRefusal(): SealCommitGateRefusal {
  return {
    status: 500,
    body: {
      error:
        'This backfill signs reviews, so it will not run without a signing ' +
        `key: ${canonicalEnvName('SIGNING_KEY')} is not set in this ` +
        `environment (nor its prior-era name ${priorEraEnvName('SIGNING_KEY')}, ` +
        'which is still accepted). No row has been read or modified. A ' +
        'keyless run is refused rather than allowed to label every ' +
        'historical review as coming from an instance with no signing key: ' +
        'those rows were written under a configuration this run cannot ' +
        "observe, and stamping the current environment's state across them " +
        'would assert something about the past that may simply be false, ' +
        'overwriting the only record that their state was unknown. Configure ' +
        'the signing key and re-run — see docs/instance-setup.md.',
      code: BACKFILL_NO_SIGNING_KEY_CODE,
    },
  };
}

/**
 * The refusal when the row listing comes back empty but the count said
 * otherwise — the table was read through something that is not reporting it
 * faithfully (a mid-run failover, a permissions boundary, a mistyped
 * connection). Proceeding would print a clean "0 rows, nothing to do" report
 * over a table that is in fact full of unsigned rows, and the operator would
 * reasonably read that as "the backfill is done."
 */
export function backfillRowsVanishedRefusal(counted: number): SealCommitGateRefusal {
  return {
    status: 500,
    body: {
      error:
        `The count query reported ${counted} attestation row(s) but the ` +
        'listing returned none. Nothing has been modified. This run is ' +
        'refused rather than reported as a completed backfill over an empty ' +
        'table, which is what a zero-row report would look like.',
      code: BACKFILL_ROWS_VANISHED_CODE,
    },
  };
}

/**
 * Preflight, run BEFORE any row is counted, read, or written.
 *
 * The mirror image of P1's `evaluateAttestationSigningGate`: that one lets the
 * keyless tier THROUGH (recording a review keyless is legitimate) and applies
 * every other refusal once a key is present. This one REFUSES the keyless case
 * (see the header) and then applies exactly the same misconfiguration
 * refusals, by delegation rather than restatement so their messages cannot
 * drift from the routes':
 *
 *   - `signing_key_id_missing`   — a key with no configured kid.
 *   - `instance_identity_missing` — a signing pair with no declared identity.
 *
 * A backfill that signed under a kid or identity this instance never declared
 * would write misattributed envelopes into historical rows, which is worse
 * than leaving them unsigned.
 */
export function evaluateBackfillPreflight(
  env: EnvLike = process.env,
): SealCommitGateRefusal | null {
  if (!isSigningKeyConfigured(env)) return backfillNoSigningKeyRefusal();
  return evaluateSealCommitGate(env);
}

/** One `attestation_packages` row, as the pass needs to see it. */
export interface BackfillCandidateRow {
  id: string;
  packageHash: string;
  /** Non-null means the row is already signed and is left alone. */
  signature: string | null;
  /** Read as `string | null`, not the closed vocabulary: the database may hold
   *  a value this build has never heard of. Narrowing happens at the guard. */
  unsignedReason: string | null;
  /** When the review was submitted. Never becomes `signed_at`. */
  createdAt: Date;
}

/** The columns one row's write sets. Mirrors P1's `AttestationSignatureColumns`
 *  so both paths populate the same five columns the same way. */
export interface BackfillWriteColumns {
  signature: string | null;
  signingKeyId: string | null;
  rfc3161Timestamp: string | null;
  signedAt: Date | null;
  unsignedReason: ReviewUnsignedReason | null;
}

export type BackfillDecision =
  /** Already signed — left exactly as it is. This is the idempotency branch. */
  | { kind: 'already-signed' }
  /** Written by the live path on a keyless instance. NOT ours to overwrite. */
  | { kind: 'keyless-tier' }
  | { kind: 'signed'; columns: BackfillWriteColumns; timestamped: boolean }
  | { kind: 'failed'; columns: BackfillWriteColumns; cause: unknown };

export interface AttestationBackfillReport {
  /** Every row the pass looked at, whatever it decided. */
  seen: number;
  /** Rows this run signed. */
  signed: number;
  /** Of `signed`, those the timestamp authority did not stamp. Not a failure —
   *  P1's rule, unchanged: a signed, untimestamped review is a valid state. */
  signedWithoutTimestamp: number;
  /** Rows already carrying a signature, left untouched. */
  alreadySignedSkipped: number;
  /** Rows the live path recorded on a keyless instance, left untouched. */
  keylessTierSkipped: number;
  /** Rows this run reached, could not sign, and labeled. */
  failedWithReason: number;
  dryRun: boolean;
}

export interface AttestationBackfillPorts {
  /** How many rows the table holds, read BEFORE the listing. */
  countRows: () => Promise<number>;
  /** Every `attestation_packages` row. The pass decides per row rather than
   *  filtering in SQL, so "already signed, skipped" is an observed count the
   *  report can state rather than an absence it would have to infer. */
  loadRows: () => Promise<BackfillCandidateRow[]>;
  /** Writes one row's signature columns. NEVER called when `dryRun` is set. */
  updateRow: (id: string, columns: BackfillWriteColumns) => Promise<void>;
  signPackage?: typeof signPackage;
  getRfc3161Timestamp?: typeof getRfc3161Timestamp;
  /** Called once per signed row, at the moment that signature is produced. */
  now?: () => Date;
  env?: EnvLike;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export type AttestationBackfillResult =
  | { ok: true; report: AttestationBackfillReport }
  | { ok: false; refusal: SealCommitGateRefusal; report: null };

/** Decide one row. Pure apart from the injected signing/clock ports — it
 *  performs no write, so a dry run and a real run take the identical path
 *  through it and cannot report different things. */
export async function decideRow(
  row: BackfillCandidateRow,
  deps: {
    sign: typeof signPackage;
    timestamp: typeof getRfc3161Timestamp;
    now: () => Date;
  },
): Promise<BackfillDecision> {
  // Idempotency: a signed row is never re-signed. Re-signing would replace a
  // signature with an equivalent one and move `signed_at` forward, rewriting a
  // true record of when the commitment was made for no gain.
  if (row.signature) return { kind: 'already-signed' };

  // The intended unsigned tier (ADR-0020 §B), recorded by the live path at a
  // moment it actually knew the answer. Signing it now would erase that fact
  // and replace it with a signature produced under a different configuration
  // than the one the row describes. Not this pass's row to touch.
  if (row.unsignedReason === 'no_signing_key') return { kind: 'keyless-tier' };

  try {
    const result = deps.sign(row.packageHash);
    if (!result) {
      // Unreachable via the script (preflight refuses keyless), but a null
      // here would mean the unsigned tier had been entered by a run that is
      // supposed to sign. Treated as the failure it would be rather than
      // silently labeled as a deliberate choice.
      return {
        kind: 'failed',
        columns: failedColumns(),
        cause: new Error('signPackage returned null despite a configured key'),
      };
    }

    // `signed_at` is taken HERE — when the signature exists — and never from
    // `row.createdAt`. Decision D2.
    const signedAt = deps.now();

    // Best-effort, exactly as on the write path. A TSA outage never costs a
    // row its signature.
    const rfc3161Timestamp = await deps.timestamp(row.packageHash).catch(() => null);

    return {
      kind: 'signed',
      timestamped: rfc3161Timestamp !== null,
      columns: {
        signature: JSON.stringify({
          signature: result.signature,
          publicKey: result.publicKey,
          algorithm: result.algorithm,
          kid: result.kid,
        }),
        signingKeyId: result.kid,
        rfc3161Timestamp,
        signedAt,
        unsignedReason: null,
      },
    };
  } catch (cause) {
    return { kind: 'failed', columns: failedColumns(), cause };
  }
}

/** A failed row: unsigned in every column, and SAYING SO. Never NULL. */
function failedColumns(): BackfillWriteColumns {
  return {
    signature: null,
    signingKeyId: null,
    rfc3161Timestamp: null,
    // Never a signing time for a row with no signature.
    signedAt: null,
    unsignedReason: REVIEW_UNSIGNED_REASON_BACKFILL_FAILED,
  };
}

/**
 * Run the pass.
 *
 * Order is load-bearing: preflight completes BEFORE `countRows`, so a keyless
 * or misconfigured run has not so much as read the table when it refuses. The
 * tests assert that directly, by handing in ports that record whether they
 * were called at all.
 *
 * A row that fails to sign is counted and the run CONTINUES — one bad row must
 * not cost the rest of the table its signatures. Only the three conditions
 * that mean "do not proceed" stop the run: no signing key, an unreachable
 * database (the port throws, and it is the caller's to catch), and a listing
 * that contradicts its own count.
 */
export async function runAttestationSignatureBackfill(
  ports: AttestationBackfillPorts,
): Promise<AttestationBackfillResult> {
  const env = ports.env ?? process.env;
  const dryRun = ports.dryRun ?? false;
  const log = ports.log ?? (() => {});
  const deps = {
    sign: ports.signPackage ?? signPackage,
    timestamp: ports.getRfc3161Timestamp ?? getRfc3161Timestamp,
    now: ports.now ?? (() => new Date()),
  };

  // --- 1. Preflight. Nothing has been read. ---
  const refusal = evaluateBackfillPreflight(env);
  if (refusal) return { ok: false, refusal, report: null };

  // --- 2. Count, then list. ---
  const counted = await ports.countRows();
  const rows = await ports.loadRows();
  if (counted > 0 && rows.length === 0) {
    return { ok: false, refusal: backfillRowsVanishedRefusal(counted), report: null };
  }

  const report: AttestationBackfillReport = {
    seen: 0,
    signed: 0,
    signedWithoutTimestamp: 0,
    alreadySignedSkipped: 0,
    keylessTierSkipped: 0,
    failedWithReason: 0,
    dryRun,
  };

  // --- 3. Walk the table. ---
  for (const row of rows) {
    report.seen += 1;
    const decision = await decideRow(row, deps);

    switch (decision.kind) {
      case 'already-signed':
        report.alreadySignedSkipped += 1;
        continue;
      case 'keyless-tier':
        report.keylessTierSkipped += 1;
        continue;
      case 'signed':
        report.signed += 1;
        if (!decision.timestamped) report.signedWithoutTimestamp += 1;
        break;
      case 'failed':
        report.failedWithReason += 1;
        log(
          `[backfill] could not sign ${row.id} — labeling ` +
            `${REVIEW_UNSIGNED_REASON_BACKFILL_FAILED}; continuing.`,
        );
        break;
    }

    if (!dryRun) await ports.updateRow(row.id, decision.columns);
  }

  return { ok: true, report };
}

/**
 * The report block, as the operator pastes it into the gate record.
 *
 * Rendered from the counters rather than assembled at the call site so a dry
 * run and a real run produce the identical shape — the whole point of reading
 * the dry-run output is that it tells you what the real run will say.
 */
export function formatBackfillReport(report: AttestationBackfillReport): string {
  return [
    '--- attestation signature backfill ---',
    `mode:                       ${report.dryRun ? 'DRY RUN (nothing written)' : 'APPLY'}`,
    `rows seen:                  ${report.seen}`,
    `signed:                     ${report.signed}`,
    `  of which untimestamped:   ${report.signedWithoutTimestamp}`,
    `already-signed, skipped:    ${report.alreadySignedSkipped}`,
    `keyless-tier rows, skipped: ${report.keylessTierSkipped}`,
    `failed (labeled ${REVIEW_UNSIGNED_REASON_BACKFILL_FAILED}): ${report.failedWithReason}`,
    '--------------------------------------',
  ].join('\n');
}
