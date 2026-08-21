// Unit tests for the P5 key-trust verification path added to verify.ts.
// Exercises each registry status + rotation edge case documented in the
// trust-registry runbook (docs/key-rotation.md).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import canonicalize from 'canonicalize';
import {
  verifySignature,
  verifyKeyTrust,
  loadTrustRegistry,
  clearTrustRegistryCache,
  legacyEmbeddedKeyTrust,
  verifyPackageBlobRefs,
  resolvePackageType,
  checkSignerIdentity,
  checkCaptureMethodVocab,
  recomputePackageHash,
  resolveContentCanonicalization,
  verifyContentHash,
  verifyAttestationNode,
  resolveLifecycleFromChain,
  resolveLifecycleFromLegacyColumns,
  type TrustRegistry,
  type LifecycleAttestationView,
} from './verify.ts';
import {
  LEGACY_JSON_CANONICALIZATION,
  DATHERE_AG_JUPYTER_CANONICALIZATION,
} from './canonicalization.ts';
import {
  buildAttestationNode,
  ATTESTATION_WITHDRAWS,
  ATTESTATION_REINSTATES,
} from './attestation.ts';
import type { BlobRef } from './blob-ref.ts';
import { ed25519, ed25519ph } from '@noble/curves/ed25519.js';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// The attestation-node cases below build envelopes, which carry
// `metadata.signingKeyId`; there is no coded default for it (signing.ts), so
// this suite declares one. `node --test` runs each file in its own process.
process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';

// #258: packages built via buildEvidencePackage below also require a
// declared instance identity (no coded defaults remain). Injected from the
// reference fixture so the verify-side assertions keep exercising the
// historical package shape.
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

// Registry fixtures below — the kid strings a verifier LOOKS UP, unrelated to
// what this process would emit.
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

// --- loadTrustRegistry: resolves solely from the embedded JSON import ---
//
// civic-ai-tools#155 P1b: `loadTrustRegistry` used to be a three-step
// resolution chain (build-time bundled JSON → on-disk read → HTTP fetch),
// with the last two steps fed by an optional `PUBLISHER_TRUST_REGISTRY_URL`
// / `EVIDENCE_TRUST_REGISTRY_URL` override. civic-ai-tools#155 P1 measured
// that steps 2-3 were dead code on every real call path — the embedded
// import always resolves first, and neither production caller ever passed a
// `url`. The owner ruled to retire the override rather than repair it, so
// P1b deleted `getTrustRegistryUrl`, the on-disk read, and the HTTP fetch
// outright. `loadTrustRegistry` now takes NO arguments (the `url` parameter
// is gone along with what it fed) and resolves only from the build-time
// embedded registry. The tests below replace the old three (two "resolves
// without reaching the network" tests plus the "B1" override-unreachability
// test) — there is no longer a disk/network step or an override to prove
// unreachable, so those tests' premises no longer apply. What's still worth
// pinning: the loader returns valid registry data, and it caches across
// calls.

test('loadTrustRegistry resolves the checked-in registry from the embedded JSON', async () => {
  clearTrustRegistryCache();
  const registry = await loadTrustRegistry();
  assert.ok(registry, 'loadTrustRegistry returned undefined even though the embedded registry exists');
  assert.ok(registry!.keys.length > 0);
  const activeKey = registry!.keys.find((k) => k.status === 'active');
  assert.ok(activeKey, 'registry should have at least one active key');
  assert.ok(activeKey!.kid.startsWith('platform:'));
  assert.ok(activeKey!.publicKey && !activeKey!.publicKey.includes('REPLACE_WITH'));
});

test('loadTrustRegistry caches the resolved registry across calls', async () => {
  clearTrustRegistryCache();
  const a = await loadTrustRegistry();
  const b = await loadTrustRegistry();
  // Same reference → served from cache, not re-resolved.
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

// --- Signature algorithm dispatch (the Ed25519 -> Ed25519ph migration fix) ---
//
// Pre-switch legacy packages (e.g. the withdrawn da9246 package surfaced in the
// #111 calm-baseline review) carry PLAIN Ed25519 signatures labeled
// `algorithm: 'Ed25519'`. verifySignature must verify each signature under the
// scheme it was actually created with: checking a valid plain-Ed25519 signature
// with Ed25519ph is the false negative that made a genuinely-valid legacy
// package show a red "signature does not verify". Dispatching on the stored
// label fixes it without weakening anything — a forgery still fails under both.
test('verifySignature: dispatches on the algorithm label (Ed25519 vs Ed25519ph)', () => {
  const hash = 'da9246cd974b0fafb1d16190e80903727133d67127febab8c16ec28a67fcaf7f';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const jwk = privateKey.export({ format: 'jwk' });
  const rawPriv = Uint8Array.from(Buffer.from(jwk.d as string, 'base64url'));
  const msg = Buffer.from(hash, 'utf-8');

  // Plain Ed25519 (the legacy scheme): verifies ONLY when labeled 'Ed25519'.
  const plainSig = Buffer.from(ed25519.sign(msg, rawPriv)).toString('base64');
  assert.equal(verifySignature(hash, plainSig, pubB64, 'Ed25519'), true);
  // The bug being fixed: the same valid signature, checked with the ph default.
  assert.equal(verifySignature(hash, plainSig, pubB64), false);

  // Ed25519ph (the modern scheme): verifies under the explicit label AND the
  // no-label default (Ed25519ph), so modern packages are unaffected.
  const phSig = Buffer.from(ed25519ph.sign(msg, rawPriv)).toString('base64');
  assert.equal(verifySignature(hash, phSig, pubB64, 'Ed25519ph'), true);
  assert.equal(verifySignature(hash, phSig, pubB64), true);

  // Cross-scheme never passes regardless of label — the label only selects the
  // verifier; the signature math must still hold.
  assert.equal(verifySignature(hash, phSig, pubB64, 'Ed25519'), false);
  assert.equal(verifySignature(hash, plainSig, pubB64, 'Ed25519ph'), false);
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

// --- PR2: recomputePackageHash dual-chain (checks #1 + #13) ---

test('recomputePackageHash: multihash contentHash present → JCS chain', () => {
  const pkg = { b: 1, a: 2, contentHash: { sha256: 'x' } };
  assert.equal(
    recomputePackageHash(pkg),
    sha256Hex(canonicalize(pkg) as string),
  );
});

test('recomputePackageHash: no contentHash (pre-v0.1) → legacy JSON.stringify chain', () => {
  const pkg = { b: 1, a: 2 };
  assert.equal(recomputePackageHash(pkg), sha256Hex(JSON.stringify(pkg)));
});

// --- PR2: check #3 — contentCanonicalization rule resolution ---

test('resolveContentCanonicalization: known legacy-json/v1 URI → ok', () => {
  assert.deepEqual(
    resolveContentCanonicalization({
      contentCanonicalization: LEGACY_JSON_CANONICALIZATION,
    }),
    { status: 'ok', rule: LEGACY_JSON_CANONICALIZATION },
  );
});

test('resolveContentCanonicalization: known dathere-ag-jupyter/v1 URI → ok', () => {
  assert.deepEqual(
    resolveContentCanonicalization({
      contentCanonicalization: DATHERE_AG_JUPYTER_CANONICALIZATION,
    }),
    { status: 'ok', rule: DATHERE_AG_JUPYTER_CANONICALIZATION },
  );
});

test('resolveContentCanonicalization: unrecognized URI → unknown_canonicalization_rule', () => {
  const r = resolveContentCanonicalization({
    contentCanonicalization: 'https://example.org/canon/madeup/v9',
  });
  assert.equal(r.status, 'unknown_canonicalization_rule');
  assert.equal(r.rule, 'https://example.org/canon/madeup/v9');
});

test('resolveContentCanonicalization: absent + contentProfile datHere → implicit dathere rule (pre-v0.1)', () => {
  assert.deepEqual(
    resolveContentCanonicalization({ metadata: { contentProfile: 'datHere' } }),
    { status: 'implicit', rule: DATHERE_AG_JUPYTER_CANONICALIZATION },
  );
});

test('resolveContentCanonicalization: absent + default/legacy → implicit legacy rule (pre-v0.1)', () => {
  assert.deepEqual(resolveContentCanonicalization({ metadata: {} }), {
    status: 'implicit',
    rule: LEGACY_JSON_CANONICALIZATION,
  });
});

test('resolveContentCanonicalization: absent + producerProfile datHere alias → implicit dathere rule', () => {
  assert.deepEqual(
    resolveContentCanonicalization({
      producerProfile: 'ai-assisted-analysis/datHere',
    }),
    { status: 'implicit', rule: DATHERE_AG_JUPYTER_CANONICALIZATION },
  );
});

// --- PR2: check #4 — content-hash verification ---

/** Build a v0.1 legacy-json/v1 package with a correct contentHash. */
function v01LegacyPkg(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: 'content/analysis/v1',
    contentCanonicalization: LEGACY_JSON_CANONICALIZATION,
    output: 'hello',
    ...overrides,
  };
  const sha256 = sha256Hex(canonicalize(base) as string);
  return { ...base, contentHash: { sha256 } };
}

const OK_RULE = { status: 'ok' as const, rule: LEGACY_JSON_CANONICALIZATION };
const OK_DATHERE_RULE = {
  status: 'ok' as const,
  rule: DATHERE_AG_JUPYTER_CANONICALIZATION,
};

test('verifyContentHash: v0.1 legacy-json/v1 with a correct hash → ok (sha256 matched)', () => {
  const pkg = v01LegacyPkg();
  const r = verifyContentHash(pkg, OK_RULE);
  assert.equal(r.status, 'ok');
  assert.equal(r.matched, 'sha256');
  assert.deepEqual(r.algorithms, ['sha256']);
});

test('verifyContentHash: v0.1 tampered off-log content → content_hash_mismatch', () => {
  // Keep the stored (now-stale) contentHash but mutate covered content.
  const pkg = { ...v01LegacyPkg(), output: 'tampered after signing' };
  assert.equal(verifyContentHash(pkg, OK_RULE).status, 'content_hash_mismatch');
});

test('verifyContentHash: v0.1 dathere-ag-jupyter/v1 over the notebook → ok', () => {
  const notebook = { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} };
  const sha256 = sha256Hex(canonicalize(notebook) as string);
  const pkg = {
    type: 'content/analysis/v1',
    contentCanonicalization: DATHERE_AG_JUPYTER_CANONICALIZATION,
    extensions: { 'org.civicaitools.notebook': notebook },
    contentHash: { sha256 },
  };
  assert.equal(verifyContentHash(pkg, OK_DATHERE_RULE).status, 'ok');
});

test('verifyContentHash: only an unsupported algorithm listed → contentHash_no_supported_algorithm', () => {
  const pkg = {
    contentCanonicalization: LEGACY_JSON_CANONICALIZATION,
    contentHash: { 'sha3-256': 'deadbeef' },
  };
  assert.equal(
    verifyContentHash(pkg, OK_RULE).status,
    'contentHash_no_supported_algorithm',
  );
});

test('verifyContentHash: unknown canonicalization rule → unresolved_rule', () => {
  const pkg = {
    contentCanonicalization: 'https://example.org/canon/madeup/v9',
    contentHash: { sha256: 'x' },
  };
  const resolution = resolveContentCanonicalization(pkg);
  assert.equal(verifyContentHash(pkg, resolution).status, 'unresolved_rule');
});

test('verifyContentHash: pre-v0.1 (no multihash contentHash) → legacy_relabeled with the slug hash', () => {
  const pkg = { output: 'hi' };
  const resolution = resolveContentCanonicalization(pkg);
  const r = verifyContentHash(pkg, resolution, 'abc123def456');
  assert.equal(r.status, 'legacy_relabeled');
  assert.deepEqual(r.contentHash, { sha256: 'abc123def456' });
});

// --- PR3: check #10 — lifecycle attestation chain (spec §8.10) ---

const PLATFORM = 'platform:civic-ai-tools';
const OTHER = 'platform:someone-else';

function view(overrides: Partial<LifecycleAttestationView> = {}): LifecycleAttestationView {
  return {
    nodeId: 'n1',
    type: ATTESTATION_WITHDRAWS,
    signer: { bindingTier: 'platform', identifier: PLATFORM, displayName: 'P' },
    createdAt: '2026-01-01T00:00:00.000Z',
    signatureValid: true,
    nodeIdMatches: true,
    hasTimestamp: true,
    hasRekor: true,
    signerMatchesTarget: true,
    ...overrides,
  };
}

test('resolveLifecycleFromChain: empty chain → active', () => {
  const r = resolveLifecycleFromChain([]);
  assert.equal(r.status, 'active');
  assert.equal(r.source, 'attestation-chain');
  assert.deepEqual(r.chain, []);
});

test('resolveLifecycleFromChain: single signer-matched withdraws → withdrawn', () => {
  const r = resolveLifecycleFromChain([
    view({ type: ATTESTATION_WITHDRAWS, reason: 'bad data', createdAt: '2026-02-01T00:00:00.000Z', effectiveAt: '2026-02-01T00:00:00.000Z' }),
  ]);
  assert.equal(r.status, 'withdrawn');
  assert.equal(r.withdrawnReason, 'bad data');
  assert.equal(r.withdrawnAt, '2026-02-01T00:00:00.000Z');
});

test('resolveLifecycleFromChain: withdraws then reinstates → active, both convenience fields', () => {
  const w = view({ nodeId: 'w', type: ATTESTATION_WITHDRAWS, reason: 'oops', createdAt: '2026-02-01T00:00:00.000Z', effectiveAt: '2026-02-01T00:00:00.000Z' });
  const re = view({ nodeId: 'r', type: ATTESTATION_REINSTATES, reason: 'fixed', createdAt: '2026-03-01T00:00:00.000Z' });
  const r = resolveLifecycleFromChain([w, re]);
  assert.equal(r.status, 'active');
  assert.equal(r.withdrawnAt, '2026-02-01T00:00:00.000Z');
  assert.equal(r.reinstatedAt, '2026-03-01T00:00:00.000Z');
  assert.equal(r.reinstatedReason, 'fixed');
});

test('resolveLifecycleFromChain: orders by envelope timestamp regardless of input order', () => {
  const w = view({ nodeId: 'w', type: ATTESTATION_WITHDRAWS, createdAt: '2026-02-01T00:00:00.000Z' });
  const re = view({ nodeId: 'r', type: ATTESTATION_REINSTATES, createdAt: '2026-03-01T00:00:00.000Z' });
  const r = resolveLifecycleFromChain([re, w]); // reinstates passed first
  assert.equal(r.status, 'active');             // but withdraws is earlier → latest is reinstates
  assert.equal(r.chain[0].nodeId, 'w');         // sorted ascending
  assert.equal(r.chain[1].nodeId, 'r');
});

test('resolveLifecycleFromChain: ties broken by nodeId lexicographic', () => {
  const a = view({ nodeId: 'aaa', type: ATTESTATION_REINSTATES, createdAt: '2026-02-01T00:00:00.000Z' });
  const b = view({ nodeId: 'bbb', type: ATTESTATION_WITHDRAWS, createdAt: '2026-02-01T00:00:00.000Z' });
  const r = resolveLifecycleFromChain([b, a]); // same timestamp; 'aaa' < 'bbb'
  assert.equal(r.chain[0].nodeId, 'aaa');
  assert.equal(r.chain[1].nodeId, 'bbb');
  assert.equal(r.status, 'withdrawn');          // latest (bbb) is withdraws
});

test('resolveLifecycleFromChain: non-signer-matched withdraws does NOT move status (retention asymmetry §8.10.3)', () => {
  const foreign = view({
    nodeId: 'f', type: ATTESTATION_WITHDRAWS, createdAt: '2026-02-01T00:00:00.000Z',
    signer: { bindingTier: 'platform', identifier: OTHER, displayName: 'X' },
    signerMatchesTarget: false,
  });
  const r = resolveLifecycleFromChain([foreign]);
  assert.equal(r.status, 'active');  // foreign withdrawal ignored for status
  assert.equal(r.chain.length, 1);   // but still surfaced in the chain
});

test('resolveLifecycleFromChain: re-withdrawn (multi-cycle) → withdrawn (latest wins)', () => {
  const w1 = view({ nodeId: 'w1', type: ATTESTATION_WITHDRAWS, createdAt: '2026-01-01T00:00:00.000Z' });
  const r1 = view({ nodeId: 'r1', type: ATTESTATION_REINSTATES, createdAt: '2026-02-01T00:00:00.000Z' });
  const w2 = view({ nodeId: 'w2', type: ATTESTATION_WITHDRAWS, createdAt: '2026-03-01T00:00:00.000Z', reason: 'again' });
  const r = resolveLifecycleFromChain([w1, r1, w2]);
  assert.equal(r.status, 'withdrawn');
  assert.equal(r.withdrawnReason, 'again');
});

// --- PR3: check #10 — legacy column fallback (spec §8.10.4) ---

test('resolveLifecycleFromLegacyColumns: no withdrawnAt → active, source none', () => {
  const r = resolveLifecycleFromLegacyColumns({});
  assert.equal(r.status, 'active');
  assert.equal(r.source, 'none');
});

test('resolveLifecycleFromLegacyColumns: withdrawnAt set → withdrawn (pre-PR3 fallback)', () => {
  const r = resolveLifecycleFromLegacyColumns({ withdrawnAt: '2026-02-01T00:00:00.000Z', withdrawnReason: 'legacy' });
  assert.equal(r.status, 'withdrawn');
  assert.equal(r.source, 'legacy-columns');
  assert.equal(r.withdrawnReason, 'legacy');
});

test('resolveLifecycleFromLegacyColumns: withdrawn + reinstated → active', () => {
  const r = resolveLifecycleFromLegacyColumns({ withdrawnAt: '2026-02-01T00:00:00.000Z', reinstatedAt: '2026-03-01T00:00:00.000Z' });
  assert.equal(r.status, 'active');
  assert.equal(r.source, 'legacy-columns');
});

// --- PR3: verifyAttestationNode ---

const ATT_SIGNER = { bindingTier: 'platform', identifier: PLATFORM, displayName: 'P' };

test('verifyAttestationNode: built node recomputes its nodeId (integrity)', () => {
  const { node, nodeId } = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: 'a'.repeat(64), signer: ATT_SIGNER, reason: 'x' });
  const r = verifyAttestationNode(node as unknown as Record<string, unknown>, nodeId, null);
  assert.equal(r.nodeIdMatches, true);
  assert.equal(r.signatureValid, null); // no signature envelope supplied
});

test('verifyAttestationNode: wrong stored nodeId → nodeIdMatches false', () => {
  const { node } = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: 'a'.repeat(64), signer: ATT_SIGNER, reason: 'x' });
  const r = verifyAttestationNode(node as unknown as Record<string, unknown>, 'f'.repeat(64), null);
  assert.equal(r.nodeIdMatches, false);
});

test('verifyAttestationNode: tampered node → nodeIdMatches false', () => {
  const { node, nodeId } = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: 'a'.repeat(64), signer: ATT_SIGNER, reason: 'x' });
  const tampered = { ...node, reason: 'tampered after signing' } as unknown as Record<string, unknown>;
  assert.equal(verifyAttestationNode(tampered, nodeId, null).nodeIdMatches, false);
});

// --- PR3 regression guard: both lifecycle paths resolve correctly ---

test('lifecycle regression: NEW withdrawal (built node → view → chain) resolves withdrawn', () => {
  // The post-PR3 path end-to-end minus the DB: build a withdraws node, project
  // it into a view as lifecycle.ts would, resolve the chain.
  const { node, nodeId } = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: 'a'.repeat(64), signer: ATT_SIGNER, reason: 'data error' });
  const v: LifecycleAttestationView = {
    nodeId,
    type: node.type,
    signer: node.signer,
    createdAt: node.metadata.createdAt,
    reason: node.reason,
    effectiveAt: node.effectiveAt,
    signatureValid: null,
    nodeIdMatches: verifyAttestationNode(node as unknown as Record<string, unknown>, nodeId, null).nodeIdMatches,
    hasTimestamp: false,
    hasRekor: false,
    signerMatchesTarget: true,
  };
  assert.equal(v.nodeIdMatches, true);
  const r = resolveLifecycleFromChain([v]);
  assert.equal(r.status, 'withdrawn');
  assert.equal(r.source, 'attestation-chain');
  assert.equal(r.withdrawnReason, 'data error');
});

test('lifecycle regression: PRE-PR3 legacy withdrawnAt (no chain) resolves withdrawn via fallback', () => {
  const r = resolveLifecycleFromLegacyColumns({ withdrawnAt: '2025-12-01T00:00:00.000Z', withdrawnReason: 'pre-PR3 withdrawal' });
  assert.equal(r.status, 'withdrawn');
  assert.equal(r.source, 'legacy-columns');
  assert.equal(r.withdrawnReason, 'pre-PR3 withdrawal');
});
