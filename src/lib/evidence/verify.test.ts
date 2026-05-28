// Unit tests for the P5 key-trust verification path added to verify.ts.
// Exercises each registry status + rotation edge case documented in the
// trust-registry runbook (docs/key-rotation.md).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  verifyKeyTrust,
  loadTrustRegistry,
  clearTrustRegistryCache,
  legacyEmbeddedKeyTrust,
  verifyPackageBlobRefs,
  resolvePackageType,
  checkSignerIdentity,
  checkCaptureMethodVocab,
  type TrustRegistry,
} from './verify.ts';
import type { BlobRef } from './blob-ref.ts';

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

// --- loadTrustRegistry: filesystem read path (Bug 1 fix) ---
//
// Vercel preview deployments put an HTML auth wall in front of
// `/.well-known/*` URLs, so the loader must read the registry from disk
// instead of fetching HTTP. These tests exercise that path against the
// real file checked into `public/.well-known/evidence-public-keys.json`.

test('loadTrustRegistry reads the checked-in registry from disk', async () => {
  clearTrustRegistryCache();
  // Point the HTTP URL at a guaranteed-invalid host; the loader should
  // still succeed because the filesystem path is tried first.
  const registry = await loadTrustRegistry('http://127.0.0.1:1/invalid');
  assert.ok(registry, 'loadTrustRegistry returned undefined even though the on-disk registry exists');
  assert.ok(registry!.keys.length > 0);
  const activeKey = registry!.keys.find((k) => k.status === 'active');
  assert.ok(activeKey, 'registry should have at least one active key');
  assert.ok(activeKey!.kid.startsWith('platform:'));
  assert.ok(activeKey!.publicKey && !activeKey!.publicKey.includes('REPLACE_WITH'));
});

test('loadTrustRegistry caches the disk read across calls', async () => {
  clearTrustRegistryCache();
  const a = await loadTrustRegistry('http://127.0.0.1:1/invalid');
  const b = await loadTrustRegistry('http://127.0.0.1:1/invalid');
  // Same reference → served from cache, not re-read.
  assert.strictEqual(a, b);
});

// --- Legacy embedded keys (pre-#66 packages) ---
//
// Packages signed before the trust registry shipped don't carry a `kid`
// alongside the signature. The signature itself still verifies
// mathematically against the embedded public key, so we surface a distinct
// `legacy_embedded` status rather than treating these as unsigned or
// registry-failed. The UI renders it as neutral (➖) so existing artifacts
// aren't visually penalised.

test('legacyEmbeddedKeyTrust: pre-registry signatures get a neutral verdict', () => {
  const result = legacyEmbeddedKeyTrust();
  assert.equal(result.status, 'legacy_embedded');
  assert.equal(result.verified, false);
  assert.equal(result.kid, undefined);
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

// --- verifyPackageBlobRefs (Phase B.6 / website#75) ---
//
// The content-integrity check that follows blob references embedded in the
// package JSON and confirms the bytes hash back to the advertised ref.

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeBlobRef(content: string, url = 'https://example/test'): BlobRef {
  return {
    ref: `blob:sha256:${sha256Hex(content)}`,
    url,
    contentType: 'text/plain',
    size: content.length,
  };
}

function withStubbedFetch<T>(
  stub: (url: string) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) =>
    stub(typeof input === 'string' ? input : input.toString())) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('verifyPackageBlobRefs: package with no refs → empty result', async () => {
  const pkg = {
    output: 'inline string',
    trace: { resourceSpans: [] },
    skillMetadata: { skillText: 'inline skill' },
  };
  const refs = await verifyPackageBlobRefs(pkg);
  assert.deepEqual(refs, []);
});

test('verifyPackageBlobRefs: output as BlobRef → single verified result', async () => {
  const content = 'synthesised output';
  const ref = makeBlobRef(content);
  const pkg = { output: ref };

  await withStubbedFetch(
    async () => new Response(content, { status: 200 }),
    async () => {
      const refs = await verifyPackageBlobRefs(pkg);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].field, 'output');
      assert.equal(refs[0].ok, true);
      assert.equal(refs[0].ref, ref.ref);
    },
  );
});

test('verifyPackageBlobRefs: trace + skillText refs both verified', async () => {
  const traceBytes = '{"resourceSpans":[]}';
  const skillBytes = '# skill text\n';
  const traceRef = makeBlobRef(traceBytes, 'https://example/trace');
  const skillRef = makeBlobRef(skillBytes, 'https://example/skill');

  const pkg = {
    output: 'inline',
    trace: traceRef,
    skillMetadata: { skillText: skillRef },
  };

  await withStubbedFetch(
    async (url) => {
      if (url.includes('/trace')) return new Response(traceBytes, { status: 200 });
      if (url.includes('/skill')) return new Response(skillBytes, { status: 200 });
      return new Response('', { status: 404 });
    },
    async () => {
      const refs = await verifyPackageBlobRefs(pkg);
      assert.equal(refs.length, 2);
      const traceResult = refs.find((r) => r.field === 'trace');
      const skillResult = refs.find((r) => r.field === 'skillMetadata.skillText');
      assert.ok(traceResult);
      assert.ok(skillResult);
      assert.equal(traceResult!.ok, true);
      assert.equal(skillResult!.ok, true);
    },
  );
});

test('verifyPackageBlobRefs: tampered content → hash_mismatch reported', async () => {
  const ref = makeBlobRef('original');
  const pkg = { output: ref };

  await withStubbedFetch(
    // Server returns different bytes than the ref commits to
    async () => new Response('tampered', { status: 200 }),
    async () => {
      const refs = await verifyPackageBlobRefs(pkg);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].ok, false);
      // "tampered" has 8 bytes, ref.size commits to 8 ("original" is 8).
      // So size check passes; hash mismatch is the failure mode.
      assert.equal(refs[0].reason, 'hash_mismatch');
    },
  );
});

test('verifyPackageBlobRefs: missing blob → fetch_failed reported', async () => {
  const ref = makeBlobRef('anything');
  const pkg = { output: ref };

  await withStubbedFetch(
    async () => new Response('', { status: 404 }),
    async () => {
      const refs = await verifyPackageBlobRefs(pkg);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].ok, false);
      assert.equal(refs[0].reason, 'fetch_failed');
    },
  );
});

test('verifyPackageBlobRefs: ignores non-BlobRef objects in the field paths', async () => {
  // `output` is a string (not a BlobRef), `trace` is a normal object, and
  // `skillMetadata.skillText` is a string. None should be picked up as a
  // reference, so no fetch should be attempted (the test would fail with a
  // real network error if it were).
  const pkg = {
    output: 'hello',
    trace: { resourceSpans: [] },
    skillMetadata: { skillText: 'plain text' },
  };
  const refs = await verifyPackageBlobRefs(pkg);
  assert.deepEqual(refs, []);
});

// --- PR1: check #12 — type resolution ---

test('resolvePackageType: known content type → ok', () => {
  assert.deepEqual(resolvePackageType({ type: 'content/analysis/v1' }), {
    status: 'ok',
    type: 'content/analysis/v1',
  });
});

test('resolvePackageType: known attestation sub-type → ok', () => {
  assert.deepEqual(resolvePackageType({ type: 'attestation/withdraws/v1' }), {
    status: 'ok',
    type: 'attestation/withdraws/v1',
  });
});

test('resolvePackageType: absent → implicit content/analysis/v1 (pre-v0.1)', () => {
  assert.deepEqual(resolvePackageType({}), {
    status: 'implicit',
    type: 'content/analysis/v1',
  });
});

test('resolvePackageType: unrecognized URI → unknown_type (non-fatal)', () => {
  assert.deepEqual(resolvePackageType({ type: 'content/madeup/v9' }), {
    status: 'unknown_type',
    type: 'content/madeup/v9',
  });
});

// --- PR1: check #14 — signer.identifier ↔ registry signerIdentity ---

const SIGNER_REGISTRY: TrustRegistry = registryWith([
  {
    kid: KID,
    publicKey: PUB,
    status: 'active',
    activatedAt: '2026-04-15T00:00:00.000Z',
    deprecatedAt: null,
    revokedAt: null,
    signerIdentity: {
      bindingTier: 'platform',
      identifier: 'platform:civic-ai-tools',
      displayName: 'Civic AI Tools Platform',
    },
  },
]);

test('checkSignerIdentity: matching identifier → ok', () => {
  const pkg = { signer: { bindingTier: 'platform', identifier: 'platform:civic-ai-tools', displayName: 'Civic AI Tools Platform' } };
  assert.deepEqual(checkSignerIdentity(pkg, KID, SIGNER_REGISTRY), {
    status: 'ok',
    claimed: 'platform:civic-ai-tools',
    registered: 'platform:civic-ai-tools',
  });
});

test('checkSignerIdentity: mismatched identifier → signer_identity_mismatch (fatal)', () => {
  const pkg = { signer: { bindingTier: 'platform', identifier: 'platform:impostor', displayName: 'x' } };
  const result = checkSignerIdentity(pkg, KID, SIGNER_REGISTRY);
  assert.equal(result.status, 'signer_identity_mismatch');
  assert.equal(result.claimed, 'platform:impostor');
  assert.equal(result.registered, 'platform:civic-ai-tools');
});

test('checkSignerIdentity: no envelope signer (pre-v0.1) → no_signer, skip', () => {
  assert.deepEqual(checkSignerIdentity({}, KID, SIGNER_REGISTRY), { status: 'no_signer' });
});

test('checkSignerIdentity: registry entry without signerIdentity → no_registry_identity', () => {
  const legacyRegistry = registryWith([
    { kid: KID, publicKey: PUB, status: 'active', activatedAt: '2026-04-15T00:00:00.000Z', deprecatedAt: null, revokedAt: null },
  ]);
  const pkg = { signer: { bindingTier: 'platform', identifier: 'platform:civic-ai-tools', displayName: 'x' } };
  assert.deepEqual(checkSignerIdentity(pkg, KID, legacyRegistry), {
    status: 'no_registry_identity',
    claimed: 'platform:civic-ai-tools',
  });
});

// --- PR1: check #15 — captureMethod per-profile vocabulary ---

test('checkCaptureMethodVocab: value in vocab → ok', () => {
  const pkg = {
    metadata: { captureMethod: 'chat-flow-stream' },
    producerProfile: 'ai-assisted-analysis/datHere',
  };
  const r = checkCaptureMethodVocab(pkg);
  assert.equal(r.status, 'ok');
  assert.equal(r.profileType, 'ai-assisted-analysis');
});

test('checkCaptureMethodVocab: value not in vocab → captureMethod_unknown (rejects)', () => {
  const pkg = { metadata: { captureMethod: 'totally-bogus' }, producerProfile: 'ai-assisted-analysis/datHere' };
  assert.equal(checkCaptureMethodVocab(pkg).status, 'captureMethod_unknown');
});

test('checkCaptureMethodVocab: null captureMethod (pre-v0.1) → no_capture_method (neutral)', () => {
  assert.equal(checkCaptureMethodVocab({ metadata: {} }).status, 'no_capture_method');
});

test('checkCaptureMethodVocab: unresolvable profile bundle → producerProfile_bundle_unresolved (degrade)', () => {
  const pkg = { metadata: { captureMethod: 'chat-flow-stream' }, producerProfile: 'human/expert-review' };
  const r = checkCaptureMethodVocab(pkg);
  assert.equal(r.status, 'producerProfile_bundle_unresolved');
  assert.equal(r.profileType, 'human');
});

test('checkCaptureMethodVocab: resolves via contentProfile legacy alias when producerProfile absent', () => {
  const pkg = { metadata: { captureMethod: 'claude-code-jsonl-readback', contentProfile: 'datHere' } };
  assert.equal(checkCaptureMethodVocab(pkg).status, 'ok');
});

test('checkCaptureMethodVocab: pre-v0.1 (no producerProfile/contentProfile) resolves to ai-assisted-analysis', () => {
  const pkg = { metadata: { captureMethod: 'chat-flow-stream' } };
  const r = checkCaptureMethodVocab(pkg);
  assert.equal(r.status, 'ok');
  assert.equal(r.profileType, 'ai-assisted-analysis');
});
