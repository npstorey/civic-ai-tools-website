// RED STUB (LAYOUT-WEB W4 P2): the names the tests import, typed, with no
// behaviour. The fix commit replaces this file.

import type { LayoutPayload } from '@typedstandards/produce-core';
import type { FetchLike, TrustRegistry } from '../evidence/verify.ts';

export interface HeldLayoutNode {
  nodeId: string;
  layout: LayoutPayload;
}

export type LayoutNodeReading =
  | ({ ok: true } & HeldLayoutNode)
  | { ok: false; status: string; message: string };

export interface NodeReadingDeps {
  fetch?: FetchLike;
  registry?: TrustRegistry | undefined;
}

const NOT_YET: LayoutNodeReading = { ok: false, status: 'not_implemented', message: 'W4 P2 red stub' };

/** The seven §8.14.1 fields of a layout node, and nothing else. */
export function layoutFieldsOf(pkg: Record<string, unknown>): Record<string, unknown> {
  const { name, version, appliesTo, order, disclosure, steps, rendererVersion } = pkg;
  return { name, version, appliesTo, order, disclosure, steps, rendererVersion };
}

export async function verifyLayoutDocument(_doc: unknown, _deps: NodeReadingDeps = {}): Promise<LayoutNodeReading> {
  return NOT_YET;
}

export async function readLayoutNodeFromUrl(_url: string, _deps: NodeReadingDeps = {}): Promise<LayoutNodeReading> {
  return NOT_YET;
}

export async function readLayoutUrlOnce(_url: string, _deps: NodeReadingDeps = {}): Promise<LayoutNodeReading> {
  return NOT_YET;
}
