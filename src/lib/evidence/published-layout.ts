// The layout a record was published under (LAYOUT-WEB W4 P2, the amendment's
// (b)): the `layoutNodeId` on the record's publication attestation, read from
// the attestation views `lifecycle.ts` builds for every row targeting the
// record. Pure, so the selection is driven without a database.
//
// Read only from an attestation whose signature verified, whose stored node id
// matches its bytes, and whose signer matches the target's. Each view's
// `layoutNodeId` is the signed node's value first, then the row's payload, as
// `lifecycle.ts` reads every other field. A record published more than once
// keeps the first publication's: the act that first showed it to readers.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import type { LifecycleAttestationView } from './verify.ts';

/** The publishes attestation's type (spec §8.12.1). */
const PUBLISHES = 'attestation/publishes/v1';

/** An attestation view, with the layout a publication attestation names. */
export interface RecordAttestationView extends LifecycleAttestationView {
  /** `attestation/publishes/v1` only: the `layoutNodeId` it carries. */
  layoutNodeId?: string;
}

/** The layout node id the record's publication attestation names, or null. */
export function publishedLayoutNodeId(views: readonly RecordAttestationView[]): string | null {
  const counting = views
    .filter((v) => v.type === PUBLISHES && v.signatureValid === true && v.nodeIdMatches && v.signerMatchesTarget)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.nodeId.localeCompare(b.nodeId));
  return counting[0]?.layoutNodeId ?? null;
}
