// Tests for signing + persisting `attestation_packages` rows
// (civic-ai-tools-website#294 P1).
//
// WHAT WAS BROKEN. The attestations route called `signPackage(hash)` without
// awaiting it and threw the result away, awaited an RFC 3161 timestamp and
// threw that away too, and inserted a row into a table with no column for
// either. A signature was computed on every submission and discarded. These
// tests pin the behavior that replaces it.
//
// WHY THE PORTS. This repo's test runner is
// `node --test --experimental-strip-types`, which cannot import the route
// module: it pulls in `next/server`, `next-auth`, and a live Postgres client
// through the `@/` alias. So the orchestrator takes its I/O as ports and these
// tests hand in recorders — which makes "nothing was persisted" a DIRECT
// assertion (putPackage never called, insertRow never called) rather than an
// inference about code shape. That is the only way the ordering fix can be
// tested at all, and the ordering is now a correctness property: a refusal
// after the blob write would orphan a blob on every failed submission.
//
// Keys are ephemeral and generated inside the test process. Nothing here reads
// or writes a real signing key.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  signAndStoreAttestationPackage,
  evaluateAttestationSigningGate,
  attestationSigningFailedRefusal,
  ATTESTATION_SIGNING_FAILED_CODE,
  type AttestationSignatureColumns,
  type AttestationSigningPorts,
} from './attestation-signing.ts';
// The real signing path is exercised through the orchestrator's DEFAULT port
// (it falls back to `signPackage`), driven by `withSigningEnv` below — so the
// signed-path tests cover custody + envelope construction as they actually run,
// not a stand-in.
import { verifySignature } from './verify.ts';
import {
  resolveReviewSignature,
  resolveReviewSignatureStatus,
  REVIEW_SIGNATURE_SIGNALS,
  REVIEW_SIGNATURE_STATUSES,
  REVIEW_UNSIGNED_REASON_NO_KEY,
} from './trust-signal.ts';
import { INSTANCE_IDENTITY_REQUIRED_VARS } from '../site-config.ts';

const SAMPLE_HASH = 'acdb56712cc0e735589e39d485dcd2c3d34a611b6752ab2f8b703e13008a3004';
const SAMPLE_PKG = {
  schemaVersion: '0.1.0',
  type: 'expert_attestation',
  body: 'The borough breakdown matches the published counts.',
};

function generateTestKeyPair(): { privB64: string; pubB64: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privB64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    pubB64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

/** Run `fn` with a signing key + kid in the environment, restoring after.
 *  Mirrors `signing.test.ts`'s helper so both exercise the same custody path. */
function withSigningEnv<T>(privB64: string, kid: string | undefined, fn: () => T): T {
  const origPriv = process.env.EVIDENCE_SIGNING_KEY;
  const origKid = process.env.EVIDENCE_KEY_ID;
  process.env.EVIDENCE_SIGNING_KEY = privB64;
  if (kid === undefined) delete process.env.EVIDENCE_KEY_ID;
  else process.env.EVIDENCE_KEY_ID = kid;
  try {
    return fn();
  } finally {
    if (origPriv === undefined) delete process.env.EVIDENCE_SIGNING_KEY;
    else process.env.EVIDENCE_SIGNING_KEY = origPriv;
    if (origKid === undefined) delete process.env.EVIDENCE_KEY_ID;
    else process.env.EVIDENCE_KEY_ID = origKid;
  }
}

interface Recorder {
  ports: AttestationSigningPorts;
  putCalls: Array<{ key: string; body: Record<string, unknown> }>;
  insertCalls: Array<AttestationSignatureColumns & { storageKey: string }>;
}

/** Ports that record every external write, so a test can assert that a
 *  refusal left NOTHING behind. */
function makeRecorder(overrides: Partial<AttestationSigningPorts> = {}): Recorder {
  const putCalls: Recorder['putCalls'] = [];
  const insertCalls: Recorder['insertCalls'] = [];
  return {
    putCalls,
    insertCalls,
    ports: {
      putPackage: async (key, body) => {
        putCalls.push({ key, body });
        return `https://blob.example/${key}`;
      },
      insertRow: async (columns) => {
        insertCalls.push(columns);
      },
      // Default: no network. A test that cares about the TSA overrides this.
      getRfc3161Timestamp: async () => 'MIIBase64TimestampToken==',
      ...overrides,
    },
  };
}

// --- 1. A stored review carries a verifiable signature -------------------

test('SIGNED: a stored review carries a signature that verifies against the public key', async () => {
  const { privB64, pubB64 } = generateTestKeyPair();
  const rec = makeRecorder();

  const result = await withSigningEnv(privB64, 'platform:test-key', () =>
    signAndStoreAttestationPackage(
      { packageHash: SAMPLE_HASH, attestationPkg: SAMPLE_PKG },
      rec.ports,
    ),
  );

  assert.equal(result.ok, true, 'expected the review to be stored');
  if (!result.ok) return;

  // The signature is PERSISTED, not merely computed — this is the defect.
  assert.ok(result.columns.signature, 'no signature persisted');
  const envelope = JSON.parse(result.columns.signature!) as {
    signature: string;
    publicKey: string;
    algorithm: string;
    kid: string;
  };

  // Envelope shape matches how the publish route writes base_package_signature.
  assert.deepEqual(
    Object.keys(envelope).sort(),
    ['algorithm', 'kid', 'publicKey', 'signature'],
  );
  assert.equal(envelope.algorithm, 'Ed25519ph');
  assert.equal(envelope.kid, 'platform:test-key');

  // THE ASSERTION THAT MATTERS: an independent verify with the known public
  // key accepts the stored signature over the stored package hash.
  assert.equal(
    verifySignature(SAMPLE_HASH, envelope.signature, pubB64),
    true,
    'stored signature did not verify against the public key',
  );
  // ...and rejects a tampered hash, so the check above is not vacuous.
  assert.equal(
    verifySignature(SAMPLE_HASH.replace(/a/g, 'b'), envelope.signature, pubB64),
    false,
  );

  // The kid is queryable without JSON extraction.
  assert.equal(result.columns.signingKeyId, 'platform:test-key');
  assert.ok(result.columns.signedAt instanceof Date);
  assert.equal(result.columns.unsignedReason, null);

  // Blob and row were both written, with the signature columns on the row.
  assert.equal(rec.putCalls.length, 1);
  assert.equal(rec.insertCalls.length, 1);
  assert.equal(rec.insertCalls[0].signature, result.columns.signature);
  assert.equal(rec.insertCalls[0].storageKey, result.storageKey);

  assert.equal(resolveReviewSignatureStatus(result.columns), 'signed_timestamped');
});

// --- 2. A signing failure refuses, and persists NOTHING ------------------

test('SIGNING FAILS: refuses with the named error and persists nothing — no row, no orphaned blob', async () => {
  const rec = makeRecorder({
    signPackage: () => {
      throw new Error('malformed key material: unsupported PKCS#8 body');
    },
  });

  const result = await signAndStoreAttestationPackage(
    { packageHash: SAMPLE_HASH, attestationPkg: SAMPLE_PKG },
    // A key IS configured — this is a misconfiguration, not the unsigned tier.
    { ...rec.ports, env: { EVIDENCE_SIGNING_KEY: 'present', EVIDENCE_KEY_ID: 'platform:k' } },
  );

  assert.equal(result.ok, false, 'a signing failure must not store the review');
  if (result.ok) return;

  assert.equal(result.refusal.status, 500);
  assert.equal(result.refusal.body.code, ATTESTATION_SIGNING_FAILED_CODE);
  assert.equal(result.refusal.body.code, 'attestation_signing_failed');

  // NOTHING WAS PERSISTED. The blob write must not have happened either — the
  // old ordering wrote the blob first, so a refusal would have orphaned one on
  // every attempt. This is the ordering regression guard.
  assert.equal(rec.putCalls.length, 0, 'orphaned blob: putPackage ran before the refusal');
  assert.equal(rec.insertCalls.length, 0, 'a row was inserted despite the refusal');

  // The refusal names what is misconfigured without leaking raw infrastructure
  // detail or key material.
  assert.match(result.refusal.body.error, /signing key/i);
  assert.match(result.refusal.body.error, /docs\/instance-setup\.md/);
  assert.doesNotMatch(result.refusal.body.error, /PKCS#8|malformed key material/);
  // The cause is carried for server-side logging only, never for the response.
  assert.ok(result.cause instanceof Error);
});

test('SIGNING FAILS defensively: a null signature on a key-bearing instance refuses rather than mislabeling', async () => {
  // `signPackage` returning null means "no key" and only that. If it ever
  // returned null WITH a key configured, storing the row would record a
  // misconfiguration as the deliberate unsigned tier.
  const rec = makeRecorder({ signPackage: () => null });

  const result = await signAndStoreAttestationPackage(
    { packageHash: SAMPLE_HASH, attestationPkg: SAMPLE_PKG },
    { ...rec.ports, env: { EVIDENCE_SIGNING_KEY: 'present', EVIDENCE_KEY_ID: 'platform:k' } },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.refusal.body.code, ATTESTATION_SIGNING_FAILED_CODE);
  assert.equal(rec.putCalls.length, 0);
  assert.equal(rec.insertCalls.length, 0);
});

// --- 3. A keyless instance STORES and LABELS (never refuses) -------------

test('KEYLESS: stores the review labeled unsigned instead of refusing', async () => {
  // ADR-0020 §B's intended unsigned tier. This repo's own CI builds keyless
  // and every first-run self-hoster is keyless; refusing here would take the
  // review feature away from all of them for no gain.
  const rec = makeRecorder({ signPackage: () => null });

  const result = await signAndStoreAttestationPackage(
    { packageHash: SAMPLE_HASH, attestationPkg: SAMPLE_PKG },
    { ...rec.ports, env: {} },
  );

  assert.equal(result.ok, true, 'a keyless instance must STORE, not refuse');
  if (!result.ok) return;

  assert.equal(result.columns.signature, null);
  assert.equal(result.columns.signingKeyId, null);
  assert.equal(result.columns.signedAt, null, 'signed_at must not claim a time for an unsigned row');
  assert.equal(result.columns.unsignedReason, REVIEW_UNSIGNED_REASON_NO_KEY);
  assert.equal(result.columns.unsignedReason, 'no_signing_key');

  // The review IS persisted — blob and row both.
  assert.equal(rec.putCalls.length, 1);
  assert.equal(rec.insertCalls.length, 1);

  // ...and it is LABELED, with the reason, distinctly from a pre-backfill row.
  const resolved = resolveReviewSignature(result.columns);
  assert.equal(resolved.status, 'unsigned_no_signing_key');
  assert.equal(resolved.label, 'Unsigned — this instance has no signing key');
  assert.equal(resolved.tier, 'attention', 'the unsigned tier is legitimate, never an alarm');
});

// --- 4. A TSA failure stores as signed-not-timestamped -------------------

test('TSA FAILS: stores as signed-not-timestamped rather than refusing', async () => {
  const { privB64, pubB64 } = generateTestKeyPair();

  for (const [name, tsa] of [
    ['resolves null', async () => null],
    ['rejects', async () => { throw new Error('freetsa.org timed out'); }],
  ] as const) {
    const rec = makeRecorder({ getRfc3161Timestamp: tsa });
    const result = await withSigningEnv(privB64, 'platform:test-key', () =>
      signAndStoreAttestationPackage(
        { packageHash: SAMPLE_HASH, attestationPkg: SAMPLE_PKG },
        rec.ports,
      ),
    );

    assert.equal(result.ok, true, `TSA ${name}: submission must never be refused on a TSA failure`);
    if (!result.ok) return;

    // Signature intact; timestamp absent.
    assert.ok(result.columns.signature, `TSA ${name}: signature missing`);
    assert.equal(result.columns.rfc3161Timestamp, null, `TSA ${name}: expected no timestamp`);
    const envelope = JSON.parse(result.columns.signature!) as { signature: string };
    assert.equal(verifySignature(SAMPLE_HASH, envelope.signature, pubB64), true);

    assert.equal(rec.putCalls.length, 1, `TSA ${name}: review not stored`);
    assert.equal(rec.insertCalls.length, 1, `TSA ${name}: row not inserted`);
    assert.equal(resolveReviewSignatureStatus(result.columns), 'signed_untimestamped');
  }
});

// --- The gate: which instances may store a review -----------------------

test('GATE: a keyless instance passes (the review is stored, labeled) — the deliberate narrowing', () => {
  // `evaluateSealCommitGate` refuses this state with 403 `unsigned_tier`,
  // because an unsigned RECORD may reach neither sealed nor public. Attaching
  // a review seals and publishes nothing — it inherits the record's
  // visibility — so the review path passes it through and labels the row.
  assert.equal(evaluateAttestationSigningGate({}), null);
  assert.equal(evaluateAttestationSigningGate({ NODE_ENV: 'production' }), null);
});

test('GATE: a key with no kid still refuses, naming the misconfiguration', () => {
  const gate = evaluateAttestationSigningGate({ EVIDENCE_SIGNING_KEY: 'present' });
  assert.ok(gate, 'a half-configured instance must be refused');
  assert.equal(gate!.body.code, 'signing_key_id_missing');
  assert.equal(gate!.status, 500);
});

test('GATE: a signing pair with no declared instance identity still refuses', () => {
  const gate = evaluateAttestationSigningGate({
    EVIDENCE_SIGNING_KEY: 'present',
    EVIDENCE_KEY_ID: 'platform:k',
  });
  assert.ok(gate);
  assert.equal(gate!.body.code, 'instance_identity_missing');
});

test('GATE: a fully configured instance passes', () => {
  const identity = Object.fromEntries(
    INSTANCE_IDENTITY_REQUIRED_VARS.map((n) => [n, 'presence-only-stand-in']),
  );
  assert.equal(
    evaluateAttestationSigningGate({
      EVIDENCE_SIGNING_KEY: 'present',
      EVIDENCE_KEY_ID: 'platform:k',
      ...identity,
    }),
    null,
  );
});

// --- The four states, and why two of them must stay distinct ------------

test('STATUS: all four states resolve, and the two unsigned ones are NOT collapsed', () => {
  assert.equal(
    resolveReviewSignatureStatus({ signature: '{}', rfc3161Timestamp: 'tok', unsignedReason: null }),
    'signed_timestamped',
  );
  assert.equal(
    resolveReviewSignatureStatus({ signature: '{}', rfc3161Timestamp: null, unsignedReason: null }),
    'signed_untimestamped',
  );
  // A row written by the current path on a keyless instance.
  assert.equal(
    resolveReviewSignatureStatus({
      signature: null,
      rfc3161Timestamp: null,
      unsignedReason: 'no_signing_key',
    }),
    'unsigned_no_signing_key',
  );
  // A row that predates migration 0016: nothing wrote `unsigned_reason`.
  assert.equal(
    resolveReviewSignatureStatus({ signature: null, rfc3161Timestamp: null, unsignedReason: null }),
    'unsigned_pre_backfill',
  );

  // The distinction is the point: same NULL signature, different fact.
  const preBackfill = resolveReviewSignature({
    signature: null, rfc3161Timestamp: null, unsignedReason: null,
  });
  const noKey = resolveReviewSignature({
    signature: null, rfc3161Timestamp: null, unsignedReason: 'no_signing_key',
  });
  assert.notEqual(preBackfill.label, noKey.label);
  assert.match(noKey.label, /no signing key/);
  assert.match(preBackfill.label, /before reviews were signed/);
});

test('STATUS: an unrecognized unsigned reason is not relabeled "no signing key"', () => {
  // A future reason must arrive with its own copy rather than borrowing a
  // cause the row does not actually claim.
  assert.equal(
    resolveReviewSignatureStatus({
      signature: null,
      rfc3161Timestamp: null,
      unsignedReason: 'some_future_reason',
    }),
    'unsigned_pre_backfill',
  );
});

test('STATUS: every declared status has copy, and no unsigned state reads as an alarm', () => {
  for (const status of REVIEW_SIGNATURE_STATUSES) {
    const signal = REVIEW_SIGNATURE_SIGNALS[status];
    assert.ok(signal, `${status} has no signal`);
    assert.ok(signal.label.length > 0, `${status} has no label`);
    // `detail` is optional on the shared descriptor type; every review-signature
    // signal is required to carry one, so a reader can always find out why.
    assert.ok(signal.detail && signal.detail.length > 0, `${status} has no detail`);
    assert.notEqual(signal.tier, 'alarm', `${status} must not read as an alarm`);
    // No status may describe an unsigned row as signed, or vice versa.
    if (status.startsWith('unsigned_')) {
      assert.match(signal.label, /^Unsigned/, `${status} must say so plainly`);
    } else {
      assert.match(signal.label, /^Signed/, `${status} must say so plainly`);
    }
  }
});

test('REFUSAL: the named error is stable and carries no key material', () => {
  const r = attestationSigningFailedRefusal();
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'attestation_signing_failed');
  // Looks for actual leakage, not for the WORDS — "a valid Ed25519 private
  // key" is operator guidance and belongs in the message. What must never
  // appear is PEM armor or an encoded blob.
  assert.doesNotMatch(r.body.error, /-----BEGIN|MII[A-Za-z0-9+/]{8}/);
  assert.doesNotMatch(r.body.error, /[A-Za-z0-9+/]{40,}={0,2}/, 'looks like encoded key material');
});
