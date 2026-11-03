'use client';

import type { ReactNode } from 'react';

/**
 * P8 · Tabs (UX-1 P0; design §2 P8). `role="tablist"` / `role="tab"` /
 * `aria-selected`, arrow keys, the selected tab underlined 2 px `--accent`; a
 * row that wraps at narrow width.
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Tabs.test.ts`) fails against. Leg B builds the primitive.
 */

export interface TabItem {
  id: string;
  /** The tab's words, count included, supplied by the caller. */
  label: ReactNode;
  /** Disabled-with-reason: the tab's feature is not offered, and this says why. */
  disabledReason?: ReactNode;
}

export interface TabsProps {
  /** The tablist's accessible name. */
  label: string;
  tabs: TabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** The selected tab's panel. */
  children?: ReactNode;
  /** Prefix for the tab and panel ids; default from `useId`. */
  idPrefix?: string;
}

export function Tabs(props: TabsProps) {
  void props;
  return <div data-ui-stub="Tabs" />;
}
