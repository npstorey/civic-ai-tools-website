// Unit tests for the PR3 attestation node builder (spec §8.10, §8.12).
// Confirms a conformant attestation envelope, the nodeId-as-JCS-envelope-hash
// (re-verifying through a storage round-trip), the legacy-json/v1 content hash,
// and tamper-evidence of the payload.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import canonicalize from 'canonicalize';
import {
  buildAttestationNode,
  ATTESTATION_WITHDRAWS,
  ATTESTATION_REINSTATES,
  ATTESTATION_PUBLISHES,
  ATTESTATION_LOCATED_AT,
  ATTESTATION_EVALUATES,
} from './attestation.ts';
import {
  computeEnvelopeHash,
  LEGACY_JSON_CANONICALIZATION,
} from './canonicalization.ts';

const SIGNER = {
  bindingTier: 'platform',
  identifier: 'platform:civic-ai-tools',
  displayName: 'Civic AI Tools Platform',
};
const TARGET = 'a'.repeat(64);

test('buildAttestationNode: withdraws node carries the conformant envelope fields', () => {
  const { node, nodeId } = buildAttestationNode({
    type: ATTESTATION_WITHDRAWS,
    targetNodeId: TARGET,
    signer: SIGNER,
    reason: 'data error in source dataset',
  });
  assert.equal(node.type, ATTESTATION_WITHDRAWS);
  assert.equal(node.targetNodeId, TARGET);
  assert.deepEqual(node.signer, SIGNER);
  assert.equal(node.contentCanonicalization, LEGACY_JSON_CANONICALIZATION);
  assert.ok(node.contentHash, 'contentHash should be present');
  assert.equal(node.contentHash!.sha256.length, 64);
  assert.equal(node.reason, 'data error in source dataset');
  // effectiveAt defaults to the envelope timestamp (§8.12.1).
  assert.equal(node.effectiveAt, node.metadata.createdAt);
  assert.equal(nodeId.length, 64);
});

test('buildAttestationNode: nodeId is the JCS envelope hash and re-verifies after a storage round-trip', () => {
  const { node, nodeId } = buildAttestationNode({
    type: ATTESTATION_WITHDRAWS,
    targetNodeId: TARGET,
    signer: SIGNER,
    reason: 'x',
  });
  const roundTripped = JSON.parse(JSON.stringify(node));
  assert.equal(computeEnvelopeHash(roundTripped), nodeId);
});

test('buildAttestationNode: contentHash fingerprints the node minus contentHash (legacy-json/v1)', () => {
  const { node } = buildAttestationNode({
    type: ATTESTATION_WITHDRAWS,
    targetNodeId: TARGET,
    signer: SIGNER,
    reason: 'x',
  });
  const rest: Record<string, unknown> = { ...node };
  delete rest.contentHash;
  const expected = crypto
    .createHash('sha256')
    .update(canonicalize(rest) as string)
    .digest('hex');
  assert.equal(node.contentHash!.sha256, expected);
});

test('buildAttestationNode: reinstates node carries priorWithdrawalNodeId and no effectiveAt', () => {
  const prior = 'b'.repeat(64);
  const { node } = buildAttestationNode({
    type: ATTESTATION_REINSTATES,
    targetNodeId: TARGET,
    signer: SIGNER,
    reason: 'source corrected',
    priorWithdrawalNodeId: prior,
  });
  assert.equal(node.type, ATTESTATION_REINSTATES);
  assert.equal(node.priorWithdrawalNodeId, prior);
  // effectiveAt is a withdraws-only payload field.
  assert.equal(node.effectiveAt, undefined);
});

test('buildAttestationNode: different reason → different nodeId (tamper-evidence)', () => {
  const a = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: TARGET, signer: SIGNER, reason: 'reason A' });
  const b = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: TARGET, signer: SIGNER, reason: 'reason B' });
  assert.notEqual(a.nodeId, b.nodeId);
});

test('buildAttestationNode: different targetNodeId → different nodeId', () => {
  const a = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: 'a'.repeat(64), signer: SIGNER, reason: 'x' });
  const b = buildAttestationNode({ type: ATTESTATION_WITHDRAWS, targetNodeId: 'c'.repeat(64), signer: SIGNER, reason: 'x' });
  assert.notEqual(a.nodeId, b.nodeId);
});

// --- Publication pair sub-types (spec §8.10/§8.12.1, ADR-0010 §6; Phase 2) ---

test('buildAttestationNode: publishes node carries publicationHost + releasedAt (defaults to envelope ts)', () => {
  const { node, nodeId } = buildAttestationNode({
    type: ATTESTATION_PUBLISHES,
    targetNodeId: TARGET,
    signer: SIGNER,
    publicationHost: 'civicaitools.org',
  });
  assert.equal(node.type, ATTESTATION_PUBLISHES);
  assert.equal(node.targetNodeId, TARGET);
  assert.equal(node.publicationHost, 'civicaitools.org');
  // releasedAt defaults to the envelope timestamp, mirroring effectiveAt's rule.
  assert.equal(node.releasedAt, node.metadata.createdAt);
  // publishes carries no withdraws-only fields.
  assert.equal(node.effectiveAt, undefined);
  assert.equal(nodeId.length, 64);
  // Round-trip re-verification (same dual-chain hash as content packages).
  assert.equal(computeEnvelopeHash(JSON.parse(JSON.stringify(node))), nodeId);
});

test('buildAttestationNode: locatedAt node carries uri + targetContentHash distinct from its own contentHash (Q48)', () => {
  const targetFingerprint = { sha256: 'd'.repeat(64) };
  const { node, nodeId } = buildAttestationNode({
    type: ATTESTATION_LOCATED_AT,
    targetNodeId: TARGET,
    signer: SIGNER,
    uri: 'https://blob.example/evidence-packages/aaaa.json',
    targetContentHash: targetFingerprint,
    contentLength: 1234,
  });
  assert.equal(node.type, ATTESTATION_LOCATED_AT);
  assert.equal(node.uri, 'https://blob.example/evidence-packages/aaaa.json');
  assert.equal(node.contentLength, 1234);
  // Q48: the TARGET's fingerprint lives at targetContentHash; the envelope's
  // own structural-primitive contentHash is computed by the builder and MUST
  // be a different value (it fingerprints this attestation, not the target).
  assert.deepEqual(node.targetContentHash, targetFingerprint);
  assert.ok(node.contentHash, 'envelope contentHash should still be present');
  assert.notEqual(node.contentHash!.sha256, targetFingerprint.sha256);
  assert.equal(computeEnvelopeHash(JSON.parse(JSON.stringify(node))), nodeId);
});

test('buildAttestationNode: locatedAt omits optional fields when not supplied', () => {
  const { node } = buildAttestationNode({
    type: ATTESTATION_LOCATED_AT,
    targetNodeId: TARGET,
    signer: SIGNER,
    uri: 'https://blob.example/x.json',
  });
  assert.ok(!('targetContentHash' in node));
  assert.ok(!('contentLength' in node));
});

test('buildAttestationNode: different uri → different locatedAt nodeId (tamper-evidence)', () => {
  const a = buildAttestationNode({ type: ATTESTATION_LOCATED_AT, targetNodeId: TARGET, signer: SIGNER, uri: 'https://host-a.example/x.json' });
  const b = buildAttestationNode({ type: ATTESTATION_LOCATED_AT, targetNodeId: TARGET, signer: SIGNER, uri: 'https://host-b.example/x.json' });
  assert.notEqual(a.nodeId, b.nodeId);
});

// --- Adversarial evaluation sub-type (spec §8.12.1; civic-ai-tools#72) ---

test('buildAttestationNode: evaluates node carries methodology + scoringRubric + results', () => {
  const methodology = {
    testSet: 'civicaitools-adversarial-rubric/six-criterion-v1',
    promptSetVersion: 'e'.repeat(64),
    evaluatorModel: 'anthropic/claude-sonnet-4-6',
  };
  const results = {
    perCriterion: { dataSourceIdentification: { score: 8, comment: 'solid' } },
    overallScore: 8,
    assessment: 'Good.',
  };
  const { node, nodeId } = buildAttestationNode({
    type: ATTESTATION_EVALUATES,
    targetNodeId: TARGET,
    signer: SIGNER,
    methodology,
    scoringRubric: methodology.testSet,
    results,
  });
  assert.equal(node.type, ATTESTATION_EVALUATES);
  assert.deepEqual(node.methodology, methodology);
  assert.equal(node.scoringRubric, methodology.testSet);
  assert.deepEqual(node.results, results);
  // Q26: evaluator binding rides the envelope signer, not a payload field.
  assert.deepEqual(node.signer, SIGNER);
  assert.ok(!('evaluatorBindingTier' in node));
  assert.equal(computeEnvelopeHash(JSON.parse(JSON.stringify(node))), nodeId);
});

test('buildAttestationNode: different results → different evaluates nodeId (tamper-evidence)', () => {
  const mk = (score: number) =>
    buildAttestationNode({
      type: ATTESTATION_EVALUATES,
      targetNodeId: TARGET,
      signer: SIGNER,
      methodology: { testSet: 't', promptSetVersion: 'v', evaluatorModel: 'm' },
      scoringRubric: 't',
      results: { perCriterion: {}, overallScore: score, assessment: '' },
    });
  assert.notEqual(mk(3).nodeId, mk(9).nodeId);
});
