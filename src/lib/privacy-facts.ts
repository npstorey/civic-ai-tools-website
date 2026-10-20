/**
 * The privacy page's statements, computed from this instance's configuration
 * and from named code constants (#516 P7).
 *
 * WHAT THIS MODULE IS. Every sentence `/privacy` shows is built here, as a
 * `Statement` carrying its `traces`: the configuration variables it reads
 * (`env:NAME`, each one a row of `ENV_SPEC` in scripts/preflight-env.mjs) and
 * the code constants it states (`const:<module>#<export>`). The page renders
 * nothing else but headings. `src/app/(app)/privacy/privacy-page.test.ts`
 * renders the page under four configurations and fails on any text outside a
 * traced statement, on a trace naming a variable `ENV_SPEC` does not declare,
 * and on a trace naming an export its module does not have.
 *
 * WHAT IT DOES NOT SAY. Anything the app cannot read: how long the operator or
 * any service named here keeps what it receives, the operator's account
 * settings with the model service (#516 G0-7), which plan the hosting
 * account is on, and any legal position. `OPERATOR_STATES` says these are the
 * operator's to state, and the page carries no placeholder for them. The
 * operator's account settings with the model service are stated only as the
 * operator's own statement, when the operator supplies one
 * (`SITE_OPERATOR_STATES_NO_TRAINING`, #632 D3 = A), and then in those words.
 *
 * CONSENT (#632 W3; design §4.7 items 3, 7, 10, 11 and 12). The consent
 * sections are the owner's text (`src/lib/sources/copy.ts`, a candidate until
 * R6 G7), the consent cookie by name, one row per configured source derived
 * from the flows statement `/api/flows` serves, and the dated change log
 * (`docs/flows-changelog.md`) linked in the instance's repository.
 *
 * THE RECIPIENTS ARE GUARDED IN BOTH DIRECTIONS. `RECIPIENT_STATEMENTS` is
 * keyed by the first cell of each row of the deploy guide's outbound-kinds
 * table (docs/deploy.md, "What the proxy carries, and what it cannot"), and
 * `ANALYTICS_RECIPIENTS` by each value of `ANALYTICS_SERVICES`, whose traffic
 * leaves from the reader's browser rather than the server and so has no row
 * in that table. `src/lib/privacy-recipients.test.ts` fails when a row or a
 * service has no statement here, and when a statement here has no row or
 * service: a new kind of outbound traffic cannot ship without a sentence on
 * this page, and a sentence cannot outlive the traffic it describes.
 *
 * A key with no configured traffic returns no statements: the page lists the
 * recipients THIS instance sends to, not every one the code could.
 *
 * HOSTS. A recipient that receives what a reader sends, or is a public
 * service the reader could look up, is named with its configured host. The
 * operator's own storage (the database, the object store, the counter store)
 * is named by kind only: its address names infrastructure, and the database
 * address carries credentials.
 */
import { getTableColumns } from 'drizzle-orm';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import type { AnalyticsConfig, AnalyticsService } from './analytics.tsx';
import {
  buildFlowsStatementFor,
  deploymentGuideUrl,
  operatorStatesNoTraining,
  type FlowsStatement,
  type PlatformHeldKind,
} from './flows/statement.ts';
import {
  HOSTED_SNAPSHOT_EXPIRATION_DAYS,
  SANDBOX_SNAPSHOTS_READ_DATE,
  SANDBOX_SNAPSHOTS_SENTENCE,
  VERCEL_SANDBOX_SNAPSHOTS,
} from './flows/sandbox-snapshots.ts';
import { CONSENT_COOKIE_NAME } from './sources/consent.ts';
import {
  COOKIE_HOLDS,
  GUIDE_LINK_TEXT,
  GUIDE_SENTENCE,
  KEPT_WITH_ACCOUNTS,
  KEPT_WITHOUT_ACCOUNTS,
  NO_GUIDE_SENTENCE,
  NOTIFY_WITH_ACCOUNTS,
  NOTIFY_WITHOUT_ACCOUNTS,
  PRIVACY_CONSENT_SECTIONS,
  PRIVACY_ENDPOINT_HEADING,
  PRIVACY_ENDPOINT_SENTENCES,
  WITHDRAW_WITH_ACCOUNTS,
  WITHDRAW_WITHOUT_ACCOUNTS,
} from './sources/copy.ts';
import { keepsText, readerSourceName, sourceWhere } from './sources/source-name.ts';
import { users } from './db/schema.ts';
import { buildProviders, normalizeIssuer, OIDC_PROVIDER_ID } from './auth-providers.ts';
import { toSignInOptions } from './auth-provider-options.ts';
import { isSignInGateEnabled } from './auth-allowlist.ts';
import { RATE_LIMIT_SECRET_VARIABLE, resolveLimit, selectLimit } from './rate-limit.ts';
import { getBrandAttribution, getBrandRepoUrl } from './brand-config.ts';
import { getDirectorySource, getRoadmapSource, isSealOnly } from './site-config.ts';
import { resolveExecutorDriverName, type ExecutorDriverSetting } from './sandbox/execute.ts';
import { getModelApiBaseUrl } from './model-client.ts';
import { timestampAuthorityUrl, transparencyLogUrl } from './evidence/signing.ts';
import { isSigningConfigured } from './evidence/unsigned-tier.ts';
import { ORPHAN_GRACE_MS } from './evidence/blob-gc.ts';
import { buildMcpRegistry, configuredAddressForSource, readMcpEnvFromProcess } from './mcp/registry.ts';
import { COMPARISON_STORAGE_KEY, LAYOUT_STORAGE_KEY, MODE_STORAGE_KEY } from './query-presentation.ts';
import { isOutboundProxyConfigured } from './outbound-proxy.ts';

// --- The statement shape ------------------------------------------------------

/** `env:NAME` (an `ENV_SPEC` variable) or `const:<module>#<export>`. */
export type Trace = `env:${string}` | `const:${string}#${string}`;

/** A run of text, a link, or a name shown as code (a cookie, a host). */
export type Segment = string | { link: string; text: string } | { code: string };

export interface Statement {
  /** Stable, for the page's markup and the tests. */
  id: string;
  /** The sentence, or for a list the lead sentence before it. */
  parts: Segment[];
  traces: Trace[];
  /** A list under the lead, one entry per item; the page renders it as a bulleted list. */
  items?: Segment[][];
  /** Text after the list. */
  after?: Segment[];
}

export interface PrivacySection {
  id: string;
  heading: string;
  statements: Statement[];
}

const MODULE = 'src/lib/privacy-facts.ts';
const c = (name: string): Trace => `const:${MODULE}#${name}`;

function statement(id: string, parts: Segment[], traces: Trace[]): Statement {
  return { id, parts, traces };
}

/** A lead sentence, a bulleted list, and optionally text after it: one statement, one set of traces. */
function listStatement(id: string, lead: Segment[], items: Segment[][], traces: Trace[], after?: Segment[]): Statement {
  return { id, parts: lead, traces, items, ...(after ? { after } : {}) };
}

/** The host of a URL-shaped value; the trimmed value itself when it is not a URL. */
export function hostOf(raw: string): string {
  const value = raw.trim();
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/** A set value, or null for unset, empty or whitespace alone. */
function present(raw: string | undefined): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

// --- Fixed text, each a named constant ---------------------------------------

/** How every statement below was produced. */
export const PAGE_BASIS =
  "Every statement on this page is read from this site's configuration or its code when the page is served, " +
  'or from a named page, with the date it was read. ' +
  'Where the site cannot know something, this page says so instead of guessing.';

/** Why questions are limited per day (design §4.7 item 2). */
export const LIMIT_REASON =
  'Each question is answered by an AI model working with live data sources, and every answer costs money. ' +
  'That is why the number of questions per day is limited.';

/** Design §4.7 item 11. */
export const NOT_VERIFIABLE_FROM_OUTSIDE =
  "Nobody, including this site, can check a hosted service's logging from outside.";

/** Item 11's second half, shown with the repository link (item 1). */
export const RUN_IT_YOURSELF = 'That is why the code is open: you can run it yourself and see exactly what it does.';

/** What the app's own logs hold: the N13 property, held by the errors-out-of-logs guards. */
export const LOGS_STATEMENT =
  "The site's own logs record which steps ran, how long they took, how large their results were, and the kind of any error. " +
  'They do not record your question, the queries sent to data sources, or what the sources returned.';

/** The design's ops side: what the app cannot read, stated as the operator's to state (the lead of a list). */
export const OPERATOR_STATES = "This site cannot read the following, so they are the operator's to state:";

/** The items under `OPERATOR_STATES`. */
export const OPERATOR_STATES_ITEMS: readonly string[] = [
  'how long the operator and each service named on this page keep what they receive',
  "the operator's account settings with the AI model service, including whether that service may keep or learn from what it receives",
  // R6 W3: what the hosting and sandbox platforms hold is stated above, each
  // in its holder's own words with its page (`PLATFORM_HELD_RECIPIENTS`); the
  // one fact about it the site still cannot read is the plan.
  "which plan this site's hosting account is on, which sets how long its logs are kept",
  'any legal position',
];

/**
 * What a record keeps under hash-only visibility. The publish dialog states
 * the same words beside its hash-only choice (`PublishEvidenceDialog.tsx`);
 * `src/lib/privacy-hash-only-words.test.ts` renders the real dialog and fails
 * when the two differ. The record's question forms are replaced by
 * `WITHHELD_QUESTION_TEXT` (`src/lib/notebook.ts`) in the publish handler.
 */
export const HASH_ONLY_RECORD_WORDS =
  'The record keeps a fingerprint of your question instead of its text. Anyone who knows or guesses the exact ' +
  'wording can confirm it matches. The answer, summary and data queries may still contain its words.';

/** The publish dialog's label for the hash-only choice (pinned by the same test). */
export const HASH_ONLY_CHOICE_LABEL = 'Hash only';

/** A record's title, in the words the publish dialog states beside the title field (pinned by the same test). */
export const RECORD_TITLE_IS_PUBLIC = 'The title is public and becomes the record’s address.';

/**
 * What a published record shows about its creator. The record page renders
 * the account's display name, linked to its profile address when there is
 * one (`src/app/(app)/evidence/[slug]/page.tsx`); the public list carries the
 * name (`buildRecordListItems`). The record-page creator test renders the page
 * and the page test drives the list builder; each fails when this differs.
 */
export const CREATOR_ATTRIBUTION =
  'A record you publish publicly shows your name, as your sign-in provider gives it, and a link to your profile with that provider, ' +
  'to anyone who opens it. The public list of records shows your name.';

/** The lead of the list of what else the site keeps for a signed-in account. */
export const ALSO_KEPT = 'The site also keeps:';

/**
 * Each item is a column the page test pins: `deviceCodes.clientName`;
 * `apiTokens.name`, `.scope` and `.lastUsedAt`; and the text an attestation
 * carries (`attestationNodes.payload`, a withdrawal or reinstatement reason;
 * an expert review's body, in its stored package).
 */
export const ALSO_KEPT_ITEMS: readonly string[] = [
  'the name a program gives itself when you approve it to sign in for you from another device, such as a command-line tool',
  'the name you give each API token (a key a program uses to publish for you), with what it is allowed to do and when it was last used',
  'the text you write when you withdraw or reinstate a record, or add a review to one',
  // R6 W3: the consent row (`source_consents`, `drizzle/0017_source_consents.sql`).
  'your consent to send questions onward: each source\'s state (On, Ask first or Off), the flows statement it refers to, and the dates you gave it and last changed it',
];

/**
 * Where an attestation's text goes. A withdrawal or reinstatement reason is in
 * the signed node `buildAttestationNode` builds, which the commitment route
 * carries in the record's public proof; a review's body is in the signed
 * package `buildExpertAttestationPayload` builds, served by the record's
 * attestation package route. The page test drives both builders.
 */
export const ATTESTATION_TEXT_IS_SERVED =
  'That text becomes part of a signed attestation (a signed statement about the record) that this site serves publicly: ' +
  "a withdrawal or reinstatement reason with the record's public proof, which anyone can look up, and a review with the record.";

/**
 * What stays public about a sealed record, by design (ADR-0010 §4 to §6): the
 * commitment route answers an unauthenticated request, by the record's
 * address or its fingerprint, with the fingerprint (`buildCommitmentView`
 * passes `packageHash` through on the redacted view). The sealed-record test
 * drives the route and fails when the fingerprint is absent.
 */
export const SEALED_FINGERPRINT_LOOKUP = 'though anyone who has its address can still look up its fingerprint';

const SEALED_FINGERPRINT_TRACES: Trace[] = [
  c('SEALED_FINGERPRINT_LOOKUP'),
  'const:src/app/api/evidence/[slug]/commitment/route.ts#GET',
  'const:src/lib/evidence/commitment.ts#buildCommitmentView',
];

/** A transparency log's defining property. */
export const TRANSPARENCY_LOG_PERMANENCE =
  'A transparency log is public and append-only: anyone can look an entry up, and entries are not removed.';

// --- Constants the code holds elsewhere, stated here and pinned by tests ------

/**
 * The daily limits when nothing overrides them. `rate-limit.ts` holds them as
 * unexported literals (`resolveLimit(..., 10)`, `resolveLimit(..., 25)`);
 * `privacy-page.test.ts` drives the real limiter and fails when these differ.
 */
export const DEFAULT_ANONYMOUS_LIMIT = 10;
export const DEFAULT_AUTHENTICATED_LIMIT = 25;

/**
 * The drivers the app selects when nothing is set (`src/lib/db/index.ts`,
 * `src/lib/storage/index.ts`: `env.X || '<default>'`). Pinned to
 * `DRIVER_SEAMS` in scripts/preflight-env.mjs by the page test.
 */
export const DEFAULT_DB_DRIVER = 'neon-http';
export const DEFAULT_BLOB_DRIVER = 'vercel-blob';

/**
 * The sign-in library's cookies. `src` sets no `cookies` option, so they are
 * next-auth's defaults (4.24.15, `core/lib/cookie.js`, `defaultCookies`);
 * the page test reads that function and fails when these differ. Over https
 * each name gains the `__Secure-` prefix, and the request-check cookie
 * `__Host-` instead.
 */
export const SIGN_IN_COOKIES: readonly { name: string; purpose: string }[] = [
  { name: 'next-auth.session-token', purpose: 'keeps you signed in' },
  { name: 'next-auth.callback-url', purpose: 'remembers where to return after signing in' },
  { name: 'next-auth.csrf-token', purpose: 'checks that a sign-in request came from this site' },
  { name: 'next-auth.pkce.code_verifier', purpose: 'checks that a sign-in reply is the one this site asked for' },
  { name: 'next-auth.state', purpose: 'checks that a sign-in reply is the one this site asked for' },
  { name: 'next-auth.nonce', purpose: 'checks that a sign-in reply is the one this site asked for' },
];

/** The one cookie whose secure name takes `__Host-` rather than `__Secure-` (pinned by the page test). */
export const HOST_PREFIXED_COOKIE = 'next-auth.csrf-token';

/**
 * Each column of the account table, in reader language. Keyed by the
 * Drizzle column key; the page test fails when a column of `users` has no
 * entry here, or an entry here names no column.
 */
export const ACCOUNT_COLUMNS: Readonly<Record<string, string>> = {
  id: 'an internal account number',
  githubId: 'the account key your sign-in provider gives this site',
  displayName: 'the name that provider gives',
  githubProfileUrl: 'a link to your profile with that provider (for a single sign-on provider, its address)',
  createdAt: 'when the account was first created',
};

/**
 * The words that state each column of the usage table (src/lib/db/schema.ts;
 * R6 W5, #632 ruling B = A), keyed by the schema's column keys. This module
 * does not name the table: it is written by one module and read by none
 * (`src/lib/usage/one-writer.test.ts`).
 * `src/lib/usage/usage-privacy-statement.test.ts` requires these keys to equal
 * the table's columns in both directions and every phrase to render, so a
 * column added with no words fails there. The `environment` column's phrase
 * renders only on the hosting platform: off it every row reads `local`.
 */
export const USAGE_COUNT_COLUMNS: Readonly<Record<string, string>> = {
  count: 'a number of questions',
  day: 'on one day',
  surface: 'which part of the site took the question',
  model: 'which AI model answered',
  signedIn: 'whether you were signed in',
  sourcesOffered: 'which data sources were offered',
  sourcesUsed: 'which were used',
  outcome: 'whether an answer came back',
  environment: 'marked as test counts',
};

/** A vendor page this page quotes from: its address, the date it was read (UTC), and the sentence read there. */
export interface VendorRead {
  url: string;
  read: string;
  sentence: string;
}

export interface AnalyticsRecipient {
  name: string;
  /** The host `AnalyticsTags` loads the tag from. */
  host: string;
  /** Who the record title reaches, in the reader's words. */
  reaches: string;
  /** What the service says about itself, as page text: the vendor's facts, with their page and read date. */
  says: Segment[];
  /** What the service says it keeps of a page address, search terms included, with its page and read date. */
  addressKept: Segment[];
  /** How a reader can object. */
  objection: Segment[];
  /** What is not sent when the browser does not load the script. */
  notSentTo: string;
  /** The pages the two runs above rest on, each with the sentence read there. */
  reads: readonly VendorRead[];
}

/** The date the vendor pages below were read, UTC. */
export const VENDOR_READ_DATE = '2026-10-18';

/**
 * Analytics: what each service's tag loads, and from where, and what the
 * service says about itself. The host is the one `AnalyticsTags` in
 * `src/lib/analytics.tsx` writes into the tag's `src`; the page test renders
 * the real tags and fails when they differ. No other module in this
 * repository loads anything from these hosts, so a browser that does not load
 * the script sends nothing to them. The vendor's own statements are labelled
 * as the vendor's, with the page and the date read.
 */
export const ANALYTICS_RECIPIENTS: Readonly<Record<AnalyticsService, AnalyticsRecipient>> = {
  'google-analytics': {
    name: 'Google Analytics',
    host: 'www.googletagmanager.com',
    reaches: 'Google',
    says: [
      'Google says it receives the page address and your network address. ' +
        'It also says it sets a cookie in your browser to tell visitors apart (its ',
      { link: 'https://policies.google.com/technologies/partner-sites', text: 'partner-sites' },
      ' and ',
      { link: 'https://support.google.com/analytics/answer/11397207', text: 'cookie' },
      ` pages, read ${VENDOR_READ_DATE}).`,
    ],
    addressKept: [
      "Google says the page address its tag sends by default is the page's full address, leaving out only any part after ",
      { code: '#' },
      ', so it includes those words (its ',
      { link: 'https://developers.google.com/analytics/devguides/collection/ga4/views?client_type=gtag', text: 'page views' },
      ` guide, read ${VENDOR_READ_DATE}).`,
    ],
    objection: [
      "To object, install Google's opt-out add-on from ",
      { link: 'https://tools.google.com/dlpage/gaoptout', text: 'tools.google.com/dlpage/gaoptout' },
      ', or use an ad blocker or other content blocker that blocks www.googletagmanager.com.',
    ],
    notSentTo: 'Google Analytics',
    reads: [
      {
        url: 'https://policies.google.com/technologies/partner-sites',
        read: VENDOR_READ_DATE,
        sentence: 'This includes the URL of the page you’re visiting and your IP address.',
      },
      {
        url: 'https://policies.google.com/technologies/partner-sites',
        read: VENDOR_READ_DATE,
        sentence: 'We may also set cookies on your browser or read cookies that are already there.',
      },
      {
        url: 'https://support.google.com/analytics/answer/11397207',
        read: VENDOR_READ_DATE,
        sentence: 'The GA4 JavaScript tags use first-party cookies to distinguish unique users as well as unique sessions from a single user.',
      },
      {
        url: 'https://policies.google.com/technologies/partner-sites',
        read: VENDOR_READ_DATE,
        sentence: 'If you don’t want Analytics to be used in your browser, you can install the Google Analytics browser add-on.',
      },
      {
        url: 'https://support.google.com/analytics/answer/181881',
        read: VENDOR_READ_DATE,
        sentence:
          'The add-on prevents the Google Analytics JavaScript (gtag.js, analytics.js) that run on websites from sharing information about your visit activity with Google Analytics.',
      },
      {
        // The `page_location` row of the page's table: default `location.href`.
        url: 'https://developers.google.com/analytics/devguides/collection/ga4/views?client_type=gtag',
        read: VENDOR_READ_DATE,
        sentence: 'The URL of the page.',
      },
      {
        url: 'https://developers.google.com/analytics/devguides/collection/ga4/views?client_type=gtag',
        read: VENDOR_READ_DATE,
        sentence: 'The default value excludes the fragment portion of the URL.',
      },
    ],
  },
  plausible: {
    name: 'Plausible',
    host: 'plausible.io',
    reaches: 'Plausible',
    says: [
      'Plausible says it sets no cookies and stores no raw network address (its ',
      { link: 'https://plausible.io/data-policy', text: 'data policy' },
      `, read ${VENDOR_READ_DATE}).`,
    ],
    addressKept: [
      'Plausible says that of a page address it keeps the site name and the path, and discards the query part, which holds those words, ' +
        'except the parts it uses to tell where a visit came from, such as a campaign or a referring site (its ',
      { link: 'https://plausible.io/data-policy', text: 'data policy' },
      ' and ',
      { link: 'https://plausible.io/docs/custom-query-params', text: 'query parameters' },
      ` pages, read ${VENDOR_READ_DATE}).`,
    ],
    objection: [
      'To object, use an ad blocker or other content blocker that blocks plausible.io, or set the browser flag Plausible describes at ',
      { link: 'https://plausible.io/docs/excluding-localstorage', text: 'plausible.io/docs/excluding-localstorage' },
      '.',
    ],
    notSentTo: 'plausible.io',
    reads: [
      { url: 'https://plausible.io/data-policy', read: VENDOR_READ_DATE, sentence: 'We do not use cookies, browser cache or local storage.' },
      { url: 'https://plausible.io/data-policy', read: VENDOR_READ_DATE, sentence: 'Raw IP addresses and User-Agent data are never stored.' },
      {
        url: 'https://plausible.io/docs/excluding-localstorage',
        read: VENDOR_READ_DATE,
        sentence: 'To prevent counting your visits, you can set a special localStorage flag in the browser.',
      },
      { url: 'https://plausible.io/data-policy', read: VENDOR_READ_DATE, sentence: 'For page URLs, we store the hostname and path.' },
      {
        url: 'https://plausible.io/data-policy',
        read: VENDOR_READ_DATE,
        sentence: 'Query parameters are discarded except for supported campaign and referral parameters.',
      },
      {
        url: 'https://plausible.io/docs/custom-query-params',
        read: VENDOR_READ_DATE,
        sentence: 'Other than the source attribution query parameters listed above, Plausible strips all other query parameters for privacy purposes.',
      },
    ],
  },
};

// --- Configuration, read through the app's own resolvers ---------------------

interface Context {
  mcp: ReturnType<typeof readMcpEnvFromProcess>;
  executor: ExecutorDriverSetting | 'unrecognized';
  signing: boolean;
}

function readContext(): Context {
  let executor: Context['executor'];
  try {
    executor = resolveExecutorDriverName();
  } catch {
    executor = 'unrecognized';
  }
  return { mcp: readMcpEnvFromProcess(), executor, signing: isSigningConfigured() };
}

/** The daily limits as the limiter selects them for this instance. */
function dailyLimits(): { anonymous: number; signedIn: number; gated: boolean } {
  const anonymous = resolveLimit(process.env.ANONYMOUS_RATE_LIMIT, DEFAULT_ANONYMOUS_LIMIT);
  const authenticated = resolveLimit(process.env.AUTHENTICATED_RATE_LIMIT, DEFAULT_AUTHENTICATED_LIMIT);
  const appTier = resolveLimit(process.env.APP_TIER_RATE_LIMIT, authenticated);
  const gated = isSignInGateEnabled();
  return {
    anonymous,
    signedIn: selectLimit({ isAuthenticated: true, gated, anonymous, authenticated, appTier }),
    gated,
  };
}

const SIGN_IN_TRACES: Trace[] = [
  'env:GITHUB_CLIENT_ID',
  'env:GITHUB_CLIENT_SECRET',
  'env:OIDC_ISSUER',
  'env:OIDC_CLIENT_ID',
  'env:OIDC_CLIENT_SECRET',
  'env:OIDC_PROVIDER_NAME',
];

const MCP_TRACES: Trace[] = [
  'env:SOCRATA_MCP_URL',
  'env:DATA_COMMONS_MCP_URL',
  'env:BOSTON_OPENCONTEXT_MCP_URL',
  'const:@typedstandards/civic-typed-router#CIVIC_MANIFEST',
];

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const NOTEBOOK_SENT_TRACES: Trace[] = [
  c('NOTEBOOK_CARRIES_QUESTION'),
  'const:src/lib/notebook-author/synthesize.ts#synthesizeNotebook',
  'const:src/lib/notebook-author/prompt.ts#buildCell0Source',
];

function notebookTraces(): Trace[] {
  return ['env:EXECUTOR_DRIVER', 'const:src/lib/sandbox/execute.ts#resolveExecutorDriverName'];
}

/** What a notebook run is, for the executor statements. */
export const NOTEBOOK_PURPOSE =
  'In notebook mode, the AI model writes a notebook (a short program) to answer your question, and the site runs it. ' +
  'The notebook requests its data from the public data portals it names.';

/**
 * What the notebook sent to run carries. It is built when the question is
 * answered (`synthesizeNotebook`, called by `src/app/api/query-notebook/route.ts`),
 * and its first cell states the question (`buildCell0Source`). The visibility a
 * reader chooses is chosen later, at publish, so it does not change this. The
 * page test drives the synthesizer and fails when the question is absent.
 */
export const NOTEBOOK_CARRIES_QUESTION = "The notebook sent to run includes your question's text.";

/**
 * The page addresses that carry what a reader types, in the part after `?`.
 * The page test reads every query parameter the pages read, and fails when one
 * is neither here nor in its list of parameters that carry only a choice from
 * the page's own controls; and when an entry here is read by no page.
 */
export const READER_INPUT_ADDRESSES: readonly { path: string; param: string; what: string }[] = [
  { path: '/directory', param: 'q', what: 'a search on the directory page' },
  { path: '/auth/device', param: 'user_code', what: 'the code you enter to approve a sign-in from another device' },
];

/**
 * What the egress proxy does not carry, keyed by the row of docs/deploy.md's
 * outbound-kinds table it belongs to. The recipients guard fails when a row's
 * last column ("Honours the proxy variables") does not begin with "yes" and
 * the row has no entry here, and when an entry names no row. Two "yes" rows
 * have an entry as well: the managed-sandbox rows, whose API calls go through
 * the proxy while the code running inside the sandbox reaches the network
 * from the provider's side (the guide's prose under that table says so, and
 * `src/lib/mcp/hosting/bridge-source.ts` passes no proxy variable in). A row's
 * exception is stated only when that row's traffic is configured here (its
 * `RECIPIENT_STATEMENTS` entry returns a statement).
 */
export const PROXY_EXCEPTIONS: Readonly<Record<string, string>> = {
  'Database, `DB_DRIVER=node-postgres`': 'the connection to the database, which is not a web request',
  'Notebook execution, `EXECUTOR_DRIVER=vercel-sandbox`':
    "the notebook's own requests for data, which leave from the Vercel Sandbox it runs in",
  "Hosted source (`NYC_CHARTER_HOSTING=sandbox`): its sandbox's lifecycle":
    "a hosted data source's own requests for its data, which leave from the Vercel Sandbox it runs in",
  'Notebook execution, `EXECUTOR_DRIVER=container`':
    "the site's instructions to run each notebook, which stay on the operator's server (the notebook's own requests for data do go through the proxy)",
  'Notebook execution, `EXECUTOR_DRIVER=lambda`':
    "the notebook's own requests for data, which go through whatever proxy is set on the AWS Lambda function, which this site cannot read",
};

/** The exception every proxied instance has: the operator's `NO_PROXY` list and the loopback addresses. */
export const PROXY_ALWAYS_EXEMPT = 'requests to addresses the operator has exempted from the proxy, and to this server itself';

/** The lead of the proxy statement. */
export const PROXY_STATEMENT =
  'The operator has set this site to send its requests to other services through a proxy: a server the operator chooses, which passes each request on. ' +
  'So everything this section says the site sends, it sends through that proxy, except:';

/** After the proxy statement's list, when analytics is configured. */
export const PROXY_NOT_ANALYTICS = 'Analytics is loaded by your browser, not by this site, so it does not go through this proxy.';

// --- The recipients: one key per outbound-kinds row ---------------------------

/**
 * One entry per row of docs/deploy.md's outbound-kinds table, keyed by the
 * row's first cell exactly. Each returns the statements for this instance,
 * or none when the instance sends nothing of that kind.
 */
export const RECIPIENT_STATEMENTS: Readonly<Record<string, (ctx: Context) => Statement[]>> = {
  'Model endpoint': () => [
    statement(
      'recipient-model',
      [
        'Your question, and the data the sources return for it, are sent to the AI model service at ',
        { code: hostOf(getModelApiBaseUrl()) },
        '.',
      ],
      ['env:MODEL_API_BASE_URL', 'const:src/lib/model-client.ts#DEFAULT_BASE_URL'],
    ),
  ],

  'MCP servers': ({ mcp }) =>
    Object.keys(buildMcpRegistry(mcp).servers).flatMap((sourceId) => {
      const entry = CIVIC_MANIFEST.find((candidate) => candidate.sourceId === sourceId);
      const address = configuredAddressForSource(mcp, sourceId);
      if (!entry || address === undefined) return [];
      return [
        statement(
          `recipient-source-${sourceId}`,
          [
            `The data source ${entry.displayName}, at `,
            { code: hostOf(address) },
            ', receives the searches and queries the AI model writes to answer your question. These can include words from your question. ',
            `How current its data is: ${entry.freshness}`,
          ],
          MCP_TRACES,
        ),
      ];
    }),

  'Object store, `BLOB_DRIVER=vercel-blob`': () =>
    (process.env.BLOB_DRIVER || DEFAULT_BLOB_DRIVER) === 'vercel-blob'
      ? [
          statement(
            'recipient-blob-vercel',
            ['Published records, and the parts of a record uploaded while it is being prepared, are stored with Vercel Blob, a file storage service.'],
            ['env:BLOB_DRIVER', c('DEFAULT_BLOB_DRIVER')],
          ),
        ]
      : [],

  'Object store, `BLOB_DRIVER=s3`': () =>
    process.env.BLOB_DRIVER === 's3'
      ? [
          statement(
            'recipient-blob-s3',
            ['Published records, and the parts of a record uploaded while it is being prepared, are stored in a file store the operator runs or rents.'],
            ['env:BLOB_DRIVER'],
          ),
        ]
      : [],

  'Signing services': ({ signing }) => [
    statement(
      'recipient-timestamp',
      [
        'When a record is published, a fingerprint of it (a hash, not its contents) is sent to the timestamp service at ',
        { code: hostOf(timestampAuthorityUrl()) },
        '. That service returns proof of when the record existed.',
      ],
      ['env:TIMESTAMP_AUTHORITY_URL', 'const:src/lib/evidence/signing.ts#DEFAULT_TIMESTAMP_AUTHORITY_URL'],
    ),
    ...(signing
      ? [
          statement(
            'recipient-transparency-log',
            [
              "The fingerprint and this site's signature over it are also entered in the transparency log at ",
              { code: hostOf(transparencyLogUrl()) },
              `. ${TRANSPARENCY_LOG_PERMANENCE}`,
            ],
            [
              'env:TRANSPARENCY_LOG_URL',
              'env:PUBLISHER_SIGNING_KEY',
              'env:PUBLISHER_KEY_ID',
              'const:src/lib/evidence/signing.ts#DEFAULT_TRANSPARENCY_LOG_URL',
              c('TRANSPARENCY_LOG_PERMANENCE'),
            ],
          ),
        ]
      : []),
  ],

  "Verification's read of a blob-referenced field": () => [
    statement(
      'recipient-verification-read',
      ["When a record is checked, the site reads the record's stored parts back from where they are stored. Nothing you send goes with that read."],
      ['env:BLOB_DRIVER'],
    ),
  ],

  'Directory and roadmap content sources': () => {
    const roadmap = getRoadmapSource();
    return [
      statement(
        'recipient-content-sources',
        [
          'To show its directory of data sources, the site reads a list from ',
          { code: hostOf(getDirectorySource().url) },
          ...(roadmap ? ['; to show its roadmap, it reads ', { code: hostOf(roadmap.rawUrl) } as Segment] : []),
          '. Nothing you send goes with those reads.',
        ],
        ['env:DIRECTORY_DATA_URL', 'env:ROADMAP_RAW_URL', 'const:src/lib/site-config.ts#COMMUNITY_DIRECTORY_DATA_URL'],
      ),
    ];
  },

  'Rate-limit counter, `KV_REST_API_URL` set': () =>
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
      ? [
          statement(
            'recipient-counter-store',
            ['The daily question counts, kept under the codes described above, are stored in a key-value store, a simple database of named values.'],
            ['env:KV_REST_API_URL', 'env:KV_REST_API_TOKEN'],
          ),
        ]
      : [
          statement(
            'recipient-counter-memory',
            ["The daily question counts, kept under the codes described above, are held in the server's memory only."],
            ['env:KV_REST_API_URL', 'env:KV_REST_API_TOKEN'],
          ),
        ],

  'Sign-in provider (GitHub / OIDC) discovery, token and userinfo calls': () =>
    toSignInOptions(buildProviders()).map((option) => {
      const oidc = option.id === OIDC_PROVIDER_ID;
      const host = oidc ? hostOf(normalizeIssuer(process.env.OIDC_ISSUER || '')) : 'github.com';
      return statement(
        `recipient-sign-in-${option.id}`,
        [`When you sign in with ${option.name}, the site asks `, { code: host }, ' for your account key, name and profile.'],
        SIGN_IN_TRACES,
      );
    }),

  'Database, `DB_DRIVER=neon-http`': () =>
    process.env.DATABASE_URL && (process.env.DB_DRIVER || DEFAULT_DB_DRIVER) === 'neon-http'
      ? [
          statement(
            'recipient-database-neon',
            ['Accounts and records are kept in a Postgres database run by a managed database service (Neon).'],
            ['env:DATABASE_URL', 'env:DB_DRIVER', c('DEFAULT_DB_DRIVER')],
          ),
        ]
      : [],

  'Database, `DB_DRIVER=node-postgres`': () =>
    process.env.DATABASE_URL && process.env.DB_DRIVER === 'node-postgres'
      ? [
          statement(
            'recipient-database-postgres',
            ['Accounts and records are kept in a Postgres database the operator runs or rents.'],
            ['env:DATABASE_URL', 'env:DB_DRIVER'],
          ),
        ]
      : [],

  'Notebook execution, `EXECUTOR_DRIVER=vercel-sandbox`': ({ executor }) =>
    executor === 'vercel-sandbox'
      ? [
          statement(
            'recipient-executor-vercel-sandbox',
            [`${NOTEBOOK_PURPOSE} ${NOTEBOOK_CARRIES_QUESTION} Each notebook runs in a Vercel Sandbox, a short-lived computer the site starts for the run.`],
            [...notebookTraces(), c('NOTEBOOK_PURPOSE'), ...NOTEBOOK_SENT_TRACES],
          ),
        ]
      : [],

  'Hosted source (`NYC_CHARTER_HOSTING=sandbox`): its sandbox\'s lifecycle': ({ mcp }) =>
    Object.values(buildMcpRegistry(mcp).hosted).map((server) =>
      statement(
        `recipient-hosted-${server.sourceId}`,
        [
          `The data source ${server.label} runs in a Vercel Sandbox this site starts, running version ${server.hosting.version} of its publisher's software. `,
          `How current its data is: ${CIVIC_MANIFEST.find((entry) => entry.sourceId === server.sourceId)?.freshness ?? ''}`,
        ],
        ['env:NYC_CHARTER_HOSTING', 'const:@typedstandards/civic-typed-router#CIVIC_MANIFEST'],
      ),
    ),

  'Hosted source: the MCP exchange with its bridge': ({ mcp }) =>
    Object.values(buildMcpRegistry(mcp).hosted).map((server) =>
      statement(
        `recipient-hosted-exchange-${server.sourceId}`,
        [
          `The searches and queries the AI model writes for ${server.label}, which can include words from your question, reach it inside that sandbox.`,
        ],
        ['env:NYC_CHARTER_HOSTING', 'const:@typedstandards/civic-typed-router#CIVIC_MANIFEST'],
      ),
    ),

  'Notebook execution, `EXECUTOR_DRIVER=container`': ({ executor }) =>
    executor === 'container'
      ? [
          statement(
            'recipient-executor-container',
            [`${NOTEBOOK_PURPOSE} ${NOTEBOOK_CARRIES_QUESTION} Each notebook runs in a container on the operator's own server.`],
            [...notebookTraces(), c('NOTEBOOK_PURPOSE'), ...NOTEBOOK_SENT_TRACES],
          ),
        ]
      : [],

  'Notebook execution, `EXECUTOR_DRIVER=lambda`': ({ executor }) => {
    if (executor !== 'lambda') return [];
    const region = present(process.env.EXECUTOR_LAMBDA_REGION);
    return [
      statement(
        'recipient-executor-lambda',
        [`${NOTEBOOK_PURPOSE} ${NOTEBOOK_CARRIES_QUESTION} Each notebook runs in an AWS Lambda function, a program Amazon's cloud runs on demand for the operator${region ? `, in the ${region} region` : ''}.`],
        [...notebookTraces(), 'env:EXECUTOR_LAMBDA_REGION', c('NOTEBOOK_PURPOSE'), ...NOTEBOOK_SENT_TRACES],
      ),
    ];
  },
};

// --- What a platform holds (R6 W2, #632 ruling 1) ------------------------------

/** The date the platform pages below were read, UTC. */
export const PLATFORM_READ_DATE = '2026-10-19';

export interface PlatformHeldRecipient {
  /** The holder, as its own pages name it. */
  holder: string;
  /** The pages its statements rest on, each with the sentence read there (found in the saved page with its markup stripped). */
  reads: readonly VendorRead[];
  /** The statements for this instance, or none when the instance has nothing of this kind. */
  statements: (ctx: Context) => Statement[];
}

const VERCEL_RUNTIME_LOGS_PAGE = 'https://vercel.com/docs/logs/runtime';
const VERCEL_SANDBOX_CONCEPTS_PAGE = 'https://vercel.com/docs/vercel-sandbox/concepts';

/**
 * Beside the outbound-kinds table, as `ANALYTICS_RECIPIENTS` is: what a
 * platform HOLDS rather than what this site SENDS, one entry per
 * `PLATFORM_HELD_KINDS` value (`src/lib/flows/statement.ts`), keyed
 * `held:<kind>` (`heldKey`). `src/lib/privacy-recipients.test.ts` fails when a
 * kind has no entry here and when an entry has no kind. The flows statement
 * (`/api/flows`) names the same recipients under the same keys.
 *
 * Each line states only what was read or measured, with its source: the
 * holder's own page and date, this site's tested guarantees, and the code
 * that creates the sandbox; what was not measured is said to be.
 */
export const PLATFORM_HELD_RECIPIENTS: Readonly<Record<PlatformHeldKind, PlatformHeldRecipient>> = {
  'function-logs': {
    holder: 'Vercel',
    reads: [
      { url: VERCEL_RUNTIME_LOGS_PAGE, read: PLATFORM_READ_DATE, sentence: 'Runtime logs include all logs generated by Vercel Functions invocations in both preview and production deployments.' },
      { url: VERCEL_RUNTIME_LOGS_PAGE, read: PLATFORM_READ_DATE, sentence: 'Each log row shares basic info about the request, like execution, domain name, HTTP status, function type, and RequestId.' },
      { url: VERCEL_RUNTIME_LOGS_PAGE, read: PLATFORM_READ_DATE, sentence: 'Runtime logs are stored with the following observability limits: Plan Retention time Hobby 1 hour of logs Pro 1 day of logs Pro with Observability Plus 30 days of logs Enterprise 3 days of logs Enterprise with Observability Plus 30 days of logs' },
    ],
    statements: () => {
      const onVercel = present(process.env.VERCEL_ENV) !== null;
      return [
        onVercel
          ? statement(
              'held-function-logs-vercel',
              [
                "This site runs on Vercel. Vercel keeps the logs the site's code writes for each request. " +
                  'Each log line also holds basic facts about the request, such as its address on this site and its status. ' +
                  "Vercel says it keeps these logs for 1 hour, 1 day, 3 days or 30 days, depending on the operator's plan (its ",
                { link: VERCEL_RUNTIME_LOGS_PAGE, text: 'runtime logs' },
                ` page, read ${PLATFORM_READ_DATE}). This site cannot read which plan applies. ${LOGS_STATEMENT} ` +
                  'Your question travels in the body of a request, not in its address. ' +
                  'So this site reads these facts as: Vercel keeps facts about requests, not your question. ' +
                  "That is this site's reading, not a claim Vercel makes. Some pages put what you type after a ",
                { code: '?' },
                ' in the address. Whether Vercel keeps that part has not been checked.',
              ],
              ['env:VERCEL_ENV', c('PLATFORM_HELD_RECIPIENTS'), c('LOGS_STATEMENT'), 'const:src/lib/flows/statement.ts#PLATFORM_HELD_KINDS'],
            )
          : statement(
              'held-function-logs-operator',
              ["This site's own logs are kept by whoever runs its server. " + LOGS_STATEMENT + ' How long they are kept is the operator\'s to state.'],
              ['env:VERCEL_ENV', c('PLATFORM_HELD_RECIPIENTS'), c('LOGS_STATEMENT'), 'const:src/lib/flows/statement.ts#PLATFORM_HELD_KINDS'],
            ),
      ];
    },
  },
  'sandbox-platform': {
    holder: 'Vercel',
    reads: [
      {
        url: VERCEL_SANDBOX_CONCEPTS_PAGE,
        read: PLATFORM_READ_DATE,
        sentence: 'With persistence enabled (the default), the filesystem is automatically snapshotted on stop and restored when the sandbox resumes.',
      },
      // R6 W3: the page that states how long a snapshot is kept.
      { url: VERCEL_SANDBOX_SNAPSHOTS, read: SANDBOX_SNAPSHOTS_READ_DATE, sentence: SANDBOX_SNAPSHOTS_SENTENCE },
    ],
    statements: ({ mcp }) =>
      Object.values(buildMcpRegistry(mcp).hosted).map((server) =>
        statement(
          `held-sandbox-platform-${server.sourceId}`,
          [
            `The data source ${server.label} runs in a Vercel Sandbox that this site keeps between uses. ` +
              `When the sandbox stops, it keeps a copy of its files, which this site sets to expire ${HOSTED_SNAPSHOT_EXPIRATION_DAYS} days after its last use. ` +
              'Vercel says snapshots expire 30 days after their last use by default (its ',
            { link: VERCEL_SANDBOX_SNAPSHOTS, text: 'sandbox snapshots' },
            ` page, read ${SANDBOX_SNAPSHOTS_READ_DATE}). Vercel's sandbox pages do not say what else it keeps of what runs there. ` +
              "The program this site runs beside the source writes no searches or queries to the sandbox's logs. " +
              "What the source's own software writes there has not been checked.",
          ],
          [
            'env:NYC_CHARTER_HOSTING',
            c('PLATFORM_HELD_RECIPIENTS'),
            'const:src/lib/flows/statement.ts#PLATFORM_HELD_KINDS',
            'const:src/lib/mcp/hosting/lifecycle.ts#wakeHostedSource',
            'const:src/lib/flows/sandbox-snapshots.ts#HOSTED_SNAPSHOT_EXPIRATION_DAYS',
            'const:src/lib/mcp/hosting/bridge-source.ts#BRIDGE_SOURCE',
          ],
        ),
      ),
  },
};

/** The key a platform-held recipient's statement is held under, beside the table's rows. */
export function heldKey(kind: string): string {
  return `held:${kind}`;
}

// --- The guard's comparison ---------------------------------------------------

/** The key an analytics service's statement is held under, beside the table's rows. */
export function analyticsKey(service: string): string {
  return `analytics:${service}`;
}

/** Every key this module holds a recipient statement under. */
export function recipientStatementKeys(): string[] {
  return [
    ...Object.keys(RECIPIENT_STATEMENTS),
    ...Object.keys(ANALYTICS_RECIPIENTS).map(analyticsKey),
    ...Object.keys(PLATFORM_HELD_RECIPIENTS).map(heldKey),
  ];
}

/**
 * The guard's comparison, in both directions: each recipient the source names
 * (a table row, or an analytics service) with no statement here, and each
 * statement here with no recipient behind it.
 */
export function recipientDrift(
  recipients: readonly string[],
  statementKeys: readonly string[],
): { unstated: string[]; unmatched: string[] } {
  return {
    unstated: recipients.filter((key) => !statementKeys.includes(key)),
    unmatched: statementKeys.filter((key) => !recipients.includes(key)),
  };
}

// --- The page -----------------------------------------------------------------

function whoRunsThis(): Statement[] {
  const attribution = getBrandAttribution();
  const repo = getBrandRepoUrl();
  const out: Statement[] = [];
  if (attribution !== null) {
    out.push(
      statement('operator', [`This site describes who runs it as: ${attribution}`], ['env:SITE_BRAND_ATTRIBUTION']),
    );
  }
  if (repo !== null) {
    out.push(
      statement(
        'source-code',
        ['The code this site runs is open, and anyone can run it themselves: ', { link: repo, text: repo.replace(/^https?:\/\//, '').replace(/\/$/, '') }, '.'],
        ['env:SITE_BRAND_REPO_URL'],
      ),
    );
  }
  return out;
}

function signInAndLimits(): Statement[] {
  const options = toSignInOptions(buildProviders());
  const limits = dailyLimits();
  const out: Statement[] = [];
  out.push(
    options.length === 0
      ? statement('sign-in', ['This site offers no sign-in.'], SIGN_IN_TRACES)
      : statement('sign-in', [`You can use this site without signing in, or sign in with ${list(options.map((o) => o.name))}.`], SIGN_IN_TRACES),
  );
  if (options.length > 0 && limits.gated) {
    out.push(
      statement('sign-in-gate', ['Signing in is limited to accounts the operator has approved.'], ['env:SIGN_IN_ALLOWLIST']),
    );
  }
  out.push(
    statement(
      'daily-limits',
      [
        `Without signing in you can ask ${limits.anonymous} questions a day` +
          (options.length > 0 ? `; signed in, ${limits.signedIn}.` : '.'),
      ],
      [
        'env:ANONYMOUS_RATE_LIMIT',
        'env:AUTHENTICATED_RATE_LIMIT',
        'env:APP_TIER_RATE_LIMIT',
        'env:SIGN_IN_ALLOWLIST',
        c('DEFAULT_ANONYMOUS_LIMIT'),
        c('DEFAULT_AUTHENTICATED_LIMIT'),
      ],
    ),
    statement('limit-reason', [LIMIT_REASON], [c('LIMIT_REASON')]),
  );
  return out;
}

function whatLinksActivity(): Statement[] {
  const signIn = toSignInOptions(buildProviders()).length > 0;
  const who = signIn
    ? [
        'To count your questions, the site makes a code for each day. Signed in, the code is made from your account; ' +
          'not signed in, from your network address. Either way it also uses the date and a secret only the operator holds.',
        'Your address and account are',
        'a given address or account',
      ]
    : [
        'To count your questions, the site makes a code for each day. ' +
          'The code is made from your network address, the date and a secret only the operator holds.',
        'Your address is',
        'a given address',
      ];
  const out: Statement[] = [
    statement(
      'daily-key',
      [
        `${who[0]} ` +
          `${who[1]} not stored with the count. ` +
          'The code changes every day, so counts from different days cannot be matched to each other without the secret. ' +
          `The operator, who holds the secret, could work out which code belongs to ${who[2]} on a given day.`,
      ],
      [`env:${RATE_LIMIT_SECRET_VARIABLE}`, 'const:src/lib/rate-limit.ts#RATE_LIMIT_SECRET_VARIABLE', ...SIGN_IN_TRACES],
    ),
  ];
  // The usage count (R6 W5): beside the daily counts above, because it is the
  // other count, and the one that keeps nothing that connects it to a reader.
  // Only with a database, where it is written (`src/lib/usage/count.ts`).
  if (process.env.DATABASE_URL) {
    const words = USAGE_COUNT_COLUMNS;
    const onPlatform = present(process.env.VERCEL_ENV) !== null;
    out.push(
      statement(
        'usage-count',
        [
          'The site also counts questions, to see how it is used. ' +
            `Each count is ${words.count} ${words.day}. ` +
            `It records ${words.surface}, ${words.model}, and ${words.signedIn}. ` +
            `It also records ${words.sourcesOffered}, ${words.sourcesUsed}, and ${words.outcome}. ` +
            'A count keeps no account, no network address and no question text.' +
            (onPlatform ? ` Questions asked on test versions of this site are counted too, and ${words.environment}.` : ''),
        ],
        ['env:DATABASE_URL', 'env:VERCEL_ENV', c('USAGE_COUNT_COLUMNS'), 'const:src/lib/usage/count.ts#usageRow'],
      ),
    );
  }
  if (signIn) {
    out.push(
      listStatement(
        'cookies',
        ['Signing in uses these cookies, set by the sign-in library this site uses:'],
        SIGN_IN_COOKIES.map((cookie): Segment[] => [{ code: cookie.name }, ` ${cookie.purpose}`]),
        [...SIGN_IN_TRACES, c('SIGN_IN_COOKIES'), c('HOST_PREFIXED_COOKIE')],
        [
          'Over a secure connection each name starts with ',
          { code: '__Secure-' },
          ', except ',
          { code: HOST_PREFIXED_COOKIE },
          ', which starts with ',
          { code: '__Host-' },
          '.',
        ],
      ),
    );
  }
  out.push(
    statement(
      'browser-storage',
      [
        'Your browser keeps three display choices for the current tab: notebook or standard mode, whether the comparison is shown, ' +
          'and which layout an answer is shown under. They are stored under ',
        { code: MODE_STORAGE_KEY },
        ', ',
        { code: COMPARISON_STORAGE_KEY },
        ' and ',
        { code: LAYOUT_STORAGE_KEY },
        '.',
      ],
      [
        'const:src/lib/query-presentation.ts#MODE_STORAGE_KEY',
        'const:src/lib/query-presentation.ts#COMPARISON_STORAGE_KEY',
        'const:src/lib/query-presentation.ts#LAYOUT_STORAGE_KEY',
      ],
    ),
  );
  return out;
}

function whatIsStored(): Statement[] {
  const out: Statement[] = [];
  if (process.env.DATABASE_URL) {
    const columns = Object.keys(getTableColumns(users)).map((key) => ACCOUNT_COLUMNS[key] ?? key);
    out.push(
      listStatement(
        'account-row',
        ['When you sign in, the site keeps an account. It holds:'],
        columns.map((column): Segment[] => [column]),
        ['env:DATABASE_URL', 'const:src/lib/db/schema.ts#users', c('ACCOUNT_COLUMNS')],
        ['Every record you publish is stored with your account as its creator.'],
      ),
    );
    if (!isSealOnly()) {
      out.push(
        statement(
          'creator-attribution',
          [CREATOR_ATTRIBUTION],
          [
            'env:DATABASE_URL',
            'env:SITE_SEAL_ONLY',
            c('CREATOR_ATTRIBUTION'),
            'const:src/lib/db/schema.ts#users',
            'const:src/lib/evidence/record-list.ts#buildRecordListItems',
          ],
        ),
      );
    }
    out.push(
      listStatement(
        'also-kept',
        [ALSO_KEPT],
        ALSO_KEPT_ITEMS.map((item): Segment[] => [item]),
        [
          'env:DATABASE_URL',
          c('ALSO_KEPT'),
          c('ALSO_KEPT_ITEMS'),
          c('ATTESTATION_TEXT_IS_SERVED'),
          'const:src/lib/db/schema.ts#deviceCodes',
          'const:src/lib/db/schema.ts#apiTokens',
          'const:src/lib/db/schema.ts#attestationNodes',
          'const:src/lib/db/schema.ts#sourceConsents',
          'const:src/lib/evidence/attestation.ts#buildAttestationNode',
          'const:src/lib/evidence/expert-attestation.ts#buildExpertAttestationPayload',
        ],
        [ATTESTATION_TEXT_IS_SERVED],
      ),
    );
  }
  out.push(
    statement(
      'prompt-text',
      [
        "When you publish, you choose whether the record includes your question's text or only a fingerprint (a hash) of it. " +
          `The publish dialog describes that choice, ${HASH_ONLY_CHOICE_LABEL}, in these words. ${HASH_ONLY_RECORD_WORDS}`,
      ],
      [
        c('HASH_ONLY_RECORD_WORDS'),
        c('HASH_ONLY_CHOICE_LABEL'),
        'const:src/lib/db/schema.ts#promptVisibilityEnum',
        'const:src/lib/notebook.ts#WITHHELD_QUESTION_TEXT',
        'const:src/app/api/evidence/route.ts#POST',
      ],
    ),
    statement(
      'record-title',
      [RECORD_TITLE_IS_PUBLIC],
      [c('RECORD_TITLE_IS_PUBLIC'), 'const:src/app/api/evidence/route.ts#POST'],
    ),
  );
  if (process.env.DATABASE_URL) {
    out.push(
      statement(
        'prompt-text-database',
        ["The site keeps your question's text in its database only if you chose to include it in the record."],
        ['env:DATABASE_URL', 'const:src/lib/db/schema.ts#promptVisibilityEnum', 'const:src/app/api/evidence/route.ts#POST'],
      ),
    );
  }
  out.push(
    isSealOnly()
      ? statement(
          'seal-only',
          [`This site seals records only: a record you publish is stored and signed, but never listed or shown publicly, ${SEALED_FINGERPRINT_LOOKUP}.`],
          ['env:SITE_SEAL_ONLY', ...SEALED_FINGERPRINT_TRACES],
        )
      : statement(
          'seal-only',
          [
            'A record you publish publicly is listed on this site and anyone can read it. ' +
              `A record you seal is stored and signed, but not listed or shown publicly, ${SEALED_FINGERPRINT_LOOKUP}.`,
          ],
          ['env:SITE_SEAL_ONLY', ...SEALED_FINGERPRINT_TRACES],
        ),
  );
  const graceHours = ORPHAN_GRACE_MS / (60 * 60 * 1000);
  out.push(
    process.env.CRON_SECRET
      ? statement(
          'upload-cleanup',
          [
            'Parts of a record are uploaded while it is being prepared. ' +
              `If the record is never published, those parts are deleted by a daily cleanup once they are ${graceHours} hours old.`,
          ],
          ['env:CRON_SECRET', 'const:src/lib/evidence/blob-gc.ts#ORPHAN_GRACE_MS'],
        )
      : statement(
          'upload-cleanup',
          ['This site has no cleanup configured. Parts of a record uploaded while it is being prepared are kept even if the record is never published.'],
          ['env:CRON_SECRET'],
        ),
  );
  return out;
}

function recipients(analytics: AnalyticsConfig | null): Statement[] {
  const ctx = readContext();
  const out = Object.values(RECIPIENT_STATEMENTS).flatMap((build) => build(ctx));
  // What a platform holds, beside what the site sends (R6 W2, ruling 1).
  out.push(...Object.values(PLATFORM_HELD_RECIPIENTS).flatMap((entry) => entry.statements(ctx)));
  if (ctx.executor === 'none') {
    out.push(statement('executor-none', ['This site does not run notebooks.'], notebookTraces()));
  } else if (ctx.executor === 'unrecognized') {
    out.push(
      statement('executor-unrecognized', ['This site is set to a notebook runner the code does not recognize, so notebooks do not run.'], notebookTraces()),
    );
  }
  if (analytics !== null) {
    const service = ANALYTICS_RECIPIENTS[analytics.service];
    out.push(
      statement(
        `recipient-analytics-${analytics.service}`,
        [
          `Your browser loads ${service.name} from `,
          { code: service.host },
          `, which records the pages you visit on this site. A published record's address includes its title, ` +
            `so the title of any record you open reaches ${service.reaches} too. ` +
            'Page addresses also carry what you type into some pages: ',
          ...readerInputAddresses(),
          '. ',
          ...service.addressKept,
          ' ',
          ...service.says,
          ' ',
          ...service.objection,
          ` If your browser does not load that script, nothing is sent to ${service.notSentTo}.`,
        ],
        ['env:NEXT_PUBLIC_ANALYTICS_SERVICE', 'env:NEXT_PUBLIC_ANALYTICS_ID', 'env:NEXT_PUBLIC_GA_MEASUREMENT_ID', c('ANALYTICS_RECIPIENTS'), c('READER_INPUT_ADDRESSES')],
      ),
    );
  }
  if (isOutboundProxyConfigured()) {
    const exceptions = Object.entries(PROXY_EXCEPTIONS)
      .filter(([kind]) => (RECIPIENT_STATEMENTS[kind]?.(ctx).length ?? 0) > 0)
      .map(([, text]) => text);
    out.push(
      listStatement(
        'recipient-proxy',
        [PROXY_STATEMENT],
        [PROXY_ALWAYS_EXEMPT, ...exceptions].map((item): Segment[] => [item]),
        [
          'env:HTTP_PROXY',
          'env:HTTPS_PROXY',
          'env:NO_PROXY',
          'const:src/lib/outbound-proxy.ts#isOutboundProxyConfigured',
          'const:src/lib/outbound-proxy.ts#DEFAULT_NO_PROXY_HOSTS',
          c('PROXY_STATEMENT'),
          c('PROXY_ALWAYS_EXEMPT'),
          c('PROXY_EXCEPTIONS'),
          ...(analytics !== null ? [c('PROXY_NOT_ANALYTICS'), 'env:NEXT_PUBLIC_ANALYTICS_SERVICE' as Trace] : []),
        ],
        analytics !== null ? [PROXY_NOT_ANALYTICS] : undefined,
      ),
    );
  }
  return out;
}

/** "a search on the directory page (`/directory?q=…`) and …", as page segments. */
function readerInputAddresses(): Segment[] {
  const parts = READER_INPUT_ADDRESSES.map((entry): Segment[] => [`${entry.what} (`, { code: `${entry.path}?${entry.param}=…` }, ')']);
  return parts.flatMap((part, i) => [...(i === 0 ? [] : [i === parts.length - 1 ? ' and ' : ', ']), ...part]);
}

function cannotTell(): Statement[] {
  const repo = getBrandRepoUrl();
  return [
    statement('logs', [LOGS_STATEMENT], [c('LOGS_STATEMENT'), 'const:src/lib/streaming.ts#errorLogFacts']),
    statement(
      'not-verifiable',
      [repo !== null ? `${NOT_VERIFIABLE_FROM_OUTSIDE} ${RUN_IT_YOURSELF}` : NOT_VERIFIABLE_FROM_OUTSIDE],
      repo !== null
        ? [c('NOT_VERIFIABLE_FROM_OUTSIDE'), c('RUN_IT_YOURSELF'), 'env:SITE_BRAND_REPO_URL']
        : [c('NOT_VERIFIABLE_FROM_OUTSIDE'), 'env:SITE_BRAND_REPO_URL'],
    ),
    listStatement(
      'operator-states',
      [OPERATOR_STATES],
      OPERATOR_STATES_ITEMS.map((item): Segment[] => [item]),
      [c('OPERATOR_STATES'), c('OPERATOR_STATES_ITEMS')],
    ),
  ];
}

// --- Consent (R6 W3) ---------------------------------------------------------------

const COPY = 'src/lib/sources/copy.ts';
const k = (name: string): Trace => `const:${COPY}#${name}`;
const COOKIE_NAME_TRACE: Trace = 'const:src/lib/sources/consent.ts#CONSENT_COOKIE_NAME';
const FLOWS_TRACE: Trace = 'const:src/lib/flows/statement.ts#buildFlowsStatementFor';

/** The change log, as the repository serves it. */
export const FLOWS_CHANGELOG_PATH = 'docs/flows-changelog.md';

/** One source's row: who publishes it, where it runs, what its holders say they keep, and how current its data is. */
function sourceRow(source: FlowsStatement['sources'][number]): Statement {
  const keptBy = source.recipients.flatMap((r) => r.keptBy);
  const parts: Segment[] = [`${readerSourceName(source.displayName)}, published by ${source.publisher}, runs at ${sourceWhere(source)}. Who holds its logs: `];
  keptBy.forEach((line, i) => {
    if (i > 0) parts.push('; ');
    parts.push(keepsText(line));
    if (line.retention) parts.push(`, for ${line.retention.replace(/\.$/, '')}`);
    if (line.statementUrl) parts.push(' (', { link: line.statementUrl, text: 'its statement' }, line.readOn ? `, read ${line.readOn})` : ')');
  });
  parts.push(`. How current its data is: ${source.freshness}`);
  return statement(`source-row-${source.sourceId}`, parts, [FLOWS_TRACE, 'env:SOCRATA_MCP_URL', 'env:BOSTON_OPENCONTEXT_MCP_URL', 'env:NYC_CHARTER_HOSTING']);
}

function consentSections(analytics: AnalyticsConfig | null): PrivacySection[] {
  const accounts = Boolean(process.env.DATABASE_URL);
  const guide = deploymentGuideUrl();
  const repo = getBrandRepoUrl();
  const [how, again, keep, each, changes] = PRIVACY_CONSENT_SECTIONS;
  const sections = PRIVACY_CONSENT_SECTIONS.map((section, i): PrivacySection => ({
    id: `consent-${i + 1}`,
    heading: section.heading,
    statements: [statement(`consent-${i + 1}`, [section.sentences.join(' ')], [k('PRIVACY_CONSENT_SECTIONS')])],
  }));
  const at = (section: typeof how) => sections[PRIVACY_CONSENT_SECTIONS.indexOf(section)].statements;

  at(how).push(
    statement('consent-kept', [accounts ? KEPT_WITH_ACCOUNTS : KEPT_WITHOUT_ACCOUNTS], ['env:DATABASE_URL', k(accounts ? 'KEPT_WITH_ACCOUNTS' : 'KEPT_WITHOUT_ACCOUNTS')]),
    statement('consent-cookie', ['The consent cookie is named ', { code: CONSENT_COOKIE_NAME }, `. ${COOKIE_HOLDS}`], [COOKIE_NAME_TRACE, k('COOKIE_HOLDS')]),
    statement('consent-withdraw', [accounts ? WITHDRAW_WITH_ACCOUNTS : WITHDRAW_WITHOUT_ACCOUNTS], ['env:DATABASE_URL', k(accounts ? 'WITHDRAW_WITH_ACCOUNTS' : 'WITHDRAW_WITHOUT_ACCOUNTS')]),
  );
  at(again).push(
    statement('consent-notify', [accounts ? NOTIFY_WITH_ACCOUNTS : NOTIFY_WITHOUT_ACCOUNTS], ['env:DATABASE_URL', k(accounts ? 'NOTIFY_WITH_ACCOUNTS' : 'NOTIFY_WITHOUT_ACCOUNTS')]),
  );
  at(keep).push(
    guide
      ? statement('consent-guide', [GUIDE_SENTENCE.replace(` ${GUIDE_LINK_TEXT} explains how.`, ' '), { link: guide, text: GUIDE_LINK_TEXT }, ' explains how.'], ['env:SITE_DEPLOYMENT_GUIDE_URL', k('GUIDE_SENTENCE')])
      : statement('consent-guide', [NO_GUIDE_SENTENCE], ['env:SITE_DEPLOYMENT_GUIDE_URL', k('NO_GUIDE_SENTENCE')]),
  );
  at(each).push(...buildFlowsStatementFor(analytics).sources.map(sourceRow));
  if (repo !== null) {
    at(changes).push(
      statement('consent-changelog', ['The log: ', { link: `${repo.replace(/\/$/, '')}/blob/main/${FLOWS_CHANGELOG_PATH}`, text: FLOWS_CHANGELOG_PATH }, '.'], ['env:SITE_BRAND_REPO_URL', c('FLOWS_CHANGELOG_PATH')]),
    );
  }
  if (operatorStatesNoTraining()) {
    sections.splice(PRIVACY_CONSENT_SECTIONS.indexOf(changes), 0, {
      id: 'consent-endpoint',
      heading: PRIVACY_ENDPOINT_HEADING,
      statements: [statement('consent-endpoint', [PRIVACY_ENDPOINT_SENTENCES.join(' ')], ['env:SITE_OPERATOR_STATES_NO_TRAINING', k('PRIVACY_ENDPOINT_SENTENCES')])],
    });
  }
  return sections;
}

/**
 * Every section of the page, for this instance as configured now. `analytics`
 * is passed in rather than read: it is a build-time value the caller reads by
 * literal name, as the root layout does, so the page and the tag agree.
 */
export function buildPrivacySections(analytics: AnalyticsConfig | null): PrivacySection[] {
  const sections: PrivacySection[] = [
    { id: 'basis', heading: 'How this page is written', statements: [statement('basis', [PAGE_BASIS], [c('PAGE_BASIS')])] },
    { id: 'who', heading: 'Who runs this site', statements: whoRunsThis() },
    { id: 'use', heading: 'Using the site', statements: signInAndLimits() },
    ...consentSections(analytics),
    { id: 'links', heading: 'What connects your activity to you', statements: whatLinksActivity() },
    { id: 'stored', heading: 'What the site keeps', statements: whatIsStored() },
    { id: 'recipients', heading: 'Who receives what', statements: recipients(analytics) },
    { id: 'limits', heading: 'What this page cannot tell you', statements: cannotTell() },
  ];
  return sections.filter((section) => section.statements.length > 0);
}
