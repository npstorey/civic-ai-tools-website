// RED STUB (LAYOUT-WEB W4 P2): the type, and the foot line as W4 P1 wrote it.
// The fix commit replaces this file.

import { layoutLine, type LayoutPayload } from './index.ts';

export type PublishedLayout = { held: true; name: string; version: number } | { held: false };

export function layoutFootLine(shown: Pick<LayoutPayload, 'name' | 'version'>, _published?: PublishedLayout): string {
  return layoutLine(shown);
}
