/**
 * The privacy page's statements, computed from this instance's configuration
 * and from named code constants (#516 P7).
 *
 * RED STUB. The fixed text and the constants the page will state are here; the
 * statements, the recipients and the guard's comparison are not yet written:
 * `buildPrivacySections` returns no section, `RECIPIENT_STATEMENTS` and
 * `ANALYTICS_RECIPIENTS` hold no entry, and `recipientDrift` reports nothing
 * (the guard switched off). The next commit writes them.
 */
import type { AnalyticsConfig, AnalyticsService } from './analytics.tsx';

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
export const ANALYTICS_RECIPIENTS = {} as Readonly<Record<AnalyticsService, { name: string; host: string }>>;

// --- Not yet written -----------------------------------------------------------

export const RECIPIENT_STATEMENTS: Readonly<Record<string, () => Statement[]>> = {};

export function analyticsKey(service: string): string {
  return `analytics:${service}`;
}

export function recipientStatementKeys(): string[] {
  return [];
}

export function recipientDrift(
  recipients: readonly string[],
  statementKeys: readonly string[],
): { unstated: string[]; unmatched: string[] } {
  void recipients;
  void statementKeys;
  return { unstated: [], unmatched: [] };
}

export function buildPrivacySections(analytics: AnalyticsConfig | null): PrivacySection[] {
  void analytics;
  return [];
}
