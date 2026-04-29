// Packager tests exercising blob-reference pathways introduced in
// Phase B.6 (website#75). Confirms backward compatibility with inline
// content packages and that BlobRef inputs flow through the package JSON
// unchanged (so verifiers and renderers can still follow the reference).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { buildEvidencePackage, type PackageInput } from './packager.ts';
import type { BlobRef } from './blob-ref.ts';

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
