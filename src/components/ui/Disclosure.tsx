'use client';

import type { ReactNode } from 'react';

/**
 * P1 · Disclosure (UX-1 P0; design §2 P1). One mechanism for "reveal more of
 * what is already here": a native `<details class="ui-disclosure">`.
 *
 * A disclosure never changes behaviour or state; it only shows. State changes
 * belong to a Menu or a Sheet. There is no disabled state: a disclosure with
 * nothing to show is not rendered.
 *
 * Toggling is the browser's own (`<details>`/`<summary>`: Enter, Space, a
 * click). With `open` given, the attribute follows the prop: a group that
 * auto-expands sets it, and `onToggle` reports the reader's toggles so the
 * caller can keep its state in step.
 *
 * Every word is the caller's.
 */

/** `inline`: a line under a paragraph. `section`: the "Learn more" line. `row`: inside a P7 row. */
export type DisclosureSize = 'inline' | 'section' | 'row';

export interface DisclosureProps {
  /** The `<summary>` content. The caller supplies every word. */
  summary: ReactNode;
  /** What the disclosure reveals. */
  children: ReactNode;
  /** Default `section`. */
  size?: DisclosureSize;
  /**
   * Controlled open state. When given, the `<details>` element's `open`
   * attribute follows it (a group that auto-expands); when omitted, the
   * element toggles natively, starting from `defaultOpen`.
   */
  open?: boolean;
  /** Initial state when `open` is not controlled. Default false. */
  defaultOpen?: boolean;
  /** Called with the new state when the reader toggles the element. */
  onToggle?: (open: boolean) => void;
  /** The summary is a destination the page told the reader to look for: painted `--accent`. */
  destination?: boolean;
  id?: string;
}

// Full class names, never built from a template: the class guard
// (`src/app/ui-class-names.test.ts`) reads string literals.
const SIZE_CLASS: Record<DisclosureSize, string> = {
  inline: 'ui-disclosure--inline',
  section: 'ui-disclosure--section',
  row: 'ui-disclosure--row',
};

export function Disclosure({
  summary,
  children,
  size = 'section',
  open,
  defaultOpen = false,
  onToggle,
  destination = false,
  id,
}: DisclosureProps) {
  const className = ['ui-disclosure', SIZE_CLASS[size], destination ? 'ui-disclosure--destination' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <details
      id={id}
      className={className}
      open={open ?? defaultOpen}
      onToggle={onToggle ? (event) => onToggle((event.currentTarget as HTMLDetailsElement).open) : undefined}
    >
      <summary className="ui-disclosure-summary">{summary}</summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  );
}
