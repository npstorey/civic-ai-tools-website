// The answer view's layouts (LAYOUT-WEB W4 P1, design §7.1, spec §8.14): the
// two built-ins, the renderer's part list, the one table that maps a layout's
// part names to the view's, and the rule that places every part.
//
// Pure, and safe for a client component to import: no React, no DOM, no
// `node:` module, no environment read. The reading of an instance's setting
// and the check through produce-core's builder live beside it, in
// `reading.ts`, which is server-only; this half is what `AnswerView.tsx`
// imports. The payload type is produce-core's (`LayoutPayload`), imported as a
// type only, so this module carries no copy of the builder.
//
// Relative, extension-carrying imports (the convention of src/lib since #345):
// the test runner has no path mapping.

import type { LayoutPayload } from '@typedstandards/produce-core';

export type { LayoutPayload };

// --- The two built-ins -------------------------------------------------------------

/**
 * `answer-first` v1: the seven fields of the §8.14.1 example payload, as the
 * site ships it (hub `docs/architecture/typed-standards-specification.md`,
 * spec v0.1.12). Its order is the order every surface rendered at the base of
 * this phase, so with no setting nothing moves.
 */
export const ANSWER_FIRST: LayoutPayload = {
  name: 'answer-first',
  version: 1,
  appliesTo: ['default', 'datHere'],
  order: ['status', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'],
  disclosure: {
    label: 'Learn more about how this analysis was produced',
    order: ['A', 'B', 'C', 'D', 'E', 'G', 'signers', 'attestations', 'verification'],
    openByDefault: false,
  },
  steps: { placement: 'beside', openByDefault: true },
  rendererVersion: 'answer-view/1',
};

/**
 * `envelope-order` v1: the order the surfaces had before the answer moved
 * first (design §2), with the same disclosure as `answer-first`. The envelope
 * comes first, so the answer follows A to E as it did when it was section F
 * (§2.2); the steps sit directly above the answer and the sources line
 * directly under it (§2.1); the citation follows the signers (§2.2); the
 * actions close the view (§2.1, §2.2, §2.3).
 */
export const ENVELOPE_ORDER: LayoutPayload = {
  name: 'envelope-order',
  version: 1,
  appliesTo: ['default', 'datHere'],
  order: ['status', 'disclosure', 'steps', 'answer', 'sources', 'citation', 'actions'],
  disclosure: {
    label: 'Learn more about how this analysis was produced',
    order: ['A', 'B', 'C', 'D', 'E', 'G', 'signers', 'attestations', 'verification'],
    openByDefault: false,
  },
  steps: { placement: 'beside', openByDefault: true },
  rendererVersion: 'answer-view/1',
};

/** The built-ins, the default first. */
export const BUILT_IN_LAYOUTS: readonly LayoutPayload[] = [ANSWER_FIRST, ENVELOPE_ORDER];

/** The layouts an instance offers a reader, and the one it renders with when the reader has not chosen. */
export interface InstanceLayouts {
  default: LayoutPayload;
  /** Every layout the toggle offers, the default among them, in the order the toggle lists them. */
  offered: readonly LayoutPayload[];
}

/** An instance with no layout setting: `answer-first` by default, and both built-ins offered. */
export const BUILT_IN_INSTANCE_LAYOUTS: InstanceLayouts = { default: ANSWER_FIRST, offered: BUILT_IN_LAYOUTS };

// --- The renderer's part list, and the name map -----------------------------------
//
// The renderer holds the part names and each part's default place: the order
// of these tables is where each part renders at this phase's base (website
// main 641a82f). The layout vocabulary is the §8.14.1 example's names (spec
// §8.14.4: the renderer's vocabulary, identified by `rendererVersion`); the
// view keeps its own names, and each row maps one to the other. A row with no
// layout name is a part the surface adds that no layout can name; it renders
// at its default place on every layout.

/** The page's parts, in their default places. */
export const PAGE_PARTS = [
  { name: 'status', view: 'status-row' },
  { name: 'answer', view: 'answer' },
  { name: 'citation', view: 'citation' },
  { name: 'steps', view: 'steps' },
  { name: 'sources', view: 'sources' },
  // R6 W4: "Where this question went". No layout names it; it renders after the sources line.
  { name: null, view: 'where-it-went' },
  { name: 'disclosure', view: 'disclosure' },
  { name: 'actions', view: 'actions' },
] as const;

/** The view's name for a page part. */
export type PagePartView = (typeof PAGE_PARTS)[number]['view'];

/** The view's page parts, in their default places (`view-model.ts`'s `PART_ORDER`). */
export const PAGE_PART_VIEWS: readonly PagePartView[] = PAGE_PARTS.map((p) => p.view);

/**
 * The disclosure's sections, in their default places. F (the answer again) is
 * a name the §8.14.1 example does not use; Provenance Graph, Additional
 * Artifacts and Adversarial evaluations are the record's sections W1 placed
 * after the envelope, which the example does not name either. Unnamed, each
 * renders where it renders at the base. `surface-extras` is what a surface
 * adds inside the disclosure (the comparison's skill excerpts); no layout
 * names it.
 */
export const DISCLOSURE_SECTIONS = [
  { name: 'A', view: 'question' },
  { name: 'B', view: 'instructions' },
  { name: 'C', view: 'environment' },
  { name: 'D', view: 'trace' },
  { name: 'E', view: 'notebook' },
  { name: 'F', view: 'answer-again' },
  { name: 'G', view: 'summary' },
  { name: 'signers', view: 'signers' },
  { name: 'provenance-graph', view: 'provenance-graph' },
  { name: 'additional-artifacts', view: 'additional-artifacts' },
  { name: 'evaluations', view: 'evaluations' },
  { name: 'attestations', view: 'attestations' },
  { name: 'verification', view: 'verification' },
  { name: null, view: 'surface-extras' },
] as const;

/** The view's name for a disclosure section. */
export type DisclosureSectionView = (typeof DISCLOSURE_SECTIONS)[number]['view'];

/** The record's own disclosure sections, which the record page hands the view by name. */
export type RecordSectionView = 'provenance-graph' | 'additional-artifacts' | 'evaluations' | 'attestations' | 'verification';

// --- The placement rule ---------------------------------------------------------------

/** Where each part renders under a layout, and the names in it the renderer does not know. */
export interface Placement<V extends string> {
  order: V[];
  unknown: string[];
}

/**
 * Places every part of `table` under the names a layout gives (spec §8.14.4;
 * the W4 amendment's item 7):
 *   - a known name renders where the layout puts it, once (a repeated name
 *     keeps its first place);
 *   - a part the layout does not name renders at its default place: directly
 *     after the part that precedes it in `table`, or first when nothing does —
 *     so it is never dropped (layout rule 2);
 *   - a name the renderer does not know renders nothing, and is returned in
 *     `unknown` so the reading can say so.
 * Applied to the table's own names in the table's order, it returns the
 * table's order: the default places.
 */
export function placeParts<V extends string>(
  table: ReadonlyArray<{ readonly name: string | null; readonly view: V }>,
  named: readonly string[],
): Placement<V> {
  const byName = new Map<string, V>();
  for (const row of table) if (row.name !== null) byName.set(row.name, row.view);
  const order: V[] = [];
  const unknown: string[] = [];
  for (const name of named) {
    const view = byName.get(name);
    if (view === undefined) {
      if (!unknown.includes(name)) unknown.push(name);
    } else if (!order.includes(view)) {
      order.push(view);
    }
  }
  table.forEach((row, i) => {
    if (order.includes(row.view)) return;
    // Every row before this one is already placed, named or not.
    const after = i === 0 ? -1 : order.indexOf(table[i - 1].view);
    order.splice(after + 1, 0, row.view);
  });
  return { order, unknown };
}

/** The page's parts under `layout`. */
export function pageOrder(layout: LayoutPayload): Placement<PagePartView> {
  return placeParts(PAGE_PARTS, layout.order);
}

/** The disclosure's sections under `layout`. */
export function disclosureOrder(layout: LayoutPayload): Placement<DisclosureSectionView> {
  return placeParts(DISCLOSURE_SECTIONS, layout.disclosure.order);
}

/** Every name in `layout` the renderer does not know: the page's, then the disclosure's. */
export function unknownPartNames(layout: LayoutPayload): string[] {
  return [...pageOrder(layout).unknown, ...disclosureOrder(layout).unknown];
}

// --- The reader's choice, and the page's line --------------------------------------------

/** A layout's identity: its name and its own version. */
export function layoutId(layout: Pick<LayoutPayload, 'name' | 'version'>): string {
  return `${layout.name}@${layout.version}`;
}

/** A stored choice, read against what the instance offers; anything else is "no choice". */
export function parseStoredLayoutChoice(raw: string | null, offered: readonly LayoutPayload[]): string | null {
  if (raw === null) return null;
  return offered.some((l) => layoutId(l) === raw) ? raw : null;
}

/** The layout a view renders with: the reader's choice when the instance offers it, else the instance's default. */
export function selectLayout(layouts: InstanceLayouts, chosen: string | null): LayoutPayload {
  if (chosen !== null) {
    const found = layouts.offered.find((l) => layoutId(l) === chosen);
    if (found !== undefined) return found;
  }
  return layouts.default;
}

/** Rule 5: the line at the foot of the view that says which layout rendered it. */
export function layoutLine(layout: Pick<LayoutPayload, 'name' | 'version'>): string {
  return `Shown under layout ${layout.name} v${layout.version}`;
}
