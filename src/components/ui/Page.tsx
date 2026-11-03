import type { ReactNode } from 'react';

/**
 * P9 · Page frame (UX-1 P0; design §2 P9). It has:
 *   - three widths: `reading` 720 px, `record` 800 px, `wide` 1200 px;
 *   - a side gutter of 24 px, 16 px below 640;
 *   - one `h1`, styled as globals.css styles every h1;
 *   - one lede style (20 px `--text-secondary`);
 *   - one section heading (18 px, 600);
 *   - sections `--space-lg` apart.
 * The chip row (`ui-chip-row`) is a horizontally scrolling, non-wrapping row
 * of 13 px outlined buttons with a 6 px gap and no separators.
 *
 * `PageToc` is not here (P7 builds it on this frame).
 *
 * Every word is the caller's.
 */

/** `reading` 720 px, `record` 800 px, `wide` 1200 px. */
export type PageWidth = 'reading' | 'record' | 'wide';

export interface PageProps {
  width: PageWidth;
  /** The page's one `h1`. */
  title?: ReactNode;
  /** The lede under the title. */
  lede?: ReactNode;
  children?: ReactNode;
  /** Default `div` (the root layout already renders `<main>`). */
  as?: 'div' | 'article';
}

export interface PageSectionProps {
  /** The section heading (18 px, 600). */
  heading: ReactNode;
  children?: ReactNode;
  /** The section's id; its heading takes `<id>-heading` and labels it. */
  id?: string;
}

export interface ChipRowProps {
  /** The row's accessible name. */
  label: string;
  /** The chips: 13 px outlined buttons, supplied by the caller. */
  children: ReactNode;
}

// Full class names, never built from a template: the class guard
// (`src/app/ui-class-names.test.ts`) reads string literals.
const WIDTH_CLASS: Record<PageWidth, string> = {
  reading: 'ui-page--reading',
  record: 'ui-page--record',
  wide: 'ui-page--wide',
};

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Page({ width, title, lede, children, as: Tag = 'div' }: PageProps) {
  const hasTitle = present(title);
  const hasLede = present(lede);
  return (
    <Tag className={['ui-page', WIDTH_CLASS[width]].join(' ')}>
      {hasTitle || hasLede ? (
        <header className="ui-page-header">
          {hasTitle ? <h1 className="ui-page-title">{title}</h1> : null}
          {hasLede ? <p className="ui-page-lede">{lede}</p> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

export function PageSection({ heading, children, id }: PageSectionProps) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} className="ui-page-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-page-section-heading">
        {heading}
      </h2>
      {children}
    </section>
  );
}

export function ChipRow({ label, children }: ChipRowProps) {
  return (
    <div className="ui-chip-row" role="group" aria-label={label}>
      {children}
    </div>
  );
}
