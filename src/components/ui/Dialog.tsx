'use client';

import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';

/**
 * P4 · Dialog (UX-1 P0; design §2 P4). A centred modal with three regions:
 *   - a header: the title (18 px) and a close control;
 *   - a body, the only region that scrolls (`overflow: auto`; the dialog is
 *     at most 90vh, so the body gets what is left after the header and footer);
 *   - a footer, outside the scroll, carrying the primary action and its
 *     one-line consequence.
 *
 * States: `form`, `busy`, `success`, `error` (the Publish dialog's four), each
 * marked as `data-state`. Busy disables the actions (the primary with a
 * spinner), disables the close control, makes the body inert and sets
 * `aria-busy`. Sizes: `short` (max 480 px), `form` (max 520 px).
 *
 * Behaviour (`useModalFocus`, shared with the Sheet):
 *   - opening focuses the first enabled control;
 *   - Tab and Shift+Tab stay inside the dialog (a focus trap);
 *   - Escape closes it, unless busy;
 *   - with another modal open over it, only the top one answers these keys;
 *   - closing returns focus to the element that had it when the dialog opened;
 *   - a click on the backdrop closes it, unless busy.
 *
 * The only built-in word is the close control's accessible name, "Close"; its
 * glyph is decorative. Every other word is the caller's.
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

// Full class names, never built from a template: the class guard
// (`src/app/ui-class-names.test.ts`) reads string literals.
const SIZE_CLASS: Record<DialogSize, string> = {
  short: 'ui-dialog ui-dialog--short',
  form: 'ui-dialog ui-dialog--form',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The open modals, oldest first. Every open modal keeps its own `keydown`
 * listener on `document`, and `stopPropagation()` does not stop another
 * listener on the same target, so each listener acts only while its modal is
 * the last entry here: with the Settings overlay open over the review sheet,
 * one Escape closes the overlay alone, and Tab stays in the overlay.
 */
const openModals: object[] = [];

/**
 * The modal behaviour the Dialog and the Sheet share: initial focus, a focus
 * trap, Escape, and focus returned on close. Effects only; a no-op where there
 * is no `document`, and while the panel's ref is unattached.
 *
 * Only the topmost open modal answers Escape and Tab (`openModals`); a second
 * Escape closes the next one down, and each close returns focus to what had it
 * when that modal opened.
 *
 * ORDERING LIMIT, stated. A modal joins the stack when its effect runs, that
 * is, when it opens. Two modals that open in the same render join child first
 * (React runs a child's effects before its parent's), so the parent would be
 * on top. No surface opens two at once today; one that does must open them in
 * turn.
 */
export function useModalFocus(open: boolean, panelRef: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]'));
    (focusable()[0] ?? panel).focus();
    const self = {};
    openModals.push(self);
    const onKeyDown = (event: KeyboardEvent) => {
      // A modal under another answers nothing: the one on top owns the keys.
      if (openModals[openModals.length - 1] !== self) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = openModals.indexOf(self);
      if (at !== -1) openModals.splice(at, 1);
      previous?.focus();
    };
  }, [open, panelRef]);
}

/** A footer action button; `busy` disables it, and the primary shows the spinner. */
export function ActionButton({ action, primary, busy }: { action: DialogAction; primary: boolean; busy: boolean }) {
  return (
    <button
      type={action.type ?? 'button'}
      form={action.form}
      className={primary ? 'ui-action ui-action--primary' : 'ui-action ui-action--secondary'}
      disabled={busy || action.disabled}
      onClick={action.onClick}
    >
      {primary && busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
      {action.label}
    </button>
  );
}

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  size = 'form',
  state = 'form',
  primaryAction,
  secondaryAction,
  footerLine,
}: DialogProps) {
  const titleId = `${useId()}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const busy = state === 'busy';
  useModalFocus(open, panelRef, () => {
    if (!busy) onClose();
  });
  if (!open) return null;

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busy) onClose();
  };
  const hasFooter = Boolean(primaryAction || secondaryAction || present(footerLine));

  return (
    <div className="ui-backdrop ui-backdrop--center" data-part="backdrop" onClick={onBackdrop}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-state={state}
        className={SIZE_CLASS[size]}
        tabIndex={-1}
      >
        <div className="ui-dialog-header" data-part="header">
          <h2 id={titleId} className="ui-dialog-title">
            {title}
          </h2>
          <button type="button" className="ui-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <span aria-hidden="true">{'×'}</span>
          </button>
        </div>
        <div className="ui-dialog-body" data-part="body" inert={busy || undefined}>
          {children}
        </div>
        {hasFooter ? (
          <div className="ui-dialog-footer" data-part="footer">
            {present(footerLine) ? <p className="ui-dialog-footer-line">{footerLine}</p> : null}
            {primaryAction || secondaryAction ? (
              <div className="ui-actions">
                {secondaryAction ? <ActionButton action={secondaryAction} primary={false} busy={busy} /> : null}
                {primaryAction ? <ActionButton action={primaryAction} primary busy={busy} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
