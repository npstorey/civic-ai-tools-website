// Tests for the one-time signing pass over pre-0016 `attestation_packages`
// rows (civic-ai-tools-website#294 P2).
//
// NOTHING HERE TOUCHES A DATABASE OR A REAL SIGNING KEY. Every key is an
// ephemeral Ed25519 pair generated inside the test process; every row and
// every write is an injected fake. The script that carries the real Postgres
// wiring is deliberately a thin shell over `runAttestationSignatureBackfill`
// precisely so the decisions can be tested without either.
//
// WHY PORTS, AGAIN. Same reason as P1's `attestation-signing.test.ts`: the
// properties worth pinning here are claims about what was and was not called.
// "A keyless run touches no row" and "a dry run writes nothing" are not
// observable from a return value — they are observable only from ports that
// record whether they ran at all.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  runAttestationSignatureBackfill,
  evaluateBackfillPreflight,
  formatBackfillReport,
  decideRow,
  backfillNoSigningKeyRefusal,
  BACKFILL_NO_SIGNING_KEY_CODE,
  BACKFILL_ROWS_VANISHED_CODE,
  type AttestationBackfillPorts,
  type BackfillCandidateRow,
  type BackfillWriteColumns,
} from './attestation-backfill.ts';
import { verifySignature } from './verify.ts';
import {
  resolveReviewSignature,
  resolveReviewSignatureStatus,
  REVIEW_UNSIGNED_REASON_BACKFILL_FAILED,
} from './trust-signal.ts';
import { INSTANCE_IDENTITY_REQUIRED_VARS } from '../site-config.ts';

const HASH_A = 'acdb56712cc0e735589e39d485dcd2c3d34a611b6752ab2f8b703e13008a3004';
const HASH_B = 'bd0e1f2a3c4b5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6';

/** When the reviews under test were submitted — months before any signature
 *  could have existed. `signed_at` must never come back as this. */
const CREATED_AT = new Date('2026-04-12T09:15:00.000Z');

function generateTestKeyPair(): { privB64: string; pubB64: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privB64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    pubB64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

/** A fully-configured signing environment as a plain object, for the paths
 *  that only need `env` (preflight). Canonical `PUBLISHER_` spellings. */
function signingEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    PUBLISHER_SIGNING_KEY: 'not-read-on-this-path',
    PUBLISHER_KEY_ID: 'platform:test-key',
  };
  for (const name of INSTANCE_IDENTITY_REQUIRED_VARS) env[name] = 'set-for-test';
  return { ...env, ...overrides };
}

/** Run `fn` with a real ephemeral key + kid + identity in `process.env`,
 *  restoring after it RESOLVES. Needed only where the DEFAULT signing port is
 *  exercised, since `signPackage` reads custody from the process environment.
 *
 *  Deliberately async, unlike P1's synchronous sibling: that one is safe
 *  because `signAndStoreAttestationPackage` signs before its first `await`,
 *  whereas this pass signs only after awaiting a count and a listing. A
 *  synchronous helper would restore the environment before the signing ever
 *  happened, and the test would fail for a reason that has nothing to do with
 *  the code under test. */
async function withSigningEnv<T>(privB64: string, fn: () => Promise<T>): Promise<T> {
  const names = [
    'EVIDENCE_SIGNING_KEY',
    'EVIDENCE_KEY_ID',
    ...INSTANCE_IDENTITY_REQUIRED_VARS,
  ];
  const orig = new Map(names.map((n) => [n, process.env[n]]));
  process.env.EVIDENCE_SIGNING_KEY = privB64;
  process.env.EVIDENCE_KEY_ID = 'platform:test-key';
  for (const n of INSTANCE_IDENTITY_REQUIRED_VARS) process.env[n] = 'set-for-test';
  try {
    return await fn();
  } finally {
    for (const [n, v] of orig) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

interface Recorder {
  ports: AttestationBackfillPorts;
  countCalls: number;
  loadCalls: number;
  updates: Array<{ id: string; columns: BackfillWriteColumns }>;
}

/** Ports that record every read and every write, so a test can assert that a
 *  refusal or a dry run left the table completely alone. */
function makeRecorder(
  rows: BackfillCandidateRow[],
  overrides: Partial<AttestationBackfillPorts> = {},
): Recorder {
  const rec: Recorder = {
    countCalls: 0,
    loadCalls: 0,
    updates: [],
    ports: {} as AttestationBackfillPorts,
  };
  rec.ports = {
    countRows: async () => {
      rec.countCalls += 1;
      return rows.length;
    },
    loadRows: async () => {
      rec.loadCalls += 1;
      return rows;
    },
    updateRow: async (id, columns) => {
      rec.updates.push({ id, columns });
    },
    // Default: signing succeeds with a stub envelope, no network anywhere.
    signPackage: () => ({
      signature: 'c3R1Yi1zaWduYXR1cmU=',
      publicKey: 'c3R1Yi1wdWJsaWMta2V5',
      algorithm: 'Ed25519ph',
      kid: 'platform:test-key',
    }),
    getRfc3161Timestamp: async () => 'MIIBase64TimestampToken==',
    env: signingEnv(),
    ...overrides,
  };
  return rec;
}

function unsignedRow(id: string, packageHash: string): BackfillCandidateRow {
  return { id, packageHash, signature: null, unsignedReason: null, createdAt: CREATED_AT };
}

// --- 1. THE KEYLESS REFUSAL — the sharpest requirement in the phase -------

test('KEYLESS: a run with no signing key REFUSES and does not touch a single row', async () => {
  const rec = makeRecorder([unsignedRow('row-1', HASH_A), unsignedRow('row-2', HASH_B)], {
    // No key under EITHER spelling. Identity is fully declared, so the ONLY
    // thing missing is custody — the refusal cannot be coming from elsewhere.
    env: signingEnv({ PUBLISHER_SIGNING_KEY: undefined, EVIDENCE_SIGNING_KEY: undefined }),
  });

  const result = await runAttestationSignatureBackfill(rec.ports);

  assert.equal(result.ok, false, 'a keyless backfill must refuse');
  if (result.ok) return;
  assert.equal(result.refusal.body.code, BACKFILL_NO_SIGNING_KEY_CODE);
  assert.equal(result.report, null, 'a refused run reports no counts');

  // THE ASSERTIONS THAT MATTER: not one row was read, let alone written. The
  // refusal happens before the table is even counted.
  assert.equal(rec.countCalls, 0, 'the table was counted despite the refusal');
  assert.equal(rec.loadCalls, 0, 'rows were read despite the refusal');
  assert.equal(rec.updates.length, 0, 'a row was written despite the refusal');
});

test('KEYLESS: the refusal never labels rows `no_signing_key` — that is the whole point', async () => {
  const rec = makeRecorder([unsignedRow('row-1', HASH_A)], {
    env: signingEnv({ PUBLISHER_SIGNING_KEY: undefined, EVIDENCE_SIGNING_KEY: undefined }),
  });
  const result = await runAttestationSignatureBackfill(rec.ports);

  assert.equal(result.ok, false);
  // No write happened at all, so no row could have been relabeled. Stated as
  // its own assertion because "labels every row no_signing_key" is the
  // specific failure this refusal exists to prevent.
  assert.deepEqual(rec.updates, []);

  const r = backfillNoSigningKeyRefusal();
  assert.equal(r.status, 500);
  assert.match(r.body.error, /No row has been read or modified/);
  // Names the canonical variable so the operator knows what to set...
  assert.match(r.body.error, /PUBLISHER_SIGNING_KEY/);
  // ...and carries no key material.
  assert.doesNotMatch(r.body.error, /-----BEGIN|MII[A-Za-z0-9+/]{8}/);
});

test('KEYLESS: preflight refuses under BOTH env spellings, and passes when either is set', () => {
  assert.equal(
    evaluateBackfillPreflight(
      signingEnv({ PUBLISHER_SIGNING_KEY: undefined }),
    )?.body.code,
    BACKFILL_NO_SIGNING_KEY_CODE,
  );
  // The prior-era spelling still counts as custody — refusing an instance that
  // HAS a key would strand it on the old name.
  assert.equal(
    evaluateBackfillPreflight(
      signingEnv({ PUBLISHER_SIGNING_KEY: undefined, EVIDENCE_SIGNING_KEY: 'present' }),
    ),
    null,
  );
  assert.equal(evaluateBackfillPreflight(signingEnv()), null);
});

test('MISCONFIGURED: a key with no kid, or no declared identity, also refuses untouched', async () => {
  for (const [name, env] of [
    ['no kid', signingEnv({ PUBLISHER_KEY_ID: undefined })],
    ['no identity', signingEnv({ [INSTANCE_IDENTITY_REQUIRED_VARS[0]]: undefined })],
  ] as const) {
    const rec = makeRecorder([unsignedRow('row-1', HASH_A)], { env });
    const result = await runAttestationSignatureBackfill(rec.ports);
    assert.equal(result.ok, false, `${name}: expected a refusal`);
    if (result.ok) continue;
    // Delegated verbatim from the shared gate, so the codes match the routes'.
    assert.match(result.refusal.body.code, /signing_key_id_missing|instance_identity_missing/);
    assert.equal(rec.countCalls, 0, `${name}: table read despite refusal`);
    assert.equal(rec.updates.length, 0, `${name}: row written despite refusal`);
  }
});

// --- 2. `signed_at` IS THE RUN TIME, NEVER `created_at` (decision D2) -----

test('SIGNS: an unsigned row gets a signature and `signed_at` = the run time, not `created_at`', async () => {
  const RUN_AT = new Date('2026-08-22T14:30:00.000Z');
  const rec = makeRecorder([unsignedRow('row-1', HASH_A)], { now: () => RUN_AT });

  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.report.seen, 1);
  assert.equal(result.report.signed, 1);
  assert.equal(rec.updates.length, 1);

  const written = rec.updates[0].columns;
  assert.ok(written.signature, 'no signature written');
  assert.equal(written.signingKeyId, 'platform:test-key');
  assert.equal(written.unsignedReason, null, 'a signed row carries no unsigned reason');

  // THE ASSERTION THAT MATTERS. A retro-dated signature would assert a moment
  // that did not happen.
  assert.deepEqual(written.signedAt, RUN_AT);
  assert.notDeepEqual(written.signedAt, CREATED_AT);
  assert.ok(
    written.signedAt!.getTime() > CREATED_AT.getTime(),
    'signed_at must be later than the review it signs',
  );

  // The row now reads as signed through the shared vocabulary.
  assert.equal(
    resolveReviewSignatureStatus({
      signature: written.signature,
      rfc3161Timestamp: written.rfc3161Timestamp,
      unsignedReason: written.unsignedReason,
    }),
    'signed_timestamped',
  );
});

test('SIGNS: the written signature actually verifies against the public key', async () => {
  const { privB64, pubB64 } = generateTestKeyPair();
  // Exercise the DEFAULT signing port — the real custody path, not a stub.
  const rec = makeRecorder([unsignedRow('row-1', HASH_A)], {
    signPackage: undefined,
    env: undefined,
  });
  delete (rec.ports as { signPackage?: unknown }).signPackage;
  delete (rec.ports as { env?: unknown }).env;

  const result = await withSigningEnv(privB64, () =>
    runAttestationSignatureBackfill(rec.ports),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.signed, 1);

  const envelope = JSON.parse(rec.updates[0].columns.signature!) as {
    signature: string;
    publicKey: string;
    algorithm: string;
    kid: string;
  };
  assert.deepEqual(Object.keys(envelope).sort(), ['algorithm', 'kid', 'publicKey', 'signature']);
  assert.equal(envelope.algorithm, 'Ed25519ph');

  // A backfilled signature is a real commitment over the row's package hash.
  assert.equal(
    verifySignature(HASH_A, envelope.signature, pubB64),
    true,
    'backfilled signature did not verify',
  );
  // ...and the check is not vacuous.
  assert.equal(verifySignature(HASH_B, envelope.signature, pubB64), false);
});

// --- 3. IDEMPOTENCY ------------------------------------------------------

test('IDEMPOTENT: an already-signed row is skipped, counted, and never rewritten', async () => {
  const signedRow: BackfillCandidateRow = {
    id: 'row-signed',
    packageHash: HASH_B,
    signature: JSON.stringify({ signature: 'x', publicKey: 'y', algorithm: 'Ed25519ph', kid: 'k' }),
    unsignedReason: null,
    createdAt: CREATED_AT,
  };
  const rec = makeRecorder([signedRow, unsignedRow('row-unsigned', HASH_A)]);

  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.report.seen, 2);
  assert.equal(result.report.signed, 1);
  assert.equal(result.report.alreadySignedSkipped, 1);
  // Only the unsigned row was written. Re-signing would move `signed_at`
  // forward and rewrite a true record of when the commitment was made.
  assert.deepEqual(rec.updates.map((u) => u.id), ['row-unsigned']);
});

test('IDEMPOTENT: a second run over the first run\'s output writes nothing', async () => {
  const rows = [unsignedRow('row-1', HASH_A), unsignedRow('row-2', HASH_B)];
  const first = makeRecorder(rows);
  const r1 = await runAttestationSignatureBackfill(first.ports);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  assert.equal(r1.report.signed, 2);

  // Apply what run 1 wrote, exactly as the database would now hold it.
  const afterFirst: BackfillCandidateRow[] = rows.map((row) => {
    const update = first.updates.find((u) => u.id === row.id)!;
    return { ...row, signature: update.columns.signature, unsignedReason: update.columns.unsignedReason };
  });

  const second = makeRecorder(afterFirst);
  const r2 = await runAttestationSignatureBackfill(second.ports);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;

  assert.equal(r2.report.seen, 2);
  assert.equal(r2.report.signed, 0, 'the second run re-signed rows');
  assert.equal(r2.report.alreadySignedSkipped, 2);
  assert.deepEqual(second.updates, [], 'the second run wrote to the database');
});

test('IDEMPOTENT: a row a previous run FAILED on is retried, not skipped forever', async () => {
  const previouslyFailed: BackfillCandidateRow = {
    id: 'row-retry',
    packageHash: HASH_A,
    signature: null,
    unsignedReason: REVIEW_UNSIGNED_REASON_BACKFILL_FAILED,
    createdAt: CREATED_AT,
  };
  const rec = makeRecorder([previouslyFailed]);

  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.report.signed, 1, 'a previously-failed row must be retried');
  assert.equal(rec.updates.length, 1);
  assert.ok(rec.updates[0].columns.signature);
  assert.equal(rec.updates[0].columns.unsignedReason, null, 'the stale reason must be cleared');
});

// --- 4. A ROW IT CANNOT SIGN: labeled, never NULL, and the run continues --

test('FAILS-ONE: a row that cannot be signed gets the reason value and the run CONTINUES', async () => {
  const rows = [unsignedRow('row-ok-1', HASH_A), unsignedRow('row-bad', HASH_B), unsignedRow('row-ok-2', HASH_A)];
  const rec = makeRecorder(rows, {
    signPackage: (hash: string) => {
      if (hash === HASH_B) throw new Error('key rejected this input');
      return {
        signature: 'c3R1Yi1zaWduYXR1cmU=',
        publicKey: 'c3R1Yi1wdWJsaWMta2V5',
        algorithm: 'Ed25519ph',
        kid: 'platform:test-key',
      };
    },
  });

  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, true, 'one bad row must not abort the pass');
  if (!result.ok) return;

  // The run continued past the failure — both good rows were signed.
  assert.equal(result.report.seen, 3);
  assert.equal(result.report.signed, 2);
  assert.equal(result.report.failedWithReason, 1);
  assert.deepEqual(rec.updates.map((u) => u.id), ['row-ok-1', 'row-bad', 'row-ok-2']);

  const bad = rec.updates.find((u) => u.id === 'row-bad')!.columns;

  // NEVER NULL. This is the assertion the whole vocabulary exists for: a
  // backfilled-but-unsigned row must not be indistinguishable from a row the
  // pass never reached.
  assert.equal(bad.unsignedReason, REVIEW_UNSIGNED_REASON_BACKFILL_FAILED);
  assert.equal(bad.unsignedReason, 'backfill_signing_failed');
  assert.notEqual(bad.unsignedReason, null);
  // ...and it is not silently relabeled as the keyless tier.
  assert.notEqual(bad.unsignedReason, 'no_signing_key');

  // The row stays honestly unsigned in every other column.
  assert.equal(bad.signature, null);
  assert.equal(bad.signingKeyId, null);
  assert.equal(bad.rfc3161Timestamp, null);
  assert.equal(bad.signedAt, null, 'signed_at must not claim a time for an unsigned row');

  // And it reads as its own state — neither "signed" nor "never reached".
  const resolved = resolveReviewSignature({
    signature: bad.signature,
    rfc3161Timestamp: bad.rfc3161Timestamp,
    unsignedReason: bad.unsignedReason,
  });
  assert.equal(resolved.status, 'unsigned_backfill_failed');
  assert.match(resolved.label, /^Unsigned/);
  assert.notEqual(resolved.status, 'unsigned_pre_backfill');
  assert.doesNotMatch(resolved.label, /no signing key/i);
});

// --- 5. TSA FAILURE: signed, untimestamped, never a reason to skip --------

test('TSA: a timestamp failure yields a SIGNED row with a null timestamp, and is only reported', async () => {
  for (const [name, tsa] of [
    ['returns null', async () => null],
    ['rejects', async () => { throw new Error('TSA unreachable'); }],
  ] as const) {
    const rec = makeRecorder([unsignedRow('row-1', HASH_A)], { getRfc3161Timestamp: tsa });
    const result = await runAttestationSignatureBackfill(rec.ports);

    assert.equal(result.ok, true, `TSA ${name}: the run must not fail`);
    if (!result.ok) continue;
    assert.equal(result.report.signed, 1, `TSA ${name}: row not signed`);
    assert.equal(result.report.failedWithReason, 0, `TSA ${name}: counted as a failure`);
    assert.equal(result.report.signedWithoutTimestamp, 1, `TSA ${name}: not reported`);

    const written = rec.updates[0].columns;
    assert.ok(written.signature, `TSA ${name}: signature lost`);
    assert.equal(written.rfc3161Timestamp, null);
    assert.ok(written.signedAt instanceof Date, `TSA ${name}: signed_at lost`);
    assert.equal(
      resolveReviewSignatureStatus({
        signature: written.signature,
        rfc3161Timestamp: written.rfc3161Timestamp,
        unsignedReason: written.unsignedReason,
      }),
      'signed_untimestamped',
      `TSA ${name}: wrong status`,
    );
  }
});

// --- 6. DRY RUN ----------------------------------------------------------

test('DRY RUN: reports exactly what the real run would do, and writes NOTHING', async () => {
  const rows = [unsignedRow('row-1', HASH_A), unsignedRow('row-2', HASH_B)];

  const dry = makeRecorder(rows, { dryRun: true });
  const dryResult = await runAttestationSignatureBackfill(dry.ports);
  assert.equal(dryResult.ok, true);
  if (!dryResult.ok) return;

  // THE ASSERTION THAT MATTERS.
  assert.deepEqual(dry.updates, [], 'a dry run wrote to the database');
  // ...but it still READ the table, or its report would be worthless.
  assert.equal(dry.loadCalls, 1);
  assert.equal(dryResult.report.dryRun, true);
  assert.equal(dryResult.report.signed, 2);

  // The counts a dry run prints are the counts the real run produces — that
  // equivalence is the only reason reading the dry-run output is meaningful.
  const wet = makeRecorder(rows);
  const wetResult = await runAttestationSignatureBackfill(wet.ports);
  assert.equal(wetResult.ok, true);
  if (!wetResult.ok) return;
  assert.deepEqual(
    { ...dryResult.report, dryRun: false },
    wetResult.report,
    'dry run and apply disagreed about what would happen',
  );
  assert.equal(wet.updates.length, 2, 'the apply run did not write');
});

// --- 7. THE KEYLESS TIER IS NOT THIS PASS'S TO OVERWRITE -----------------

test('KEYLESS TIER: a row the live path recorded as `no_signing_key` is left alone', async () => {
  const keylessRow: BackfillCandidateRow = {
    id: 'row-keyless',
    packageHash: HASH_B,
    signature: null,
    unsignedReason: 'no_signing_key',
    createdAt: CREATED_AT,
  };
  const rec = makeRecorder([keylessRow, unsignedRow('row-pre-0016', HASH_A)]);

  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.report.keylessTierSkipped, 1);
  assert.equal(result.report.signed, 1);
  // Only the pre-0016 row was touched. The keyless row records a fact the live
  // path knew at write time; overwriting it would destroy that record.
  assert.deepEqual(rec.updates.map((u) => u.id), ['row-pre-0016']);
});

// --- 8. THE "DO NOT PROCEED" CONDITION: a listing that contradicts itself --

test('VANISHED: a count of N with an empty listing REFUSES rather than reporting success', async () => {
  const rec = makeRecorder([], {
    countRows: async () => 12,
    loadRows: async () => [],
  });

  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, false, 'an empty listing against a non-zero count must refuse');
  if (result.ok) return;
  assert.equal(result.refusal.body.code, BACKFILL_ROWS_VANISHED_CODE);
  assert.match(result.refusal.body.error, /12/);
  assert.deepEqual(rec.updates, []);
});

test('EMPTY TABLE: a genuine zero-row table is a clean success, not a refusal', async () => {
  const rec = makeRecorder([]);
  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, true, 'an empty table is not an error');
  if (!result.ok) return;
  assert.equal(result.report.seen, 0);
  assert.deepEqual(rec.updates, []);
});

// --- 9. THE REPORT BLOCK -------------------------------------------------

test('REPORT: every counter the gate record needs appears, and the mode is unambiguous', async () => {
  const rec = makeRecorder([unsignedRow('row-1', HASH_A)], { dryRun: true });
  const result = await runAttestationSignatureBackfill(rec.ports);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const block = formatBackfillReport(result.report);
  for (const needed of [
    'rows seen:',
    'signed:',
    'already-signed, skipped:',
    'failed (labeled backfill_signing_failed):',
  ]) {
    assert.ok(block.includes(needed), `report block is missing "${needed}"`);
  }
  // A dry run must never be mistakable for an applied one in pasted output.
  assert.match(block, /DRY RUN \(nothing written\)/);
  assert.doesNotMatch(formatBackfillReport({ ...result.report, dryRun: false }), /DRY RUN/);
});

// --- 10. `decideRow` performs no write on any path ------------------------

test('DECIDE: the per-row decision is write-free, so dry and applied runs cannot diverge', async () => {
  // `decideRow` takes no write port at all — the type system enforces what the
  // dry-run test asserts behaviorally. This pins the signed path's shape.
  const decision = await decideRow(unsignedRow('row-1', HASH_A), {
    sign: () => ({
      signature: 'c3RVYg==',
      publicKey: 'cHVi',
      algorithm: 'Ed25519ph',
      kid: 'platform:test-key',
    }),
    timestamp: async () => null,
    now: () => new Date('2026-08-22T14:30:00.000Z'),
  });
  assert.equal(decision.kind, 'signed');
  if (decision.kind !== 'signed') return;
  assert.equal(decision.timestamped, false);
  assert.notDeepEqual(decision.columns.signedAt, CREATED_AT);
});
