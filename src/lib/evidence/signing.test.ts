// Regression tests for the signing path.
//
// Covers the Ed25519 → Ed25519ph switch (required by Rekor's hashedrekord
// verifier since 2024-03) and the sign/verify round-trip. If these break,
// the `/evidence/[slug]` verification UI will silently mark a real signature
// as invalid, and Rekor will reject the submission with
// `failed to verify signature`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  signPackage,
  getActiveKeyId,
  getConfiguredKeyId,
  rekorHashForPackage,
} from './signing.ts';
import { verifySignature } from './verify.ts';

function generateTestKeyEnv(): { privB64: string; pubB64: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { privB64, pubB64 };
}

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

const SAMPLE_HASH = 'acdb56712cc0e735589e39d485dcd2c3d34a611b6752ab2f8b703e13008a3004';

test('signPackage returns an Ed25519ph SignResult with kid, DER public key, 64-byte signature', () => {
  const { privB64 } = generateTestKeyEnv();
  const result = withSigningEnv(privB64, 'platform:test-key', () => signPackage(SAMPLE_HASH));
  assert.ok(result, 'signPackage returned null');
  assert.equal(result!.algorithm, 'Ed25519ph');
  assert.equal(result!.kid, 'platform:test-key');
  assert.ok(result!.signature, 'signature missing');
  assert.ok(result!.publicKey, 'publicKey missing');
  // Ed25519 signatures are always 64 bytes
  assert.equal(Buffer.from(result!.signature, 'base64').length, 64);
});

test('signPackage returns null when EVIDENCE_SIGNING_KEY is not set', () => {
  const orig = process.env.EVIDENCE_SIGNING_KEY;
  delete process.env.EVIDENCE_SIGNING_KEY;
  try {
    assert.equal(signPackage(SAMPLE_HASH), null);
  } finally {
    if (orig !== undefined) process.env.EVIDENCE_SIGNING_KEY = orig;
  }
});

test('Round-trip: verifySignature accepts a signature produced by signPackage', () => {
  const { privB64 } = generateTestKeyEnv();
  const result = withSigningEnv(privB64, 'platform:test-key', () => signPackage(SAMPLE_HASH));
  assert.ok(result);
  const verified = verifySignature(SAMPLE_HASH, result!.signature, result!.publicKey);
  assert.equal(verified, true, 'sign/verify round-trip failed — Ed25519ph mismatch?');
});

test('verifySignature rejects a tampered package hash', () => {
  const { privB64 } = generateTestKeyEnv();
  const result = withSigningEnv(privB64, 'platform:test-key', () => signPackage(SAMPLE_HASH));
  assert.ok(result);
  const tamperedHash = SAMPLE_HASH.replace(/a/g, 'b');
  assert.equal(verifySignature(tamperedHash, result!.signature, result!.publicKey), false);
});

test('verifySignature rejects a signature produced by a different key', () => {
  const { privB64: privA } = generateTestKeyEnv();
  const { pubB64: pubB } = generateTestKeyEnv();
  const result = withSigningEnv(privA, 'platform:test-key', () => signPackage(SAMPLE_HASH));
  assert.ok(result);
  // swap the verifying public key for a different one
  assert.equal(verifySignature(SAMPLE_HASH, result!.signature, pubB), false);
});

test('verifySignature rejects a malformed signature', () => {
  const { pubB64 } = generateTestKeyEnv();
  // 'AAAA' decodes to 3 zero bytes — nowhere near the 64 an Ed25519 sig has
  assert.equal(verifySignature(SAMPLE_HASH, 'AAAA', pubB64), false);
});

/** Run `fn` with EVIDENCE_KEY_ID set (or deleted), restoring after. */
function withKeyId<T>(kid: string | undefined, fn: () => T): T {
  const orig = process.env.EVIDENCE_KEY_ID;
  if (kid === undefined) delete process.env.EVIDENCE_KEY_ID;
  else process.env.EVIDENCE_KEY_ID = kid;
  try {
    return fn();
  } finally {
    if (orig === undefined) delete process.env.EVIDENCE_KEY_ID;
    else process.env.EVIDENCE_KEY_ID = orig;
  }
}

test('getActiveKeyId returns the configured EVIDENCE_KEY_ID verbatim', () => {
  withKeyId('platform:custom-kid', () => {
    assert.equal(getActiveKeyId(), 'platform:custom-kid');
  });
});

test('NO FALLBACK KID: getActiveKeyId throws when EVIDENCE_KEY_ID is unset', () => {
  // The defect this pins: a coded default used to substitute the reference
  // deployment's kid here, so an instance with a key but no kid signed its
  // own packages under someone else's registry entry — unverifiable evidence
  // carrying another party's identity. There is no default to fall back to.
  withKeyId(undefined, () => {
    assert.throws(
      () => getActiveKeyId(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        // Actionable: names the variable and the guide, and is explicit that
        // the private key is not what is at stake here.
        assert.match(err.message, /EVIDENCE_KEY_ID/);
        assert.match(err.message, /instance-setup/);
        assert.match(err.message, /misattributes/);
        // Platform-neutral: instances run on containers, VMs, and PaaS hosts.
        assert.ok(!/vercel|render|heroku|aws/i.test(err.message));
        return true;
      },
    );
  });
});

test('NO FALLBACK KID: a whitespace-only EVIDENCE_KEY_ID is not a key id', () => {
  withKeyId('   ', () => {
    assert.equal(getConfiguredKeyId(), null);
    assert.throws(() => getActiveKeyId(), /EVIDENCE_KEY_ID/);
  });
});

test('getConfiguredKeyId is the non-throwing probe: value when set, null when not', () => {
  withKeyId('platform:custom-kid', () => {
    assert.equal(getConfiguredKeyId(), 'platform:custom-kid');
  });
  withKeyId(undefined, () => {
    assert.equal(getConfiguredKeyId(), null);
  });
});

test('getConfiguredKeyId never normalizes the value it returns', () => {
  // A configured kid lands in a signed field; silently rewriting it would be
  // its own defect. Presence is trimmed, the returned string is not.
  withKeyId(' platform:padded ', () => {
    assert.equal(getConfiguredKeyId(), ' platform:padded ');
    assert.equal(getActiveKeyId(), ' platform:padded ');
  });
});

test('KEY WITHOUT KID: signPackage refuses rather than signing under a substituted kid', () => {
  const { privB64 } = generateTestKeyEnv();
  assert.throws(
    () => withSigningEnv(privB64, undefined, () => signPackage(SAMPLE_HASH)),
    /EVIDENCE_KEY_ID/,
  );
});

test('rekorHashForPackage: SHA-512 of UTF-8 of hex package hash', () => {
  // The value Rekor stores in spec.data.hash.value for a signed package
  // is SHA-512 over the UTF-8 bytes of the hex SHA-256 hash — matching
  // what signPackage signs via Ed25519ph's internal prehash. This
  // invariant is what verifyRekorEntry compares against; any drift between
  // sign-time and verify-time derivation silently breaks Rekor
  // verification in the UI.
  const packageHash = 'acdb56712cc0e735589e39d485dcd2c3d34a611b6752ab2f8b703e13008a3004';
  const expected = crypto
    .createHash('sha512')
    .update(Buffer.from(packageHash, 'utf-8'))
    .digest('hex');
  assert.equal(rekorHashForPackage(packageHash), expected);
  // SHA-512 hex is always 128 characters
  assert.equal(rekorHashForPackage(packageHash).length, 128);
});

test('Cross-check: signature verifies as Ed25519ph (prehashed with SHA-512)', async () => {
  // Independent verification via @noble/curves directly. Catches the case
  // where signPackage accidentally switches back to pure Ed25519 — a pure
  // Ed25519 signature would NOT verify as Ed25519ph, and Rekor would reject
  // it in production.
  const { privB64 } = generateTestKeyEnv();
  const result = withSigningEnv(privB64, 'platform:test-key', () => signPackage(SAMPLE_HASH));
  assert.ok(result);

  const { ed25519ph } = await import('@noble/curves/ed25519.js');
  const pubKeyObj = crypto.createPublicKey({
    key: Buffer.from(result!.publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const pubBytes = Uint8Array.from(Buffer.from(pubKeyObj.export({ format: 'jwk' }).x as string, 'base64url'));
  const sigBytes = Uint8Array.from(Buffer.from(result!.signature, 'base64'));
  const messageBytes = Uint8Array.from(Buffer.from(SAMPLE_HASH, 'utf-8'));

  assert.equal(ed25519ph.verify(sigBytes, messageBytes, pubBytes), true);
});
