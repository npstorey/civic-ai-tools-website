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
 *
 * UX-2 P3b-2 adds the harness menu's words (the contract's Words table: R1 = A,
 * D3 = A, Q11 = A, ASK3 = A, C1 = A, C2 = A, C3 = A, C6 = A), CA-1a's
 * where-line (C1 = A; v2 ruling 2), and the words the gear's region carried,
 * moved verbatim (`notebookDesc`, `compareDesc`, the no-sign-in Sandbox
 * sentence, "Why these models?"). Each is one constant here, so a words ruling
 * is a one-line edit. Compare's "On" / "Off" await criterion 13's words check
 * (v2 ruling 3) and ship as that pair, one constant each.
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
  /** CA-1a (C1 = A; v2 ruling 2): no source On where this site cannot ask, in both session types. */
  cannotAsk: `${LEAD}nowhere; no data source is On`,
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

// --- UX-2 P3b-2: the harness menu (2B-2E) -----------------------------------------------------------------------

/** Row 25 (R1 = A; D3 = A): the trigger, signed in and out; the model's name follows it at 900 px and up. */
export const HARNESS_TRIGGER = 'Default harness';
/** Between the trigger's words and the model's name, visible and in the trigger's accessible name (fix 3). */
export const HARNESS_TRIGGER_SEPARATOR = ' · ';
/** Rows 26-27 (R1 = A; Q11 = A): the heading row, as 2B item 1 writes it. */
export const HARNESS_HEADING = 'Harness · Civic AI harness v1';

/** Row 31: the Model item; B4a (ASK3 = A): its reason signed out. */
export const MODEL_ITEM = { label: 'Model', signedOutReason: 'Sign in to choose a model.' } as const;

/** Row 44, rows 1-3, H-2 and H-3 (C1 = A, C3 = A, C6 = A): the Data sources item, in its two routing forms. */
export const DATA_SOURCES_ITEM = {
  label: 'Data sources',
  value: 'Auto',
  /** Shown only in loop with the decision store (`canPauseToAsk`; v2 ruling 1). */
  inLoop: {
    auto: 'Auto - find sources for me',
    autoDescription: 'The model chooses which data sources to use, from those you set On or Ask first.',
    pickReason: 'Not offered on this site yet. The model chooses from the data sources you set On or Ask first.',
  },
  /** Every other case: routing all-sources, no store, or either unread or failed. */
  allSources: {
    auto: 'Auto - use every source I set On',
    autoDescription: 'Every data source you set On is given to the model from the start. Sources set to Ask first are not used.',
    pickReason: 'Not offered on this site yet. Every data source you set On is given to the model.',
  },
  /** Rows 1-3: the second option, with no description (C1 = A). */
  pick: 'Only the ones I pick',
  /** Row 44: the footer, a link to the Settings overlay. */
  footer: 'All data sources and your consent',
} as const;

/** Rows 4-5, 15: the Session type item and its two values. */
export const SESSION_TYPE_ITEM = { label: 'Session type', sandbox: 'Sandbox', standard: 'Standard' } as const;
/** Moved verbatim from the form's response-mode block (`notebookDesc`, `QueryForm.tsx:533-535` at b4766f1). */
export const SANDBOX_DESCRIPTION = 'Generates and executes a Jupyter notebook against live data. Typically 30 to 90 seconds. The notebook and a cryptographic execution record are signed by the platform.';
/**
 * Where sign-in is not offered, the Sandbox option's reason: the form's sign-in branch's sentence, moved verbatim
 * (`QueryForm.tsx:612` at b4766f1; fix 10). An item for criterion 13's words check (v3 conflict ruling 3).
 */
export const SANDBOX_SIGN_IN_REASON = 'Executed-sandbox mode generates and runs a Jupyter notebook against live data, then signs the execution record. Sign in to enable.';

/** Row 30 (D4 = A): the Compare item; `compareDesc` moved verbatim (`QueryForm.tsx:691-692` at b4766f1); row 16. */
export const COMPARE_ITEM = {
  label: 'Compare with a second harness',
  description: 'Adds a second answer from training data alone, side by side. Runs one extra model call per question.',
  sandboxReason: 'Not offered in a Sandbox session. Switch Session type to Standard to compare.',
} as const;
/** Compare's value On: awaiting criterion 13's words check (v2 ruling 3). */
export const COMPARE_VALUE_ON = 'On';
/** Compare's value Off: awaiting criterion 13's words check (v2 ruling 3). */
export const COMPARE_VALUE_OFF = 'Off';

/** Row 6: the last item, a link to the Settings overlay. */
export const ALL_SETTINGS = 'All settings';
/** B1: the signed-out menu's button, doing what the header's Sign in does. */
export const SIGN_IN_FOR_MORE = 'Sign in for more options';

/** H-1 (C2 = A, its second sentence cut): "About these settings" only (Q2 = A). */
export const HARNESS_SENTENCE = 'A harness is the data sources a question can use and the instructions the model gets for using them.';
/** Moved verbatim from the form's region (`QueryForm.tsx:850` at b4766f1; Q8 = A): the About tab's link. */
export const WHY_THESE_MODELS = 'Why these models?';
