import type { ReactNode } from 'react';

/**
 * The page frame's jump list (UX-1 P7; design §2 P9). A `<nav aria-label>`
 * holding one list of fragment links, placed by the page under its lede,
 * modelled on the privacy page's jump list. It is built on `Page`: a page
 * renders it as a child of the frame, and it takes the frame's type and rhythm.
 *
 * The rule for WHEN a page has one (more than five h2s) is the page's: the
 * owner may rule a jump list on a page with fewer (G0-2 (ii)).
 *
 * Every word is the caller's: the nav's accessible name and each item's label.
 * Each item's `id` must be the id the page renders on the element the link
 * reaches, taken from the same source that gives that element its id.
 */

export interface PageTocItem {
  /** The id of the element the link reaches, without the `#`. */
  id: string;
  /** The link's text: the heading it reaches, as the page writes it. */
  label: ReactNode;
}

export interface PageTocProps {
  /** The nav's accessible name. */
  label: string;
  items: PageTocItem[];
  /**
   * `data-*` attributes for the element holding the list, for a page that
   * traces each element it renders (the privacy page's `data-statement` and
   * `data-trace`).
   */
  data?: Record<`data-${string}`, string>;
}

export function PageToc({ label, items, data }: PageTocProps) {
  return (
    <nav className="ui-page-toc" aria-label={label}>
      <div {...data}>
        <ul className="ui-page-toc-list">
          {items.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`}>{item.label}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
