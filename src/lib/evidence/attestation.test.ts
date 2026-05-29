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
