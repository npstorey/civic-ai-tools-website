'use client';

import type { ReactNode } from 'react';

/**
 * P2 · Menu (UX-1 P0; design §2 P2). A trigger and a panel for "choose one
 * of these". No submenus (UX-2's P3 extends the contract).
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Menu.test.ts`) fails against. Leg B builds the primitive.
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

export function Menu(props: MenuProps) {
  void props;
  return <div data-ui-stub="Menu" />;
}
