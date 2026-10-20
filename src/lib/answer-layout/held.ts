// The layout nodes this site holds (LAYOUT-WEB W4 P2, the amendment's (b)):
// the committed nodes (`committed-nodes.ts`, build-time imports) and, when
// `ANSWER_LAYOUT_URL` is set, the node read from it. Server-only.
//
// A committed node is the site's own file, so it is read without a network
// and without a key: its node id is recomputed from its package bytes, which
// must equal the id its document claims, and its seven fields pass the
// builder's check. A committed file that fails either is a broken build, not
// a node to skip: the reading refuses (`AnswerLayoutConfigurationError`).
// Whether a node was signed by this instance is a separate question, asked
// only when the node is named in a signed statement (`default-node.ts`).
//
// W4 P1's rule that a layout reusing a held name and version with other
// fields is refused applies to every node held here, committed or read from
// the URL (`checkNoTwins`).
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import type { LayoutPayload } from '@typedstandards/produce-core';
import { computeEnvelopeHash } from '../evidence/verify.ts';
import { BUILT_IN_LAYOUTS, layoutId } from './index.ts';
import { AnswerLayoutConfigurationError, checkLayout, sameLayout } from './layout-check.ts';
import { COMMITTED_LAYOUT_DOCUMENTS } from './committed-nodes.ts';
import { layoutFieldsOf, readLayoutUrlOnce, type HeldLayoutNode } from './node-reading.ts';
import type { PublishedLayout } from './published-line.ts';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A committed node document, read: its id, its seven fields, and the parts a key check needs. */
export interface CommittedLayoutNode extends HeldLayoutNode {
  /** The node document as committed (the §9.4 view with the package inline). */
  document: Record<string, unknown>;
}

/**
 * The committed nodes, each read from its document. Throws
 * `AnswerLayoutConfigurationError` on a document that is not a layout node
 * view, whose package does not recompute to its claimed id, or whose fields
 * the builder refuses.
 */
export function committedLayoutNodes(documents: readonly unknown[] = COMMITTED_LAYOUT_DOCUMENTS): CommittedLayoutNode[] {
  return documents.map((doc, i) => {
    const where = `committed layout node #${i + 1}`;
    if (!isObject(doc) || !isObject(doc.package) || typeof doc.packageHash !== 'string') {
      throw new AnswerLayoutConfigurationError(`${where} is not a layout node view (packageHash and the package inline).`);
    }
    const nodeId = computeEnvelopeHash(doc.package);
    if (nodeId !== doc.packageHash) {
      throw new AnswerLayoutConfigurationError(`${where} claims ${doc.packageHash}, and its package recomputes to ${nodeId}.`);
    }
    return { nodeId, layout: checkLayout(layoutFieldsOf(doc.package), `${where} (${nodeId})`), document: doc };
  });
}

/**
 * Refuses a set of layouts in which two share a name and version with
 * different fields, a built-in counting as one of the set. `source` names each
 * for the message.
 */
export function checkNoTwins(layouts: ReadonlyArray<{ source: string; layout: LayoutPayload }>): void {
  const all = [...BUILT_IN_LAYOUTS.map((layout) => ({ source: `the built-in ${layoutId(layout)}`, layout })), ...layouts];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (layoutId(a.layout) === layoutId(b.layout) && !sameLayout(a.layout, b.layout)) {
        const isBuiltIn = i < BUILT_IN_LAYOUTS.length;
        throw new AnswerLayoutConfigurationError(
          isBuiltIn
            ? `${b.source}: the layout is named ${b.layout.name} v${b.layout.version}, a built-in's name and version, with different fields. Give it a name or a version of its own.`
            : `${b.source}: the layout is named ${b.layout.name} v${b.layout.version}, the name and version of ${a.source}, with different fields. Give it a name or a version of its own.`,
        );
      }
    }
  }
}

function present(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Every layout node this site holds: the committed nodes, then the URL node when one is set and read. */
export async function heldLayoutNodes(
  env: Record<string, string | undefined> = process.env,
  committed: readonly HeldLayoutNode[] = committedLayoutNodes(),
): Promise<HeldLayoutNode[]> {
  const url = present(env.ANSWER_LAYOUT_URL);
  const held: HeldLayoutNode[] = [...committed];
  if (url !== undefined) {
    const reading = await readLayoutUrlOnce(url);
    if (reading.ok) held.push({ nodeId: reading.nodeId, layout: reading.layout });
  }
  return held;
}

/**
 * The layout a record's publication attestation names, looked up among the
 * nodes the site holds: its name and version when held, `{ held: false }`
 * when not, and `undefined` when the attestation names none.
 */
export function lookUpPublishedLayout(nodeId: string | null | undefined, held: readonly HeldLayoutNode[]): PublishedLayout | undefined {
  if (nodeId === null || nodeId === undefined) return undefined;
  const found = held.find((n) => n.nodeId === nodeId);
  return found === undefined ? { held: false } : { held: true, name: found.layout.name, version: found.layout.version };
}

/** `lookUpPublishedLayout` against this site's held nodes. */
export async function publishedLayoutFor(nodeId: string | null | undefined): Promise<PublishedLayout | undefined> {
  if (nodeId === null || nodeId === undefined) return undefined;
  return lookUpPublishedLayout(nodeId, await heldLayoutNodes());
}
