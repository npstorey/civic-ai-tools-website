import type { ReactNode } from 'react';

/**
 * P7 · List row (UX-1 P0; design §2 P7). Title, one-line summary, meta line,
 * a trailing column of P6 `line` signals, an optional row menu (P2 `icon`)
 * and an optional P1 `row` disclosure.
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Row.test.ts`) fails against. Leg B builds the primitive.
 */

/** `list`: full width, a rule between rows. `card`: a P5 plain card around the row, for grids. */
export type RowSize = 'list' | 'card';

export interface RowProps {
  /** The title; a link when `href` is given. */
  title: ReactNode;
  href?: string;
  /** One-line summary, clamped to two lines. */
  summary?: ReactNode;
  /** The meta line's items (date, author, model display name), in order. */
  meta?: ReactNode[];
  /** The trailing column: P6 `line` signals. */
  signals?: ReactNode;
  /** The row menu: a P2 `icon` menu. */
  menu?: ReactNode;
  /** An optional P1 `row` disclosure. */
  disclosure?: { summary: ReactNode; children: ReactNode };
  /** Default `list`. */
  size?: RowSize;
  /** Title struck, row at 0.65 opacity. */
  withdrawn?: boolean;
  /** The focus-ring state. */
  selected?: boolean;
  /** Default `div`. */
  as?: 'div' | 'li' | 'article';
  id?: string;
}

export function Row(props: RowProps) {
  void props;
  return <div data-ui-stub="Row" />;
}
