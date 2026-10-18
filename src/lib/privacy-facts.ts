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
  parts: Segment[];
  traces: Trace[];
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
  "Every statement on this page is read from this site's configuration or its code when the page is served. " +
  'Where the site cannot know something, this page says so instead of guessing.';

/** Why questions are limited per day (design §4.7 item 2). */
export const LIMIT_REASON =
  'Each question is answered by an AI model working with live data sources, and every answer costs money, so the number of questions per day is limited.';

/** Design §4.7 item 11. */
export const NOT_VERIFIABLE_FROM_OUTSIDE =
  'No one outside a hosted service can check how it handles its logs, including this one.';

/** Item 11's second half, shown with the repository link (item 1). */
export const RUN_IT_YOURSELF = 'That is why the code is open: you can run it yourself and see exactly what it does.';

/** What the app's own logs hold: the N13 property, held by the errors-out-of-logs guards. */
export const LOGS_STATEMENT =
  "The site's own logs record which steps ran, how long they took, how large their results were, and the kind of any error. " +
  'They do not record your question, the queries sent to data sources, or what the sources returned.';

/** The design's ops side: what the app cannot read, stated as the operator's to state. */
export const OPERATOR_STATES =
  'This site cannot read the following, so they are for whoever runs it to state: ' +
  'how long the operator and each service named on this page keep what they receive; ' +
  "the operator's account settings with the AI model service, including whether that service may keep or learn from what it receives; " +
  'what the hosting platform records about each visit, such as network addresses; ' +
  'and any legal position.';

/**
 * What a record keeps under hash-only visibility. The publish dialog states
 * the same words beside its hash-only choice (`PublishEvidenceDialog.tsx`);
 * `src/lib/privacy-hash-only-words.test.ts` renders the real dialog and fails
 * when the two differ. The record's question forms are replaced by
 * `WITHHELD_QUESTION_TEXT` (`src/lib/notebook.ts`) in the publish handler.
 */
export const HASH_ONLY_RECORD_WORDS = 'The record shows only a fingerprint (a hash) of your question.';

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
 * Analytics: what each service's tag loads, and from where. The host is the
 * one `AnalyticsTags` in `src/lib/analytics.tsx` writes into the tag's
 * `src`; the page test renders the real tags and fails when they differ.
 */
export const ANALYTICS_RECIPIENTS: Readonly<Record<AnalyticsService, { name: string; host: string }>> = {
  'google-analytics': { name: 'Google Analytics', host: 'www.googletagmanager.com' },
  plausible: { name: 'Plausible', host: 'plausible.io' },
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
            ', receives the searches and queries the AI model writes to answer your question, which can include words from it. ',
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
        ', which returns proof of when the record existed.',
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
            ['The daily question counts, kept under the codes described above, are stored in a key-value store.'],
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
          `The data source ${server.label} runs in a Vercel Sandbox this site starts, running version ${server.hosting.version} of its publisher's package. `,
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
        [`${NOTEBOOK_PURPOSE} Each notebook runs in an AWS Lambda function the operator runs${region ? `, in the ${region} region` : ''}.`],
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
    ? ['your account (when you are signed in) or your network address (when you are not)', 'Your address and account are', 'a given address or account']
    : ['your network address', 'Your address is', 'a given address'];
  const out: Statement[] = [
    statement(
      'daily-key',
      [
        `To count your questions, the site computes a code from ${who[0]} and the date, using a secret only the operator holds. ` +
          `${who[1]} not stored with the count. ` +
          'The code changes every day, so counts from different days cannot be matched to each other without the secret. ' +
          `The operator, who holds the secret, could work out which code belongs to ${who[2]} on a given day.`,
      ],
      [`env:${RATE_LIMIT_SECRET_VARIABLE}`, 'const:src/lib/rate-limit.ts#RATE_LIMIT_SECRET_VARIABLE', ...SIGN_IN_TRACES],
    ),
  ];
  if (signIn) {
    out.push(
      statement(
        'cookies',
        [
          'Signing in uses these cookies, set by the sign-in library this site uses: ',
          ...SIGN_IN_COOKIES.flatMap((cookie, i): Segment[] => [
            ...(i > 0 ? ['; '] : []),
            { code: cookie.name },
            ` ${cookie.purpose}`,
          ]),
          '. Over a secure connection each name starts with ',
          { code: '__Secure-' },
          ' (the request check: ',
          { code: '__Host-' },
          ').',
        ],
        [...SIGN_IN_TRACES, c('SIGN_IN_COOKIES')],
      ),
    );
  }
  out.push(
    statement(
      'browser-storage',
      [
        'Two display choices (notebook or standard mode, and whether the comparison is shown) are kept in your browser for the current tab, under ',
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
      statement(
        'account-row',
        [`When you sign in, the site keeps an account with ${list(columns)}. Every record you publish is stored with your account as its creator.`],
        ['env:DATABASE_URL', 'const:src/lib/db/schema.ts#users', c('ACCOUNT_COLUMNS')],
      ),
    );
  }
  out.push(
    statement(
      'prompt-text',
      [`When you publish, you choose whether the record includes your question's text or a fingerprint (a hash) of it. With the fingerprint: ${HASH_ONLY_RECORD_WORDS}`],
      [
        c('HASH_ONLY_RECORD_WORDS'),
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
          [`Parts of a record uploaded while it is being prepared, if the record is never published, are deleted by a daily cleanup once they are ${graceHours} hours old.`],
          ['env:CRON_SECRET', 'const:src/lib/evidence/blob-gc.ts#ORPHAN_GRACE_MS'],
        )
      : statement(
          'upload-cleanup',
          ['This site has no cleanup configured, so parts of a record uploaded while it is being prepared are kept even if the record is never published.'],
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
          `, which records the pages you visit on this site. A published record's address includes its title.`,
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
    statement('operator-states', [OPERATOR_STATES], [c('OPERATOR_STATES')]),
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
