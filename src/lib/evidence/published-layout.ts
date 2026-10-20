// RED STUB (LAYOUT-WEB W4 P2): typed, selects nothing. The fix commit replaces this file.

import type { LifecycleAttestationView } from './verify.ts';

export interface RecordAttestationView extends LifecycleAttestationView {
  layoutNodeId?: string;
}

export function publishedLayoutNodeId(_views: readonly RecordAttestationView[]): string | null {
  return null;
}
