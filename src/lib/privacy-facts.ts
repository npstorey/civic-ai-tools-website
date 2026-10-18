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
 * settings with the model service (#516 G0-7), what the hosting platform
 * records per request, and any legal position. `OPERATOR_STATES` says these
 * are the operator's to state, and the page carries no placeholder for them.
 * Consent and its change log (design §4.7 items 10 and 12) do not exist yet,
 * so the page says nothing about them.
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
import { COMPARISON_STORAGE_KEY, MODE_STORAGE_KEY } from './query-presentation.ts';

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
  'what the hosting platform records about each visit, such as network addresses',
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

function notebookTraces(): Trace[] {
  return ['env:EXECUTOR_DRIVER', 'const:src/lib/sandbox/execute.ts#resolveExecutorDriverName'];
}

/** What a notebook run is, for the executor statements. */
export const NOTEBOOK_PURPOSE =
  'In notebook mode, the AI model writes a notebook (a short program) to answer your question, and the site runs it. ' +
  'The notebook requests its data from the public data portals it names.';

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
            [`${NOTEBOOK_PURPOSE} Each notebook runs in a Vercel Sandbox, a short-lived computer the site starts for the run.`],
            [...notebookTraces(), c('NOTEBOOK_PURPOSE')],
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
            [`${NOTEBOOK_PURPOSE} Each notebook runs in a container on the operator's own server.`],
            [...notebookTraces(), c('NOTEBOOK_PURPOSE')],
          ),
        ]
      : [],

  'Notebook execution, `EXECUTOR_DRIVER=lambda`': ({ executor }) => {
    if (executor !== 'lambda') return [];
    const region = present(process.env.EXECUTOR_LAMBDA_REGION);
    return [
      statement(
        'recipient-executor-lambda',
        [`${NOTEBOOK_PURPOSE} Each notebook runs in an AWS Lambda function, a program Amazon's cloud runs on demand for the operator${region ? `, in the ${region} region` : ''}.`],
        [...notebookTraces(), 'env:EXECUTOR_LAMBDA_REGION', c('NOTEBOOK_PURPOSE')],
      ),
    ];
  },
};

// --- The guard's comparison ---------------------------------------------------

/** The key an analytics service's statement is held under, beside the table's rows. */
export function analyticsKey(service: string): string {
  return `analytics:${service}`;
}

/** Every key this module holds a recipient statement under. */
export function recipientStatementKeys(): string[] {
  return [...Object.keys(RECIPIENT_STATEMENTS), ...Object.keys(ANALYTICS_RECIPIENTS).map(analyticsKey)];
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
        'Your browser keeps two display choices for the current tab: notebook or standard mode, and whether the comparison is shown. ' +
          'They are stored under ',
        { code: MODE_STORAGE_KEY },
        ' and ',
        { code: COMPARISON_STORAGE_KEY },
        '.',
      ],
      ['const:src/lib/query-presentation.ts#MODE_STORAGE_KEY', 'const:src/lib/query-presentation.ts#COMPARISON_STORAGE_KEY'],
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
          ['This site seals records only: a record you publish is stored and signed, but never listed or shown publicly.'],
          ['env:SITE_SEAL_ONLY'],
        )
      : statement(
          'seal-only',
          [
            'A record you publish publicly is listed on this site and anyone can read it. ' +
              'A record you seal is stored and signed, but not listed or shown publicly.',
          ],
          ['env:SITE_SEAL_ONLY'],
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
            `so the title of any record you open reaches ${service.reaches} too. `,
          ...service.says,
          ' ',
          ...service.objection,
          ` If your browser does not load that script, nothing is sent to ${service.notSentTo}.`,
        ],
        ['env:NEXT_PUBLIC_ANALYTICS_SERVICE', 'env:NEXT_PUBLIC_ANALYTICS_ID', 'env:NEXT_PUBLIC_GA_MEASUREMENT_ID', c('ANALYTICS_RECIPIENTS')],
      ),
    );
  }
  return out;
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
    { id: 'links', heading: 'What connects your activity to you', statements: whatLinksActivity() },
    { id: 'stored', heading: 'What the site keeps', statements: whatIsStored() },
    { id: 'recipients', heading: 'Who receives what', statements: recipients(analytics) },
    { id: 'limits', heading: 'What this page cannot tell you', statements: cannotTell() },
  ];
  return sections.filter((section) => section.statements.length > 0);
}
