// P3 red instrument, Wave N9 (#384), family F5: a rejected tool call is a
// rejected tool call in the signed package.
//
// THE DEFECT, measured at d81eb76. The loop records `failed`/`failureKind` on
// the tool-call record at its catch site (run-tool-loop.ts:858-859) and says,
// in its own header, that nothing downstream can recover the fact. The
// packager then maps that record onto the envelope's `queries[]` through a
// hand-copied eight-key list (packager.ts:395-404), and produce-core 0.3.0's
// `buildEnvelope` re-emits the same eight keys ("this also drops any extra
// caller keys"), so a call the source rejected reaches the package
// indistinguishable from one that returned nothing. The trace inside the
// package does carry the failure (`error: true` on the span); the envelope's
// own tool-call list contradicts it, and so does every page that renders
// `queries[]`.
//
// WHAT IS RED HERE AND WHAT IS NOT. The first case is red at d81eb76: the
// failure keys are absent from `queries[]`. The second (absent is absent) and
// the two byte-identity cases are green at the base and must stay green
// through the produce-core pin bump
// (`^0.3.0` → 0.4.0, which adds `failed?`/`failureKind?` to `EnvelopeQuery`
// and re-emits them after `resultColumns`): both `JSON.stringify` and
// RFC 8785 omit an undefined key, so a package that recorded no failure is
// byte-identical before and after, and the pinned hashes prove that rather
// than assert it. A change to the pinned hashes is a change to the bytes of
// every package that recorded no failure, and needs saying why.
//
// The input is typed as the loop's own `ToolCallRecord` rather than cast
// through `unknown`: the record IS what the publish route receives (the
// client posts the `complete` event's `tools_called[]` verbatim), and
// `ToolCallRecord` is assignable to `ToolCallInput` structurally. The read
// side widens the entry type locally, because `EvidencePackage.queries`
// does not name the two keys at the base.
//
// Determinism for the pinned hashes: `packageId` and `createdAt` are the two
// inputs the packager draws from `crypto.randomUUID()` and the clock; both
// are mocked for the byte-identity case only. The signing kid and the
// instance identity are set explicitly for the same reason, in both
// spellings the resolver accepts, so a shell that exports either cannot move
// the pinned bytes.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/evidence/packager.failed-call.test.ts)

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import canonicalize from 'canonicalize';
import { buildEvidencePackage, type EvidencePackage, type PackageInput } from './packager.ts';
import { recomputePackageHash } from './verify.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';
import type { ToolCallRecord } from '../model-loop/run-tool-loop.ts';

const FIXTURE_KID = 'platform:test-suite-kid';
process.env.PUBLISHER_KEY_ID = FIXTURE_KID;
process.env.EVIDENCE_KEY_ID = FIXTURE_KID;
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] = value;
}

/** One envelope entry, widened to name the two keys the base type lacks. */
type QueryEntry = EvidencePackage['queries'][number] & {
  failed?: boolean;
  failureKind?: string;
};

const PORTAL = 'data.cityofnewyork.us';

const RETURNED_ONE_ROW: ToolCallRecord = {
  name: 'get_data',
  args: { type: 'query', portal: PORTAL, dataset_id: 'erm2-nwe9', select: 'count(*)' },
  resultSummary: { rows: 1, columns: 1 },
  duration_ms: 120,
  operationType: 'query',
};

/**
 * A call the source did not answer in time, exactly as the loop records it:
 * `failed`/`failureKind` set at the catch site, no `resultSummary`, no
 * `duration_ms` (the call never completed, so nothing measured one).
 */
const REJECTED_TIMEOUT: ToolCallRecord = {
  name: 'get_data',
  args: { type: 'query', portal: PORTAL, dataset_id: 'abcd-1234', select: 'count(*)', where: "borough='QUEENS'" },
  operationType: 'query',
  failed: true,
  failureKind: 'timeout',
};

function packageInput(toolCalls: ToolCallRecord[], overrides: Partial<PackageInput> = {}): PackageInput {
  return {
    trace: { resourceSpans: [] },
    prompt: 'How many 311 noise complaints last year?',
    output: 'Around 400,000.',
    toolCalls,
    model: 'openai/gpt-4o',
    portal: PORTAL,
    tokenUsage: { promptTokens: 100, completionTokens: 20 },
    promptVisibility: 'full_text',
    title: 'Test',
    summary: 'Test summary.',
    ...overrides,
  };
}

// --- RED at d81eb76: the failure does not reach queries[] -------------------

test('packager: a rejected tool call is a rejected call in queries[] — failed and failureKind travel', () => {
  const { pkg } = buildEvidencePackage(packageInput([RETURNED_ONE_ROW, REJECTED_TIMEOUT]));
  assert.equal(pkg.queries.length, 2, 'both calls are listed');

  const rejected: QueryEntry = pkg.queries[1];
  assert.equal(rejected.tool, 'get_data');
  assert.equal(
    rejected.failed,
    true,
    'the envelope entry for a call the loop recorded as failed does not say so — a reader of ' +
      'queries[] cannot tell it from a call that returned nothing',
  );
  assert.equal(rejected.failureKind, 'timeout', 'the kind the loop recorded travels with it');
  assert.equal(rejected.resultRows, undefined, 'a failed call has no row count, and none is invented');

  // The bytes are the claim — exactly these values, not a null kind.
  const rejectedBytes = JSON.stringify(rejected);
  assert.ok(
    rejectedBytes.includes('"failed":true') && rejectedBytes.includes('"failureKind":"timeout"'),
    `the rejected entry's bytes name the failure: ${rejectedBytes}`,
  );
});

test('packager: a call recorded without a failure carries neither key — absent is absent', () => {
  const { pkg } = buildEvidencePackage(packageInput([RETURNED_ONE_ROW, REJECTED_TIMEOUT]));

  const returned: QueryEntry = pkg.queries[0];
  assert.equal(returned.failed, undefined);
  assert.equal(returned.failureKind, undefined);
  // The bytes are the claim: neither key is written for a call that did not
  // fail, on either canonicalization chain.
  for (const bytes of [JSON.stringify(returned), canonicalize(returned) ?? '']) {
    assert.ok(!bytes.includes('"failed"'), `no "failed" key on a call that did not fail: ${bytes}`);
    assert.ok(!bytes.includes('"failureKind"'), `no "failureKind" key on a call that did not fail: ${bytes}`);
  }
});

// --- GREEN at d81eb76, and must stay green through the pin bump -------------
//
// Pinned at d81eb76 with @typedstandards/produce-core 0.3.0 and
// @typedstandards/civic-typed-harness 0.3.0 installed. An entry that carries
// no `failed`/`failureKind` is re-emitted byte-identically by produce-core
// 0.4.0, so these hashes are the bump's byte-identity proof for every package
// that recorded no failure.

const FIXED_PACKAGE_ID = '00000000-0000-4000-8000-000000000384';
const FIXED_NOW = '2026-09-02T12:00:00.000Z';

const PINNED_ENVELOPE_HASH = {
  /** No `type` → legacy chain: SHA-256(JSON.stringify(pkg)); insertion order is the byte contract. */
  legacy: 'beb0b3d6353f7c565d6c8b1d55382de21e4d0ce6b1b61c60a3aa0cb5ef3bd3ab',
  /** `type` set → v0.1 chain: RFC 8785 JCS with `contentCanonicalization` + `contentHash`. */
  v01: 'ce1779021bebc6acc2abba20d67fce2a34014792f7abfb9d8d8f45d93a423101',
} as const;

function buildDeterministically(input: PackageInput): { pkg: EvidencePackage; hash: string } {
  mock.method(crypto, 'randomUUID', () => FIXED_PACKAGE_ID as ReturnType<typeof crypto.randomUUID>);
  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW).getTime() });
  try {
    return buildEvidencePackage(input);
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
}

test('packager: byte identity — the envelope hash of a package that recorded no failure is pinned (legacy chain)', () => {
  const { pkg, hash } = buildDeterministically(packageInput([RETURNED_ONE_ROW]));
  assert.equal(pkg.metadata.packageId, FIXED_PACKAGE_ID, 'determinism holds — the mock reached the packager');
  assert.equal(pkg.metadata.createdAt, FIXED_NOW, 'determinism holds — the clock mock reached the packager');
  assert.equal(recomputePackageHash(pkg as unknown as Record<string, unknown>), hash, 'the verifier recomputes the same hash');
  assert.equal(
    hash,
    PINNED_ENVELOPE_HASH.legacy,
    'the bytes of a package with no failure moved — a pin bump must leave an entry without ' +
      'failed/failureKind byte-identical',
  );
});

test('packager: byte identity — the envelope hash of a package that recorded no failure is pinned (v0.1 chain)', () => {
  const { pkg, hash } = buildDeterministically(
    packageInput([RETURNED_ONE_ROW], { type: 'content/analysis/v1', captureMethod: 'chat-flow-stream' }),
  );
  assert.equal(pkg.type, 'content/analysis/v1');
  assert.ok(pkg.contentHash?.sha256, 'the v0.1 chain emits contentHash');
  assert.equal(recomputePackageHash(pkg as unknown as Record<string, unknown>), hash, 'the verifier recomputes the same hash');
  assert.equal(
    hash,
    PINNED_ENVELOPE_HASH.v01,
    'the bytes of a package with no failure moved — a pin bump must leave an entry without ' +
      'failed/failureKind byte-identical',
  );
});
