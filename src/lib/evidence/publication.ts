// Publication-pair emission (spec §8.10, ADR-0010 §6; civic-ai-tools#71 Phase 2).
//
// A publication is two coupled, independently-verifiable signed nodes, each
// with its own nodeId, signature, RFC 3161 timestamp, and Rekor inclusion:
//
//   1. `attestation/publishes/v1`  — the visibility transition (committed →
//      published) asserted by the publisher. Authorization: publisher-only;
//      the platform signs on the author's behalf (§8.5), exactly as the
//      withdraw/reinstate routes do.
//   2. `attestation/locatedAt/v1`  — the publisher's own public pointer to the
//      content. Authorization: any-with-binding; the platform's locatedAt is
//      the first-asserter pointer.
//
// Both blobs are stored before the DB rows are written, and the two rows are
// inserted in ONE statement — the neon-http driver has no transactions, so the
// single multi-row insert is what keeps the pair atomic at the DB layer. (An
// orphaned Rekor entry from a failed attempt is harmless: it is a signed hash
// on an append-only public log, referencing nothing that was made public.)

import { db } from '@/lib/db';
import { attestationNodes } from '@/lib/db/schema';
import { putPackage } from '@/lib/storage';
import {
  signPackage,
  getRfc3161Timestamp,
  publishToRekor,
  getActiveSigner,
} from './signing.ts';
import {
  buildAttestationNode,
  ATTESTATION_PUBLISHES,
  ATTESTATION_LOCATED_AT,
  type AttestationNode,
} from './attestation.ts';

const PUBLICATION_HOST = 'civicaitools.org';

export interface PublicationPairInput {
  /** The content node's envelope hash (what both attestations target). */
  targetNodeId: string;
  /** The now-public content URL the locatedAt asserts. */
  uri: string;
  /** The target package's own multihash contentHash, carried on the locatedAt
   *  as `targetContentHash` (Q48 naming note in attestation.ts). Optional —
   *  omitted for packages that predate the multihash field. */
  targetContentHash?: Record<string, string>;
  /** Byte length of the content at `uri` (optional). */
  contentLength?: number;
  /** The human author on whose behalf the platform signs (route audit column). */
  creatorId: string;
}

export interface PublicationPairResult {
  publishesNodeId: string;
  locatedAtNodeId: string;
}

interface SignedNodeArtifacts {
  node: AttestationNode;
  nodeId: string;
  storageKey: string;
  signatureJson: string | null;
  rfc3161Timestamp: string | null;
  rekorEntryId: string | null;
  rekorInclusionProof: string | null;
}

/** Sign + timestamp + Rekor + store one attestation node (same best-effort
 *  posture for the external proofs as the content-publish route; the blob
 *  store is NOT best-effort — a node that can't be persisted throws). */
async function signAndStore(
  node: AttestationNode,
  nodeId: string,
): Promise<SignedNodeArtifacts> {
  const signResult = signPackage(nodeId);
  const [rfc3161Token, rekorResult] = await Promise.all([
    getRfc3161Timestamp(nodeId).catch(() => null),
    signResult
      ? publishToRekor(nodeId, signResult.signature, signResult.publicKey).catch(() => null)
      : Promise.resolve(null),
  ]);

  const storageKey = await putPackage(nodeId, node as unknown as Record<string, unknown>);

  return {
    node,
    nodeId,
    storageKey,
    signatureJson: signResult
      ? JSON.stringify({
          nodeId,
          signature: signResult.signature,
          publicKey: signResult.publicKey,
          algorithm: signResult.algorithm,
          kid: signResult.kid,
        })
      : null,
    rfc3161Timestamp: rfc3161Token,
    rekorEntryId: rekorResult?.entryId || null,
    rekorInclusionProof: rekorResult?.inclusionProof || null,
  };
}

/**
 * Emit the publication pair for a content node. Throws if either node cannot
 * be built, stored, or row-inserted — callers decide whether that is fatal
 * (the explicit publish route) or best-effort (the publish-at-create path).
 */
export async function emitPublicationPair(
  input: PublicationPairInput,
): Promise<PublicationPairResult> {
  const signer = getActiveSigner();

  const publishes = buildAttestationNode({
    type: ATTESTATION_PUBLISHES,
    targetNodeId: input.targetNodeId,
    signer,
    publicationHost: PUBLICATION_HOST,
  });

  const locatedAt = buildAttestationNode({
    type: ATTESTATION_LOCATED_AT,
    targetNodeId: input.targetNodeId,
    signer,
    uri: input.uri,
    ...(input.targetContentHash ? { targetContentHash: input.targetContentHash } : {}),
    ...(input.contentLength !== undefined ? { contentLength: input.contentLength } : {}),
  });

  const [publishesArtifacts, locatedAtArtifacts] = await Promise.all([
    signAndStore(publishes.node, publishes.nodeId),
    signAndStore(locatedAt.node, locatedAt.nodeId),
  ]);

  // Single multi-row insert = atomic pair at the DB layer (no transactions on
  // neon-http). Payload mirrors the signed node's sub-type fields, matching
  // the withdraw/reinstate rows' denormalization pattern.
  await db.insert(attestationNodes).values([
    {
      nodeId: publishesArtifacts.nodeId,
      targetNodeId: input.targetNodeId,
      type: ATTESTATION_PUBLISHES,
      storageKey: publishesArtifacts.storageKey,
      signature: publishesArtifacts.signatureJson,
      rfc3161Timestamp: publishesArtifacts.rfc3161Timestamp,
      rekorEntryId: publishesArtifacts.rekorEntryId,
      rekorInclusionProof: publishesArtifacts.rekorInclusionProof,
      signer: publishesArtifacts.node.signer,
      payload: {
        publicationHost: publishesArtifacts.node.publicationHost,
        releasedAt: publishesArtifacts.node.releasedAt,
      },
      creatorId: input.creatorId,
    },
    {
      nodeId: locatedAtArtifacts.nodeId,
      targetNodeId: input.targetNodeId,
      type: ATTESTATION_LOCATED_AT,
      storageKey: locatedAtArtifacts.storageKey,
      signature: locatedAtArtifacts.signatureJson,
      rfc3161Timestamp: locatedAtArtifacts.rfc3161Timestamp,
      rekorEntryId: locatedAtArtifacts.rekorEntryId,
      rekorInclusionProof: locatedAtArtifacts.rekorInclusionProof,
      signer: locatedAtArtifacts.node.signer,
      payload: {
        uri: locatedAtArtifacts.node.uri,
        ...(locatedAtArtifacts.node.targetContentHash
          ? { targetContentHash: locatedAtArtifacts.node.targetContentHash }
          : {}),
        ...(locatedAtArtifacts.node.contentLength !== undefined
          ? { contentLength: locatedAtArtifacts.node.contentLength }
          : {}),
      },
      creatorId: input.creatorId,
    },
  ]);

  return {
    publishesNodeId: publishesArtifacts.nodeId,
    locatedAtNodeId: locatedAtArtifacts.nodeId,
  };
}
