// Unit tests for the P5 key-trust verification path added to verify.ts.
// Exercises each registry status + rotation edge case documented in the
// trust-registry runbook (docs/key-rotation.md).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyKeyTrust,
  type TrustRegistry,
} from './verify.ts';

const KID = 'platform:evidence-2026-04';
const NEW_KID = 'platform:evidence-2027-04';
const PUB = 'MCowBQYDK2VwAyEA-PLACEHOLDER-ACTIVE-KEY';
const NEW_PUB = 'MCowBQYDK2VwAyEA-PLACEHOLDER-NEW-KEY';
const OTHER_PUB = 'MCowBQYDK2VwAyEA-PLACEHOLDER-OTHER-KEY';

function registryWith(keys: TrustRegistry['keys']): TrustRegistry {
  return { keys };
}

// --- Active keys ---

test('active key: (kid, publicKey) match → verified', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'active',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: null,
      revokedAt: null,
    },
  ]);
  const result = verifyKeyTrust(PUB, KID, undefined, registry);
  assert.equal(result.status, 'active');
  assert.equal(result.verified, true);
  assert.equal(result.kid, KID);
});

test('active key: public key mismatch → unknown_key', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'active',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: null,
      revokedAt: null,
    },
  ]);
  const result = verifyKeyTrust(OTHER_PUB, KID, undefined, registry);
  assert.equal(result.status, 'unknown_key');
  assert.equal(result.verified, false);
});

test('active key: kid mismatch → unknown_key (defense against kid swap)', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'active',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: null,
      revokedAt: null,
    },
  ]);
  // Caller claims the public key was signed with a different kid.
  const result = verifyKeyTrust(PUB, 'platform:different-kid', undefined, registry);
  assert.equal(result.status, 'unknown_key');
  assert.equal(result.verified, false);
});

// --- Revoked keys ---

test('revoked key: never verified, even with matching pair', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'revoked',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: null,
      revokedAt: '2026-05-01T12:00:00.000Z',
    },
  ]);
  // Even a package integrated well before revocation is not trusted — we
  // assume the compromise window is unbounded.
  const earlyIntegratedTime = new Date('2026-04-16T00:00:00.000Z').getTime() / 1000;
  const result = verifyKeyTrust(PUB, KID, earlyIntegratedTime, registry);
  assert.equal(result.status, 'revoked');
  assert.equal(result.verified, false);
  assert.equal(result.revokedAt, '2026-05-01T12:00:00.000Z');
});

// --- Deprecated keys ---

test('deprecated key + integratedTime before deprecatedAt → deprecated_valid', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'deprecated',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: '2027-04-15T00:00:00.000Z',
      revokedAt: null,
    },
  ]);
  const beforeDeprecation = new Date('2027-01-01T00:00:00.000Z').getTime() / 1000;
  const result = verifyKeyTrust(PUB, KID, beforeDeprecation, registry);
  assert.equal(result.status, 'deprecated_valid');
  assert.equal(result.verified, true);
});

test('deprecated key + integratedTime after deprecatedAt → deprecated_invalid', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'deprecated',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: '2027-04-15T00:00:00.000Z',
      revokedAt: null,
    },
  ]);
  const afterDeprecation = new Date('2027-05-01T00:00:00.000Z').getTime() / 1000;
  const result = verifyKeyTrust(PUB, KID, afterDeprecation, registry);
  assert.equal(result.status, 'deprecated_invalid');
  assert.equal(result.verified, false);
});

test('deprecated key + undefined integratedTime → deprecated_invalid (fail closed)', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'deprecated',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: '2027-04-15T00:00:00.000Z',
      revokedAt: null,
    },
  ]);
  // Without a Rekor integratedTime we can't prove the package is pre-
  // deprecation — the secure default is to fail.
  const result = verifyKeyTrust(PUB, KID, undefined, registry);
  assert.equal(result.status, 'deprecated_invalid');
  assert.equal(result.verified, false);
});

test('deprecated key without deprecatedAt timestamp → deprecated_invalid (malformed registry)', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'deprecated',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: null, // malformed — deprecated but no timestamp
      revokedAt: null,
    },
  ]);
  const someTime = new Date('2027-01-01T00:00:00.000Z').getTime() / 1000;
  const result = verifyKeyTrust(PUB, KID, someTime, registry);
  assert.equal(result.status, 'deprecated_invalid');
  assert.equal(result.verified, false);
});

// --- Registry unavailable / multi-key ---

test('registry undefined → registry_unavailable', () => {
  const result = verifyKeyTrust(PUB, KID, undefined, undefined);
  assert.equal(result.status, 'registry_unavailable');
  assert.equal(result.verified, false);
});

test('empty registry → unknown_key', () => {
  const result = verifyKeyTrust(PUB, KID, undefined, registryWith([]));
  assert.equal(result.status, 'unknown_key');
  assert.equal(result.verified, false);
});

test('Rotation scenario: old key deprecated + new key active, both resolve correctly', () => {
  // Mirrors the preventive-rotation state: previous kid marked
  // deprecated, new kid marked active, both present in the registry.
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'deprecated',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: '2027-04-15T00:00:00.000Z',
      revokedAt: null,
    },
    {
      kid: NEW_KID,
      publicKey: NEW_PUB,
      status: 'active',
      activatedAt: '2027-04-15T00:00:00.000Z',
      deprecatedAt: null,
      revokedAt: null,
    },
  ]);

  // Pre-rotation package (old key): verifies if integrated pre-deprecation
  const preRotation = new Date('2027-01-01T00:00:00.000Z').getTime() / 1000;
  const oldResult = verifyKeyTrust(PUB, KID, preRotation, registry);
  assert.equal(oldResult.status, 'deprecated_valid');
  assert.equal(oldResult.verified, true);

  // Post-rotation package (new key): verifies as active
  const newResult = verifyKeyTrust(NEW_PUB, NEW_KID, undefined, registry);
  assert.equal(newResult.status, 'active');
  assert.equal(newResult.verified, true);

  // Attempted forgery: old public key but claiming the new kid
  const forged = verifyKeyTrust(PUB, NEW_KID, undefined, registry);
  assert.equal(forged.status, 'unknown_key');
  assert.equal(forged.verified, false);
});

test('Compromise scenario: revoked key + replacement active key', () => {
  const registry = registryWith([
    {
      kid: KID,
      publicKey: PUB,
      status: 'revoked',
      activatedAt: '2026-04-15T00:00:00.000Z',
      deprecatedAt: null,
      revokedAt: '2026-05-01T12:00:00.000Z',
    },
    {
      kid: NEW_KID,
      publicKey: NEW_PUB,
      status: 'active',
      activatedAt: '2026-05-01T12:00:00.000Z',
      deprecatedAt: null,
      revokedAt: null,
    },
  ]);

  // Package signed with the revoked key — never trusted, even if integrated
  // before the detection time.
  const earlyIntegratedTime = new Date('2026-04-20T00:00:00.000Z').getTime() / 1000;
  const compromised = verifyKeyTrust(PUB, KID, earlyIntegratedTime, registry);
  assert.equal(compromised.status, 'revoked');
  assert.equal(compromised.verified, false);

  // Package signed with the replacement — verified normally.
  const clean = verifyKeyTrust(NEW_PUB, NEW_KID, undefined, registry);
  assert.equal(clean.status, 'active');
  assert.equal(clean.verified, true);
});
