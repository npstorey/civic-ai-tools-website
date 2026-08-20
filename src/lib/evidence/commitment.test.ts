// Unit tests for the §8.8.1 proof-sidecar builder (commitment.ts), the WS1
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
  readCommitmentNamespace,
  COMMITMENT_NAMESPACE_KEY,
  COMMITMENT_NAMESPACE_KEY_PRIOR_ERA,
} from './commitment.ts';
import { evidenceRecords, users } from '../db/schema.ts';
import type { EvidencePackage } from './packager.ts';
import {
  REFERENCE_IDENTITY_ENV,
  REFERENCE_TRUST_REGISTRY_CANONICAL_URL,
  REFERENCE_TRUST_REGISTRY_LEGACY_URL,
} from './reference-identity-fixture.ts';

// #258: the sidecar's registry URLs resolve from instance identity with no
// coded defaults — an unconfigured instance refuses instead (covered in
// instance-config.test.ts). This suite is about sidecar SHAPE, so it injects
// the reference identity explicitly; the URL assertions below are the
// byte-parity proof for the reference deployment.
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}
const CANONICAL_TRUST_REGISTRY_URL = REFERENCE_TRUST_REGISTRY_CANONICAL_URL;
const LEGACY_TRUST_REGISTRY_URL = REFERENCE_TRUST_REGISTRY_LEGACY_URL;

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

// Every key the sidecar is ALLOWED to emit. Anything outside this set is an
// unintended leak. This is the load-bearing assertion of the security audit:
// no email, no internal DB UUID (record.id / creatorId / users.id), no private
// columns (promptText / systemPromptHash / withdrawalSignature / …).
//
// The wire version key is `protocolVersion` as of the 2026-08-19 vocabulary
// settlement (spec §8.8.1 / Appendix J; produce-core 0.3.0). The prior-era
// spelling `evidenceProtocolVersion` is deliberately ABSENT from this
// allowlist: post-cutover emissions mint the settlement-era key only, and a
// view carrying the old key would now be a defect. Dual-era acceptance is a
// verifier-side rule (both eras valid on READ, forever) — not a licence for
// this publisher to keep emitting the old key. Views minted before the
// cutover keep theirs; nothing already exported is rewritten.
const ALLOWED_KEYS = new Set([
  'protocolVersion',
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
  'lifecycleAttestations',
  'trustRegistryUrl',
  'trustRegistryUrlLegacy',
  'subjectTitle',
  'subjectSummary',
  'visibility',
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
    visibility: 'published',
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
  assert.equal(view.protocolVersion, '0.1.0');
});

// The settlement cutover pin (civic-ai-tools#160 P5, spec §8.8.1 / Appendix J).
// Two halves, because the flip has two failure modes: emitting nothing under
// the new key, and continuing to emit the old one beside it. produce-core
// 0.3.0 guards the second internally; this pins the reference publisher's own
// wire form so a future dependency change that reintroduced the old key would
// fail HERE, at the surface external verifiers read.
test('wire key: new commitment views carry protocolVersion and NOT the prior-era key', () => {
  const view = buildCommitmentView(makeRecord(), makeCreator(), makePkg());

  assert.equal(view.protocolVersion, '0.1.0');
  assert.equal(
    'evidenceProtocolVersion' in view,
    false,
    'post-cutover emissions must not carry the prior-era wire key',
  );
});

// Dual-era honesty at the READ surface (Appendix J rules J.4.1–J.4.3). The
// commitment view is assembled at read time from the DB row plus the stored
// blob — it is not itself a signed artifact — so a record published BEFORE the
// cutover is served today with the settlement-era wire key, while the package
// it points at keeps its prior-era identifiers frozen inside the signature.
// Both halves are asserted together, because the pair is exactly what an
// external verifier receives for an old record after this phase ships.
// (The stored package's own hash/signature survival is pinned end-to-end in
// packager.test.ts, over a package built by the real builder.)
test('dual-era: a stored prior-era package serves a settlement-era commitment view, unmodified', () => {
  const priorEraPkg = makePkg({
    provenance: {
      '@context': {
        civic: 'https://civicaitools.org/ns/evidence/',
      },
      '@graph': [{ '@id': 'urn:civic-evidence:platform:civic-ai-tools' }],
    },
  } as unknown as Partial<EvidencePackage>);

  const view = buildCommitmentView(makeRecord(), makeCreator(), priorEraPkg);

  // New era on the wire...
  assert.equal(view.protocolVersion, '0.1.0');
  assert.equal('evidenceProtocolVersion' in view, false);

  // ...prior era inside the package, passed through verbatim. The view carries
  // the envelope fields the signature commits to; none of them is rewritten.
  assert.equal(view.contentHash, priorEraPkg.contentHash);
  assert.equal(view.type, priorEraPkg.type);
  assert.equal(view.contentCanonicalization, priorEraPkg.contentCanonicalization);
  const storedJson = JSON.stringify(priorEraPkg);
  assert.ok(storedJson.includes('urn:civic-evidence:'));
  assert.ok(storedJson.includes('https://civicaitools.org/ns/evidence/'));
});

test('rekorEntryBody is omitted (not null) when the column is empty', () => {
  const view = buildCommitmentView(
    makeRecord({ basePackageRekorEntryBody: null }),
    makeCreator(),
    makePkg(),
  );
  assert.equal('rekorEntryBody' in view, false);
});

test('carries lifecycleAttestations when present, omits when empty (#119 P3)', () => {
  const att = [
    {
      node: { type: 'attestation/withdraws/v1', targetNodeId: 'abc' },
      nodeId: 'deadbeef',
      signature: { signature: 'SIG', publicKey: 'PUB', algorithm: 'Ed25519ph' },
      hasTimestamp: false,
      hasRekor: false,
    },
  ];
  const withChain = buildCommitmentView(makeRecord(), makeCreator(), makePkg(), att);
  assert.deepEqual(withChain.lifecycleAttestations, att);
  // No signed chain ⇒ the key is omitted (verifier falls back to STATE).
  const noChain = buildCommitmentView(makeRecord(), makeCreator(), makePkg(), []);
  assert.equal('lifecycleAttestations' in noChain, false);
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

// --- Sealed-record redaction (civic-ai-tools#71 Phase 2, ADR-0010 §5) ---

test('sealed redaction: capability URL, title, and summary never leave the server', () => {
  const record = makeRecord({
    visibility: 'committed',
    basePackageStorageKey:
      'https://store.public.blob.vercel-storage.com/evidence-packages/committed/0123456789abcdef0123456789abcdef.json',
    title: 'SECRET internal question title',
    summary: 'SECRET internal summary',
  });
  const view = buildCommitmentView(record, makeCreator(), makePkg(), undefined, {
    redactContentSurface: true,
  });

  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes('committed/0123456789abcdef'), false, 'capability URL leaked');
  assert.equal(serialized.includes('SECRET internal question title'), false, 'title leaked');
  assert.equal(serialized.includes('SECRET internal summary'), false, 'summary leaked');
  assert.ok(!('packageUrl' in view));
  assert.ok(!('subjectTitle' in view));
  assert.ok(!('subjectSummary' in view));

  // The commitment itself — the proofs — is served unredacted. `visibility` is
  // served CANONICAL as of the ADR-0016 §A P2 flip: this fixture's row still
  // holds the legacy `committed` label and the view emits `sealed`.
  assert.equal(view.visibility, 'sealed');
  assert.equal(view.packageHash, record.basePackageHash);
  assert.ok(view.signature, 'signature envelope should be served');
  assert.equal(view.rfc3161Timestamp, 'BASE64TSTOKEN');
  assert.equal(view.rekorEntryId, 'rekor-entry-123');

  // Allowed-keys audit holds for the redacted form too.
  for (const key of Object.keys(view)) {
    assert.ok(ALLOWED_KEYS.has(key), `unexpected key in redacted sidecar: ${key}`);
  }
});

test('public records carry visibility "public" and stay unredacted', () => {
  // The base fixture's row holds the legacy `published` label; the view serves
  // the canonical `public` (ADR-0016 §A, P2).
  const view = buildCommitmentView(makeRecord(), makeCreator(), makePkg());
  assert.equal(view.visibility, 'public');
  assert.ok(view.packageUrl);
  assert.equal(view.subjectTitle, 'Sample analysis');
});

// --- Ruling D3: the dual-era commitment-view extension namespace ---
//
// spec §8.8.2 / Appendix J §J.3. The owner took this row as "dual-era,
// accepted forever" rather than the default alias-and-deprecate, so the two
// halves need separate coverage: what a NEW bundle mints, and what a bundle
// exported BEFORE the cutover still resolves to. Measured scope in this repo:
// exactly one writer (the bundle route) and — before this phase — zero
// readers, which is why the preference rule now has a single named
// implementation instead of an inline lookup at each future call site.

test('D3 namespace: the settlement-era key is what new bundles mint', () => {
  assert.equal(COMMITMENT_NAMESPACE_KEY, 'org.civicaitools.record');
});

test('D3 namespace: a PRIOR-ERA bundle still resolves (accepted forever)', () => {
  assert.equal(COMMITMENT_NAMESPACE_KEY_PRIOR_ERA, 'org.civicaitools.evidence');
  const priorEraNotebookMetadata = {
    [COMMITMENT_NAMESPACE_KEY_PRIOR_ERA]: { packageHash: 'abc', protocolVersion: '0.1.0' },
  };
  const view = readCommitmentNamespace(priorEraNotebookMetadata);
  assert.ok(view, 'a pre-cutover bundle must still resolve its commitment view');
  assert.equal(view.packageHash, 'abc');
});

test('D3 namespace: a SETTLEMENT-ERA bundle resolves', () => {
  const view = readCommitmentNamespace({
    [COMMITMENT_NAMESPACE_KEY]: { packageHash: 'def' },
  });
  assert.equal(view?.packageHash, 'def');
});

test('D3 namespace: with both keys present the settlement-era one wins', () => {
  const view = readCommitmentNamespace({
    [COMMITMENT_NAMESPACE_KEY_PRIOR_ERA]: { packageHash: 'old' },
    [COMMITMENT_NAMESPACE_KEY]: { packageHash: 'new' },
  });
  assert.equal(view?.packageHash, 'new');
});

test('D3 namespace: metadata carrying neither key resolves to null (not a bundle)', () => {
  assert.equal(readCommitmentNamespace({ 'org.civicaitools.notebook': {} }), null);
  assert.equal(readCommitmentNamespace(null), null);
  assert.equal(readCommitmentNamespace(undefined), null);
});
