// Attestation node builder (spec §8.10, §8.12; ADR-0010) — app-side shim over
// @typedstandards/produce-core (S3a P1, #166; the verify-core shim pattern of
// #116-WS3 applied to the producer side).
//
// The builder body lives in produce-core's `buildAttestationNode` (ADR-0021 §A:
// envelope + attestation assembly are FORMAT; the sub-type constants and
// methodology/results payload types travel with it). The core is deterministic —
// `packageId` / `createdAt` / `signingKeyId` are caller-supplied inputs
// (ADR-0021 §D) — so this wrapper is where the app supplies them: RNG for the
// packageId, the clock for createdAt, and the active platform key id. Every
// existing importer keeps working unchanged: `buildAttestationNode(input)`
// takes the same determinism-free input it always did, and the emitted
// envelope (field order, conditional spreads, legacy-json/v1 contentHash,
// JCS nodeId) is byte-identical by construction.

import crypto from 'crypto';
import { getActiveKeyId } from './signing.ts';
import {
  buildAttestationNode as buildAttestationNodeCore,
  ATTESTATION_WITHDRAWS,
  ATTESTATION_REINSTATES,
  ATTESTATION_PUBLISHES,
  ATTESTATION_LOCATED_AT,
  ATTESTATION_EVALUATES,
  LIFECYCLE_ATTESTATION_TYPES,
  type LifecycleAttestationType,
  type EmittableAttestationType,
  type EvaluationMethodology,
  type EvaluationResults,
  type AttestationNode,
  type AttestationInput as CoreAttestationInput,
} from '@typedstandards/produce-core';

export {
  ATTESTATION_WITHDRAWS,
  ATTESTATION_REINSTATES,
  ATTESTATION_PUBLISHES,
  ATTESTATION_LOCATED_AT,
  ATTESTATION_EVALUATES,
  LIFECYCLE_ATTESTATION_TYPES,
  type LifecycleAttestationType,
  type EmittableAttestationType,
  type EvaluationMethodology,
  type EvaluationResults,
  type AttestationNode,
};

/** App-side builder input: the core's `AttestationInput` minus the
 *  determinism fields (`packageId` / `createdAt` / `signingKeyId`) this
 *  wrapper supplies. Same shape existing callers have always passed. */
export type AttestationInput = Omit<
  CoreAttestationInput,
  'packageId' | 'createdAt' | 'signingKeyId'
>;

/**
 * Build an unsigned attestation envelope and its nodeId.
 *
 * Thin wrapper over produce-core's deterministic builder: the app supplies
 * the envelope identity (fresh UUID), timestamp (now — also the §8.12.1
 * default for `effectiveAt` / `releasedAt`), and the active signing key id.
 * The signing / timestamp / Rekor / storage steps run in the route via the
 * existing signing path, exactly as the content-publish route does.
 */
export function buildAttestationNode(
  input: AttestationInput,
): { node: AttestationNode; nodeId: string } {
  return buildAttestationNodeCore({
    ...input,
    packageId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    signingKeyId: getActiveKeyId(),
  });
}
