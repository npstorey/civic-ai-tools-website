// A layout node's document (LAYOUT-WEB W4 P2): the §9.4 commitment view of a
// signed `content/layout/v1` node with the package inline, the shape
// `scripts/publish-layout.ts` writes, the site reads (`node-reading.ts`), and
// the published cli's `view` prints and its `verify` reads.
//
// Built with produce-core's `buildCommitmentView` from exactly the inputs the
// cli's `view` passes (`@typedstandards/cli` 0.2.1, `view.ts:96-113`):
// `visibility: "public"`, the node's own envelope claims, the signature, no
// lifecycle nodes, the trust registry URL, no title, and no summary. It omits
// `signerIdentity`, `trustRegistryUrlLegacy` and the four proof keys the
// site's own commitment wrapper adds (`src/lib/evidence/commitment.ts`), since
// the cli's `verify` refuses any key outside its list (`BUNDLE_KEYS`).
// `captureMethod` is null (ruling D5 = A: a layout node states none) and
// `packageUrl` is not set: the package is inline, and no separate location
// serves it.
//
// Pure: no I/O, no key. Relative, extension-carrying imports (the convention
// of src/lib since #345).

import { buildCommitmentView, type LayoutNode } from '@typedstandards/produce-core';

/** The signature envelope a document carries: what `signPackage` returned, without anything else. */
export interface NodeSignature {
  signature: string;
  publicKey: string;
  algorithm: string;
  kid: string;
}

/** The keys the published cli's `verify` accepts in a view (`@typedstandards/cli` 0.2.1, `verify.ts:139-158`, `BUNDLE_KEYS`). */
export const CLI_VIEW_KEYS: readonly string[] = [
  'protocolVersion', 'packageHash', 'packageUrl', 'visibility', 'captureMethod', 'contentProfile', 'producerProfile',
  'type', 'signer', 'contentHash', 'contentCanonicalization', 'signature', 'lifecycle', 'lifecycleAttestations',
  'trustRegistryUrl', 'subjectTitle', 'subjectSummary', 'package',
];

/** The document for `node` (whose id is `nodeId`), signed as `signature`, naming `trustRegistryUrl`. */
export function buildLayoutNodeDocument(node: LayoutNode, nodeId: string, signature: NodeSignature, trustRegistryUrl: string): Record<string, unknown> {
  const view = buildCommitmentView({
    packageHash: nodeId,
    visibility: 'public',
    captureMethod: null,
    contentProfile: null,
    producerProfile: undefined,
    type: node.type,
    signer: node.signer,
    contentHash: node.contentHash,
    contentCanonicalization: node.contentCanonicalization,
    signature: { signature: signature.signature, publicKey: signature.publicKey, algorithm: signature.algorithm, kid: signature.kid },
    lifecycleAttestations: [],
    trustRegistryUrl,
    subjectTitle: undefined,
    subjectSummary: undefined,
  });
  // As the cli's `view` returns it: through JSON, so an undefined member is gone.
  return JSON.parse(JSON.stringify({ ...view, package: node })) as Record<string, unknown>;
}
