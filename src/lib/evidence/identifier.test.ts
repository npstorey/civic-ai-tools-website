// Tests for identifier resolution on the public commitment endpoint
// (civic-ai-tools-website#116 durable backend half): a bare base-package hash
// and a slug MUST resolve to the same §9.2.1 commitment, hash matching MUST be
// case-insensitive, slug resolution MUST be unchanged, and a non-public package
// MUST stay unreachable by hash.
//
// The commitment route imports `@/lib/db` (a live Neon client) so it can't run
// under the `node --test` harness. These tests instead drive the SAME pure
// functions the route uses — `classifyIdentifier`, `commitmentAccessError`,
// `buildCommitmentView` — through a tiny in-memory store that mirrors the route's
// DB resolution (equality match + canonical-row ordering). The live deployed
// behavior (uppercase hash 404 before this fix, 200 after) was additionally
// confirmed by curl against civicaitools.org.
//
// Run with: npm test (Node 22+).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyIdentifier,
  commitmentAccessError,
  IDENTIFIER_HASH_RE,
} from './identifier.ts';
import { buildCommitmentView } from './commitment.ts';
import { evidenceRecords, users } from '../db/schema.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// #258: buildCommitmentView refuses without a declared instance identity —
// injected here explicitly (this suite is about identifier resolution).
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

const HASH = 'e84455d16b154641c264480fad9423bf9a33328e97c3915d6eba76ac26e85b16';

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const base: EvidenceRecord = {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'noise-trends-in-nyc-last-week-e84455',
    creatorId: '22222222-2222-2222-2222-222222222222',
    title: 'Noise trends in NYC last week',
    summary: 'A short, citation-ready summary of the analysis.',
    model: 'openai/gpt-4o',
    promptHash: 'sha256:promptdigest',
    promptVisibility: 'full_text',
    promptText: 'SECRET prompt text that must never leak into the sidecar',
    systemPromptHash: 'sha256:systemdigest',
    mcpServer: 'https://socrata-mcp.civicaitools.org',
    jurisdiction: 'NYC',
    civicContext: 'civic context note',
    basePackageHash: HASH,
    basePackageStorageKey:
      'https://store.public.blob.vercel-storage.com/evidence-packages/' +
      HASH +
      '.json',
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
    withdrawalSignature: null,
    withdrawalTimestamp: null,
    reinstatedAt: null,
    reinstatedReason: null,
    reinstatementSignature: null,
    reinstatementTimestamp: null,
    createdAt: new Date('2026-06-16T00:31:59.875Z'),
    updatedAt: new Date('2026-06-16T00:31:59.875Z'),
  };
  return { ...base, ...overrides };
}

function makeCreator(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    githubId: '583231',
    displayName: 'Nathan Storey',
    githubProfileUrl: 'https://github.com/npstorey',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Mirror of the commitment route's DB resolution using the REAL classifier:
 * equality match on the classified column, and — for the hash form — the
 * canonical (oldest-created) row when several share a base_package_hash.
 * Returns the matched row or null.
 */
function resolveFromStore(
  store: EvidenceRecord[],
  identifier: string,
): EvidenceRecord | null {
  const q = classifyIdentifier(identifier);
  const matched = store.filter((r) =>
    q.by === 'basePackageHash' ? r.basePackageHash === q.value : r.slug === q.value,
  );
  if (matched.length === 0) return null;
  if (q.isHash) {
    matched.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  return matched[0];
}

/**
 * Mirror of the commitment route's full pipeline: resolve → public-visibility
 * gate → build the §9.2.1 view. `pkg` is passed null (the route degrades to
 * DB-sourced proofs when the blob can't be fetched), which is enough to compare
 * commitment identity across address forms.
 */
function serveCommitment(
  store: EvidenceRecord[],
  creator: UserRecord | null,
  identifier: string,
): { status: number; error?: string; body?: Record<string, unknown> } {
  const record = resolveFromStore(store, identifier);
  if (!record) return { status: 404, error: 'Evidence not found' };
  const accessError = commitmentAccessError(record);
  if (accessError) return { status: 404, error: accessError };
  return { status: 200, body: buildCommitmentView(record, creator, null) };
}

// --- classifyIdentifier ---

test('classifyIdentifier: lowercase 64-hex is a hash, matched verbatim', () => {
  const q = classifyIdentifier(HASH);
  assert.deepEqual(q, { by: 'basePackageHash', value: HASH, isHash: true });
});

test('classifyIdentifier: UPPERCASE/mixed-case hash lowercases for the lookup (the fix)', () => {
  const upper = classifyIdentifier(HASH.toUpperCase());
  assert.deepEqual(upper, { by: 'basePackageHash', value: HASH, isHash: true });

  const mixed =
    HASH.slice(0, 32).toUpperCase() + HASH.slice(32); // half upper, half lower
  const q = classifyIdentifier(mixed);
  assert.equal(q.by, 'basePackageHash');
  assert.equal(q.isHash, true);
  assert.equal(q.value, HASH); // normalized to the lowercase stored digest
});

test('classifyIdentifier: a real slug is a slug, passed through verbatim', () => {
  const slug = 'noise-trends-in-nyc-last-week-e84455';
  assert.deepEqual(classifyIdentifier(slug), {
    by: 'slug',
    value: slug,
    isHash: false,
  });
});

test('classifyIdentifier: near-hash strings are NOT hashes (63/65 chars, non-hex)', () => {
  assert.equal(classifyIdentifier(HASH.slice(0, 63)).isHash, false); // 63 chars
  assert.equal(classifyIdentifier(HASH + 'a').isHash, false); // 65 chars
  assert.equal(classifyIdentifier('g'.repeat(64)).isHash, false); // non-hex
  assert.equal(IDENTIFIER_HASH_RE.test(HASH.toUpperCase()), true); // case-insensitive re
});

// --- commitmentAccessError (the "no more access by hash than by slug" gate) ---

test('commitmentAccessError: public, published record is served', () => {
  assert.equal(commitmentAccessError(makeRecord()), null);
});

test('commitmentAccessError: unpublished (no base hash) and non-public are 404', () => {
  assert.equal(
    commitmentAccessError(makeRecord({ basePackageHash: null })),
    'No published evidence package for this identifier',
  );
  assert.equal(
    commitmentAccessError(makeRecord({ isPublic: false })),
    'Evidence not found',
  );
});

// --- end-to-end: hash and slug are interchangeable ---

test('GET-by-hash and GET-by-slug return the SAME commitment', () => {
  const store = [makeRecord()];
  const creator = makeCreator();

  const byHash = serveCommitment(store, creator, HASH);
  const bySlug = serveCommitment(store, creator, store[0].slug);

  assert.equal(byHash.status, 200);
  assert.equal(bySlug.status, 200);
  assert.deepEqual(byHash.body, bySlug.body);
  assert.equal(byHash.body?.packageHash, HASH);
});

test('GET-by-UPPERCASE-hash returns the same commitment (regression: no 404 by case)', () => {
  const store = [makeRecord()];
  const creator = makeCreator();

  const byUpper = serveCommitment(store, creator, HASH.toUpperCase());
  const bySlug = serveCommitment(store, creator, store[0].slug);

  assert.equal(byUpper.status, 200);
  assert.deepEqual(byUpper.body, bySlug.body);
});

test('slug resolution is unchanged (regression)', () => {
  const store = [makeRecord()];
  const res = serveCommitment(store, makeCreator(), store[0].slug);
  assert.equal(res.status, 200);
  assert.equal(res.body?.packageHash, HASH);
  assert.equal(res.body?.subjectTitle, 'Noise trends in NYC last week');
});

test('a non-public package stays unreachable by hash AND by slug (identical authz)', () => {
  const store = [makeRecord({ isPublic: false })];
  const creator = makeCreator();

  const byHash = serveCommitment(store, creator, HASH);
  const bySlug = serveCommitment(store, creator, store[0].slug);

  assert.equal(byHash.status, 404);
  assert.equal(bySlug.status, 404);
  assert.equal(byHash.error, 'Evidence not found');
  // Addressing by hash reveals no more than addressing by slug: same status,
  // same body, no proof fields leaked.
  assert.deepEqual(byHash, bySlug);
});

test('hash form returns the canonical (oldest-created) row when a hash is shared', () => {
  const older = makeRecord({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    slug: 'noise-trends-original-e84455',
    title: 'Original title',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  });
  const newer = makeRecord({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    slug: 'noise-trends-republished-e84455',
    title: 'Republished title',
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
  });
  // Store in newest-first order to prove ordering, not insertion order, decides.
  const res = serveCommitment([newer, older], makeCreator(), HASH);
  assert.equal(res.status, 200);
  assert.equal(res.body?.subjectTitle, 'Original title');
});
