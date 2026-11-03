'use client';

import type { ReactNode } from 'react';

/**
 * P1 · Disclosure (UX-1 P0; design §2 P1). One mechanism for "reveal more of
 * what is already here": a native `<details class="ui-disclosure">`.
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Disclosure.test.ts`) fails against. Leg B builds the primitive.
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

export function Disclosure(props: DisclosureProps) {
  void props;
  return <div data-ui-stub="Disclosure" />;
}
