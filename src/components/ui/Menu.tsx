'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { horizontalShift } from './menu-placement';

/**
 * P2 · Menu (UX-1 P0; design §2 P2). A trigger and a panel for "choose one
 * of these". No submenus (UX-2's P3 extends the contract).
 *
 * Trigger states: idle; hover (CSS); open (`aria-expanded`); disabled. Item
 * states: idle; hover (`--card-background`, CSS); selected (`aria-checked` on
 * radio items, `--text-primary` 600); disabled-with-reason (muted,
 * `aria-disabled`, with the reason as the item's second line).
 *
 * The panel is 220-360 px wide, at most 60vh tall with its own scroll, and
 * anchored below the trigger. It opens above the trigger when the room below
 * is short. That is measured when the trigger opens it; a caller-controlled
 * open does not flip. Sideways, an open panel is moved, before it paints, so
 * its box lies inside the viewport (`menu-placement.ts`): `align` is where it
 * starts, not where it may end up (UX-2 P4a leg D: an `end` panel on a
 * trigger near the left edge ran off the screen at 390 px).
 *
 * Behaviour:
 *   - Escape closes the menu and returns focus to the trigger.
 *   - A click outside the menu closes it.
 *   - ArrowDown and ArrowUp move among the enabled items; Home and End go to
 *     the first and last.
 *   - Enter or Space on an item selects it. The menu closes and focus
 *     returns to the trigger.
 *   - Tab closes the menu.
 *   - Opening focuses the checked item, or else the first enabled one.
 *   - ArrowDown on a closed trigger opens the menu.
 *
 * Every word is the caller's; the caret is a decorative glyph.
 */

/** `icon`: a 32 px square. `label`: text plus a caret. `field`: a full-width current-value button. */
export type MenuTriggerSize = 'icon' | 'label' | 'field';

/** `action` items are `menuitem`s; `radio` items are `menuitemradio`s with `aria-checked`. */
export type MenuKind = 'action' | 'radio';

export interface MenuItem {
  id: string;
  /** The item's words, supplied by the caller. */
  label: ReactNode;
  /** A navigation item: rendered as a link. */
  href?: string;
  /** Disabled-with-reason: the item is muted and this is its second line. */
  disabledReason?: ReactNode;
  /** A navigation item that names the page being shown: its link carries `aria-current="page"` (UX-2 P3b-1). */
  current?: boolean;
}

export interface MenuProps {
  /** The trigger's visible content (an icon glyph, a label, a current value). */
  trigger: ReactNode;
  /** The trigger's accessible name when its content is a glyph (`icon` size). */
  triggerLabel?: string;
  /** Default `label`. */
  size?: MenuTriggerSize;
  items: MenuItem[];
  /** Called with the chosen item's id; the menu then closes. */
  onSelect?: (id: string) => void;
  /** Default `action`. */
  kind?: MenuKind;
  /** The checked item of a `radio` menu. */
  selectedId?: string;
  /** The trigger's disabled state. */
  disabled?: boolean;
  /** Controlled open state; omitted, the menu keeps its own. */
  open?: boolean;
  /** Initial state when `open` is not controlled. Default false. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The panel's horizontal anchor against the trigger. Default `start`. */
  align?: 'start' | 'end';
}

// Full class names, never built from a template: the class guard
// (`src/app/ui-class-names.test.ts`) reads string literals.
const ROOT_CLASS: Record<MenuTriggerSize, string> = {
  icon: 'ui-menu',
  label: 'ui-menu',
  field: 'ui-menu ui-menu--field',
};

const TRIGGER_CLASS: Record<MenuTriggerSize, string> = {
  icon: 'ui-menu-trigger ui-menu-trigger--icon',
  label: 'ui-menu-trigger ui-menu-trigger--label',
  field: 'ui-menu-trigger ui-menu-trigger--field',
};

const ENABLED_ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemradio"]:not([aria-disabled="true"])';
/** The panel's tallest estimate before it renders, for the flip decision: 60vh or the items. */
const ITEM_HEIGHT_ESTIMATE = 40;

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Menu({
  trigger,
  triggerLabel,
  size = 'label',
  items,
  onSelect,
  kind = 'action',
  selectedId,
  disabled = false,
  open,
  defaultOpen = false,
  onOpenChange,
  align = 'start',
}: MenuProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const [above, setAbove] = useState(false);
  const isOpen = open ?? ownOpen;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const panelId = `${baseId}-panel`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setOwnOpen(next);
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );

  // Opening focuses the checked item, else the first enabled one.
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const panel = panelRef.current;
    if (!panel) return;
    const checked = panel.querySelector<HTMLElement>('[aria-checked="true"]:not([aria-disabled="true"])');
    (checked ?? panel.querySelector<HTMLElement>(ENABLED_ITEM_SELECTOR))?.focus();
  }, [isOpen]);

  // Opening keeps the panel inside the viewport sideways: its box is read once
  // it renders, before paint, and moved by the shift `horizontalShift` names.
  // The panel unmounts on close, so the next open measures it afresh.
  useLayoutEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const panel = panelRef.current;
    if (!panel) return;
    const dx = horizontalShift(panel.getBoundingClientRect(), document.documentElement.clientWidth);
    panel.style.transform = dx === 0 ? '' : `translateX(${dx}px)`;
  }, [isOpen]);

  // A click outside the menu closes it; focus stays where the reader clicked.
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, setOpen]);

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openFromTrigger = () => {
    const button = triggerRef.current;
    if (button && typeof window !== 'undefined') {
      const rect = button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const wanted = Math.min(window.innerHeight * 0.6, items.length * ITEM_HEIGHT_ESTIMATE + 16);
      setAbove(below < wanted && rect.top > below);
    }
    setOpen(true);
  };

  const choose = (id: string) => {
    onSelect?.(id);
    closeToTrigger();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' && !isOpen) {
      event.preventDefault();
      openFromTrigger();
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      closeToTrigger();
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeToTrigger();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const enabled = Array.from(panel.querySelectorAll<HTMLElement>(ENABLED_ITEM_SELECTOR));
    if (enabled.length === 0) return;
    const at = enabled.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = at < 0 ? 0 : (at + 1) % enabled.length;
        break;
      case 'ArrowUp':
        next = at < 0 ? enabled.length - 1 : (at - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    enabled[next].focus();
  };

  const panelClass = [
    'ui-menu-panel',
    align === 'end' ? 'ui-menu-panel--end' : '',
    above ? 'ui-menu-panel--up' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={ROOT_CLASS[size]} ref={rootRef}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={TRIGGER_CLASS[size]}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        aria-label={triggerLabel}
        disabled={disabled}
        onClick={() => (isOpen ? setOpen(false) : openFromTrigger())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="ui-menu-trigger-content">{trigger}</span>
        {size === 'icon' ? null : (
          <span className="ui-menu-caret" aria-hidden="true">
            {'▾'}
          </span>
        )}
      </button>
      {isOpen ? (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-labelledby={triggerId}
          className={panelClass}
          onKeyDown={onPanelKeyDown}
        >
          {items.map((item) => {
            const itemDisabled = present(item.disabledReason);
            const role = kind === 'radio' ? 'menuitemradio' : 'menuitem';
            const checked = kind === 'radio' ? item.id === selectedId : undefined;
            const content = (
              <>
                <span className="ui-menu-item-label">{item.label}</span>
                {itemDisabled ? <span className="ui-menu-item-reason">{item.disabledReason}</span> : null}
              </>
            );
            if (item.href && !itemDisabled) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role={role}
                  aria-checked={checked}
                  aria-current={item.current ? 'page' : undefined}
                  className="ui-menu-item"
                  tabIndex={-1}
                  onClick={() => choose(item.id)}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role={role}
                aria-checked={checked}
                aria-disabled={itemDisabled || undefined}
                className="ui-menu-item"
                tabIndex={-1}
                onClick={itemDisabled ? undefined : () => choose(item.id)}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
