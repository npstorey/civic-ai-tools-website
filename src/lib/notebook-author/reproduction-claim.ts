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

/** The claim a cover text states, or null when it states none. */
export function parseReproductionClaim(coverText: string): ReproductionClaim | null {
  const match = CLAIM_PATTERN.exec(coverText);
  if (!match) return null;
  return { reRun: Number(match[1]), steps: Number(match[2]) };
}

/** True when a cover text calls the analysis complete. */
export function claimsCompleteness(coverText: string): boolean {
  return BARE_COMPLETENESS_PATTERN.test(coverText);
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
