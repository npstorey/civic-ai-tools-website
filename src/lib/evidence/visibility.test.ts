// Tests for the ADR-0016 §A visibility vocabulary boundary (visibility.ts) and
// for the property that makes the rename safe to ship in stages: a row written
// under the LEGACY vocabulary keeps working, unchanged, at every surface that
// reads it.
//
// Run with: npm test (Node 22+).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fromDbValue,
  toDbValue,
  normalizeVisibility,
  isSealedDbValue,
  SEALED_DB_VALUES,
  PUBLIC_DB_VALUES,
  ACCEPTED_VISIBILITY_INPUTS,
  type Visibility,
  type VisibilityDbValue,
} from './visibility.ts';
import { buildCommitmentView } from './commitment.ts';
import { evidenceRecords, users } from '../db/schema.ts';
import type { EvidencePackage } from './packager.ts';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

const CREATOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const base: EvidenceRecord = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'historical-analysis-eb1cad',
    creatorId: CREATOR_ID,
    title: 'Historical analysis',
    summary: 'A summary captured before the vocabulary rename.',
    model: 'claude-opus-4-8',
    promptHash: 'sha256:promptdigest',
    promptVisibility: 'full_text',
    promptText: 'prompt text',
    systemPromptHash: 'sha256:systemdigest',
    mcpServer: 'https://socrata-mcp.civicaitools.org',
    jurisdiction: 'NYC',
    civicContext: 'civic context note',
    basePackageHash:
      'eb1cadfebadcaffeebeadfacedbeadedcabbadedeafdeedfeebfadedaccededa',
    basePackageStorageKey:
      'https://store.public.blob.vercel-storage.com/evidence-packages/committed/deadbeefcafefeedfacedbadcabbaded.json',
    basePackageSignature: JSON.stringify({
      signature: 'BASE64SIG',
      publicKey: 'BASE64PUBKEY',
      algorithm: 'Ed25519ph',
      kid: 'platform:evidence-legacy',
    }),
    basePackageRfc3161Timestamp: 'BASE64TSTOKEN',
    basePackageRekorEntryId: 'rekor-entry-legacy',
    basePackageRekorInclusionProof: JSON.stringify({ logIndex: 'abc' }),
    basePackageRekorEntryBody: 'eyJhcGlWZXJzaW9uIjoiMC4wLjEifQ==',
    captureMethod: 'chat-flow-stream',
    contentProfile: null,
    verificationStatus: 'unverified',
    consistencyClassification: null,
    isPublic: true,
    // The point of the fixture: the row holds the LEGACY label.
    visibility: 'committed',
    withdrawnAt: null,
    withdrawnReason: null,
    withdrawalSignature: null,
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

function makeCreator(): UserRecord {
  return {
    id: CREATOR_ID,
    githubId: 'octocat-id',
    displayName: 'Octocat',
    githubProfileUrl: 'https://github.com/octocat',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  };
}

// Only the envelope fields buildCommitmentView reads; cast keeps it small
// (the full package shape is exercised in packager.test.ts).
function makePkg(): EvidencePackage {
  return {
    producerProfile: 'analysis/socrata-civic/v1',
    type: 'content/analysis/v1',
    signer: {
      bindingTier: 'platform',
      identifier: 'platform:evidence-legacy',
    },
    contentHash: 'sha256:contentdigest',
    contentCanonicalization: 'application/json+jcs',
  } as unknown as EvidencePackage;
}

// --- Normalization: both vocabularies mean the same thing ---

test('fromDbValue normalizes both vocabularies to the same canonical value', () => {
  assert.equal(fromDbValue('committed'), 'sealed');
  assert.equal(fromDbValue('sealed'), 'sealed');
  assert.equal(fromDbValue('published'), 'public');
  assert.equal(fromDbValue('public'), 'public');

  // Stated as the property rather than four literals: each legacy label and its
  // replacement are indistinguishable downstream.
  assert.deepEqual(SEALED_DB_VALUES.map(fromDbValue), ['sealed', 'sealed']);
  assert.deepEqual(PUBLIC_DB_VALUES.map(fromDbValue), ['public', 'public']);
});

test('fromDbValue refuses an unrecognized label instead of coercing it', () => {
  assert.throws(
    () => fromDbValue('unlisted' as VisibilityDbValue),
    /Unrecognized visibility value/,
  );
});

test('isSealedDbValue is true for both sealed-state labels and false for both public ones', () => {
  for (const label of SEALED_DB_VALUES) assert.equal(isSealedDbValue(label), true, label);
  for (const label of PUBLIC_DB_VALUES) assert.equal(isSealedDbValue(label), false, label);
});

// --- Input aliasing: legacy and new request bodies produce the same write ---

test('normalizeVisibility accepts all four request literals and rejects everything else', () => {
  assert.equal(ACCEPTED_VISIBILITY_INPUTS.length, 4);
  for (const literal of ACCEPTED_VISIBILITY_INPUTS) {
    assert.notEqual(normalizeVisibility(literal), null, literal);
  }
  for (const bad of ['Sealed', 'PUBLIC', 'private', 'withdrawn', '', null, undefined, 1, {}]) {
    assert.equal(normalizeVisibility(bad), null, JSON.stringify(bad));
  }
});

test('round trip: legacy input and new input produce an identical DB write', () => {
  const write = (input: unknown): VisibilityDbValue => {
    const canonical = normalizeVisibility(input);
    assert.notEqual(canonical, null, `expected ${String(input)} to be accepted`);
    return toDbValue(canonical as Visibility);
  };

  assert.equal(write('committed'), write('sealed'));
  assert.equal(write('published'), write('public'));

  // …and in this phase that identical write is the LEGACY label, so the merge
  // changes nothing about what lands in the column. When the flip phase turns
  // `toDbValue` into the identity, this pair of assertions is what changes —
  // and it is the only place in the suite that has to.
  assert.equal(write('sealed'), 'committed');
  assert.equal(write('public'), 'published');
});

test('toDbValue output is always a value the canonical vocabulary round-trips', () => {
  for (const canonical of ['sealed', 'public'] as const) {
    assert.equal(fromDbValue(toDbValue(canonical)), canonical);
  }
});

// --- Historical records are unharmed ---
//
// The acceptance criterion for shipping the vocabulary widening ahead of the
// data: a row still holding `committed` reads, gates, and serves exactly as it
// did before.

test('historical record: a legacy "committed" row still reads as the sealed state', () => {
  const record = makeRecord();
  assert.equal(fromDbValue(record.visibility), 'sealed');
});

test('historical record: a legacy "committed" row still fails the public read gate', () => {
  // `isSealedRecord` in sealed-access.ts is exactly this predicate applied
  // to `record.visibility`; when it is true the route requires the requester to
  // resolve to `record.creatorId`. A row on the legacy label must keep hitting
  // that branch — if it stopped, the content surface of every pre-rename sealed
  // record would become world-readable.
  const legacy = makeRecord({ visibility: 'committed' });
  const renamed = makeRecord({ visibility: 'sealed' });
  assert.equal(isSealedDbValue(legacy.visibility), true);
  assert.equal(isSealedDbValue(renamed.visibility), true);

  // The disclosed state, under either label, needs no creator check.
  assert.equal(isSealedDbValue(makeRecord({ visibility: 'published' }).visibility), false);
  assert.equal(isSealedDbValue(makeRecord({ visibility: 'public' }).visibility), false);
});

test('historical record: a legacy "committed" row still produces a servable, redacted commitment view', () => {
  const record = makeRecord({
    title: 'CONFIDENTIAL question title',
    summary: 'CONFIDENTIAL summary',
  });

  // The redaction decision is taken exactly the way the commitment route takes
  // it — through the vocabulary boundary, not a string literal.
  const view = buildCommitmentView(record, makeCreator(), makePkg(), undefined, {
    redactContentSurface: isSealedDbValue(record.visibility),
  });

  // Content surface stays redacted for the legacy label.
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes('CONFIDENTIAL'), false, 'content strings leaked');
  assert.ok(!('packageUrl' in view), 'capability URL leaked');
  assert.ok(!('subjectTitle' in view));
  assert.ok(!('subjectSummary' in view));

  // The proofs — which ARE the commitment — are served.
  assert.equal(view.packageHash, record.basePackageHash);
  assert.ok(view.signature);
  assert.equal(view.rfc3161Timestamp, 'BASE64TSTOKEN');
  assert.equal(view.rekorEntryId, 'rekor-entry-legacy');

  // SERVING SURFACE, deliberately unchanged: the commitment view passes the raw
  // column through. An external verifier that already knows this record reads
  // byte-identically to before the boundary module existed. Renaming what this
  // field serves is the flip phase's chartered change, not a side effect here.
  assert.equal(view.visibility, 'committed');
});

test('serving surface: a public-state row still serves its raw label unchanged', () => {
  const view = buildCommitmentView(
    makeRecord({ visibility: 'published', title: 'Open analysis', summary: 'Open summary' }),
    makeCreator(),
    makePkg(),
  );
  assert.equal(view.visibility, 'published');
  assert.equal(view.subjectTitle, 'Open analysis');
  assert.ok(view.packageUrl);
});
