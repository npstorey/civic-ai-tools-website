import type { ReactNode } from 'react';
import Link from 'next/link';
import { Disclosure } from './Disclosure';

/**
 * P7 · List row (UX-1 P0; design §2 P7). Anatomy:
 *   - a title (a link when `href` is given, 16 px display font);
 *   - a one-line summary (14 px, clamped to two lines);
 *   - a meta line (12 px `--text-muted`: date · author · model display name;
 *     the separators are CSS);
 *   - a trailing column of P6 `line` signals;
 *   - an optional row menu (a P2 `icon` menu);
 *   - an optional P1 `row` disclosure.
 *
 * States: idle; hover (`--card-background`, CSS); withdrawn (title struck, row
 * at 0.65 opacity); selected (focus ring). Sizes: `list` (full width, a rule
 * between rows) and `card` (a P5 plain card, for grids). Below 640 px the
 * trailing column wraps under the meta line.
 *
 * Every word is the caller's.
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

// Full class names, never built from a template: the class guard
// (`src/app/ui-class-names.test.ts`) reads string literals. The `card` size
// is a P5 plain card: it carries Card's own classes.
const SIZE_CLASS: Record<RowSize, string> = {
  list: 'ui-row--list',
  card: 'ui-row--card ui-card ui-card--plain',
};

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Row({
  title,
  href,
  summary,
  meta,
  signals,
  menu,
  disclosure,
  size = 'list',
  withdrawn = false,
  selected = false,
  as: Tag = 'div',
  id,
}: RowProps) {
  const className = [
    'ui-row',
    SIZE_CLASS[size],
    withdrawn ? 'ui-row--withdrawn' : '',
    selected ? 'ui-row--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const metaItems = (meta ?? []).filter(present);
  const hasSignals = present(signals);
  const hasMenu = present(menu);
  return (
    <Tag id={id} className={className}>
      <div className="ui-row-main">
        <div className="ui-row-title">{href ? <Link href={href}>{title}</Link> : title}</div>
        {present(summary) ? <p className="ui-row-summary">{summary}</p> : null}
        {metaItems.length > 0 ? (
          <p className="ui-row-meta">
            {metaItems.map((item, i) => (
              <span key={i} className="ui-row-meta-item">
                {item}
              </span>
            ))}
          </p>
        ) : null}
        {disclosure ? (
          <Disclosure size="row" summary={disclosure.summary}>
            {disclosure.children}
          </Disclosure>
        ) : null}
      </div>
      {hasSignals || hasMenu ? (
        <div className="ui-row-trailing">
          {hasSignals ? <div className="ui-row-signals">{signals}</div> : null}
          {hasMenu ? <div className="ui-row-menu">{menu}</div> : null}
        </div>
      ) : null}
    </Tag>
  );
}
