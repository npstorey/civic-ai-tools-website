import type { ReactNode } from 'react';

/**
 * P9 · Page frame (UX-1 P0; design §2 P9). Three widths, one `h1`, one lede
 * style, one section heading, the section rhythm, and the example-chip row.
 * `PageToc` is not here (P7 builds it on this frame).
 *
 * LEG A STUB: the final props types; the renders are placeholders the fixture
 * test (`Page.test.ts`) fails against. Leg B builds the primitives.
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
  id?: string;
}

export interface ChipRowProps {
  /** The row's accessible name. */
  label: string;
  /** The chips: 13 px outlined buttons, supplied by the caller. */
  children: ReactNode;
}

export function Page(props: PageProps) {
  void props;
  return <div data-ui-stub="Page" />;
}

export function PageSection(props: PageSectionProps) {
  void props;
  return <div data-ui-stub="PageSection" />;
}

export function ChipRow(props: ChipRowProps) {
  void props;
  return <div data-ui-stub="ChipRow" />;
}
