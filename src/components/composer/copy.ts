/**
 * The composer's words (UX-2 P3b-1). One place for every word the composer
 * adds; the words the guard's slots carry (the consent card, the decline line,
 * the no-source-on line) stay in `src/lib/sources/copy.ts`.
 *
 * RULED, shipped byte for byte (the research check's second report, R1 = A;
 * P3b's rulings, Q5 = B):
 * - X23, the docked box's placeholder;
 * - X24, the first-time line, in its two forms: the signed-in form on `/ask`,
 *   the signed-out form on the home page (no form on `/explore`, where no
 *   answer sits beside a box a new question could replace).
 *
 * PENDING (the words gate has not reached it; a later leg swaps it):
 * - `CHIP_ROW_LABEL`, the example row's accessible name (`ChipRow`'s required
 *   `label`), drawn as "Example questions" in the design reference.
 */

/** X23: the docked box's placeholder. */
export const DOCKED_PLACEHOLDER = 'Ask another question';

/**
 * X24 (Q5 = B), by sign-in state, as its disclosure shows it (relay 57; design version 4): the first sentence is
 * the closed disclosure's summary, the second its body. Read whole, each form is the ruled sentence pair.
 */
export const FIRST_TIME_LINE_PARTS = {
  signedIn: { summary: 'A new question replaces this answer.', body: 'To keep this answer, publish it first.' },
  signedOut: { summary: 'A new question replaces this answer.', body: 'To keep this answer, sign in and publish it.' },
} as const;

/** PENDING: the example row's accessible name. */
export const CHIP_ROW_LABEL = 'Example questions';
