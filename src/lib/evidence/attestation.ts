// Attestation node builder (spec §8.10, §8.12; ADR-0010).
//
// An `attestation/*` node is a full signed envelope — its own nodeId (envelope
// hash), signature, timestamp, and Rekor proof — that references a content node
// by `targetNodeId` and asserts something about it WITHOUT modifying it. PR3
// operationalizes the two lifecycle sub-types (`withdraws`, `reinstates`).
//
// This builder is the attestation analog of `buildEvidencePackage`: it produces
// the unsigned envelope + its nodeId, REUSING the PR2 canonicalization module
// (RFC 8785 JCS envelope hash + multihash contentHash). The signing /
// timestamp / Rekor / storage steps run in the route via the existing signing
// path, exactly as the content-publish route does — no new signing abstraction.

import crypto from 'crypto';
import { getActiveKeyId, type SignerIdentity } from './signing.ts';
import {
  LEGACY_JSON_CANONICALIZATION,
  computeEnvelopeHash,
  computeContentHashSha256,
} from './canonicalization.ts';
// Lifecycle sub-type URIs are defined once in verify-core (the verify side
// dispatches on them); imported here for the builder body and re-exported so
// existing importers (`./attestation.ts`) are unaffected. `supersedes` /
// `publishes` / `locatedAt` and the claim-to-claim sub-types remain reserved
// name-only per the Xanadu doctrine — the attestation_nodes table holds them,
// but no route emits them until an adopter needs them.
import {
  ATTESTATION_WITHDRAWS,
  ATTESTATION_REINSTATES,
  LIFECYCLE_ATTESTATION_TYPES,
  type LifecycleAttestationType,
} from './verify-core/attestation.ts';

export {
  ATTESTATION_WITHDRAWS,
  ATTESTATION_REINSTATES,
  LIFECYCLE_ATTESTATION_TYPES,
  type LifecycleAttestationType,
};

const PACKAGE_SCHEMA_VERSION = '0.1.0';

/**
 * A conformant `attestation/*` envelope (spec §8.12.3). Structurally a
 * content-like package: metadata + type + signer + contentCanonicalization +
 * contentHash, plus the attestation-specific `targetNodeId` and the sub-type
 * payload fields. `contentHash` is typed optional only so the builder can
 * compute it from the base object (a hash cannot include itself); it is always
 * present on a built node.
 */
export interface AttestationNode {
  metadata: {
    schemaVersion: string;
    packageId: string;
    createdAt: string;
    signingKeyId: string;
  };
  /** Attestation sub-type URI, e.g. `attestation/withdraws/v1`. */
  type: string;
  /** Envelope-side identity claim (spec §8.1.1, §8.5). The platform signs on
   *  behalf of authors today, so this carries the platform identity. */
  signer?: SignerIdentity;
  /** The content node this attestation references by nodeId (spec §8.12.1). */
  targetNodeId: string;
  /** Off-log canonicalization rule. Attestation content is JSON, so always
   *  legacy-json/v1 (the whole-envelope-minus-contentHash rule). */
  contentCanonicalization: string;
  /** Multihash digest set fingerprinting the off-log content (spec §8.2). */
  contentHash?: Record<string, string>;
  // --- Sub-type payload (spec §8.12.1) ---
  /** `withdraws` (required, non-empty) / `reinstates` (optional). */
  reason?: string;
  /** `withdraws`: when the withdrawal takes effect (defaults to envelope ts). */
  effectiveAt?: string;
  /** `reinstates`: the prior withdrawal this reinstatement reverses. */
  priorWithdrawalNodeId?: string;
}

export interface AttestationInput {
  type: LifecycleAttestationType;
  targetNodeId: string;
  signer: SignerIdentity;
  reason?: string;
  effectiveAt?: string;
  priorWithdrawalNodeId?: string;
}

/**
 * Build an unsigned attestation envelope and its nodeId.
 *
 * The nodeId is the RFC 8785 JCS envelope hash (spec §8.2/§8.3.1) — the same
 * `computeEnvelopeHash` the content packager uses, so attestation nodes verify
 * on the identical dual-chain logic. The off-log content hash is computed under
 * legacy-json/v1 from the envelope minus `contentHash`, then spread on last.
 */
export function buildAttestationNode(
  input: AttestationInput,
): { node: AttestationNode; nodeId: string } {
  const now = new Date().toISOString();

  // Base envelope WITHOUT contentHash. The conditional spreads keep the
  // payload minimal — only supplied sub-type fields are emitted, so the
  // canonical JSON carries exactly the fields the sub-type defines.
  const base: AttestationNode = {
    metadata: {
      schemaVersion: PACKAGE_SCHEMA_VERSION,
      packageId: crypto.randomUUID(),
      createdAt: now,
      signingKeyId: getActiveKeyId(),
    },
    type: input.type,
    signer: input.signer,
    targetNodeId: input.targetNodeId,
    contentCanonicalization: LEGACY_JSON_CANONICALIZATION,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    // `effectiveAt` defaults to the envelope timestamp per §8.12.1.
    ...(input.type === ATTESTATION_WITHDRAWS
      ? { effectiveAt: input.effectiveAt ?? now }
      : {}),
    ...(input.priorWithdrawalNodeId !== undefined
      ? { priorWithdrawalNodeId: input.priorWithdrawalNodeId }
      : {}),
  };

  const contentHash = {
    sha256: computeContentHashSha256(
      base as unknown as Record<string, unknown>,
      LEGACY_JSON_CANONICALIZATION,
    ),
  };
  const node: AttestationNode = { ...base, contentHash };
  const nodeId = computeEnvelopeHash(node as unknown as Record<string, unknown>);

  return { node, nodeId };
}
