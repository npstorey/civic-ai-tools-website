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
/** The same, where a question can stop to ask (`SOURCE_ROUTING=in-loop`, R8 W2): the owner's card F; the panel renders it only there. */
export const ASK_FIRST_MEANS_WITH_PAUSE = 'Ask first: nothing is sent to this source until you turn it On, here or when the site asks you during a question. If you choose Allow then, it stays On for later questions.';

/** The panel's heading, and its lead sentence. */
export const PANEL_HEADING = 'Data sources';
export const PANEL_LEAD = 'Set each data source to On, Ask first or Off. Your choice applies from your next question.';

/**
 * The panel's lead before a consent is given (R9 P2, #661): the states Allow
 * will write, counted, then what the reader can do. `lead` + the groups +
 * `end`, then `after`; each group is a count in words and its state, a group
 * with none left out, the first group named carrying "source" or "sources",
 * the groups joined by `join` (`panelLeadBeforeConsent`). The counts are the
 * states the panel shows: the defaults, the reader's changes, or the stored
 * states on a re-ask. It replaces "Allow uses these settings. After you allow,
 * you can change each one here." (UX pass row 2(a)).
 */
export const PANEL_BEFORE_CONSENT = {
  lead: 'These are the settings Allow will use: ',
  join: ', ',
  end: '.',
  after: 'Set them now, or change them after you allow.',
} as const;

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'] as const;

/** The lead before a consent, for these counts; empty when there is no source to count. */
export function panelLeadBeforeConsent(counts: { on: number; askFirst: number; off: number }): string {
  const groups = ([[counts.on, 'On'], [counts.askFirst, 'Ask first'], [counts.off, 'Off']] as const).filter(([n]) => n > 0);
  if (groups.length === 0) return '';
  const named = groups.map(([n, state], i) => {
    const count = n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
    return i === 0 ? `${count} ${n === 1 ? 'source' : 'sources'} ${state}` : `${count} ${state}`;
  });
  return `${PANEL_BEFORE_CONSENT.lead}${named.join(PANEL_BEFORE_CONSENT.join)}${PANEL_BEFORE_CONSENT.end} ${PANEL_BEFORE_CONSENT.after}`;
}

/** Each row's drawer (R9 P2, design principle 8): its summary; the reach, logs and currency lines open under it. */
export const PANEL_ROW_MORE = 'More about this source';

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

/**
 * Why a source was not sent this question (R6 W4, §2; W4-D2 and W4-D3, the
 * owner's approval of the eight, word for word). In order of precedence: the
 * source's last load first (the first four, then "On, not used" for any
 * other `loaded` load), then its stated reason. Read by
 * `src/lib/flows/where-it-went.ts`.
 */
export const WHERE_IT_WENT_REASONS = {
  allowedNotUsed: 'Ask first: allowed when asked, but not used for this question.',
  declined: 'Ask first: not allowed for this question.',
  noAnswer: 'Ask first: no answer arrived in time, so it was not used.',
  unavailable: 'Unavailable. This site could not load it for this question.',
  onNotUsed: 'On, not used for this question.',
  off: 'Off.',
  notAsked: 'Ask first: not asked for this question.',
  notSetUp: 'Not set up on this site.',
} as const;

/**
 * What chose a run's sources (R10 P1, #682; the anchor's D7 = A, read
 * literally). Hypotheses, read against `docs/design-principles.md` and the
 * consent research (fix round 1 applied the research check's rewrites). The
 * chooser line opens "Where this question went", and the card "Sources chosen
 * by" sits in "Model + environment"; both read the record's `routing` (on a
 * run, the trace's `analysis.routing`) and nothing else decides the method.
 *   - `inLoop`, then the three groups, each by the sources' reader names: the
 *     sources loaded; requested and not loaded, one line each with its reason
 *     in `CHOOSER_REASONS`' words; not requested. An empty group says `none`.
 *   - `notRecorded`: the record has no `routing` key (every all-sources run,
 *     and every record published before in-loop routing).
 *   - `allSources`: only for a record that states the method `all-sources`.
 *     The research-checked sentence, which replaces D7's draft by the seat's
 *     ruling (fix round 1, item 7 as amended); no record states that method
 *     today.
 *   - `unrecognized`: a method this site has no sentence for, echoed capped
 *     (`ECHO_LIMIT`). It is never read as either of the two above (a gate
 *     question).
 * Read by `src/lib/flows/source-chooser.ts`, which `WhereItWent.tsx` and the
 * three adapters render through.
 */
export const SOURCE_CHOOSER_TEXT = {
  inLoop: 'The model chose which sources to load, from those this question could use.',
  loaded: 'Loaded: ',
  askedNotLoaded: 'Requested, not loaded: ',
  neverAsked: 'Not requested: ',
  none: 'none',
  /** Between two names in a group: a name may itself hold a comma. */
  separator: '; ',
  /** Between a source requested and not loaded, and its reason, on the source's own line. */
  reasonSeparator: ' — ',
  notRecorded: 'What chose these sources is not recorded.',
  allSources: 'Every source this question could use was given to the model from the start.',
  unrecognized: (method: string) => `What chose these sources is recorded as “${method}”, a method this site does not recognize.`,
} as const;

/** The longest recorded method value the chooser line and the card echo; a longer one is cut, with "…". */
export const ECHO_LIMIT = 40;

/**
 * Why a source the model requested was not loaded, by the load's outcome, in
 * the chooser line only (R10 P1 fix round 1). None of them claims a question
 * put to the reader: `declined` is also the outcome when no pause could be held
 * (`routing-mode.ts:301`), and `no-answer` when the reader could not be asked
 * (`decision.ts`, `notHeld`). `WHERE_IT_WENT_REASONS` above is owner-approved
 * and unchanged.
 */
export const CHOOSER_REASONS = {
  declined: 'Ask first, so it was not used for this question.',
  noAnswer: 'Ask first: not used, because this site could not ask, or no answer arrived in time.',
  unavailable: 'Unavailable. This site could not load it for this question.',
} as const;

/** The card in "Model + environment" (R10 P1, #682): the same fact as the chooser line. Hypotheses. */
export const SOURCE_CHOOSER_CARD = {
  label: 'Sources chosen by',
  /**
   * In-loop: the router named by the record's own router component id, then
   * `routing.version`; with no such component, "router version <version>";
   * with no version, the model alone. No name is supplied that the record
   * does not state.
   */
  inLoop: (router: string | null, version: string | null) =>
    version === null
      ? 'the model'
      : router !== null
        ? `the model, from a source list given by ${router} ${version}`
        : `the model, from a source list given by router version ${version}`,
  notRecorded: 'not recorded',
  allSources: 'no choice made: every source this question could use was given to the model from the start',
  unrecognized: (method: string) => `recorded as “${method}”`,
  /** The small print: the hash over the run's sources and instructions, its first twelve characters, as "Skill hash" is shown. */
  definitionLabel: 'Sources and instructions hash',
} as const;

/** The run's portal, renamed from "Data portal" (R10 P1, #682): shown only when the run holds one. Hypothesis. */
export const RUN_PORTAL_LABEL = 'Socrata portal';

/**
 * A load step's label (R10 P1, G0 D1 = A). Open, the load is under way and the
 * choice already made; closed, the model chose the source. The names are the
 * sources' reader names (`readerSourceName`, as every other surface names
 * them), found by each load's own alias in the manifest (`loadAliasReaderName`,
 * `src/lib/flows/source-chooser.ts`); a load with no alias, or an alias no
 * source has, is stated without a name, and nothing is read from the message
 * text. Hypotheses.
 */
export const LOAD_STEP_LABEL = {
  open: (names: readonly string[], count: number) =>
    names.length === 0
      ? (count > 1 ? 'Loading sources the model chose' : 'Loading a source the model chose')
      : `Loading the ${names.length > 1 ? 'sources' : 'source'} the model chose: ${nameList(names)}`,
  closed: (names: readonly string[], count: number) =>
    names.length === 0
      ? (count > 1 ? 'The model chose sources' : 'The model chose a source')
      : `The model chose ${names.length > 1 ? 'sources' : 'a source'}: ${nameList(names)}`,
} as const;

/** "A", "A and B", "A, B and C". */
function nameList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Section B's words about a record's system prompt (R10 P1b, #694). A record
 * carries the final request's prompt hash and, since P1b, a BlobRef to its
 * text; the section shows the text only when its bytes hash to the
 * reference. Fix round 1 applies the research check
 * (`p1b-research-check.md`, S1 to S6, the button and the intro).
 */
export const SYSTEM_PROMPT_TEXT = {
  /** S1: a record that carries no text, but states the hash. */
  notCarried: 'This record does not include the text of the system prompt (the instructions the model was given before the question).',
  /** S1: a record that carries neither the text nor its hash. */
  notCarriedNorHash: 'This record does not include the text of the system prompt (the instructions the model was given before the question), or a hash of it.',
  /** S2: before the full hash, rendered "System prompt hash: <hash>", in every state of B that has one. */
  hashLabel: 'System prompt hash',
  /** S2: once, after the first hash B shows. */
  hashExplained: 'A hash is a fingerprint of the exact text: anyone who has the text can check that it matches. The hash does not reveal the text.',
  /** S3: before the composition's components, each "<id> <version> · instructions hash <hash>". */
  componentsIntro: 'The record lists what the prompt was built from, with versions. Where a data source added its own instructions, a hash of them follows.',
  /** S3: before a component's instructions hash; omitted where it has none. */
  instructionsHashLabel: 'instructions hash',
  /** S4: the text found does not hash to the reference. */
  mismatch: 'The text found does not match the hash this record states, so it is not shown.',
  /** S5: the text could not be loaded. True of `SkillSection`, which fetches only from its first, idle state. */
  unavailable: 'The text could not be loaded, so it is not shown. Reloading the page tries again.',
  /** S6: more than one distinct prompt, and the section's hash is the last; `count` includes the last. */
  manyPrompts: (count: number) =>
    `The model was given ${count} system prompts as it loaded data sources. This section describes the last one.`,
  /** S6, where the view shows no text of the last prompt. */
  textNotShown: 'Its text is not shown on this page.',
  /** S6: before the earlier prompts' hashes. */
  earlierByHash: 'The earlier ones, by hash:',
  /** The button, for inline and blob text alike. */
  showText: (bytes: number) => `Show full system prompt (${bytes.toLocaleString()} bytes)`,
  hideText: 'Hide system prompt',
  /** The intro beside the button, blob text. */
  introBlob: 'The text of the system prompt the model was given, kept outside the signed record. It is shown only if it matches the hash this record states.',
  /** The intro beside the button, inline text. */
  introInline: 'The text of the system prompt the model was given, as the signed record includes it.',
} as const;
