/**
 * The composer's words (UX-2 P3b-1). One place for every word the composer
 * adds; the words the guard's slots carry (the consent card, the decline line,
 * the no-source-on line) stay in `src/lib/sources/copy.ts`.
 *
 * RULED, shipped byte for byte (the research checks, R1 = A; P3b's rulings,
 * Q5 = B, Q6 = B with the owner's note; the owner's rulings on design version
 * 6, O3 = A and O4 = A; the words gate's rulings W1-W7):
 * - X23, the docked box's placeholder;
 * - X24, the first-time line: signed in both sentences, signed out the first
 *   only (O4 = A); the second signed-out sentence is ruled and withheld;
 * - the where-line's forms (items 23/47 and 32; W3-W6);
 * - the account line: the count (W1), its form at 0 (W2), and the P3b sign-in
 *   sentence (Q6 = B with the note);
 * - the example row's accessible name (W7).
 */

/** X23: the docked box's placeholder. */
export const DOCKED_PLACEHOLDER = 'Ask another question';

/** X24 (Q5 = B; O4 = A), by sign-in state, as one plain paragraph. */
export const FIRST_TIME_LINE = {
  signedIn: 'A new question replaces this answer. To keep this answer, publish it first.',
  signedOut: 'A new question replaces this answer.',
} as const;

/**
 * X24's signed-out second sentence: ruled, and withheld (O4 = A). Rendered
 * nowhere until signing in keeps an unpublished answer (a UX-2 follow-up: today
 * a sign-in is a full-page redirect that loses the answer on screen, S10); that
 * follow-up brings it back after `FIRST_TIME_LINE.signedOut`.
 */
export const FIRST_TIME_LINE_WITHHELD = 'To keep this answer, sign in and publish it.';

/** W7: the example row's accessible name (`ChipRow`'s `label`). */
export const CHIP_ROW_LABEL = 'Example questions';

/** The where-line (D5 B; items 23/47; W3-W6), everything before its link. */
const LEAD = 'Where your question goes: ';
const dataSources = (n: number) => (n === 1 ? '1 data source' : `${n} data sources`);
export const WHERE_LINE = {
  /** N ≥ 1 sources On: Standard (items 23/47), or Sandbox with the notebook runner (W3). */
  on: (n: number, sandbox: boolean) =>
    sandbox ? `${LEAD}the model service, the notebook runner and ${dataSources(n)}` : `${LEAD}the model service and ${dataSources(n)}`,
  /** None On, a source Ask first: Standard (items 23/47), or Sandbox (W4). */
  askFirst: (sandbox: boolean) =>
    sandbox ? `${LEAD}the model service and the notebook runner; data sources ask first` : `${LEAD}the model service; data sources ask first`,
  /** Every source Off, in both session types (W5, W6). */
  everyOff: `${LEAD}nowhere; every data source is Off`,
  /** Between the words and the link. */
  separator: ' · ',
  /** Item 32: the link to the Settings overlay. */
  link: 'Select sources',
} as const;

/** The account line's count (W1), and at 0 the sentence after it (W2). */
export const COUNT_LINE = {
  left: (remaining: number, limit: number) => `${remaining} of ${limit} questions left today.`,
  reset: 'The count resets at midnight UTC.',
} as const;

/**
 * The P3b sign-in sentence (Q6 = B with the owner's note), split at "Sign in"
 * so the control wraps those two words only: "Sign in for more features and
 * usage."
 */
export const SIGN_IN_LINE = { action: 'Sign in', rest: ' for more features and usage.' } as const;
