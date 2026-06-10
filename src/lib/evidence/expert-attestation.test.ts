// Regression tests for the `expert_attestation` validation + payload
// helpers used by the attestations API route (issue #53). These cover
// input-validation edge cases that the route handler relies on, plus the
// canonical payload shape that gets hashed + signed. If the shape drifts,
// the signed hash of the attestation package will also drift, which would
// silently break any external verifier that pinned a prior serialization.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  validateExpertAttestation,
  buildExpertAttestationPayload,
  EXPERT_RATINGS,
  EXPERT_BODY_MAX_CHARS,
  EXPERT_EXPERTISE_MAX_CHARS,
} from './expert-attestation.ts';
import { signPackage } from './signing.ts';
import { verifySignature } from './verify.ts';

const SAMPLE_ATTESTER = {
  dbUserId: '11111111-2222-3333-4444-555555555555',
  githubId: 'gh-123',
  displayName: 'Ava Attester',
  githubProfileUrl: 'https://github.com/ava-attester',
};

const MIN_VALID_INPUT = { body: 'Solid analysis.', expertise: 'Demographer', rating: 'endorse' as const };

// ---- validateExpertAttestation ----

test('validateExpertAttestation accepts a minimal valid payload', () => {
  const result = validateExpertAttestation(MIN_VALID_INPUT);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.body, 'Solid analysis.');
    assert.equal(result.value.expertise, 'Demographer');
    assert.equal(result.value.rating, 'endorse');
  }
});

test('validateExpertAttestation trims body and expertise', () => {
  const result = validateExpertAttestation({
    body: '  Some review.  \n',
    expertise: '  NYU Furman Center  ',
    rating: 'concerns',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.body, 'Some review.');
    assert.equal(result.value.expertise, 'NYU Furman Center');
  }
});

test('validateExpertAttestation rejects non-object data', () => {
  assert.equal(validateExpertAttestation(null).ok, false);
  assert.equal(validateExpertAttestation('string').ok, false);
  assert.equal(validateExpertAttestation(42).ok, false);
  assert.equal(validateExpertAttestation(undefined).ok, false);
});

test('validateExpertAttestation rejects empty body', () => {
  const r = validateExpertAttestation({ ...MIN_VALID_INPUT, body: '' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /body is required/);
});

test('validateExpertAttestation rejects whitespace-only body', () => {
  const r = validateExpertAttestation({ ...MIN_VALID_INPUT, body: '   \n\t ' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /body is required/);
});

test('validateExpertAttestation rejects body exceeding the max', () => {
  const huge = 'a'.repeat(EXPERT_BODY_MAX_CHARS + 1);
  const r = validateExpertAttestation({ ...MIN_VALID_INPUT, body: huge });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /body exceeds/);
});

test('validateExpertAttestation accepts body exactly at the max', () => {
  const maxBody = 'a'.repeat(EXPERT_BODY_MAX_CHARS);
  const r = validateExpertAttestation({ ...MIN_VALID_INPUT, body: maxBody });
  assert.equal(r.ok, true);
});

test('validateExpertAttestation rejects empty expertise', () => {
  const r = validateExpertAttestation({ ...MIN_VALID_INPUT, expertise: '' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /expertise is required/);
});

test('validateExpertAttestation rejects expertise exceeding the max', () => {
  const huge = 'x'.repeat(EXPERT_EXPERTISE_MAX_CHARS + 1);
  const r = validateExpertAttestation({ ...MIN_VALID_INPUT, expertise: huge });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /expertise exceeds/);
});

test('validateExpertAttestation rejects an unknown rating', () => {
  const r = validateExpertAttestation({ ...MIN_VALID_INPUT, rating: 'love_it' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /rating must be one of/);
});

test('validateExpertAttestation rejects a missing rating', () => {
  const r = validateExpertAttestation({ body: 'x', expertise: 'y' });
  assert.equal(r.ok, false);
});

test('validateExpertAttestation accepts every allowed rating', () => {
  for (const rating of EXPERT_RATINGS) {
    const r = validateExpertAttestation({ ...MIN_VALID_INPUT, rating });
    assert.equal(r.ok, true, `rating=${rating} should be accepted`);
  }
});

// ---- buildExpertAttestationPayload ----

test('buildExpertAttestationPayload snapshots attester identity and input', () => {
  const pkg = buildExpertAttestationPayload(
    { body: 'Solid.', expertise: 'Demographer', rating: 'endorse' },
    SAMPLE_ATTESTER,
    'abc123' + '0'.repeat(58),
    '2026-04-18T12:00:00.000Z',
  );
  assert.equal(pkg.schemaVersion, '0.1.0');
  assert.equal(pkg.type, 'expert_attestation');
  assert.equal(pkg.evidenceBaseHash, 'abc123' + '0'.repeat(58));
  assert.equal(pkg.createdAt, '2026-04-18T12:00:00.000Z');
  assert.equal(pkg.attesterUserId, SAMPLE_ATTESTER.dbUserId);
  assert.equal(pkg.attesterGithubId, SAMPLE_ATTESTER.githubId);
  assert.equal(pkg.attesterDisplayName, SAMPLE_ATTESTER.displayName);
  assert.equal(pkg.attesterGithubProfileUrl, SAMPLE_ATTESTER.githubProfileUrl);
  assert.equal(pkg.body, 'Solid.');
  assert.equal(pkg.expertise, 'Demographer');
  assert.equal(pkg.rating, 'endorse');
});

test('buildExpertAttestationPayload is deterministic for identical inputs', () => {
  // JSON.stringify over the same key ordering produces the same bytes,
  // which is what the route handler hashes with SHA-256. If a future
  // refactor re-orders fields, downstream hash matches will drift.
  const args = [
    { body: 'x', expertise: 'y', rating: 'neutral' as const },
    SAMPLE_ATTESTER,
    'deadbeef' + '0'.repeat(56),
    '2026-04-18T12:00:00.000Z',
  ] as const;
  const pkg1 = buildExpertAttestationPayload(...args);
  const pkg2 = buildExpertAttestationPayload(...args);
  assert.equal(JSON.stringify(pkg1), JSON.stringify(pkg2));
});

test('buildExpertAttestationPayload preserves a null evidenceBaseHash', () => {
  const pkg = buildExpertAttestationPayload(
    MIN_VALID_INPUT,
    SAMPLE_ATTESTER,
    null,
    '2026-04-18T12:00:00.000Z',
  );
  assert.equal(pkg.evidenceBaseHash, null);
});

// ---- Sign + verify round-trip ----

test('expert attestation payload signs + verifies via the platform helpers', () => {
  // Generate an ephemeral keypair and use it as the signing key to prove
  // the canonical payload shape is signable/verifiable the same way as the
  // base package flow.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const origKey = process.env.EVIDENCE_SIGNING_KEY;
  const origKid = process.env.EVIDENCE_KEY_ID;
  process.env.EVIDENCE_SIGNING_KEY = privB64;
  process.env.EVIDENCE_KEY_ID = 'platform:expert-test';
  try {
    const pkg = buildExpertAttestationPayload(
      MIN_VALID_INPUT,
      SAMPLE_ATTESTER,
      'c'.repeat(64),
      '2026-04-18T12:00:00.000Z',
    );
    const canonical = JSON.stringify(pkg);
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');
    const result = signPackage(hash);
    assert.ok(result);
    assert.equal(result!.kid, 'platform:expert-test');
    // Independent verify with the known public key — matches what the
    // verify route does for base packages.
    assert.equal(verifySignature(hash, result!.signature, pubB64), true);
    // Drift check: a tampered body produces a different hash that the
    // original signature should NOT verify against.
    const tampered = { ...pkg, body: 'Tampered.' };
    const tamperedHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(tampered))
      .digest('hex');
    assert.notEqual(tamperedHash, hash);
    assert.equal(verifySignature(tamperedHash, result!.signature, pubB64), false);
  } finally {
    if (origKey === undefined) delete process.env.EVIDENCE_SIGNING_KEY;
    else process.env.EVIDENCE_SIGNING_KEY = origKey;
    if (origKid === undefined) delete process.env.EVIDENCE_KEY_ID;
    else process.env.EVIDENCE_KEY_ID = origKid;
  }
});
