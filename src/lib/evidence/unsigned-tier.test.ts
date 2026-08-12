// Unsigned-tier gate + indicator tests (S3a P3, #166; ADR-0020 Decisions B/C).
//
// NEW file covering NEW behavior: the G0-3 gate-off. The server-side seal/
// commit enforcement is decided by these pure functions; the publish/commit
// routes wire them in front of every persist path (POST /api/evidence and
// POST /api/evidence/[slug]/publish), so "the gate refuses" here IS the
// server-side refusal an unsigned run receives.
//
// All functions take an env-shaped record — no process.env mutation.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSigningConfigured,
  isSigningKeyConfigured,
  isSigningKeyIdConfigured,
  evaluateSealCommitGate,
  evaluateUnsignedRecordPublishGate,
  shouldShowRunningUnsignedIndicator,
  resolveUnsignedIndicator,
} from './unsigned-tier.ts';

// Deliberately inert stand-in — presence is all the tier logic reads, so the
// fixture never needs to look like key material.
const KEY_PRESENT = 'presence-only-stand-in';
const KID_PRESENT = 'platform:this-instance-2026-08';
/** Both halves of the signing pair, the only fully-configured state. */
const SIGNED = { EVIDENCE_SIGNING_KEY: KEY_PRESENT, EVIDENCE_KEY_ID: KID_PRESENT };
/** The defect state: custody without a declared identity. */
const KEY_NO_KID = { EVIDENCE_SIGNING_KEY: KEY_PRESENT };

test('isSigningConfigured: BOTH halves required — a key alone is not configured', () => {
  assert.equal(isSigningConfigured(SIGNED), true);
  // The defect state. A key with no declared kid used to read as configured,
  // which is what let an instance sign under the reference deployment's kid.
  assert.equal(isSigningConfigured(KEY_NO_KID), false);
  // And the mirror image: a kid with no key cannot sign either.
  assert.equal(isSigningConfigured({ EVIDENCE_KEY_ID: KID_PRESENT }), false);
  assert.equal(isSigningConfigured({}), false);
});

test('isSigningConfigured: presence-only, whitespace-only counts as absent on either half', () => {
  assert.equal(isSigningConfigured({ ...SIGNED, EVIDENCE_SIGNING_KEY: '' }), false);
  assert.equal(isSigningConfigured({ ...SIGNED, EVIDENCE_SIGNING_KEY: '   ' }), false);
  assert.equal(isSigningConfigured({ ...SIGNED, EVIDENCE_KEY_ID: '' }), false);
  assert.equal(isSigningConfigured({ ...SIGNED, EVIDENCE_KEY_ID: '   ' }), false);
  assert.equal(isSigningConfigured({ ...SIGNED, EVIDENCE_KEY_ID: undefined }), false);
});

test('the halves are separately observable (the gate and the banner branch on them)', () => {
  assert.equal(isSigningKeyConfigured(KEY_NO_KID), true);
  assert.equal(isSigningKeyIdConfigured(KEY_NO_KID), false);
  assert.equal(isSigningKeyIdConfigured(SIGNED), true);
});

test('gate-off (ADR-0020 C): an unsigned run cannot reach seal/commit — the gate refuses server-side', () => {
  const refusal = evaluateSealCommitGate({});
  assert.ok(refusal, 'unsigned tier must be refused');
  assert.equal(refusal!.status, 403);
  assert.equal(refusal!.body.code, 'unsigned_tier');
  // The refusal explains the tier and the rule (neither sealed nor public),
  // and points at the setup path — an explanatory refusal, not a bare error.
  assert.match(refusal!.body.error, /running unsigned/);
  assert.match(refusal!.body.error, /neither the sealed nor the public state/);
  assert.match(refusal!.body.error, /instance-setup/);
});

test('KEY WITHOUT KID: refused loudly and specifically, not as a generic unsigned tier', () => {
  const refusal = evaluateSealCommitGate(KEY_NO_KID);
  assert.ok(refusal, 'a half-configured instance must not pass the gate');
  // A server misconfiguration, not a policy "you may not" — and a distinct
  // code so the state is diagnosable from the response alone.
  assert.equal(refusal!.status, 500);
  assert.equal(refusal!.body.code, 'signing_key_id_missing');
  // Actionable: names the missing variable and the guide.
  assert.match(refusal!.body.error, /EVIDENCE_KEY_ID/);
  assert.match(refusal!.body.error, /instance-setup/);
  // States the real consequence — misattribution and unverifiable evidence —
  // and explicitly rules out the wrong reading (a leaked signing key).
  assert.match(refusal!.body.error, /misattribution/);
  assert.match(refusal!.body.error, /not a key disclosure/);
  // Platform-neutral: instances run on containers, VMs, and PaaS hosts alike.
  assert.ok(!/vercel|render|heroku|aws/i.test(refusal!.body.error));
  // NOT the generic tier refusal an operator has already moved past.
  assert.notEqual(refusal!.body.code, 'unsigned_tier');
});

test('gate-off: a fully configured instance passes the gate (the action proceeds)', () => {
  assert.equal(evaluateSealCommitGate(SIGNED), null);
});

test('per-record gate: a historical unsigned-persisted record cannot be promoted to published', () => {
  // Even on a signed instance: the BASE PACKAGE has no signature to back a
  // public state (Decision C is a property of the package, not the runtime).
  const refusal = evaluateUnsignedRecordPublishGate(null);
  assert.ok(refusal);
  assert.equal(refusal!.status, 409);
  assert.equal(refusal!.body.code, 'unsigned_package');
  assert.match(refusal!.body.error, /neither the sealed nor the public/);
});

test('per-record gate: a signed record passes', () => {
  const sigJson = JSON.stringify({ signature: 'QQ==', publicKey: 'QQ==', algorithm: 'Ed25519ph' });
  assert.equal(evaluateUnsignedRecordPublishGate(sigJson), null);
});

test('running-unsigned indicator: shows outside dev, calm in dev/test (ADR-0020 §Consequences)', () => {
  // Unsigned + production → indicator shows.
  assert.equal(shouldShowRunningUnsignedIndicator({ NODE_ENV: 'production' }), true);
  // Unknown environment is NOT a dev environment — never silently unsigned.
  assert.equal(shouldShowRunningUnsignedIndicator({}), true);
  // Dev and test stay calm — the unsigned tier is the intended first-run state.
  assert.equal(shouldShowRunningUnsignedIndicator({ NODE_ENV: 'development' }), false);
  assert.equal(shouldShowRunningUnsignedIndicator({ NODE_ENV: 'test' }), false);
});

test('running-unsigned indicator: never shows when BOTH halves are configured', () => {
  assert.equal(shouldShowRunningUnsignedIndicator({ ...SIGNED, NODE_ENV: 'production' }), false);
  assert.equal(shouldShowRunningUnsignedIndicator({ ...SIGNED, NODE_ENV: 'development' }), false);
  assert.equal(resolveUnsignedIndicator({ ...SIGNED, NODE_ENV: 'production' }), null);
});

test('indicator reason: the two states get different copy', () => {
  assert.equal(resolveUnsignedIndicator({ NODE_ENV: 'production' }), 'no_signing_key');
  assert.equal(resolveUnsignedIndicator({ ...KEY_NO_KID, NODE_ENV: 'production' }), 'no_key_id');
});

test('KEY WITHOUT KID: the indicator shows even in dev — it is not an intended state anywhere', () => {
  // The dev-calm rule exists because the unsigned tier is the intended
  // first-run dev state. A half-configured pair is intended nowhere, and dev
  // is exactly where an operator wiring signing up should catch it.
  for (const NODE_ENV of ['development', 'test', 'production', undefined]) {
    assert.equal(
      resolveUnsignedIndicator({ ...KEY_NO_KID, NODE_ENV }),
      'no_key_id',
      `half-configured must surface under NODE_ENV=${NODE_ENV}`,
    );
  }
});
