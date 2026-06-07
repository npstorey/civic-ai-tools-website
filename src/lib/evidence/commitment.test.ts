// Unit tests for the §9.2.1 proof-sidecar builder (commitment.ts), the WS1
// core of civic-ai-tools-website#116. These prove the generalization beyond the
// datHere-shaped inline original AND the security-audit invariants for the
// net-new public exposure: only intended-public fields leave the server.
//
// Run with: npm test (Node 22+).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommitmentView,
  buildCommitmentLifecycle,
  CANONICAL_TRUST_REGISTRY_URL,
  LEGACY_TRUST_REGISTRY_URL,
} from './commitment.ts';
import { evidenceRecords, users } from '../db/schema.ts';
import type { EvidencePackage } from './packager.ts';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

// Every key the sidecar is ALLOWED to emit. Anything outside this set is an
// unintended leak. This is the load-bearing assertion of the security audit:
// no email, no internal DB UUID (record.id / creatorId / users.id), no private
// columns (promptText / systemPromptHash / withdrawalSignature / …).
const ALLOWED_KEYS = new Set([
  'evidenceProtocolVersion',
  'packageHash',
  'packageUrl',
  'captureMethod',
  'contentProfile',
  'producerProfile',
  'type',
  'signer',
  'contentHash',
  'contentCanonicalization',
  'signature',
  'signerIdentity',
  'rfc3161Timestamp',
  'rekorEntryId',
  'rekorInclusionProof',
  'rekorEntryBody',
  'lifecycle',
  'trustRegistryUrl',
  'trustRegistryUrlLegacy',
  'subjectTitle',
  'subjectSummary',
]);

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const base: EvidenceRecord = {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'sample-analysis-abc123',
    creatorId: '22222222-2222-2222-2222-222222222222',
    title: 'Sample analysis',
    summary: 'A short, citation-ready summary of the analysis.',
    model: 'claude-opus-4-8',
    promptHash: 'sha256:promptdigest',
    promptVisibility: 'full_text',
    promptText: 'SECRET prompt text that must never leak into the sidecar',
    systemPromptHash: 'sha256:systemdigest',
    mcpServer: 'https://socrata-mcp.civicaitools.org',
    jurisdiction: 'NYC',
    civicContext: 'civic context note',
    basePackageHash:
      'ef1a431c16bf00262bb4e706b0870617fd44bd5d0d3828f9885bd6aefea9a1ba',
    basePackageStorageKey:
      'https://store.public.blob.vercel-storage.com/evidence-packages/ef1a431c16bf00262bb4e706b0870617fd44bd5d0d3828f9885bd6aefea9a1ba.json',
    basePackageSignature: JSON.stringify({
      signature: 'BASE64SIG',
      publicKey: 'BASE64PUBKEY',
      algorithm: 'Ed25519ph',
      kid: 'platform:evidence-2026-04',
    }),
    basePackageRfc3161Timestamp: 'BASE64TSTOKEN',
    basePackageRekorEntryId: 'rekor-entry-123',
    basePackageRekorInclusionProof: JSON.stringify({ logIndex: 42 }),
    basePackageRekorEntryBody: 'eyJhcGlWZXJzaW9uIjoiMC4wLjEifQ==',
    captureMethod: 'chat-flow-stream',
    contentProfile: null,
    verificationStatus: 'unverified',
    consistencyClassification: null,
    isPublic: true,
    withdrawnAt: null,
    withdrawnReason: null,
    withdrawalSignature: 'SECRET withdrawal signature',
    withdrawalTimestamp: null,
    reinstatedAt: null,
    reinstatedReason: null,
    reinstatementSignature: null,
    reinstatementTimestamp: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  };
  return { ...base, ...overrides };
}

function makeCreator(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    githubId: '583231', // public GitHub user id (token.sub), NOT the DB UUID
    displayName: 'Octocat',
    githubProfileUrl: 'https://github.com/octocat',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

// Only the envelope fields buildCommitmentView reads are exercised; cast keeps
// the fixture small. (The full EvidencePackage shape is tested in packager.test.)
function makePkg(overrides: Partial<EvidencePackage> = {}): EvidencePackage {
  return {
    producerProfile: 'analysis/socrata-civic/v1',
    type: 'content/analysis/v1',
    signer: {
      bindingTier: 'platform',
      identifier: 'platform:civic-ai-tools',
      displayName: 'Civic AI Tools Platform',
    },
    contentCanonicalization: 'https://typedstandards.org/canonicalization/legacy-json/v1',
    contentHash: { sha256: 'deadbeef' },
    ...overrides,
  } as unknown as EvidencePackage;
}

test('non-datHere package (contentProfile null) yields a coherent default sidecar', () => {
  const view = buildCommitmentView(makeRecord(), makeCreator(), makePkg());

  // The generalization: profile sourced from the row, not hardcoded 'datHere'.
  assert.equal(view.contentProfile, 'default');
  // Self-describing: carries the blob URL and BOTH registry paths.
  assert.equal(
    view.packageUrl,
    'https://store.public.blob.vercel-storage.com/evidence-packages/ef1a431c16bf00262bb4e706b0870617fd44bd5d0d3828f9885bd6aefea9a1ba.json',
  );
  assert.equal(view.trustRegistryUrl, CANONICAL_TRUST_REGISTRY_URL);
  assert.equal(view.trustRegistryUrlLegacy, LEGACY_TRUST_REGISTRY_URL);
  assert.match(view.trustRegistryUrl as string, /typed-publisher\.json$/);
  // Proofs present.
  assert.equal(
    view.packageHash,
    'ef1a431c16bf00262bb4e706b0870617fd44bd5d0d3828f9885bd6aefea9a1ba',
  );
  assert.equal(view.rfc3161Timestamp, 'BASE64TSTOKEN');
  assert.equal(view.rekorEntryId, 'rekor-entry-123');
  // The Rekor entry body is carried so inclusion can be verified offline (#119 P1).
  assert.equal(view.rekorEntryBody, 'eyJhcGlWZXJzaW9uIjoiMC4wLjEifQ==');
  assert.equal(view.evidenceProtocolVersion, '0.1.0');
});

test('rekorEntryBody is omitted (not null) when the column is empty', () => {
  const view = buildCommitmentView(
    makeRecord({ basePackageRekorEntryBody: null }),
    makeCreator(),
    makePkg(),
  );
  assert.equal('rekorEntryBody' in view, false);
});

test('datHere package surfaces contentProfile datHere', () => {
  const view = buildCommitmentView(
    makeRecord({ contentProfile: 'datHere' }),
    makeCreator(),
    makePkg(),
  );
  assert.equal(view.contentProfile, 'datHere');
});

test('signature is carried verbatim with algorithm + kid (load-bearing for verify-core dispatch)', () => {
  const view = buildCommitmentView(makeRecord(), makeCreator(), makePkg());
  const sig = view.signature as Record<string, unknown>;
  assert.equal(sig.algorithm, 'Ed25519ph');
  assert.equal(sig.kid, 'platform:evidence-2026-04');
  assert.equal(sig.publicKey, 'BASE64PUBKEY');
  assert.equal(sig.signature, 'BASE64SIG');
});

test('pre-kid / plain-Ed25519 signature is carried as-is (no kid)', () => {
  const view = buildCommitmentView(
    makeRecord({
      basePackageSignature: JSON.stringify({
        signature: 'SIG',
        publicKey: 'PK',
        algorithm: 'Ed25519',
      }),
    }),
    makeCreator(),
    makePkg(),
  );
  const sig = view.signature as Record<string, unknown>;
  // Dispatch must select plain ed25519 for legacy packages (the #111 fix).
  assert.equal(sig.algorithm, 'Ed25519');
  assert.equal('kid' in sig, false);
});

test('malformed signature JSON degrades to no signature field, not a throw', () => {
  const view = buildCommitmentView(
    makeRecord({ basePackageSignature: '{not valid json' }),
    makeCreator(),
    makePkg(),
  );
  assert.equal('signature' in view, false);
});

test('signer (envelope §8.5 claim) and signerIdentity (public GitHub) are distinct fields', () => {
  const view = buildCommitmentView(makeRecord(), makeCreator(), makePkg());

  const signer = view.signer as Record<string, unknown>;
  const signerIdentity = view.signerIdentity as Record<string, unknown>;

  // Envelope signer — the check-#14 subject.
  assert.equal(signer.identifier, 'platform:civic-ai-tools');
  // Public GitHub identity — informational; providerId is the GitHub user id.
  assert.equal(signerIdentity.provider, 'github');
  assert.equal(signerIdentity.providerId, '583231');
  assert.equal(signerIdentity.profileUrl, 'https://github.com/octocat');
  // They must not be conflated.
  assert.notEqual(signer.identifier, signerIdentity.providerId);
});

test('null pkg: envelope fields omitted, proofs + packageUrl still served', () => {
  const view = buildCommitmentView(makeRecord(), makeCreator(), null);

  assert.equal('producerProfile' in view, false);
  assert.equal('type' in view, false);
  assert.equal('signer' in view, false);
  assert.equal('contentHash' in view, false);
  assert.equal('contentCanonicalization' in view, false);
  // Core proofs survive a missing blob.
  assert.equal(
    view.packageHash,
    'ef1a431c16bf00262bb4e706b0870617fd44bd5d0d3828f9885bd6aefea9a1ba',
  );
  assert.ok(view.signature);
  assert.equal(view.rekorEntryId, 'rekor-entry-123');
  assert.ok(view.packageUrl);
});

test('no creator: signerIdentity omitted, no throw', () => {
  const view = buildCommitmentView(makeRecord(), null, makePkg());
  assert.equal('signerIdentity' in view, false);
});

test('lifecycle: active package omits the lifecycle field entirely', () => {
  const view = buildCommitmentView(makeRecord(), makeCreator(), makePkg());
  assert.equal('lifecycle' in view, false);
});

test('lifecycle: currently-withdrawn package is served with withdrawn state', () => {
  const view = buildCommitmentView(
    makeRecord({
      withdrawnAt: new Date('2026-06-02T12:00:00.000Z'),
      withdrawnReason: 'Superseded by a corrected analysis',
    }),
    makeCreator(),
    makePkg(),
  );
  const lc = view.lifecycle as Record<string, unknown>;
  assert.equal(lc.status, 'withdrawn');
  assert.equal(lc.withdrawnAt, '2026-06-02T12:00:00.000Z');
  assert.equal(lc.withdrawnReason, 'Superseded by a corrected analysis');
  // The package's proofs are STILL present (withdrawal is a separate action).
  assert.ok(view.signature);
  assert.ok(view.packageHash);
});

test('lifecycle: reinstated package reads active but carries history', () => {
  const view = buildCommitmentView(
    makeRecord({
      withdrawnAt: new Date('2026-06-02T12:00:00.000Z'),
      withdrawnReason: 'mistake',
      reinstatedAt: new Date('2026-06-03T09:00:00.000Z'),
      reinstatedReason: 'resolved',
    }),
    makeCreator(),
    makePkg(),
  );
  const lc = view.lifecycle as Record<string, unknown>;
  assert.equal(lc.status, 'active');
  assert.equal(lc.withdrawnAt, '2026-06-02T12:00:00.000Z');
  assert.equal(lc.reinstatedAt, '2026-06-03T09:00:00.000Z');
  assert.equal(lc.reinstatedReason, 'resolved');
});

test('buildCommitmentLifecycle returns null when never withdrawn', () => {
  assert.equal(
    buildCommitmentLifecycle({
      withdrawnAt: null,
      withdrawnReason: null,
      reinstatedAt: null,
      reinstatedReason: null,
    }),
    null,
  );
});

test('SECURITY: only intended-public keys are emitted (no PII / internal IDs / private columns)', () => {
  // Exercise the widest field set: withdrawn + full pkg + creator.
  const view = buildCommitmentView(
    makeRecord({
      withdrawnAt: new Date('2026-06-02T12:00:00.000Z'),
      withdrawnReason: 'reason',
    }),
    makeCreator(),
    makePkg(),
  );

  for (const key of Object.keys(view)) {
    assert.ok(
      ALLOWED_KEYS.has(key),
      `unexpected key leaked into commitment view: ${key}`,
    );
  }

  // Spot-check the specific sensitive values are absent anywhere in the JSON.
  const serialized = JSON.stringify(view);
  assert.equal(
    serialized.includes('SECRET prompt text'),
    false,
    'prompt text leaked',
  );
  assert.equal(
    serialized.includes('SECRET withdrawal signature'),
    false,
    'withdrawal signature leaked',
  );
  // Internal DB UUIDs (record.id / creatorId / users.id) must never appear.
  assert.equal(
    serialized.includes('11111111-1111-1111-1111-111111111111'),
    false,
    'record UUID leaked',
  );
  assert.equal(
    serialized.includes('22222222-2222-2222-2222-222222222222'),
    false,
    'creator UUID leaked',
  );
});
