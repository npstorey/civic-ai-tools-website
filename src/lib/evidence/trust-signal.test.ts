// Coverage + tier-correctness tests for the trust-signal vocabulary
// (civic-ai-tools-website#110). Two things are proven here:
//   1. TOTAL coverage — every status the verify route actually emits maps to a
//      valid tier, by enumerating the source-of-truth const-arrays. (Spec checks
//      #6 / #13 are NOT emitted as discrete status fields today, so they are
//      tiered in the design note only and intentionally not asserted here.)
//   2. The load-bearing splits and resolved judgment calls hold — including the
//      calm requirement: a synthetic pre-v0.1 legacy package tiers all-calm,
//      with zero amber/red on the default view.
//
// Run with: npm test (Node 22+).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTENT_CANONICALIZATION_STATUSES,
  CONTENT_HASH_STATUSES,
  KEY_TRUST_STATUSES,
  TYPE_RESOLUTION_STATUSES,
  SIGNER_IDENTITY_CHECK_STATUSES,
  CAPTURE_METHOD_VOCAB_STATUSES,
  LIFECYCLE_STATUSES,
  LIFECYCLE_SOURCES,
} from './verify.ts';
import { BLOB_REF_VERIFY_REASONS } from './blob-ref.ts';
import {
  TIER_META,
  toResolvedSignal,
  biKey,
  triKey,
  BI_STATE_KEYS,
  TRI_STATE_KEYS,
  ENVELOPE_INTEGRITY_SIGNALS,
  SIGNATURE_SIGNALS,
  CONTENT_CANONICALIZATION_SIGNALS,
  CONTENT_HASH_SIGNALS,
  KEY_TRUST_SIGNALS,
  TIMESTAMP_SIGNALS,
  REKOR_SIGNALS,
  BLOB_REFS_SIGNALS,
  BLOB_REF_REASON_SIGNALS,
  LIFECYCLE_STATE_SIGNALS,
  LIFECYCLE_SOURCE_SIGNALS,
  LIFECYCLE_ATTESTATION_SIGNATURE_SIGNALS,
  LIFECYCLE_ATTESTATION_NODE_ID_SIGNALS,
  LIFECYCLE_ATTESTATION_SIGNER_MATCH_SIGNALS,
  LIFECYCLE_ATTESTATION_TIMESTAMP_SIGNALS,
  LIFECYCLE_ATTESTATION_REKOR_SIGNALS,
  TYPE_RESOLUTION_SIGNALS,
  SIGNER_IDENTITY_SIGNALS,
  CAPTURE_METHOD_VOCAB_SIGNALS,
  CAPTURE_METHOD_LABELS,
  NOTEBOOK_PROVENANCE_VALUES,
  NOTEBOOK_PROVENANCE_SIGNALS,
  type TrustSignalDescriptor,
} from './trust-signal.ts';

// The valid tiers, derived from the source so the test cannot drift from it.
const VALID_TIERS = new Set(Object.keys(TIER_META));

/**
 * Assert that a status→descriptor map EXACTLY covers a status space: every
 * status has a descriptor with a valid tier + non-empty label, and the map has
 * no extra keys. Driven by the const-array, so a status added upstream that
 * isn't tiered here fails the test (and `Record<Status, …>` fails the compile).
 */
function assertExactCoverage<K extends string>(
  name: string,
  statuses: readonly K[],
  map: Record<K, TrustSignalDescriptor>,
) {
  for (const status of statuses) {
    const d = map[status];
    assert.ok(d, `${name}: status "${String(status)}" has no descriptor`);
    assert.ok(VALID_TIERS.has(d.tier), `${name}: status "${status}" → invalid tier "${d.tier}"`);
    assert.ok(d.label.length > 0, `${name}: status "${status}" has an empty label`);
  }
  assert.deepEqual(
    Object.keys(map).sort(),
    [...statuses].sort(),
    `${name}: map keys do not exactly match the emitted status space`,
  );
}

// --- Total coverage of the string-union status spaces --------------------

test('total coverage: every emitted string-union status maps to a valid tier', () => {
  assertExactCoverage('contentCanonicalization', CONTENT_CANONICALIZATION_STATUSES, CONTENT_CANONICALIZATION_SIGNALS);
  assertExactCoverage('contentHash', CONTENT_HASH_STATUSES, CONTENT_HASH_SIGNALS);
  assertExactCoverage('keyTrust', KEY_TRUST_STATUSES, KEY_TRUST_SIGNALS);
  assertExactCoverage('typeResolution', TYPE_RESOLUTION_STATUSES, TYPE_RESOLUTION_SIGNALS);
  assertExactCoverage('signerIdentity', SIGNER_IDENTITY_CHECK_STATUSES, SIGNER_IDENTITY_SIGNALS);
  assertExactCoverage('captureMethodVocab', CAPTURE_METHOD_VOCAB_STATUSES, CAPTURE_METHOD_VOCAB_SIGNALS);
  assertExactCoverage('lifecycleState', LIFECYCLE_STATUSES, LIFECYCLE_STATE_SIGNALS);
  assertExactCoverage('lifecycleSource', LIFECYCLE_SOURCES, LIFECYCLE_SOURCE_SIGNALS);
  assertExactCoverage('blobRefReason', BLOB_REF_VERIFY_REASONS, BLOB_REF_REASON_SIGNALS);
});

// --- Total coverage of the boolean-state checks --------------------------

test('total coverage: every boolean-state check covers its states with valid tiers', () => {
  assertExactCoverage('envelopeIntegrity', BI_STATE_KEYS, ENVELOPE_INTEGRITY_SIGNALS);
  assertExactCoverage('timestamp', BI_STATE_KEYS, TIMESTAMP_SIGNALS);
  assertExactCoverage('signature', TRI_STATE_KEYS, SIGNATURE_SIGNALS);
  assertExactCoverage('rekor', TRI_STATE_KEYS, REKOR_SIGNALS);
  assertExactCoverage('blobRefs', TRI_STATE_KEYS, BLOB_REFS_SIGNALS);
  // Lifecycle per-attestation signals.
  assertExactCoverage('lifecycle.signature', TRI_STATE_KEYS, LIFECYCLE_ATTESTATION_SIGNATURE_SIGNALS);
  assertExactCoverage('lifecycle.nodeId', BI_STATE_KEYS, LIFECYCLE_ATTESTATION_NODE_ID_SIGNALS);
  assertExactCoverage('lifecycle.signerMatch', BI_STATE_KEYS, LIFECYCLE_ATTESTATION_SIGNER_MATCH_SIGNALS);
  assertExactCoverage('lifecycle.timestamp', BI_STATE_KEYS, LIFECYCLE_ATTESTATION_TIMESTAMP_SIGNALS);
  assertExactCoverage('lifecycle.rekor', BI_STATE_KEYS, LIFECYCLE_ATTESTATION_REKOR_SIGNALS);
});

test('notebookProvenance: both readings covered and calm', () => {
  assertExactCoverage('notebookProvenance', NOTEBOOK_PROVENANCE_VALUES, NOTEBOOK_PROVENANCE_SIGNALS);
  for (const v of NOTEBOOK_PROVENANCE_VALUES) {
    assert.equal(NOTEBOOK_PROVENANCE_SIGNALS[v].tier, 'normal');
  }
});

// --- The load-bearing splits ---------------------------------------------

test('load-bearing split #4: legacy_relabeled=Normal vs content_hash_mismatch=Alarm (same check, opposite tiers)', () => {
  assert.equal(CONTENT_HASH_SIGNALS.legacy_relabeled.tier, 'normal');
  assert.equal(CONTENT_HASH_SIGNALS.content_hash_mismatch.tier, 'alarm');
});

test('load-bearing split #5: legacy_embedded=Normal vs revoked/deprecated_invalid=Alarm', () => {
  assert.equal(KEY_TRUST_SIGNALS.legacy_embedded.tier, 'normal');
  assert.equal(KEY_TRUST_SIGNALS.revoked.tier, 'alarm');
  assert.equal(KEY_TRUST_SIGNALS.deprecated_invalid.tier, 'alarm');
});

// --- The calm requirement: a synthetic legacy package shows zero red/amber

test('a synthetic pre-v0.1 legacy package tiers all-calm (zero attention/alarm)', () => {
  // The status set a signed pre-v0.1 (legacy-embedded) package produces across
  // every check. Each MUST resolve to verified or normal — never attention/alarm.
  const legacySignals: TrustSignalDescriptor[] = [
    ENVELOPE_INTEGRITY_SIGNALS[biKey(true)], //  #1 envelope intact
    SIGNATURE_SIGNALS[triKey(true)], //          #2 legacy embedded key verifies
    CONTENT_CANONICALIZATION_SIGNALS.implicit, //#3 rule inferred
    CONTENT_HASH_SIGNALS.legacy_relabeled, //    #4 slug hash relabeled
    KEY_TRUST_SIGNALS.legacy_embedded, //        #5 pre-registry signature
    TIMESTAMP_SIGNALS[biKey(false)], //          #7 no timestamp
    REKOR_SIGNALS[triKey(null)], //              #8 not logged
    BLOB_REFS_SIGNALS[triKey(null)], //          #9 all fields inline
    LIFECYCLE_STATE_SIGNALS.active, //          #10 not withdrawn
    LIFECYCLE_SOURCE_SIGNALS.none, //           #10 no lifecycle events
    TYPE_RESOLUTION_SIGNALS.implicit, //        #12 type inferred
    SIGNER_IDENTITY_SIGNALS.no_signer, //       #14 no envelope signer
    CAPTURE_METHOD_VOCAB_SIGNALS.no_capture_method, // #15 pre-ADR-0003
    NOTEBOOK_PROVENANCE_SIGNALS.skeleton, //     skeleton notebook
  ];
  for (const s of legacySignals) {
    assert.ok(
      s.tier === 'verified' || s.tier === 'normal',
      `legacy signal "${s.label}" tiered "${s.tier}" — a legacy package must read calm`,
    );
  }
  // And a fully-unsigned ancient package (no signature at all) is calm too.
  assert.ok(['verified', 'normal'].includes(SIGNATURE_SIGNALS[triKey(null)].tier));
});

// --- Resolved judgment calls (see docs/trust-signal-vocabulary.md §5) ----

test('judgment calls resolve as documented', () => {
  // Sharpest call: captureMethod_unknown is Attention (unrecognized signature-
  // covered label), not Alarm, despite spec #15 "rejects the node".
  assert.equal(CAPTURE_METHOD_VOCAB_SIGNALS.captureMethod_unknown.tier, 'attention');
  // signer_identity_mismatch is the genuine fatal identity failure → Alarm.
  assert.equal(SIGNER_IDENTITY_SIGNALS.signer_identity_mismatch.tier, 'alarm');
  // The "unrecognized identifier" family all sits at Attention.
  assert.equal(TYPE_RESOLUTION_SIGNALS.unknown_type.tier, 'attention');
  assert.equal(CONTENT_CANONICALIZATION_SIGNALS.unknown_canonicalization_rule.tier, 'attention');
  assert.equal(CONTENT_HASH_SIGNALS.unresolved_rule.tier, 'attention');
  assert.equal(CONTENT_HASH_SIGNALS.contentHash_no_supported_algorithm.tier, 'attention');
  assert.equal(KEY_TRUST_SIGNALS.unknown_key.tier, 'attention');
  assert.equal(KEY_TRUST_SIGNALS.registry_unavailable.tier, 'attention');
  // rekor=false is Attention (often transient / supplementary log), not Alarm.
  assert.equal(REKOR_SIGNALS.false.tier, 'attention');
  // Backwards-compat degradations stay calm (Normal).
  assert.equal(KEY_TRUST_SIGNALS.deprecated_valid.tier, 'normal');
  assert.equal(SIGNER_IDENTITY_SIGNALS.no_registry_identity.tier, 'normal');
  assert.equal(CAPTURE_METHOD_VOCAB_SIGNALS.producerProfile_bundle_unresolved.tier, 'normal');
});

test('every BlobRef failure reason is an Alarm sub-explanation', () => {
  for (const reason of BLOB_REF_VERIFY_REASONS) {
    assert.equal(BLOB_REF_REASON_SIGNALS[reason].tier, 'alarm', `blobRef reason "${reason}"`);
  }
});

test('lifecycle per-attestation: integrity falses are Alarm; signer-mismatch + supplementary are Normal', () => {
  // Forged / altered transition → Alarm.
  assert.equal(LIFECYCLE_ATTESTATION_SIGNATURE_SIGNALS.false.tier, 'alarm');
  assert.equal(LIFECYCLE_ATTESTATION_NODE_ID_SIGNALS.false.tier, 'alarm');
  // Deviation from the brief's grouping: a third-party (non-signer-matched)
  // attestation is a legitimately-surfaced event per §8.10.3 retention
  // asymmetry — it does not move the publisher's status → Normal, not Alarm.
  assert.equal(LIFECYCLE_ATTESTATION_SIGNER_MATCH_SIGNALS.false.tier, 'normal');
  // Supplementary checks → Normal when absent.
  assert.equal(LIFECYCLE_ATTESTATION_TIMESTAMP_SIGNALS.false.tier, 'normal');
  assert.equal(LIFECYCLE_ATTESTATION_REKOR_SIGNALS.false.tier, 'normal');
});

// --- Tier metadata + resolver plumbing -----------------------------------

test('TIER_META covers all four tiers with valid icons, colors, and aria labels', () => {
  assert.deepEqual(Object.keys(TIER_META).sort(), ['alarm', 'attention', 'normal', 'verified']);
  const validIcons = new Set(['check', 'info', 'warning', 'error']);
  for (const tier of Object.keys(TIER_META) as (keyof typeof TIER_META)[]) {
    const meta = TIER_META[tier];
    assert.ok(validIcons.has(meta.icon), `tier "${tier}" has invalid icon "${meta.icon}"`);
    assert.ok(meta.colorVar.startsWith('var('), `tier "${tier}" color is not a CSS var`);
    assert.ok(meta.ariaLabel.length > 0);
  }
});

test('toResolvedSignal attaches the tier default icon', () => {
  assert.equal(toResolvedSignal({ tier: 'verified', label: 'x' }).icon, 'check');
  assert.equal(toResolvedSignal({ tier: 'normal', label: 'x' }).icon, 'info');
  assert.equal(toResolvedSignal({ tier: 'attention', label: 'x' }).icon, 'warning');
  assert.equal(toResolvedSignal({ tier: 'alarm', label: 'x' }).icon, 'error');
});

test('captureMethod labels are informational (no tier) and cover the known methods', () => {
  // Mirrors the packager `CaptureMethod` union (not runtime-enumerable). Each is
  // a signature-covered LABEL rendered adjacent to the signature verdict, not a
  // tiered pass/fail signal (spec §9.2 #11).
  for (const method of ['chat-flow-stream', 'claude-code-jsonl-readback', 'claude-code-self-report'] as const) {
    assert.ok(CAPTURE_METHOD_LABELS[method].length > 0, `captureMethod label "${method}"`);
  }
});
