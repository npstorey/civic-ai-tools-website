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
  evaluateSealCommitGate,
  evaluateUnsignedRecordPublishGate,
  shouldShowRunningUnsignedIndicator,
} from './unsigned-tier.ts';

// Deliberately inert stand-in — presence is all the tier logic reads, so the
// fixture never needs to look like key material.
const KEY_PRESENT = 'presence-only-stand-in';

test('isSigningConfigured: presence-only — set means signed tier, unset/empty means unsigned', () => {
  assert.equal(isSigningConfigured({ EVIDENCE_SIGNING_KEY: KEY_PRESENT }), true);
  assert.equal(isSigningConfigured({}), false);
  assert.equal(isSigningConfigured({ EVIDENCE_SIGNING_KEY: undefined }), false);
  assert.equal(isSigningConfigured({ EVIDENCE_SIGNING_KEY: '' }), false);
  assert.equal(isSigningConfigured({ EVIDENCE_SIGNING_KEY: '   ' }), false);
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

test('gate-off: a signed instance passes the gate (the action proceeds)', () => {
  assert.equal(evaluateSealCommitGate({ EVIDENCE_SIGNING_KEY: KEY_PRESENT }), null);
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

test('running-unsigned indicator: never shows when signing is configured', () => {
  assert.equal(
    shouldShowRunningUnsignedIndicator({ EVIDENCE_SIGNING_KEY: KEY_PRESENT, NODE_ENV: 'production' }),
    false,
  );
  assert.equal(
    shouldShowRunningUnsignedIndicator({ EVIDENCE_SIGNING_KEY: KEY_PRESENT, NODE_ENV: 'development' }),
    false,
  );
});
