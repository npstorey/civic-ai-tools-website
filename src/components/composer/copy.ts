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
 * where-line (C1 = A; v2 ruling 2), and the words the gear's region carried
 * (`notebookDesc`, `compareDesc`, "Why these models?"), moved verbatim but for
 * the owner's rulings on P3b-2's words memo (D1 = B, D4 = B; #729 6877110969).
 * Each is one constant here, so a words ruling is a one-line edit. Compare's "On" / "Off" were kept by criterion 13's
 * words check (W2 KEEP, #729 6866525511) and the owner's rulings (6877110969), one constant each.
 */

// OF3b: the map format's two reason lines are kept with the map's other words; relative, so `node --test` reads it.
import { MAP_COMPARE_REASON, MAP_SANDBOX_REASON } from '../../lib/output-format/map-words.ts';

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
    /** S110 (S4 W2a; the words W2 uses, "Seen and not carded" item 6, with W3 = A's pair applied). */
    autoDescription: 'The AI chooses which data sources to use, from those you have not disabled. The site asks before it uses one not answered yet.',
    /** S1 (S3-B W1; D9 = A): "Only the ones I pick", offered in this form only. */
    pickDescription: 'You search for data sources and pick the ones this question can use. The model uses no others.',
  },
  /** Where the read names all-sources, or in loop with no store. While the pair is unread or failed, Auto reads `value` alone (PQ6 = (b)). */
  allSources: {
    /** S115, S116, S117 (S4 W2a; the words W2 uses, "Seen and not carded" item 6, with W3 = A's pair applied). */
    auto: 'Auto - use every enabled source',
    autoDescription: 'The AI can use every enabled data source. A source not enabled is not used.',
    /** D8 = B (S3-B W1): the reason "Only the ones I pick" is not offered here (D5 = A); S117's words. */
    pickReason: 'Not offered on this site. Every enabled data source is given to the AI.',
  },
  /** Rows 1-3: the second option. */
  pick: 'Only the ones I pick',
  /** S13 (S3-B W1): the item's value while "Only the ones I pick" is chosen; "0 picked" with none, never "Auto". */
  picked: (n: number) => `${n} picked`,
  /** Row 44: the footer, a link to the Settings overlay. */
  footer: 'All data sources and your consent',
} as const;

/**
 * OF2 (Sprint OF-1, website #810; G0-1 = A, G0-2 = A): the Output format item, directly after Data sources, on an
 * instance with `SITE_OUTPUT_FORMAT` on. The label is ruled (G0-1 = A); Auto's option line and its description are
 * ruled at G0b (W1 = B, W3 = A: "the AI"; seat 7168515476, 7172131446); the value "Auto" is as built, the item's Auto
 * as Data sources' is. A format's own words travel with it from the registry
 * (`src/lib/output-format/registry.ts`); OF2 offers none but Auto (G0-9 = A).
 */
export const OUTPUT_FORMAT_ITEM = {
  label: 'Output format',
  /** OF3b (K3 = A; the seat's 7172716367): a map format's reason in a Sandbox session (`map-words.ts`). */
  sandboxMapReason: MAP_SANDBOX_REASON,
  /** The item's value under Auto, as built. */
  value: 'Auto',
  /** Auto's option line: ruled, W1 = B (the built label), W3 = A ("the AI"). */
  auto: 'Auto - text as the AI writes it',
  /** Auto's description: ruled, W1 = B (the checker's line), W3 = A ("the AI"). */
  autoDescription: 'The AI\'s answer, with no output format applied.',
} as const;

/** Rows 4-5, 15: the Session type item and its two values. */
export const SESSION_TYPE_ITEM = { label: 'Session type', sandbox: 'Sandbox', standard: 'Standard' } as const;
/**
 * The form's response-mode block's `notebookDesc` (`QueryForm.tsx:533-535` at b4766f1), with its last sentence as the owner
 * ruled it (D4 = B, #729 6877110969): "this site" for "the platform".
 */
export const SANDBOX_DESCRIPTION = 'Generates and executes a Jupyter notebook against live data. Typically 30 to 90 seconds. The notebook and a cryptographic execution record are signed by this site.';
/**
 * Where sign-in is not offered, the Sandbox option's reason (fix 10), as the owner ruled it (D1 = B, #729 6877110969),
 * in place of the form's sign-in branch's sentence (`QueryForm.tsx:612` at b4766f1).
 */
export const SANDBOX_SIGN_IN_REASON = 'Not offered on this site: a Sandbox session needs you to sign in, and this site has no sign-in.';

/** Row 30 (D4 = A): the Compare item; `compareDesc` moved verbatim (`QueryForm.tsx:691-692` at b4766f1); row 16. */
export const COMPARE_ITEM = {
  label: 'Compare with a second harness',
  description: 'Adds a second answer from training data alone, side by side. Runs one extra model call per question.',
  sandboxReason: 'Not offered in a Sandbox session. Switch Session type to Standard to compare.',
  /** OF3b (C3 = A; the seat's 7172716367): while a map format is chosen; the compare route refuses with it too. */
  mapReason: MAP_COMPARE_REASON,
} as const;
/** Compare's value On: kept by the words check (W2 KEEP, #729 6866525511) and the owner's rulings (6877110969). */
export const COMPARE_VALUE_ON = 'On';
/** Compare's value Off: kept by the words check (W2 KEEP, #729 6866525511) and the owner's rulings (6877110969). */
export const COMPARE_VALUE_OFF = 'Off';

/** Row 6: the last item, a link to the Settings overlay. */
export const ALL_SETTINGS = 'All settings';
/** B1: the signed-out menu's button, doing what the header's Sign in does. */
export const SIGN_IN_FOR_MORE = 'Sign in for more options';

/** H-1 (C2 = A, its second sentence cut): "About these settings" only (Q2 = A). */
export const HARNESS_SENTENCE = 'A harness is the data sources a question can use and the instructions the model gets for using them.';
/** Moved verbatim from the form's region (`QueryForm.tsx:850` at b4766f1; Q8 = A): the About tab's link. */
export const WHY_THESE_MODELS = 'Why these models?';

/**
 * The picker (S3-B W1, npstorey/civic-ai-tools#318; the owner's W0 rulings, OA-870, D1 = B, D2 = A, D3 = A, D4 = B,
 * D9 = A; words `w0-words.r2.md`, checked by `research-check-w0.md`). The panel's search field and its no-match line
 * are the Settings overlay's (`SETTINGS_TEXT.search`, `.noMatch`, S2 and S3); its close control is the site's × "Close"
 * (S15, `research-check-w1.md`); S10 is `friendlyStreamError`'s; S11 and D7's words are `WHERE_IT_WENT_REASONS`'.
 */
export const PICKER_TEXT = {
  /** S12: the panel's heading, and its name. */
  heading: 'Pick the data sources for this question',
  /** S4: a row's pick control, its visible words and its accessible name. */
  pick: 'Pick for this question',
  pickName: (name: string) => `Pick ${name} for this question`,
  /** S5: an Off row, why it cannot be picked. */
  // S4 W2a fix round 1: drafted by the ruled pairs, naming only a state the two buttons can set; for the words check.
  // It was "Off. Set it to On or Ask first to pick it.".
  offReason: 'Disabled. Enable it to pick it.',
  /** S6a: a hit this site has not set up. */
  notSetUp: 'Not set up on this site.',
  /** S7: under the box, once sources are picked; the names in the statement's order, "A", "A and B", "A, B and C". */
  picksLine: (names: readonly string[]) => `Your question can use only these data sources: ${joinNames(names)}.`,
  /** S8: after S7, the control that opens the panel again. */
  change: 'Change',
  /** S9 (D4 = B): under the box, after a send with "Only the ones I pick" chosen and nothing picked. */
  noPickAfterSend: 'No data source is picked, so nothing was sent. Pick at least one, or choose Auto.',
  /**
   * FIX-1 D2 = A, D3 = E0 (website #807; OA-1101, OA-1109): under the box, in S9's place, after a send with sources
   * picked while the flows statement could not be read, again, at the send. Auto's own description stays where a reader
   * chooses it (`DATA_SOURCES_ITEM`).
   */
  notLoadedAfterSend: 'Your picked data sources could not be loaded just now, so nothing was sent. Try again in a moment, or choose Auto.',
} as const;

/**
 * FIX-1 D6 = A, D7 = A (website #807; G0, OA-1101): the question surface's one polite announcement, once per run, when
 * the run's answer is ready (`src/components/shared/answer-arrival.ts`). Read by a screen reader only.
 */
export const ANSWER_READY = 'The answer to your question is ready.';

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
