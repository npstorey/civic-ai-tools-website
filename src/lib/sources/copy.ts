/**
 * The consent texts (R6 W3, #632): the privacy page's consent sections, the
 * first-consent card, and the local-only offer both of them make.
 *
 * The texts are the owner's, ruled at R6 G7 on 2026-10-20 (#632 comment
 * 6297423813, rulings T1-T14 and S2). They began as the research's §3 texts
 * ("Consent and Privacy Wording for an Open-Data AI Question Site: Research,
 * Critique and Paste-Ready Rewrites", sha256 41bec744…5042) with the
 * contract's amendment 1 (#632 comment 6281125002) applied: D1's withdrawal
 * sentence, D2's scoped notice sentence, D3's endpoint statement, D4's order,
 * and the corrections to fact 4 (where to withdraw) and fact 5 (the re-ask
 * list is not complete).
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

// --- Text 3: the local-only offer ---

/** The offer itself, with or without a guide. */
export const LOCAL_ONLY_OFFER = 'You can also run this whole system on your own computer, with your own model and data sources.';

/** After the offer, when `SITE_DEPLOYMENT_GUIDE_URL` names the guide: the sentence, its link text. */
export const GUIDE_SENTENCE = 'The deployment guide explains how.';
export const GUIDE_LINK_TEXT = 'deployment guide';

/** After the offer, when no guide is named (D10 = A). */
export const NO_GUIDE_SENTENCE = 'This site does not name a deployment guide.';

// --- The Sources panel ---

/** What Ask first means in R6, in literal words (Q1): the pause is R8's. */
export const ASK_FIRST_MEANS = 'Ask first: nothing is sent to this source until you turn it On.';

/** The panel's heading, and its lead sentence. */
export const PANEL_HEADING = 'Data sources';
export const PANEL_LEAD = 'Set each data source to On, Ask first or Off. Your choice applies from your next question.';

/** The panel before a consent is given: the states it would give are shown, and nothing is stored yet. */
export const PANEL_NO_CONSENT = 'Allow uses these settings. After you allow, you can change each one here.';

/** The panel's link to the privacy page (T12). */
export const PANEL_PRIVACY_LINK = 'Where a question can go, in full';

/**
 * After a successful state change, under that source's control, as a status
 * line (UX pass row 5): the source's reader name + `middle` + the state's label
 * + `end`, e.g. "NYS Open Legislation is now Off. This applies from your next
 * question." The row's "Set <State> since <date>." follows on the same line.
 */
export const PANEL_STATE_CHANGED = { middle: ' is now ', end: '. This applies from your next question.' } as const;

/**
 * The just-in-time line under the question box while a consent is in force
 * (UX pass row 11), in its pieces: `lead` (`leadNotebook` when the form is in
 * notebook mode) + the On sources (or `noSource`) +
 * `.`; then, when any source is not On, `notTo` + each group of the others
 * with `whichAre` / `whichIs` + its state, the groups joined by `orGroup`;
 * then the link that opens the Sources panel, `change`. The names are read
 * from the statement (`readerSourceName`), never typed.
 */
export const JUST_IN_TIME_LINE = {
  lead: 'This question goes to the model service and to ',
  /** In notebook mode: the notebook sent to run carries the question's text, so the runner is named too. */
  leadNotebook: 'This question goes to the model service, the notebook runner and to ',
  noSource: 'no data source',
  notTo: 'Not to ',
  whichAre: ', which are set to ',
  whichIs: ', which is set to ',
  orGroup: ', or ',
  change: 'Change sources',
} as const;

// --- The dashboard's Sources tab ---

/** The tab when no consent is in force (T9). */
export const SOURCES_TAB_NO_CONSENT = 'This site asks before your next question.';

// --- What a holder keeps, when only this site's operator can say (T11) ---

/** The one phrase: the card's endpoint row and `keepsText`'s default both read it. */
export const KEPT_FOR_OPERATOR = "what it keeps is for this site's operator to state";

// --- Text 2: the first-consent card ---

/**
 * The card's text that is the same on every instance, in order: the heading,
 * then the sentences above the recipient list (`beforeList`), then those
 * after it and above the buttons (`afterList`). `sentences` is both, for the
 * tests. The sentence after the list that names where states are set and
 * consent is withdrawn depends on a database (`CARD_AFTER_ALLOW_*`, T3).
 * Under D4 = A the analytics line and the cookie sentence render below the
 * buttons (`CARD_ANALYTICS`, `CARD_COOKIE`).
 */
const CARD_BEFORE_LIST = [
  'To answer, this site sends your question to a model endpoint, the service that runs the model.',
  'A data source gets the searches the model writes, which can include words from your question.',
  'Your question is not sent beyond this site before you answer.',
  'Each recipient is listed below with what it says it keeps.',
] as const;
const CARD_AFTER_LIST = ['The privacy page has the full statement.'] as const;

/** Fact 10's effect: the card beside its buttons, and the privacy page's "How consent works" (T7). */
const ALLOW_EFFECT = '"Allow" turns on the sources the panel shows as On and sends your question. "Not now" sends nothing.';

export const CONSENT_CARD = {
  heading: 'Before your first question',
  beforeList: CARD_BEFORE_LIST,
  afterList: CARD_AFTER_LIST,
  sentences: [...CARD_BEFORE_LIST, ...CARD_AFTER_LIST],
  /** Fact 10, beside the two buttons. */
  effect: ALLOW_EFFECT,
} as const;

/** The card's sentence after the list (T3): where states are set and consent withdrawn, with a database, and without one. */
export const CARD_AFTER_ALLOW_WITH_ACCOUNTS =
  "After you allow, you can set each source to On, Ask first or Off in the panel beside the question box, and withdraw consent there, or on your dashboard's Sources tab if you are signed in.";
export const CARD_AFTER_ALLOW_WITHOUT_ACCOUNTS =
  'After you allow, you can set each source to On, Ask first or Off in the panel beside the question box, and withdraw consent there.';

/** Fact 4 (Q7, amendment 1 correction 3): the privacy page's statement of where to withdraw, with a database, and without one. */
export const WITHDRAW_WITH_ACCOUNTS = 'To withdraw consent, use the panel beside the question box, or the Sources tab on your dashboard if you are signed in.';
export const WITHDRAW_WITHOUT_ACCOUNTS = 'To withdraw consent, use the panel beside the question box.';

/** Below the buttons (D4 = A), only when analytics is configured. */
export const CARD_ANALYTICS = 'An analytics service counts page visits. The privacy page names it and says how to object.';

/** Below the buttons (D4 = A): where the choice is kept, with a database, and without one. */
export const CARD_COOKIE_WITH_ACCOUNTS = 'We keep your answer for this browser session in a cookie, or on your account if signed in.';
export const CARD_COOKIE_WITHOUT_ACCOUNTS = 'We keep your answer for this browser session in a cookie.';

/**
 * D3 = A: the operator's statement about the model endpoint, only when the
 * operator supplies it (`SITE_OPERATOR_STATES_NO_TRAINING`). Training only,
 * never retention. The card's endpoint row and the privacy page's "The model
 * endpoint" section say the same.
 */
export const ENDPOINT_NO_TRAINING =
  "This site's operator states that the endpoint is set to send questions only to providers that do not train on them. The site cannot read that setting.";

/** After Not now: the form stays disabled for that question (Q2); a new question asks again. */
export const NOT_NOW_LINE = 'Nothing was sent. Edit this question or write a new one, and you will be asked again before it is sent.';

// --- D2 = A: the notice ---

/** The notice's lead, dated by the row's `updatedAt`: "Since <date>, where a question can go has changed:". */
export const NOTICE_LEAD = 'Where a question can go has changed since';
export const NOTICE_DISMISS = 'Dismiss';

// --- Text 1: the privacy page's consent sections ---

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
      'Your question is not sent beyond this site before you answer.',
      ALLOW_EFFECT,
      'After you allow, you can set each data source to On, Ask first or Off beside the question box.',
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
      'For each recipient, we state what it says it keeps, and for how long when it gives a time.',
      'Where it says so on a page, we give that page and the date we read it.',
      'If a provider says nothing, we write "not stated."',
      "Nobody, including this site, can check a hosted service's logging from outside.",
      'That is why there is another option.',
      LOCAL_ONLY_OFFER,
    ],
  },
  {
    heading: 'Each data source',
    sentences: [
      "Each source's row gives who publishes its connector, where it runs, who holds its logs and what they say they keep, and how current its data is.",
      "Where we read the holder's own page, the logs line gives that page and the date we read it.",
    ],
  },
  {
    heading: 'Changes',
    sentences: [
      "A dated log of every change to where a question can go is kept with the site's code.",
      'You can use it to check the version your consent refers to.',
    ],
  },
];

// --- The Sources rows: what each source is, and whose connector reaches it (R6 PL) ---

/** What a source's row says beyond the flows statement (D1 = A, D2 = A). */
export interface SourceDescription {
  /**
   * What the source is, stored as it reads inside a sentence: a common word
   * lower-case ("an …", "public …", "the …"), a proper noun with its capital.
   * The panel upper-cases the first letter; the privacy page prints it as
   * stored.
   */
  what: string;
  /** The publisher of the source's connector, as the row prints it. */
  publisher: string;
  /** The connector's repository, which the publisher's name links to. */
  link: string;
}

/**
 * One entry per manifest source, keyed by `sourceId`, pinned to the manifest
 * both ways (`./source-name.test.ts`: the publisher, after a leading "the ",
 * is the manifest's; the link is the address in the manifest entry's `id`,
 * Boston's excepted, whose `id` carries its endpoint). Read when a row
 * renders, never copied.
 */
export const SOURCE_DESCRIPTIONS: Readonly<Record<string, SourceDescription>> = {
  socrata: {
    what: 'an open-data portal platform from Tyler Technologies. Many cities and states publish their data on its portals.',
    publisher: 'npstorey',
    link: 'https://github.com/npstorey/socrata-mcp-server',
  },
  'data-commons': {
    what: 'public statistics from government agencies and international organizations, gathered by Google.',
    publisher: 'Google',
    link: 'https://github.com/datacommonsorg/agent-toolkit',
  },
  'boston-opencontext': {
    what: "the City of Boston's open data, from data.boston.gov.",
    publisher: 'the City of Boston',
    link: 'https://github.com/CityOfBoston/OpenContext',
  },
  'nyc-charter': {
    what: "the text of New York City's Charter, Administrative Code and Rules.",
    publisher: 'BetaNYC',
    link: 'https://github.com/BetaNYC/nyc-charter-laws-rules',
  },
  'nyc-checkbook': {
    what: "New York City's spending, contracts, budget figures and payroll, as the City Comptroller publishes them on Checkbook NYC.",
    publisher: 'BetaNYC',
    link: 'https://github.com/BetaNYC/nyc-checkbook-mcp',
  },
  'nyc-record': {
    what: "notices in The City Record, New York City's official journal: procurement, public hearings and other agency notices.",
    publisher: 'BetaNYC',
    link: 'https://github.com/BetaNYC/nyc-record-mcp',
  },
  'nys-legislation': {
    what: "New York State's bills and the votes on them, and the State's laws, from the State Senate's Open Legislation service.",
    publisher: 'BetaNYC',
    link: 'https://github.com/BetaNYC/nys-openlegislation-mcp',
  },
};

/**
 * The reach sentence (D1 = A), in its pieces: `before` + the publisher +
 * `after` + where it runs + `end`. With no publisher stated, `unstated` + where
 * it runs + `end`.
 */
export const REACH_SENTENCE = {
  before: 'This site reaches it through an MCP server, a connector that ',
  after: ' publishes, running at ',
  unstated: 'This site reaches it through an MCP server, a connector whose publisher is not stated, running at ',
  end: '.',
} as const;
