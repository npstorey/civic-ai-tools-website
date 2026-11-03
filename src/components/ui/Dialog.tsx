'use client';

import type { ReactNode } from 'react';

/**
 * P4 · Dialog (UX-1 P0; design §2 P4). A centred modal: header (title, close),
 * body (the only scrolling region), and a footer outside the scroll carrying
 * the primary action and its one-line consequence.
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Dialog.test.ts`) fails against. Leg B builds the primitive.
 */

/** `short`: max 480 px. `form`: max 520 px. */
export type DialogSize = 'short' | 'form';

/** The Publish dialog's four states. `busy` disables the actions and makes the body inert. */
export type DialogState = 'form' | 'busy' | 'success' | 'error';

/** A footer action. Words are the caller's. */
export interface DialogAction {
  label: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Default `button`. */
  type?: 'button' | 'submit';
  /** The id of the form a `submit` action submits. */
  form?: string;
}

export interface DialogProps {
  open: boolean;
  /** Escape, the close control, and a backdrop click (unless busy) call this. */
  onClose: () => void;
  /** The title; the dialog is `aria-labelledby` it. */
  title: ReactNode;
  /** The body. */
  children: ReactNode;
  /** Default `form`. */
  size?: DialogSize;
  /** Default `form`. */
  state?: DialogState;
  primaryAction?: DialogAction;
  secondaryAction?: DialogAction;
  /** The footer's one line: the primary action's consequence, or why it is disabled. */
  footerLine?: ReactNode;
}

export function Dialog(props: DialogProps) {
  void props;
  return <div data-ui-stub="Dialog" />;
}
