/**
 * The consent texts (R6 W3, #632): the privacy page's consent sections, the
 * first-consent card, and the local-only offer both of them make.
 *
 * Every block below is marked "candidate; the owner's final text replaces it
 * before R6 G7". The candidates are the research's §3 texts ("Consent and
 * Privacy Wording for an Open-Data AI Question Site: Research, Critique and
 * Paste-Ready Rewrites", sha256 41bec744…5042), with the contract's amendment
 * 1 (#632 comment 6281125002) applied: D1's withdrawal sentence, D2's scoped
 * notice sentence, D3's endpoint statement, D4's order, and the corrections to
 * fact 4 (where to withdraw) and fact 5 (the re-ask list is not complete).
 *
 * WHAT RENDERS ONLY WHEN CONFIGURED (amendment 1, correction 5). A text that
 * would be false on an instance that lacks the thing it describes is its own
 * export, and its surface renders it only when the instance has it:
 *   - "on your account" and "your dashboard" (a database, `DATABASE_URL`);
 *   - D2's notice sentences (a database);
 *   - the card's analytics line (analytics configured);
 *   - D3's endpoint statement (`SITE_OPERATOR_STATES_NO_TRAINING`).
 * The rest is the same on every instance.
 *
 * The surfaces render these strings as they are; the tests read the rendered
 * output against them (`src/components/sources/*.test.ts`,
 * `src/app/(app)/privacy/privacy-consent-items.test.ts`).
 */

// --- Text 3: the local-only offer (candidate; the owner's final text replaces it before R6 G7) ---

/** The offer itself, with or without a guide. */
export const LOCAL_ONLY_OFFER = 'You can also run this whole system on your own computer, with your own model and data sources.';

/** After the offer, when `SITE_DEPLOYMENT_GUIDE_URL` names the guide: the sentence, its link text. */
export const GUIDE_SENTENCE = 'The deployment guide explains how.';
export const GUIDE_LINK_TEXT = 'deployment guide';

/** After the offer, when no guide is named (D10 = A). */
export const NO_GUIDE_SENTENCE = 'This site does not name a deployment guide.';

// --- The Sources panel (candidate; the owner's final text replaces it before R6 G7) ---

/** What Ask first means in R6, in literal words (Q1): the pause is R8's. */
export const ASK_FIRST_MEANS = 'Ask first: this source is left out of your questions until you turn it On.';

/** The panel's heading, and its lead sentence. */
export const PANEL_HEADING = 'Data sources';
export const PANEL_LEAD = 'Set each data source to On, Ask first or Off. Your choice applies from your next question.';

/** The panel before a consent is given: the states it would give are shown, and nothing is stored yet. */
export const PANEL_NO_CONSENT = 'You have not answered yet. This site asks before your first question.';

// --- Text 2: the first-consent card (candidate; the owner's final text replaces it before R6 G7) ---

/**
 * The card's text that is the same on every instance, in order: the heading,
 * then the sentences above the recipient list (`beforeList`), then those
 * after it and above the buttons (`afterList`). `sentences` is both, for the
 * tests. Under D4 = A the analytics line and the cookie sentence render
 * below the buttons (`CARD_ANALYTICS`, `CARD_COOKIE`).
 */
const CARD_BEFORE_LIST = [
  'To answer, this site sends your question to a model endpoint, the service that runs the model.',
  'A data source gets only the search terms and filters it needs, not your question.',
  'Nothing is sent before you answer.',
  'Each recipient is listed below with what it says it keeps.',
] as const;
const CARD_AFTER_LIST = [
  'You can set each source to On, Ask first or Off in the panel beside the question box, at any time.',
  'The privacy page has the full statement.',
] as const;

export const CONSENT_CARD = {
  heading: 'Before your first question',
  beforeList: CARD_BEFORE_LIST,
  afterList: CARD_AFTER_LIST,
  sentences: [...CARD_BEFORE_LIST, ...CARD_AFTER_LIST],
  /** Fact 10, beside the two buttons. */
  effect: '"Allow" turns on the sources listed as On and sends your question. "Not now" sends nothing.',
} as const;

/** Fact 4 (Q7, amendment 1 correction 3): where to withdraw, with a database, and without one. */
export const WITHDRAW_WITH_ACCOUNTS = 'To withdraw consent, use the panel beside the question box, or the Sources tab on your dashboard if you are signed in.';
export const WITHDRAW_WITHOUT_ACCOUNTS = 'To withdraw consent, use the panel beside the question box.';

/** Below the buttons (D4 = A), only when analytics is configured. */
export const CARD_ANALYTICS = 'An analytics service counts page visits. The privacy page names it and says how to object.';

/** Below the buttons (D4 = A): where the choice is kept, with a database, and without one. */
export const CARD_COOKIE_WITH_ACCOUNTS = 'We keep your choice for this browser session in a cookie, or on your account if signed in.';
export const CARD_COOKIE_WITHOUT_ACCOUNTS = 'We keep your choice for this browser session in a cookie.';

/**
 * D3 = A: the operator's statement about the model endpoint, only when the
 * operator supplies it (`SITE_OPERATOR_STATES_NO_TRAINING`). Training only,
 * never retention. The card's endpoint row and the privacy page's "The model
 * endpoint" section say the same.
 */
export const ENDPOINT_NO_TRAINING =
  "This site's operator states that the endpoint is set to send questions only to providers that do not train on them. The site cannot read that setting.";

/** After Not now: the form stays disabled for that question (Q2); a new question asks again. */
export const NOT_NOW_LINE = 'Nothing was sent. Change your question to be asked again.';

// --- D2 = A: the notice (candidate; the owner's final text replaces it before R6 G7) ---

/** The notice's lead, dated by the row's `updatedAt`: "Since <date>, where a question can go has changed:". */
export const NOTICE_LEAD = 'Where a question can go has changed since';
export const NOTICE_DISMISS = 'Dismiss';

// --- Text 1: the privacy page's consent sections (candidate; the owner's final text replaces it before R6 G7) ---

export interface PrivacyConsentSection {
  heading: string;
  /** The sentences the same on every instance. */
  sentences: readonly string[];
}

/** "How consent works": with a database, where the answer is kept. */
export const KEPT_WITH_ACCOUNTS = 'If you are signed in, we keep your answer on your account. If not, we keep it in a cookie, named below, until this browser session ends.';
export const KEPT_WITHOUT_ACCOUNTS = 'We keep your answer in a cookie, named below, until this browser session ends.';

/** "When we ask again": D2's scoped sentences, with a database; without one, the cookie's rule alone. */
export const NOTIFY_WITH_ACCOUNTS =
  'A recipient may also be removed, or say it keeps less. If your answer is kept on your account, we tell you and do not ask again. If it is kept in a cookie, we may ask again instead. ' +
  'We tell you in the panel beside the question box and on the Sources tab of your dashboard, until you dismiss it.';
export const NOTIFY_WITHOUT_ACCOUNTS = 'A recipient may also be removed, or say it keeps less. Your answer is kept in a cookie, so we may ask again instead.';

/** "The model endpoint", only when the operator supplies D3's statement. */
export const PRIVACY_ENDPOINT_HEADING = 'The model endpoint';
export const PRIVACY_ENDPOINT_SENTENCES: readonly string[] = [ENDPOINT_NO_TRAINING, "This is the operator's statement only."];

/** The cookie, by name (Q8): what it holds. */
export const COOKIE_HOLDS = 'It holds your choices and the versions of this statement they refer to, never who you are.';

export const PRIVACY_CONSENT_SECTIONS: readonly PrivacyConsentSection[] = [
  {
    heading: 'How consent works',
    sentences: [
      'Before your first question, we ask once whether this site may send questions onward.',
      'Nothing is sent anywhere before you answer.',
      '"Allow" turns on the sources listed as On and sends your question. "Not now" sends nothing.',
      'You can set each data source to On, Ask first or Off beside the question box, at any time.',
      'After you withdraw consent, we send no questions until you agree again. Withdrawing cannot take back a question already sent.',
    ],
  },
  {
    heading: 'When we ask again',
    sentences: [
      'Your answer covers the list of recipients as it was when you answered.',
      'We ask again when a recipient changes in a way your answer may not cover. For example: a recipient is added, a recipient says it keeps more, or a source moves to a different host.',
    ],
  },
  {
    heading: 'What recipients keep',
    sentences: [
      'For each recipient, we state what it says it keeps and for how long, with the page and date we read that on.',
      'If a provider says nothing, we write "not stated."',
      "Nobody, including this site, can check a hosted service's logging from outside.",
      'That is why there is another option.',
      LOCAL_ONLY_OFFER,
    ],
  },
  {
    heading: 'Each data source',
    sentences: [
      "Each source's row gives four dated facts: who publishes it, where it runs, what its host says it keeps, and how current its data is.",
    ],
  },
  {
    heading: 'Changes',
    sentences: [
      "A dated log of every change to these statements is kept with the site's code.",
      'You can use it to check the version your consent refers to.',
    ],
  },
];
