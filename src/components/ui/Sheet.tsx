'use client';

import type { ReactNode } from 'react';
import type { DialogAction } from './Dialog';

/**
 * P3 · Sheet (UX-1 P0; design §2 P3). A side panel at 900 px and wider
 * (420 px wide, full height), a bottom sheet below (up to 85vh), for a task
 * that needs more than a menu. Header (title, close), body (the only
 * scrolling region), footer (one primary action, or a status line).
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Sheet.test.ts`) fails against. Leg B builds the primitive.
 */

export interface SheetProps {
  open: boolean;
  /** Escape, the close control and a backdrop click (unless busy) call this. */
  onClose: () => void;
  /** The title; the sheet is `aria-labelledby` it. */
  title: ReactNode;
  /** The body. */
  children: ReactNode;
  /** The footer's one primary action. */
  primaryAction?: DialogAction;
  /** The footer's line: a "Saved" status when changes apply immediately. */
  footerLine?: ReactNode;
  /** Busy: the footer action is disabled with a spinner and the body is inert. */
  busy?: boolean;
}

export function Sheet(props: SheetProps) {
  void props;
  return <div data-ui-stub="Sheet" />;
}
