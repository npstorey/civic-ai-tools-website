/**
 * What an executed notebook's cover cell claims about its own reproduction —
 * written here, parsed back here, and refused here (#371, ruling D3).
 *
 * ONE SENTENCE, ONE HOME. The cover cell is emitted by `./prompt.ts`, so by the
 * rule `./tool-to-cell.ts` states for `REPRODUCED_FETCH_ASSIGNMENT` — a detector
 * lives beside the thing it detects — the builder and its parser would belong
 * there. They are here instead for one measured reason: `prompt.ts` reaches
 * `../site-config.ts`, which reads non-`NEXT_PUBLIC` environment, and TWO CLIENT
 * COMPONENTS have to read this claim back off a stored notebook
 * (`components/evidence/NotebookSection.tsx`,
 * `components/notebook/ChatNotebookOutput.tsx`) so that what they tell a reader
 * is what the notebook in hand says rather than a sentence hardcoded beside the
 * download button. `src/lib/notebook.ts:2-11` records what happens when a
 * server-env module rides into a client bundle. This module imports one TYPE and
 * nothing else, so it is safe on both sides; `prompt.ts` imports the builder from
 * here rather than restating the sentence, and the sentence therefore still
 * exists exactly once.
 *
 * WHAT A "STEP" IS. A step is a tool call the notebook renders as its own step
 * in the analysis pipeline: one that either re-runs a live request (a code cell
 * carrying `dfN = fetch_*(`) or is stated as not re-run (a `#### Not reproduced:`
 * cell). A discovery call is not a step — `renderDiscoverySummaryCell` collapses
 * every one of them into a single cell that already says they are not
 * re-executed, and the notebook never numbers them. Both numbers are therefore
 * derivable FROM THE CELLS, which is what `./validate.ts` demands of itself: a
 * count read off the document cannot be satisfied by a claim the document makes.
 *
 * WHY THE SUBJECT IS THE NOTEBOOK. "1 of 4 steps re-run a live request" changes
 * its verb with its numerator; "This notebook re-runs a live request in 1 of its
 * 4 analysis steps" does not. One fixed form is what lets the validator parse
 * back exactly what the builder wrote.
 */

import type { NotebookCell } from './cells.ts';

/**
 * The cover cell's section heading. Owned here because the locator below finds
 * the cover BY CONTENT rather than by index: `/api/evidence/[slug]/bundle`
 * prepends a commitment cell to the stored notebook before a reader downloads
 * it, so cell 0 of the file in a reader's hands is not the cell this module
 * wrote.
 */
export const COVER_SECTION_HEADING = '## How to use this notebook';

/**
 * The cover cell's own prose — the body of the section above, from its heading
 * to the next `## ` heading — and NOTHING ELSE IN THE CELL.
 *
 * This scope is the whole point, and it is not a tidiness measure. The cover
 * cell opens with the instance title, then `**Query:** <the reader's own
 * question>`, then the portal and the generation time. A check that scans the
 * whole cell reads all four as the notebook's own words: a reader who asks "How
 * complete is the 311 data for 2024?" made `validateCoverClaims` report that the
 * notebook calls its analysis complete — a false issue about a claim the
 * document never made, raised by the very check added to stop false claims. A
 * question that happened to contain the claim's own wording did the same to the
 * parser, one function over.
 *
 * One definition, exported, so the validator and the reader-facing components
 * cannot scope this differently: what the notebook SAYS is what it says in its
 * own prose.
 */
export function coverSectionBody(coverText: string): string {
  const start = coverText.indexOf(COVER_SECTION_HEADING);
  if (start === -1) return '';
  const body = coverText.slice(start + COVER_SECTION_HEADING.length);
  // The next section heading, at the start of a line. `## ` with the space is
  // deliberate: `### Discovery` is a deeper heading, not the end of this one.
  const next = body.search(/(^|\n)## /);
  return next === -1 ? body : body.slice(0, next);
}

/** The one form of the claim. Every emitter calls this; nothing restates it. */
export function reproductionClaimSentence(reRun: number, steps: number): string {
  return `This notebook re-runs a live request in ${reRun} of its ${steps} analysis steps.`;
}

/**
 * The same sentence as a pattern, tolerant of the line wrapping the cover cell
 * applies to its paragraphs. Anchored on the whole clause rather than on two
 * bare numerals so a row count elsewhere in the cell can never be read as a
 * reproduction claim.
 */
const CLAIM_PATTERN = /re-runs\s+a\s+live\s+request\s+in\s+(\d+)\s+of\s+its\s+(\d+)\s+analysis\s+steps/;

/**
 * "Complete" as a bare adjective about the analysis — the claim ruling D3
 * removed. A notebook where three of four fetches were rejected asserted it
 * unchanged, because the condition it sat behind was binary (#371).
 */
const BARE_COMPLETENESS_PATTERN = /\bcomplete\b/i;

export interface ReproductionClaim {
  /** Steps that re-run a live request, as the cover text states it. */
  reRun: number;
  /** Steps the notebook renders, as the cover text states it. */
  steps: number;
}

function cellText(cell: NotebookCell | { source: string[] | string }): string {
  return Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '');
}

/**
 * The cover cell, located by content. Returns null when no cell carries the
 * heading — which is a real answer for a notebook this module did not write,
 * and not one to paper over with cell 0.
 */
export function findCoverCell<T extends { source: string[] | string }>(
  cells: readonly T[],
): T | null {
  for (const cell of cells) {
    if (cellText(cell).includes(COVER_SECTION_HEADING)) return cell;
  }
  return null;
}

/**
 * The claim a cover text states, or null when it states none.
 *
 * Scoped to the cover's own prose by `coverSectionBody`: the reader's question
 * sits five lines above the section that states the claim, so an unscoped parse
 * would take the first match in the cell — which can be the reader's numbers
 * rather than the document's.
 */
export function parseReproductionClaim(coverText: string): ReproductionClaim | null {
  const match = CLAIM_PATTERN.exec(coverSectionBody(coverText));
  if (!match) return null;
  return { reRun: Number(match[1]), steps: Number(match[2]) };
}

/**
 * True when a cover text calls the analysis complete — in its own prose. Scoped
 * by the same definition, and for the sharper reason: a single word carries this
 * one, so any occurrence anywhere in the cell would have tripped it.
 */
export function claimsCompleteness(coverText: string): boolean {
  return BARE_COMPLETENESS_PATTERN.test(coverSectionBody(coverText));
}

/**
 * The claim a NOTEBOOK states about itself, for a reader that has the cells and
 * not the tool calls. Null covers three honest cases at once and does not
 * distinguish them, because a reader-facing surface may not: a notebook written
 * before this claim existed, one whose cover cell is absent, and one that
 * renders no analysis step and so has no ratio to state.
 */
export function readReproductionClaim<T extends { source: string[] | string }>(
  cells: readonly T[],
): ReproductionClaim | null {
  const cover = findCoverCell(cells);
  if (!cover) return null;
  return parseReproductionClaim(cellText(cover));
}
