// RED STUB (LAYOUT-WEB W4 P2): typed, names nothing. The fix commit replaces this file.

import type { EnvRecord } from '../publisher-env.ts';
import type { CommittedLayoutNode } from './held.ts';
import type { NodeReadingDeps } from './node-reading.ts';

export function instanceSigningPublicKey(_env: EnvRecord = process.env): string | null {
  return null;
}

export interface DefaultNodeSources {
  committed?: readonly CommittedLayoutNode[];
  urlDeps?: NodeReadingDeps;
}

export async function defaultLayoutNodeId(_env: EnvRecord = process.env, _sources: DefaultNodeSources = {}): Promise<string | undefined> {
  return undefined;
}
