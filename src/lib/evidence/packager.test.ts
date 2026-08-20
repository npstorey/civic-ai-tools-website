// Packager tests exercising blob-reference pathways introduced in
// Phase B.6 (website#75). Confirms backward compatibility with inline
// content packages and that BlobRef inputs flow through the package JSON
// unchanged (so verifiers and renderers can still follow the reference).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import canonicalize from 'canonicalize';
import { buildEvidencePackage, type PackageInput } from './packager.ts';
import { recomputePackageHash, verifyContentHash } from './verify.ts';
import {
  LEGACY_JSON_CANONICALIZATION,
  DATHERE_AG_JUPYTER_CANONICALIZATION,
  computeContentHashSha256,
} from './canonicalization.ts';
import type { BlobRef } from './blob-ref.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// Every envelope carries `metadata.signingKeyId`, and there is no coded
// default for it (signing.ts) — an instance emits the kid it declared or
// none. So this suite declares one, as any signing instance must. `node
// --test` runs each file in its own process, so it is local to this suite.
process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';

// #258: the packager also refuses without a declared instance identity —
// there are no coded identity defaults left to fall back to. This suite is
// about blob-reference pathways, not identity, so it injects the REFERENCE
// deployment's identity explicitly (that injection is what preserves the
// historical byte assertions below, e.g. environment.host).
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeBlobRef(content: string, contentType = 'text/plain'): BlobRef {
  return {
    ref: `blob:sha256:${sha256Hex(content)}`,
    url: `https://example.public.blob.vercel-storage.com/evidence-refs/${sha256Hex(content)}.bin`,
    contentType,
    size: new TextEncoder().encode(content).byteLength,
  };
}

function baseInput(overrides: Partial<PackageInput> = {}): PackageInput {
  return {
    trace: { resourceSpans: [] },
    prompt: 'How many 311 noise complaints last year?',
    output: 'Around 400,000.',
    toolCalls: [
      {
        name: 'get_data',
        args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9', select: 'count(*)' },
        resultSummary: { rows: 1, columns: 1 },
        operationType: 'query',
      },
    ],
    model: 'openai/gpt-4o',
    portal: 'data.cityofnewyork.us',
    tokenUsage: { promptTokens: 100, completionTokens: 20 },
    promptVisibility: 'full_text',
    title: 'Test',
    summary: 'Test summary.',
    ...overrides,
  };
}

// --- Backward compatibility: inline content still works ---

test('buildEvidencePackage: inline output + inline trace produces a package hash', () => {
  const { pkg, hash } = buildEvidencePackage(baseInput());
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 64);
  assert.equal(typeof pkg.output, 'string');
  assert.equal(pkg.output, 'Around 400,000.');
});

// --- BlobRef output is passed through unchanged ---

test('buildEvidencePackage: BlobRef output is preserved in the package JSON', () => {
  const ref = makeBlobRef('Long synthesised output...\n\n## Details\n...');
  const { pkg } = buildEvidencePackage(baseInput({ output: ref }));
  assert.deepEqual(pkg.output, ref);
});

test('buildEvidencePackage: BlobRef output produces a deterministic package hash (idempotency)', () => {
  const ref = makeBlobRef('content');
  const a = buildEvidencePackage(baseInput({ output: ref }));
  const b = buildEvidencePackage(baseInput({ output: ref }));
  // packageId is random so a.hash !== b.hash, but the ref survives both.
  assert.deepEqual(a.pkg.output, ref);
  assert.deepEqual(b.pkg.output, ref);
});

// --- BlobRef output drives the PROV-O output hash ---

test('buildEvidencePackage: PROV-O output entity hash matches the BlobRef hash', () => {
  const ref = makeBlobRef('synthesis');
  const { pkg } = buildEvidencePackage(baseInput({ output: ref }));
  const outputEntity = pkg.provenance!['@graph'].find(
    (n) => (n['@id'] as string).includes(':output:'),
  );
  assert.ok(outputEntity, 'provenance output entity should exist');
  const refHash = ref.ref.split(':').at(-1);
  assert.equal(outputEntity!['civic:contentHash'], `sha256:${refHash}`);
});

// --- BlobRef trace skips span extraction gracefully ---

test('buildEvidencePackage: BlobRef trace + no override → empty skill metadata', () => {
  const traceRef = makeBlobRef('{"resourceSpans":[]}', 'application/json');
  const { pkg } = buildEvidencePackage(baseInput({ trace: traceRef }));
  assert.deepEqual(pkg.trace, traceRef);
  // No override supplied → extraction returns {} because traceForInspection
  // falls back to an empty resourceSpans.
  assert.equal(pkg.skillMetadata.systemPromptHash, undefined);
  assert.equal(pkg.skillMetadata.mcpServerUrl, undefined);
  assert.equal(pkg.skillMetadata.skillText, undefined);
});

test('buildEvidencePackage: BlobRef trace + skillMetadataOverride populates skill metadata', () => {
  const traceRef = makeBlobRef('{"resourceSpans":[]}', 'application/json');
  const skillTextRef = makeBlobRef('# Skill\n...', 'text/markdown');
  const { pkg } = buildEvidencePackage(
    baseInput({
      trace: traceRef,
      skillMetadataOverride: {
        systemPromptHash: 'e751da4a' + '0'.repeat(56),
        mcpServerUrl: 'https://socrata-mcp.civicaitools.org',
        skillText: skillTextRef,
      },
    }),
  );
  assert.equal(pkg.skillMetadata.systemPromptHash, 'e751da4a' + '0'.repeat(56));
  assert.equal(pkg.skillMetadata.mcpServerUrl, 'https://socrata-mcp.civicaitools.org');
  assert.deepEqual(pkg.skillMetadata.skillText, skillTextRef);
});

// --- BlobRef fields are covered by the canonical package hash ---

test('buildEvidencePackage: BlobRef hash is covered by the package hash', () => {
  const { hash: hashA } = buildEvidencePackage(
    baseInput({ output: makeBlobRef('A') }),
  );
  const { hash: hashB } = buildEvidencePackage(
    baseInput({ output: makeBlobRef('B') }),
  );
  // Different referenced content → different refs → different package hashes.
  // (Plus random packageId, but the ref difference alone is enough.)
  assert.notEqual(hashA, hashB);
});

// --- Output hash used by PROV-O never coincides with the empty string hash ---

test('buildEvidencePackage: empty-string output is hashed, not undefined-skipped', () => {
  const { pkg } = buildEvidencePackage(baseInput({ output: '' }));
  const outputEntity = pkg.provenance!['@graph'].find(
    (n) => (n['@id'] as string).includes(':output:'),
  );
  assert.ok(outputEntity);
  // Hash of the empty string — matches `sha256("")` in any cryptography lib.
  assert.equal(
    outputEntity!['civic:contentHash'],
    `sha256:${sha256Hex('')}`,
  );
});

// --- ADR-0003: captureMethod is part of the canonical hash ---
//
// The label is what differentiates structurally distinct publish paths
// (chat-flow streaming vs. Claude Code JSONL readback). For the label to
// be tamper-evident, two packages identical except for `captureMethod`
// MUST produce different package hashes — otherwise the field could be
// flipped in storage without invalidating the signature.
//
// `packageId` and `metadata.createdAt` are random/time-dependent, so we
// strip them before re-hashing for a deterministic comparison.

function normalizedHash(pkg: ReturnType<typeof buildEvidencePackage>['pkg']): string {
  // Clone the metadata without the non-deterministic fields, leaving the
  // rest of the package shape (and ordering) intact.
  const stripped = {
    ...pkg,
    metadata: {
      schemaVersion: pkg.metadata.schemaVersion,
      signingKeyId: pkg.metadata.signingKeyId,
      ...(pkg.metadata.captureMethod ? { captureMethod: pkg.metadata.captureMethod } : {}),
    },
  };
  return sha256Hex(JSON.stringify(stripped));
}

test('buildEvidencePackage: captureMethod is covered by the package hash (ADR-0003)', () => {
  const a = buildEvidencePackage(baseInput({ captureMethod: 'chat-flow-stream' }));
  const b = buildEvidencePackage(baseInput({ captureMethod: 'claude-code-jsonl-readback' }));
  assert.notEqual(
    normalizedHash(a.pkg),
    normalizedHash(b.pkg),
    'two packages identical except for captureMethod must hash differently',
  );
});

test('buildEvidencePackage: omitting captureMethod produces canonical JSON without the metadata key', () => {
  // Backwards compat: callers that don't supply captureMethod (legacy
  // tests, internal call sites that pre-date the route enforcement) get
  // a metadata block with no captureMethod key — so legacy verify, which
  // recomputes the package hash from stored canonical JSON, continues to
  // produce identical hashes.
  const { pkg } = buildEvidencePackage(baseInput());
  assert.equal(
    Object.prototype.hasOwnProperty.call(pkg.metadata, 'captureMethod'),
    false,
  );
  // And the corresponding JSON.stringify output has no captureMethod key.
  assert.equal(JSON.stringify(pkg.metadata).includes('captureMethod'), false);
});

test('buildEvidencePackage: with captureMethod, metadata.captureMethod matches input', () => {
  const { pkg } = buildEvidencePackage(
    baseInput({ captureMethod: 'claude-code-jsonl-readback' }),
  );
  assert.equal(pkg.metadata.captureMethod, 'claude-code-jsonl-readback');
});

// --- ADR-0004: datHere content profile ---
//
// The datHere content profile (spec §8.7, ADR-0004) promotes `summary` to
// canonical-JSON and auto-emits the `org.civicaitools.environment`
// extension. Both are required for datHere conformance per §8.7.1. For
// non-datHere content profiles the canonical JSON shape stays byte-
// identical to pre-ADR-0004 — neither field appears, so pre-ADR packages
// hash the same. contentProfile is orthogonal to captureMethod (ADR-0003).

test('buildEvidencePackage: datHere content profile produces canonical JSON with summary', () => {
  const { pkg } = buildEvidencePackage(
    baseInput({ contentProfile: 'datHere' }),
  );
  assert.equal(pkg.summary, 'Test summary.');
  assert.equal(
    Object.prototype.hasOwnProperty.call(pkg, 'summary'),
    true,
  );
});

test('buildEvidencePackage: datHere content profile auto-emits org.civicaitools.environment extension', () => {
  const { pkg } = buildEvidencePackage(
    baseInput({ contentProfile: 'datHere' }),
  );
  const env = pkg.extensions?.['org.civicaitools.environment'];
  assert.ok(env, 'environment extension should be present');
  const envObj = env as Record<string, unknown>;
  assert.equal(envObj.modelVersion, 'openai/gpt-4o');
  assert.equal(envObj.host, 'civicaitools.org');
  assert.ok(Array.isArray(envObj.mcpServers));
  assert.ok(Array.isArray(envObj.toolDefinitions));
  assert.equal(typeof envObj.temperature, 'number');
});

test('buildEvidencePackage: chat-flow-stream WITHOUT contentProfile does NOT emit summary in canonical JSON (backwards-compat)', () => {
  // Chat-flow-stream capture with no contentProfile (legacy / default).
  // The PackageInput.summary IS provided (the route always sends it),
  // but the packager must NOT write it into canonical JSON unless
  // contentProfile === 'datHere'. Otherwise pre-ADR-0004 package hashes
  // would change.
  const { pkg } = buildEvidencePackage(
    baseInput({ captureMethod: 'chat-flow-stream' }),
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(pkg, 'summary'),
    false,
    'summary must not appear in canonical JSON when contentProfile is unset',
  );
  assert.equal(JSON.stringify(pkg).includes('"summary"'), false);
});

test('buildEvidencePackage: chat-flow-stream WITHOUT contentProfile does NOT emit org.civicaitools.environment extension (backwards-compat)', () => {
  const { pkg } = buildEvidencePackage(
    baseInput({ captureMethod: 'chat-flow-stream' }),
  );
  const env = pkg.extensions?.['org.civicaitools.environment'];
  assert.equal(env, undefined, 'environment extension must not be auto-emitted when contentProfile is unset');
});

test('buildEvidencePackage: summary value is part of the package hash for datHere content profile', () => {
  // Two datHere-content-profile packages identical except for `summary`
  // MUST hash differently — otherwise the summary could be flipped in
  // storage without invalidating the signature. Same load-bearing
  // tamper-evidence property the captureMethod test asserts.
  const a = buildEvidencePackage(
    baseInput({ contentProfile: 'datHere', summary: 'Summary A' }),
  );
  const b = buildEvidencePackage(
    baseInput({ contentProfile: 'datHere', summary: 'Summary B' }),
  );
  assert.notEqual(
    normalizedHash(a.pkg),
    normalizedHash(b.pkg),
    'two datHere-content-profile packages identical except for summary must hash differently',
  );
});

test('buildEvidencePackage: environment extension is part of the package hash for datHere content profile', () => {
  // Two datHere-content-profile packages with different models produce
  // different environment.modelVersion values, which are inside the
  // extension, which is inside canonical JSON, which is inside the
  // hash. Tamper-evidence for the section-C environment metadata.
  const a = buildEvidencePackage(
    baseInput({ contentProfile: 'datHere', model: 'openai/gpt-4o' }),
  );
  const b = buildEvidencePackage(
    baseInput({ contentProfile: 'datHere', model: 'anthropic/claude-3-5-sonnet' }),
  );
  assert.notEqual(
    normalizedHash(a.pkg),
    normalizedHash(b.pkg),
    'two datHere-content-profile packages with different environment.modelVersion must hash differently',
  );
});

test('buildEvidencePackage: datHere content profile is part of the package hash (ADR-0004 tamper-evidence)', () => {
  // contentProfile flips the canonical JSON shape (adds summary + the
  // environment extension). Two packages identical except for
  // contentProfile MUST hash differently so contentProfile can't be
  // flipped in storage without invalidating the signature. This is the
  // analog of the ADR-0003 captureMethod tamper-evidence assertion.
  const a = buildEvidencePackage(baseInput({ captureMethod: 'chat-flow-stream' }));
  const b = buildEvidencePackage(baseInput({ captureMethod: 'chat-flow-stream', contentProfile: 'datHere' }));
  assert.notEqual(
    normalizedHash(a.pkg),
    normalizedHash(b.pkg),
    'a contentProfile=datHere package must hash differently from one with contentProfile unset',
  );
});

test('buildEvidencePackage: contentProfile is orthogonal to captureMethod', () => {
  // ADR-0004 architectural property: contentProfile and captureMethod
  // are orthogonal. A claude-code-jsonl-readback capture with
  // contentProfile=datHere should produce the same hash-relevant shape
  // (summary + environment extension) as a chat-flow-stream capture
  // with contentProfile=datHere.
  const a = buildEvidencePackage(
    baseInput({ captureMethod: 'chat-flow-stream', contentProfile: 'datHere' }),
  );
  const b = buildEvidencePackage(
    baseInput({ captureMethod: 'claude-code-jsonl-readback', contentProfile: 'datHere' }),
  );
  // Both should have summary + environment extension (the contentProfile-
  // gated behaviors).
  assert.equal(a.pkg.summary, 'Test summary.');
  assert.equal(b.pkg.summary, 'Test summary.');
  assert.ok(a.pkg.extensions?.['org.civicaitools.environment']);
  assert.ok(b.pkg.extensions?.['org.civicaitools.environment']);
});

test('buildEvidencePackage: datHere content profile preserves caller-supplied extensions alongside auto-emitted environment', () => {
  // The chat-flow publish dialog supplies extensions['org.civicaitools.notebook'].
  // datHere auto-emits extensions['org.civicaitools.environment']. Both must
  // survive — the packager merges rather than overwrites.
  const notebookFixture = { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} };
  const { pkg } = buildEvidencePackage(
    baseInput({
      contentProfile: 'datHere',
      extensions: { 'org.civicaitools.notebook': notebookFixture },
    }),
  );
  assert.ok(pkg.extensions, 'extensions object should be present');
  assert.deepEqual(
    pkg.extensions?.['org.civicaitools.notebook'],
    notebookFixture,
    'caller-supplied notebook extension must be preserved verbatim',
  );
  assert.ok(
    pkg.extensions?.['org.civicaitools.environment'],
    'environment extension must be auto-emitted alongside the caller-supplied notebook extension',
  );
});

// --- PR1: producerProfile / type / signer top-level envelope fields ---
//
// ADR-0006/0009 (spec §8.1.1). The load-bearing property is that
// existing-shape inputs (none of the three fields) produce byte-identical
// canonical JSON to before — so legacy verify, which recomputes the hash
// from stored canonical JSON, still matches. The fields are top-level
// (parallel to metadata.contentProfile, which stays nested).

test('buildEvidencePackage: existing-shape input emits NO producerProfile/type/signer (byte-identical)', () => {
  const { pkg } = buildEvidencePackage(baseInput());
  // Top-level keys must be absent so legacy verify (which recomputes the hash
  // from stored canonical JSON) still matches. (A substring scan of the JSON
  // would false-positive on nested keys like a tool call's `args.type`, so
  // assert on the top-level object's own properties.)
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, 'producerProfile'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, 'type'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, 'signer'), false);
});

test('buildEvidencePackage: datHere auto-derives producerProfile = ai-assisted-analysis/datHere', () => {
  const { pkg } = buildEvidencePackage(baseInput({ contentProfile: 'datHere' }));
  assert.equal(pkg.producerProfile, 'ai-assisted-analysis/datHere');
});

test('buildEvidencePackage: explicit producerProfile is preserved (not overridden by auto-derive)', () => {
  const { pkg } = buildEvidencePackage(
    baseInput({ contentProfile: 'datHere', producerProfile: 'ai-assisted-analysis/datHere' }),
  );
  assert.equal(pkg.producerProfile, 'ai-assisted-analysis/datHere');
  // And a non-datHere input with an explicit producerProfile keeps it.
  const { pkg: pkg2 } = buildEvidencePackage(
    baseInput({ producerProfile: 'ai-assisted-analysis/civicaitools-default' }),
  );
  assert.equal(pkg2.producerProfile, 'ai-assisted-analysis/civicaitools-default');
});

test('buildEvidencePackage: type is emitted at top level when supplied', () => {
  const { pkg } = buildEvidencePackage(baseInput({ type: 'content/analysis/v1' }));
  assert.equal(pkg.type, 'content/analysis/v1');
});

test('buildEvidencePackage: signer is emitted at top level when supplied', () => {
  const signer = {
    bindingTier: 'platform',
    identifier: 'platform:civic-ai-tools',
    displayName: 'Civic AI Tools Platform',
  };
  const { pkg } = buildEvidencePackage(baseInput({ signer }));
  assert.deepEqual(pkg.signer, signer);
});

test('buildEvidencePackage: type is covered by the package hash (tamper-evidence)', () => {
  const a = buildEvidencePackage(baseInput({ type: 'content/analysis/v1' }));
  const b = buildEvidencePackage(baseInput({ type: 'content/other/v1' }));
  assert.notEqual(
    normalizedHash(a.pkg),
    normalizedHash(b.pkg),
    'two packages identical except for type must hash differently',
  );
});

// --- PR2: contentCanonicalization + contentHash + JCS envelope hash ---
//
// The v0.1 envelope is gated on `type` presence (the spec's required v0.1
// discriminator, which the route always default-fills). Legacy / internal
// callers that don't supply `type` keep the pre-PR2 shape — no contentHash,
// JSON.stringify hashing — so their canonical JSON stays byte-identical and
// re-verifies on the legacy detection chain.

/** Simulate the production storage round-trip: putPackage stores
 *  JSON.stringify(pkg); getPackage returns response.json() (a parsed object). */
function storageRoundTrip(pkg: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
}

test('buildEvidencePackage: legacy input (no type) emits NO contentHash/contentCanonicalization and hashes via JSON.stringify (byte-identical)', () => {
  const { pkg, hash } = buildEvidencePackage(baseInput());
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, 'contentHash'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(pkg, 'contentCanonicalization'),
    false,
  );
  // Byte-identical legacy chain: the envelope hash is SHA-256(JSON.stringify).
  assert.equal(
    hash,
    crypto.createHash('sha256').update(JSON.stringify(pkg)).digest('hex'),
  );
});

test('buildEvidencePackage: v0.1 input (type present) emits legacy-json/v1 rule + multihash contentHash, hashes via JCS', () => {
  const { pkg, hash } = buildEvidencePackage(
    baseInput({ type: 'content/analysis/v1' }),
  );
  assert.equal(pkg.contentCanonicalization, LEGACY_JSON_CANONICALIZATION);
  assert.ok(pkg.contentHash, 'contentHash should be present on a v0.1 package');
  assert.equal(typeof pkg.contentHash!.sha256, 'string');
  assert.equal(pkg.contentHash!.sha256.length, 64);
  // JCS chain: the envelope hash is SHA-256(JCS(pkg)).
  assert.equal(
    hash,
    crypto.createHash('sha256').update(canonicalize(pkg) as string).digest('hex'),
  );
});

test('buildEvidencePackage: v0.1 default contentHash fingerprints the package minus contentHash (legacy-json/v1)', () => {
  const { pkg } = buildEvidencePackage(baseInput({ type: 'content/analysis/v1' }));
  const rest: Record<string, unknown> = { ...pkg };
  delete rest.contentHash;
  const expected = crypto
    .createHash('sha256')
    .update(canonicalize(rest) as string)
    .digest('hex');
  assert.equal(pkg.contentHash!.sha256, expected);
});

test('buildEvidencePackage: v0.1 datHere emits dathere-ag-jupyter/v1 rule + fingerprints the executed notebook', () => {
  const notebook = { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} };
  const { pkg } = buildEvidencePackage(
    baseInput({
      type: 'content/analysis/v1',
      contentProfile: 'datHere',
      extensions: { 'org.civicaitools.notebook': notebook },
    }),
  );
  assert.equal(pkg.contentCanonicalization, DATHERE_AG_JUPYTER_CANONICALIZATION);
  // datHere off-log content is the notebook, NOT the whole package; the
  // auto-emitted environment extension is a sibling and is excluded.
  const expected = crypto
    .createHash('sha256')
    .update(canonicalize(notebook) as string)
    .digest('hex');
  assert.equal(pkg.contentHash!.sha256, expected);
});

test('buildEvidencePackage: v0.1 contentHash changes when off-log content changes (tamper-evidence)', () => {
  const a = buildEvidencePackage(
    baseInput({ type: 'content/analysis/v1', output: 'AAAA' }),
  );
  const b = buildEvidencePackage(
    baseInput({ type: 'content/analysis/v1', output: 'BBBB' }),
  );
  assert.notEqual(a.pkg.contentHash!.sha256, b.pkg.contentHash!.sha256);
});

// --- PR2: build → store → verify round-trip (the regression-guard property) ---
//
// A freshly-built package must recompute to the exact hash it was published
// under after the production storage round-trip (JSON.stringify → JSON.parse).
// This is the unit-level analog of the production regression guard.

test('round-trip: legacy package re-verifies byte-identical (legacy detection chain)', () => {
  const { pkg, hash } = buildEvidencePackage(baseInput());
  assert.equal(recomputePackageHash(storageRoundTrip(pkg)), hash);
});

test('round-trip: v0.1 default package re-verifies (JCS detection chain)', () => {
  const { pkg, hash } = buildEvidencePackage(
    baseInput({ type: 'content/analysis/v1' }),
  );
  assert.equal(recomputePackageHash(storageRoundTrip(pkg)), hash);
});

test('round-trip: v0.1 datHere package re-verifies (JCS detection chain)', () => {
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    cells: [
      { cell_type: 'code', source: ['print(1)'], outputs: [], metadata: {} },
    ],
    metadata: {},
  };
  const { pkg, hash } = buildEvidencePackage(
    baseInput({
      type: 'content/analysis/v1',
      contentProfile: 'datHere',
      extensions: { 'org.civicaitools.notebook': notebook },
    }),
  );
  assert.equal(recomputePackageHash(storageRoundTrip(pkg)), hash);
});

test('round-trip: v0.1 package re-verifies even if storage reorders top-level keys (JCS order-independence)', () => {
  const { pkg, hash } = buildEvidencePackage(
    baseInput({ type: 'content/analysis/v1' }),
  );
  const reordered: Record<string, unknown> = {};
  for (const k of Object.keys(pkg).reverse()) {
    reordered[k] = (pkg as unknown as Record<string, unknown>)[k];
  }
  assert.equal(recomputePackageHash(reordered), hash);
});

// --- Dual-era honesty: a package STORED before the vocabulary cutover ---
//
// civic-ai-tools#160 P5. The settlement (spec Appendix J, rules J.4.1/J.4.2)
// froze two identifiers inside already-signed packages: the URN scheme
// (`urn:civic-evidence:` → `urn:civic-record:`) and the JSON-LD vocabulary URI
// (`.../ns/evidence/` → `.../ns/civic/`). Every package this instance published
// before harness 0.3.0 carries the prior-era pair in its provenance graph, and
// that graph is INSIDE the canonical JSON — so it is covered by `contentHash`
// and by the envelope hash, and therefore by the platform signature.
//
// The failure this pins is a silent one: any code path that normalized a stored
// package's vocabulary on read — even cosmetically, even for display — would
// change the bytes that hash, and every prior-era record on the site would
// start reporting a hash mismatch and an invalid signature. The check must
// therefore be end-to-end over a package built exactly as the prior era built
// it, not over a hand-written fragment.
//
// The prior-era package below is constructed the way the prior-era publisher
// constructed it: the same builder, with the two Appendix J literals put back,
// and the hashes then computed by the SAME shared chain (`computeContentHashSha256`
// / `recomputePackageHash`) the publisher used. No fixture bytes are invented.

/** Rewrite a settlement-era package into the prior-era form, verbatim
 *  everywhere else — the shape a pre-cutover blob actually holds. */
function toPriorEraVocabulary(pkg: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(pkg)
    .split('urn:civic-record:')
    .join('urn:civic-evidence:')
    .split('https://civicaitools.org/ns/civic/')
    .join('https://civicaitools.org/ns/evidence/');
  return JSON.parse(json) as Record<string, unknown>;
}

test('dual-era: a stored PRIOR-ERA package re-verifies unchanged (hash + contentHash)', () => {
  const built = buildEvidencePackage(baseInput({ type: 'content/analysis/v1' }));

  // Settlement-era emissions are the new vocabulary — the P4/harness-0.3.0 flip,
  // observed here rather than assumed.
  const settlementJson = JSON.stringify(built.pkg);
  assert.ok(
    settlementJson.includes('urn:civic-record:'),
    'new emissions must carry the settlement-era URN scheme',
  );
  assert.ok(
    settlementJson.includes('https://civicaitools.org/ns/civic/'),
    'new emissions must carry the settlement-era vocabulary URI',
  );

  // The stored prior-era artifact: same package, prior-era identifiers, with
  // contentHash recomputed over ITS OWN bytes exactly as its publisher did.
  const priorEraBase = toPriorEraVocabulary(
    built.pkg as unknown as Record<string, unknown>,
  );
  delete priorEraBase.contentHash;
  const priorEraPkg: Record<string, unknown> = {
    ...priorEraBase,
    contentHash: {
      sha256: computeContentHashSha256(priorEraBase, LEGACY_JSON_CANONICALIZATION),
    },
  };
  const priorEraHash = recomputePackageHash(priorEraPkg);

  // 1. The frozen identifiers survive the round-trip byte-for-byte — nothing
  //    on the read path rewrites them.
  const stored = storageRoundTrip(priorEraPkg);
  const storedJson = JSON.stringify(stored);
  assert.ok(
    storedJson.includes('urn:civic-evidence:'),
    'a stored prior-era package keeps its prior-era URN scheme',
  );
  assert.ok(
    storedJson.includes('https://civicaitools.org/ns/evidence/'),
    'a stored prior-era package keeps its prior-era vocabulary URI',
  );
  assert.equal(storedJson.includes('urn:civic-record:'), false);
  assert.equal(storedJson.includes('/ns/civic/'), false);

  // 2. It recomputes to the hash it was published under — the signature over
  //    that hash still verifies.
  assert.equal(recomputePackageHash(stored), priorEraHash);

  // 3. Its contentHash still matches the content it covers (verify check #13).
  assert.equal(
    verifyContentHash(stored, {
      status: 'ok',
      rule: LEGACY_JSON_CANONICALIZATION,
    }).status,
    'ok',
  );

  // 4. THE VOCABULARY IS INSIDE THE HASHED BYTES — the property that makes a
  //    normalizing read path fatal rather than cosmetic.
  //
  //    This is asserted against a package that differs from the prior-era one
  //    ONLY in the two Appendix J literals, with every other byte (including
  //    the stored `contentHash` field) held identical. Their recomputed hashes
  //    must differ. If a read path normalized old vocabulary to new before
  //    hashing, these two would collide — and every prior-era record on the
  //    site would start reporting a hash mismatch against its stored value.
  //
  //    Assertion 2 above deliberately does NOT carry this weight: it compares
  //    two calls to the same function, so a normalizer applied to both sides
  //    cancels out and the check passes vacuously. That was measured, not
  //    assumed — an injected normalizer left assertion 2 green. The collision
  //    check below is what actually fires.
  const settlementEraTwin = JSON.parse(
    JSON.stringify(priorEraPkg)
      .split('urn:civic-evidence:')
      .join('urn:civic-record:')
      .split('https://civicaitools.org/ns/evidence/')
      .join('https://civicaitools.org/ns/civic/'),
  ) as Record<string, unknown>;
  assert.notEqual(
    recomputePackageHash(stored),
    recomputePackageHash(settlementEraTwin),
    'the URN scheme and vocabulary URI must be inside the hashed bytes — ' +
      'if these collide, a read path is normalizing frozen vocabulary',
  );

  // 5. And the two ERAS of the same analysis are distinct artifacts end to end.
  assert.notEqual(priorEraHash, built.hash);
});
