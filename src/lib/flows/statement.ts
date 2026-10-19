/**
 * The flows statement (#632 W2, D7 = A): where a question on this instance can
 * go, derived at request time from the configuration, the router manifest's
 * hosting variants and postures, and the dated constants below. Served as
 * JSON at `/api/flows`; a consent refers to it, and a record carries its
 * address, hash and date.
 *
 * WHAT IT STATES. `recipients`, the instance-level recipients: the model
 * endpoint, the hosting platform's function logs, sign-in, analytics and the
 * notebook executor, each where it is configured. `sources`, each configured
 * source with its hosting variant in force, its publisher, its freshness and
 * its own recipients (the server an addressed source's searches reach, or the
 * sandbox platform a hosted source runs on). Each recipient carries what it
 * receives and its kept-by lines: what the holder says it keeps, with the
 * statement's address and the date it was read; or `not-stated` where a
 * statement that was read says nothing; or `operator-states` where only this
 * instance's operator can say (the model endpoint, correction g); or
 * `not-read`. Nothing here calls a source or any other host (design §2.4
 * rule 1): it is built from configuration and code alone.
 *
 * THE THREE DIGESTS (the ORCH's ruling on the stage-A proposal), each a
 * lowercase hex SHA-256 over RFC 8785 canonical JSON:
 *   - `version`, the base version: the instance-level recipients, each
 *     reduced to its identity, where it is, what it receives and what each
 *     holder keeps (`computeBaseVersion`). Configuring a source, a re-read
 *     that finds the same statement, and the `date` move none of it. D5's base
 *     scope reads it; the anonymous cookie stores it.
 *   - each source's `version`: its variant in force, its host and its
 *     recipients' postures (`computeSourceVersion`), never its freshness line.
 *     D5's source scope reads it; the cookie stores one per source.
 *   - the statement's hash (`statementHash`): the SHA-256 of the exact bytes
 *     `/api/flows` serves (`serializeFlowsStatement`). It is the flows version
 *     a consent was shown (the PUT echoes it, 409 when stale), the row's
 *     `flows_hash`, and the `hash` a record carries.
 *
 * THE DATE is the statement's content date: the latest read date among the
 * statements it carries (`FLOWS_STATEMENT_FIRST_DATE` when it carries none),
 * never the request's. The same configuration on two clock days serves the
 * same bytes; a re-read moves `date` and the hash and neither version.
 *
 * THE KEYS. Every recipient carries the key the privacy page holds its
 * statement under: a row of `docs/deploy.md`'s outbound-kinds table, an
 * analytics service (`analytics:<service>`), or a kind a platform holds
 * (`held:<kind>`, `PLATFORM_HELD_KINDS`). `src/lib/privacy-recipients.test.ts`
 * fails when a statement names a key outside those three sources, so this
 * statement and the privacy page cannot name different recipients.
 */
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { CIVIC_MANIFEST, type HostingVariant, type LoggingPosture } from '@typedstandards/civic-typed-router';
import type { AnalyticsConfig, AnalyticsService } from '../analytics.tsx';
import { buildProviders, normalizeIssuer, OIDC_PROVIDER_ID } from '../auth-providers.ts';
import { toSignInOptions } from '../auth-provider-options.ts';
import { resolveAppOrigin } from '../host-routing.ts';
import { getModelApiBaseUrl } from '../model-client.ts';
import { ANALYTICS_RECIPIENTS, hostOf } from '../privacy-facts.ts';
import { resolveExecutorDriverName } from '../sandbox/execute.ts';
import {
  configuredAddressForSource,
  hostingVariantInForce,
  readMcpEnvFromProcess,
  type McpRegistryEnv,
} from '../mcp/registry.ts';

// --- The shape -------------------------------------------------------------------

/** What a holder's statement says it keeps, or why there is no such line. */
export type FlowsKeeps = 'none' | 'metadata' | 'content' | 'not-stated' | 'not-read' | 'operator-states';

export interface FlowsKeptBy {
  /** The holder, named as its own statement names it, or by its role. */
  holder: string;
  keeps: FlowsKeeps;
  /** How long, in the statement's terms, when it says. */
  retention?: string;
  /** The longest retention the statement allows, in days, when it states a number. */
  retentionDays?: number;
  /** The statement read: an `https:` address. */
  statementUrl?: string;
  /** The UTC date it was read, `YYYY-MM-DD`. */
  readOn?: string;
  /** What this line rests on besides the holder's statement, each fact with its trace. */
  basis?: string[];
}

export interface FlowsRecipient {
  /** Stable identity, for the re-ask rule: a host or a holder changing under one id is a changed arrangement. */
  id: string;
  /** The privacy page's key for this recipient (see THE KEYS above). */
  key: string;
  role: 'model-endpoint' | 'function-logs' | 'sign-in' | 'analytics' | 'notebook-executor' | 'source' | 'sandbox-platform';
  /** The host it is reached at, when it has one. */
  host?: string;
  /** Where it runs, when it is not a host this site sends to. */
  runsAt?: string;
  /** What it receives, in reader language. */
  receives: string;
  keptBy: FlowsKeptBy[];
}

export interface FlowsSourceVariant {
  variant: string;
  kind: HostingVariant['kind'];
  runsAt: HostingVariant['runsAt'];
  package?: string;
  version?: string;
}

export interface FlowsSource {
  sourceId: string;
  displayName: string;
  /** The source's publisher, as its own page names it, or "not stated". */
  publisher: string;
  variant: FlowsSourceVariant;
  /** The configured address's host, for an addressed source. */
  host?: string;
  freshness: string;
  recipients: FlowsRecipient[];
  /** This source's own version (`computeSourceVersion`). */
  version: string;
}

export interface FlowsLinks {
  /** The privacy page, on whichever host serves the statement. */
  privacy: string;
  /** Present until the deployment guide has a public address (D10, W3). */
  deploymentGuideOmitted?: string;
}

export interface FlowsStatement {
  /** The base version (`computeBaseVersion`). */
  version: string;
  /** The content date: the latest read date among the statements carried. */
  date: string;
  recipients: FlowsRecipient[];
  sources: FlowsSource[];
  links: FlowsLinks;
}

/** What the record carries: the statement's address, its hash and its date (harness 0.9.0, D2 = A). */
export interface FlowsStatementReference {
  url: string;
  hash: string;
  date: string;
}

// --- The dated constants -----------------------------------------------------------

/** Where the statement is served (`src/app/api/flows/route.ts`). */
export const FLOWS_STATEMENT_PATH = '/api/flows';

/** The statement's date when it carries no read date at all (its first publication). */
export const FLOWS_STATEMENT_FIRST_DATE = '2026-10-19';

/** The date the instance-level statements below were read, UTC. */
export const FLOWS_READ_DATE = '2026-10-19';

/**
 * What a platform holds rather than what this site sends (ruling 1): the
 * hosting platform's function logs, and the sandbox platform a hosted source
 * runs on. The privacy page holds one statement per kind, keyed
 * `held:<kind>` (`PLATFORM_HELD_RECIPIENTS` in `src/lib/privacy-facts.ts`).
 */
export const PLATFORM_HELD_KINDS = ['function-logs', 'sandbox-platform'] as const;
export type PlatformHeldKind = (typeof PLATFORM_HELD_KINDS)[number];

const held = (kind: PlatformHeldKind) => `held:${kind}`;

const VERCEL_RUNTIME_LOGS = 'https://vercel.com/docs/logs/runtime';
const VERCEL_SANDBOX = 'https://vercel.com/docs/vercel-sandbox';
const GITHUB_PRIVACY = 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement';
const TYLER_PRIVACY = 'https://www.tylertech.com/privacy';
const AWS_LAMBDA_LOGS = 'https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html';

/** The site's own tested guarantee about its log lines. */
const LOGS_GUARANTEE =
  "this site's log lines record step names, sizes, durations and error kinds, never the question, a tool's arguments or a source's answer " +
  '(src/lib/logs-carry-no-reader-content.test.ts)';

/** The hosting platform's function logs: Vercel's, when this site runs there (`VERCEL_ENV`), else the operator's. */
function functionLogs(onVercel: boolean): FlowsRecipient {
  return {
    id: 'function-logs',
    key: held('function-logs'),
    role: 'function-logs',
    runsAt: onVercel ? 'Vercel' : "this site's own server",
    receives: "what this site's own logs record of each request: which steps ran, how long they took and the kind of any error",
    keptBy: [
      onVercel
        ? {
            holder: 'Vercel',
            keeps: 'metadata',
            retention: "1 hour, 1 day, 3 days or 30 days, by the operator's plan, which this site cannot read",
            retentionDays: 30,
            statementUrl: VERCEL_RUNTIME_LOGS,
            readOn: FLOWS_READ_DATE,
            basis: [
              "Vercel's runtime logs page: runtime logs include the output of the site's functions, kept 1 hour (Hobby), 1 day (Pro), 3 days (Enterprise) or 30 days (with Observability Plus)",
              LOGS_GUARANTEE,
              "so 'metadata' is this site's reading of those two facts, not Vercel's own claim",
            ],
          }
        : { holder: "this site's operator", keeps: 'operator-states' },
    ],
  };
}

/** The sandbox platform's posture: Vercel Sandbox, whose pages say nothing about what it keeps. */
function sandboxPlatform(basis: string[]): FlowsKeptBy {
  return { holder: 'Vercel', keeps: 'not-stated', statementUrl: VERCEL_SANDBOX, readOn: FLOWS_READ_DATE, basis };
}

/** Measured from the hosted source's lifecycle and bridge (the stage-B report states each). */
const HOSTED_SANDBOX_MEASURED = [
  'measured: the sandbox is created persistent, and the platform keeps its last filesystem snapshot for up to 30 days (src/lib/mcp/hosting/lifecycle.ts, persistent: true, keepLastSnapshots 1, snapshotExpiration 30 days)',
  "measured: the bridge's own log lines carry error kinds, versions and process ids, never a tool's arguments, and it writes no file per request (src/lib/mcp/hosting/bridge-source.ts)",
  "not measured: what the source's own server writes to its error output, which reaches the sandbox's command log (bridge-source.ts, stderr: 'inherit')",
];

/** Measured from the notebook executor's Vercel Sandbox driver. */
const EXECUTOR_SANDBOX_MEASURED = [
  'measured: each run gets its own sandbox, created non-persistent and stopped after the run (src/lib/sandbox/vercel-sandbox.ts, persistent: false; src/lib/sandbox/execute.ts)',
  "measured: the notebook written into it carries the question's text (src/lib/sandbox/execute.ts, /tmp/notebook.ipynb; privacy-facts NOTEBOOK_CARRIES_QUESTION)",
  "not measured: what the platform keeps of a stopped sandbox's files or of its command output",
];

/**
 * The postures of the log holders the manifest names by role
 * (`statedBy: 'instance'`, ADR-0036): the manifest is the same for every
 * instance and cannot name them, so this instance states each.
 */
export const INSTANCE_ROLE_POSTURES: Readonly<Record<string, (host: string | undefined) => FlowsKeptBy>> = {
  'server-operator': (host) => ({ holder: host ? `the operator of ${host}` : "the server's operator", keeps: 'operator-states' }),
  'portal-operator': () => ({
    holder: 'Tyler Technologies',
    keeps: 'not-stated',
    statementUrl: TYLER_PRIVACY,
    readOn: FLOWS_READ_DATE,
    basis: ["its privacy statement gives a retention rule for personal information and says nothing about what it keeps of a portal's data requests"],
  }),
  'sandbox-platform': () => sandboxPlatform(HOSTED_SANDBOX_MEASURED),
};

/** What a source's server receives. */
const SOURCE_RECEIVES = 'the searches and queries the AI model writes to answer your question, which can include words from your question';

// --- Building ------------------------------------------------------------------------

function keptByFor(logging: readonly LoggingPosture[], host: string | undefined): FlowsKeptBy[] {
  const lines = logging.map((posture): FlowsKeptBy => {
    if (posture.statedBy === 'manifest') {
      return {
        holder: posture.holder,
        keeps: posture.keeps,
        ...(posture.retention ? { retention: posture.retention } : {}),
        statementUrl: posture.statementUrl,
        readOn: posture.readOn,
      };
    }
    const stated = INSTANCE_ROLE_POSTURES[posture.role];
    return stated ? stated(host) : { holder: posture.role, keeps: 'not-read' };
  });
  return lines.length > 0 ? lines : [{ holder: 'not stated', keeps: 'not-read' }];
}

function sourceRows(configured: McpRegistryEnv): FlowsSource[] {
  const rows: FlowsSource[] = [];
  for (const entry of CIVIC_MANIFEST) {
    const variant = hostingVariantInForce(entry, configured);
    if (!variant) continue;
    const address = variant.kind === 'remote' ? configuredAddressForSource(configured, entry.sourceId) : undefined;
    const host = address ? hostOf(address) : undefined;
    const recipient: FlowsRecipient =
      variant.kind === 'npm-package'
        ? { id: `source:${entry.sourceId}`, key: held('sandbox-platform'), role: 'sandbox-platform', runsAt: 'instance-sandbox', receives: SOURCE_RECEIVES, keptBy: keptByFor(variant.logging, undefined) }
        : { id: `source:${entry.sourceId}`, key: 'MCP servers', role: 'source', ...(host ? { host } : { runsAt: variant.runsAt }), receives: SOURCE_RECEIVES, keptBy: keptByFor(variant.logging, host) };
    const summary: FlowsSourceVariant = {
      variant: variant.variant,
      kind: variant.kind,
      runsAt: variant.runsAt,
      ...(variant.kind === 'npm-package' ? { package: variant.package, version: variant.version } : {}),
    };
    const row = {
      sourceId: entry.sourceId,
      displayName: entry.displayName,
      publisher: entry.publisher ?? 'not stated',
      variant: summary,
      ...(host ? { host } : {}),
      freshness: entry.freshness,
      recipients: [recipient],
    };
    rows.push({ ...row, version: computeSourceVersion(row) });
  }
  return rows;
}

function signInRecipients(): FlowsRecipient[] {
  return toSignInOptions(buildProviders()).map((option): FlowsRecipient => {
    const oidc = option.id === OIDC_PROVIDER_ID;
    const host = oidc ? hostOf(normalizeIssuer(process.env.OIDC_ISSUER || '')) : 'github.com';
    return {
      id: `sign-in:${option.id}`,
      key: 'Sign-in provider (GitHub / OIDC) discovery, token and userinfo calls',
      role: 'sign-in',
      host,
      receives: 'a request for your account key, name and profile, when you sign in',
      keptBy: [
        oidc
          ? { holder: host, keeps: 'operator-states' }
          : {
              holder: 'GitHub',
              keeps: 'metadata',
              retention: 'as long as your account is active, and as needed for legal obligations',
              statementUrl: GITHUB_PRIVACY,
              readOn: FLOWS_READ_DATE,
            },
      ],
    };
  });
}

/** The analytics configuration, read only when one of its variables is set (the tag module is `.tsx`). */
async function analyticsInForce(): Promise<AnalyticsConfig | null> {
  const env = {
    NEXT_PUBLIC_ANALYTICS_SERVICE: process.env.NEXT_PUBLIC_ANALYTICS_SERVICE,
    NEXT_PUBLIC_ANALYTICS_ID: process.env.NEXT_PUBLIC_ANALYTICS_ID,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  };
  if (!Object.values(env).some((value) => typeof value === 'string' && value.trim() !== '')) return null;
  const { resolveAnalytics } = await import('../analytics.tsx');
  return resolveAnalytics(env);
}

function analyticsRecipient(service: AnalyticsService): FlowsRecipient {
  const recipient = ANALYTICS_RECIPIENTS[service];
  const read = recipient.reads[0];
  return {
    id: `analytics:${service}`,
    key: `analytics:${service}`,
    role: 'analytics',
    host: recipient.host,
    receives: 'the pages you visit on this site, sent by your browser',
    keptBy: [{ holder: recipient.reaches, keeps: 'metadata', statementUrl: read.url, readOn: read.read }],
  };
}

function notebookExecutor(): FlowsRecipient | null {
  let driver: string;
  try {
    driver = resolveExecutorDriverName();
  } catch {
    return null;
  }
  if (driver === 'none') return null;
  const base = {
    id: 'notebook-executor',
    key: `Notebook execution, \`EXECUTOR_DRIVER=${driver}\``,
    role: 'notebook-executor' as const,
    receives: "the notebook the AI model writes for your question, which includes your question's text",
  };
  if (driver === 'vercel-sandbox') return { ...base, runsAt: 'Vercel Sandbox', keptBy: [sandboxPlatform(EXECUTOR_SANDBOX_MEASURED)] };
  if (driver === 'lambda') {
    return {
      ...base,
      runsAt: 'AWS Lambda',
      keptBy: [{
        holder: 'Amazon Web Services',
        keeps: 'operator-states',
        statementUrl: AWS_LAMBDA_LOGS,
        readOn: FLOWS_READ_DATE,
        basis: ["the function's logs go to a CloudWatch log group whose retention the operator sets"],
      }],
    };
  }
  return { ...base, runsAt: "the operator's own server", keptBy: [{ holder: "this site's operator", keeps: 'operator-states' }] };
}

/**
 * The statement in force under this process's configuration. Async only for
 * the analytics module, which is loaded when analytics is configured.
 */
export async function buildFlowsStatement(): Promise<FlowsStatement> {
  return buildFlowsStatementFor(await analyticsInForce());
}

/** The statement under this process's configuration, with the analytics configuration given. */
export function buildFlowsStatementFor(analytics: AnalyticsConfig | null): FlowsStatement {
  const executor = notebookExecutor();
  const recipients: FlowsRecipient[] = [
    {
      id: 'model-endpoint',
      key: 'Model endpoint',
      role: 'model-endpoint',
      host: hostOf(getModelApiBaseUrl()),
      receives: 'your question, and the data the sources return for it',
      keptBy: [{ holder: hostOf(getModelApiBaseUrl()), keeps: 'operator-states' }],
    },
    functionLogs(typeof process.env.VERCEL_ENV === 'string' && process.env.VERCEL_ENV.trim() !== ''),
    ...signInRecipients(),
    ...(analytics ? [analyticsRecipient(analytics.service)] : []),
    ...(executor ? [executor] : []),
  ];
  return assembleFlowsStatement({
    recipients,
    sources: sourceRows(readMcpEnvFromProcess()),
    links: {
      privacy: '/privacy',
      deploymentGuideOmitted: 'This instance names no public address for its deployment guide yet.',
    },
  });
}

/** The statement from its parts: the base version and the content date computed, never supplied. */
export function assembleFlowsStatement(parts: { recipients: FlowsRecipient[]; sources: FlowsSource[]; links: FlowsLinks }): FlowsStatement {
  const reads = [...parts.recipients, ...parts.sources.flatMap((s) => s.recipients)]
    .flatMap((r) => r.keptBy.map((k) => k.readOn))
    .filter((d): d is string => typeof d === 'string');
  const date = reads.reduce((latest, d) => (d > latest ? d : latest), FLOWS_STATEMENT_FIRST_DATE);
  return { version: computeBaseVersion(parts.recipients), date, recipients: parts.recipients, sources: parts.sources, links: parts.links };
}

// --- The digests ------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonical(value: unknown): string {
  const text = canonicalize(value);
  if (typeof text !== 'string') throw new Error('flows statement: a value has no canonical JSON form');
  return text;
}

/** A holder's posture, as the versions see it: no address, no read date, no basis. */
function posture(k: FlowsKeptBy): Record<string, unknown> {
  return {
    holder: k.holder,
    keeps: k.keeps,
    ...(k.retention !== undefined ? { retention: k.retention } : {}),
    ...(k.retentionDays !== undefined ? { retentionDays: k.retentionDays } : {}),
  };
}

function arrangement(r: FlowsRecipient): Record<string, unknown> {
  return {
    id: r.id,
    role: r.role,
    ...(r.host !== undefined ? { host: r.host } : {}),
    ...(r.runsAt !== undefined ? { runsAt: r.runsAt } : {}),
    receives: r.receives,
    keptBy: r.keptBy.map(posture),
  };
}

/** The base version: the instance-level recipients' arrangements and postures. */
export function computeBaseVersion(recipients: readonly FlowsRecipient[]): string {
  return sha256(canonical(recipients.map(arrangement)));
}

/** A source's own version: its variant, its host and its recipients' postures. */
export function computeSourceVersion(source: Pick<FlowsSource, 'sourceId' | 'variant' | 'host' | 'recipients'>): string {
  return sha256(canonical({
    sourceId: source.sourceId,
    variant: source.variant,
    ...(source.host !== undefined ? { host: source.host } : {}),
    recipients: source.recipients.map(arrangement),
  }));
}

/** The bytes `/api/flows` serves: the statement's RFC 8785 canonical JSON. */
export function serializeFlowsStatement(statement: FlowsStatement): string {
  return canonical(statement);
}

/** The statement's hash: the SHA-256 of the bytes served. */
export function statementHash(statement: FlowsStatement): string {
  return sha256(serializeFlowsStatement(statement));
}

/**
 * The instance's public origin for a request: `getBaseUrl(request)`'s
 * precedence (`src/lib/device-flow.ts:74`) — `APP_HOST`'s origin, else
 * `NEXTAUTH_URL` without its trailing slash, else the request's origin.
 * Restated rather than imported: `device-flow.ts` imports `./host-routing`
 * with no extension, which Next resolves and the test runner's module hooks
 * in a dozen route-driven suites do not, so importing it here would stop
 * every one of them from loading the routes. `statement.test.ts` pins this to
 * `getBaseUrl` itself under each branch, so the two cannot part.
 */
export function instanceOrigin(request: Request): string {
  const appOrigin = resolveAppOrigin(process.env);
  if (appOrigin) return appOrigin;
  const fromEnv = process.env.NEXTAUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Where the statement is served for a request: the instance origin plus `/api/flows` (ruling 2). */
export function flowsStatementUrl(request: Request): string {
  return `${instanceOrigin(request)}${FLOWS_STATEMENT_PATH}`;
}

/** What a record carries: exactly the url, the hash and the date, in that order. */
export function flowsStatementReference(statement: FlowsStatement, request: Request): FlowsStatementReference {
  return { url: flowsStatementUrl(request), hash: statementHash(statement), date: statement.date };
}

/** Every key a statement names, base and sources: what the privacy guard compares. */
export function flowsRecipientKeys(statement: Pick<FlowsStatement, 'recipients' | 'sources'>): string[] {
  return [...new Set([...statement.recipients.map((r) => r.key), ...statement.sources.flatMap((s) => s.recipients.map((r) => r.key))])];
}
