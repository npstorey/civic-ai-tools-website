// RED STUB (LAYOUT-WEB W4 P2): the committed nodes are read (the tests build
// their fixtures through it); the lookup has no behaviour. The fix commit
// replaces this file.

import { computeEnvelopeHash } from '../evidence/verify.ts';
import { checkLayout } from './reading.ts';
import { layoutFieldsOf, type HeldLayoutNode } from './node-reading.ts';
import type { PublishedLayout } from './published-line.ts';

export interface CommittedLayoutNode extends HeldLayoutNode {
  document: Record<string, unknown>;
}

export function committedLayoutNodes(documents: readonly unknown[] = []): CommittedLayoutNode[] {
  return documents.map((doc) => {
    const d = doc as Record<string, unknown>;
    const pkg = d.package as Record<string, unknown>;
    return { nodeId: computeEnvelopeHash(pkg), layout: checkLayout(layoutFieldsOf(pkg), 'committed'), document: d };
  });
}

export function lookUpPublishedLayout(_nodeId: string | null | undefined, _held: readonly HeldLayoutNode[]): PublishedLayout | undefined {
  return undefined;
}

export async function publishedLayoutFor(_nodeId: string | null | undefined): Promise<PublishedLayout | undefined> {
  return undefined;
}
