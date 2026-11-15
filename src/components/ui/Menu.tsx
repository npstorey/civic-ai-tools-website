'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { horizontalShift } from './menu-placement';

/**
 * P2 · Menu (UX-1 P0; design §2 P2). A trigger and a panel for "choose one
 * of these". UX-2 P3b-2 extends it for the composer's harness menu (Q10 = A):
 * an item may carry a value at its right and a description under its label;
 * an item with `children` is a group that opens inline, its children
 * `menuitemradio`s; an item's `kind` makes it a heading row, a rule, a footer
 * link or a full-width button; `wide` widens the panel. No nested panels.
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
 *   - A group's row (an item with `children`) opens and closes the group in
 *     place (a click, Enter or Space); the arrow keys walk its children with
 *     the rest. Every group closes when the menu closes.
 *
 * Placement is decided once, at open: the upward flip, and, for a menu with a
 * group, a cap on the panel's height at the room on the side it opens (the
 * room above measured to the sticky site header's bottom edge), so a group
 * opened later scrolls inside the panel rather than past the window (UX-2
 * P3b-2, fix 2). A menu with no group carries no cap.
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
  /** UX-2 P3b-2: a value at the item's right (`ui-menu-item-value`), cut by CSS when long. */
  value?: ReactNode;
  /** UX-2 P3b-2: a line under the label (`ui-menu-item-description`), shown whether or not the item is disabled. */
  description?: ReactNode;
  /** UX-2 P3b-2: a group's child, a `menuitemradio`: whether it is the group's checked one. */
  checked?: boolean;
  /** UX-2 P3b-2: a group: its row opens these inline; each child reports itself through `onSelect`. */
  children?: MenuItem[];
  /**
   * UX-2 P3b-2: a heading row (no role, not hidden), a rule (`<hr role="separator">`), a footer link (`href`), or a
   * full-width button (a link when it has an `href`). Omitted, an ordinary item.
   */
  kind?: 'heading' | 'rule' | 'footer' | 'button';
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
  /** UX-2 P3b-2 (fix 1): the panel takes `ui-menu-panel--wide`, `min(360px, 100vw - 32px)` wide. */
  wide?: boolean;
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
/** The least a capped panel is given, so a cramped window still shows a few rows (fix 2). */
const MIN_CAP = 120;

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
  wide = false,
}: MenuProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const [above, setAbove] = useState(false);
  /** The group open inline, by its id (UX-2 P3b-2); none when the menu closes. */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** The panel's height cap, set at open for a menu with a group (fix 2); null for every other menu. */
  const [cap, setCap] = useState<number | null>(null);
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
      if (!next) setExpanded(null);
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
      const up = below < wanted && rect.top > below;
      setAbove(up);
      if (items.some((item) => item.children !== undefined && item.children.length > 0)) {
        // The room on the chosen side, less the panel's 4 px offset and an 8 px margin; above, to the sticky header.
        const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        const room = up ? rect.top - Math.max(0, header) - 12 : below - 12;
        setCap(Math.max(MIN_CAP, Math.floor(room)));
      }
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

  /** One item as host elements: an ordinary item renders the markup it always has; P3b-2's fields add to it. */
  const renderItem = (item: MenuItem, child: boolean): ReactNode[] => {
    if (item.kind === 'heading') return [<div key={item.id} className="ui-menu-heading">{item.label}</div>];
    if (item.kind === 'rule') return [<hr key={item.id} role="separator" className="ui-menu-rule" />];
    const itemDisabled = present(item.disabledReason);
    const group = item.children !== undefined && item.children.length > 0 && !itemDisabled;
    const role = child && !item.href ? 'menuitemradio' : kind === 'radio' ? 'menuitemradio' : 'menuitem';
    const checked = child && !item.href ? item.checked === true : kind === 'radio' ? item.id === selectedId : undefined;
    const label = <span className="ui-menu-item-label">{item.label}</span>;
    const content = (
      <>
        {present(item.value) ? (
          <span className="ui-menu-item-head">
            {label}
            <span className="ui-menu-item-value">{item.value}</span>
          </span>
        ) : label}
        {present(item.description) ? <span className="ui-menu-item-description">{item.description}</span> : null}
        {itemDisabled ? <span className="ui-menu-item-reason">{item.disabledReason}</span> : null}
      </>
    );
    if (item.kind === 'button') {
      return [item.href ? (
        <a key={item.id} href={item.href} role="menuitem" className="ui-menu-item ui-menu-item--button" tabIndex={-1} onClick={() => choose(item.id)}>
          {content}
        </a>
      ) : (
        <button key={item.id} type="button" role="menuitem" className="ui-menu-item ui-menu-item--button" tabIndex={-1} onClick={() => choose(item.id)}>
          {content}
        </button>
      )];
    }
    if (item.href && !itemDisabled) {
      const linkClass = item.kind === 'footer' ? (child ? 'ui-menu-item ui-menu-item--child ui-menu-item--footer' : 'ui-menu-item ui-menu-item--footer') : child ? 'ui-menu-item ui-menu-item--child' : 'ui-menu-item';
      return [
        <Link
          key={item.id}
          href={item.href}
          role={child ? 'menuitem' : role}
          aria-checked={child ? undefined : checked}
          aria-current={item.current ? 'page' : undefined}
          className={linkClass}
          tabIndex={-1}
          onClick={() => choose(item.id)}
        >
          {content}
        </Link>,
      ];
    }
    if (group) {
      const isOpen = expanded === item.id;
      return [
        <button
          key={item.id}
          type="button"
          role="menuitem"
          aria-expanded={isOpen}
          className="ui-menu-item"
          tabIndex={-1}
          onClick={() => setExpanded(isOpen ? null : item.id)}
        >
          {content}
        </button>,
        ...(isOpen ? item.children!.flatMap((c) => renderItem(c, true)) : []),
      ];
    }
    return [
      <button
        key={item.id}
        type="button"
        role={role}
        aria-checked={checked}
        aria-disabled={itemDisabled || undefined}
        className={child ? 'ui-menu-item ui-menu-item--child' : 'ui-menu-item'}
        tabIndex={-1}
        onClick={itemDisabled ? undefined : () => choose(item.id)}
      >
        {content}
      </button>,
    ];
  };

  const panelClass = [
    'ui-menu-panel',
    align === 'end' ? 'ui-menu-panel--end' : '',
    above ? 'ui-menu-panel--up' : '',
    wide ? 'ui-menu-panel--wide' : '',
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
          style={cap === null ? undefined : { maxHeight: `min(60vh, ${cap}px)` }}
          onKeyDown={onPanelKeyDown}
        >
          {items.flatMap((item) => renderItem(item, false))}
        </div>
      ) : null}
    </div>
  );
}
