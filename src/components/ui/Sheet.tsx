'use client';

import { useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { ActionButton, useModalFocus, type DialogAction } from './Dialog';

/**
 * P3 · Sheet (UX-1 P0; design §2 P3). For a task that needs more than a menu.
 * Placement:
 *   - at 900 px and wider, a side panel (420 px wide, full height);
 *   - below 900 px, a bottom sheet (up to 85vh).
 *
 * Regions:
 *   - a header: the title (18 px display font) and a close control;
 *   - a body, the only region that scrolls (`overflow: auto`);
 *   - a fixed footer: one primary action, or a status line ("Saved") when
 *     changes apply immediately.
 *
 * States: closed, open, busy. Busy disables the footer action with a spinner,
 * disables the close control, makes the body inert and sets `aria-busy`.
 *
 * Behaviour (`useModalFocus`, shared with the Dialog):
 *   - opening focuses the first enabled control;
 *   - a focus trap keeps focus inside the sheet;
 *   - Escape closes it, unless busy;
 *   - with another modal open over it, only the top one answers these keys;
 *   - closing returns focus to where it was;
 *   - a click on the backdrop (`rgba(0,0,0,0.5)`) closes it, unless busy.
 *
 * The only built-in word is the close control's accessible name, "Close"; its
 * glyph is decorative. Every other word is the caller's.
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

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Sheet({ open, onClose, title, children, primaryAction, footerLine, busy = false }: SheetProps) {
  const titleId = `${useId()}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, panelRef, () => {
    if (!busy) onClose();
  });
  if (!open) return null;

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busy) onClose();
  };
  const hasLine = present(footerLine);

  return (
    <div className="ui-backdrop" data-part="backdrop" onClick={onBackdrop}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className="ui-sheet"
        tabIndex={-1}
      >
        <div className="ui-sheet-header" data-part="header">
          <h2 id={titleId} className="ui-sheet-title">
            {title}
          </h2>
          <button type="button" className="ui-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <span aria-hidden="true">{'×'}</span>
          </button>
        </div>
        <div className="ui-sheet-body" data-part="body" inert={busy || undefined}>
          {children}
        </div>
        {primaryAction || hasLine ? (
          <div className="ui-sheet-footer" data-part="footer">
            {hasLine ? (
              <p className="ui-sheet-footer-line" role="status">
                {footerLine}
              </p>
            ) : null}
            {primaryAction ? (
              <div className="ui-actions">
                <ActionButton action={primaryAction} primary busy={busy} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
