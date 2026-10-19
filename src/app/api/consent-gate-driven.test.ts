// R6 W2 (#632), criterion 4: the first-consent gate and the selection, driven
// through the four gated routes (D3, D12, C6).
//
// THE RULE. Nothing is sent anywhere before consent, the model endpoint
// included (design §4.4). Each gated route reads the consent in force — the
// row when the session carries a `dbId`, else the cookie, anonymous or signed
// in ("row, or cookie", never "row, else cookie") — after the instance's
// configuration refusals and before the rate limiter spends anything. None in
// force, and the route answers the typed `consent_required` with the current
// flows version. In force, the selection is configured ∩ On, a configured
// source absent from the states is Ask first (D6), the router's `not-selected`
// is recorded as `reader-off` or `not-consented` from the state (D2 = A), and
// the root span carries `analysis.flows_statement` (the url, hash and date).
//
// WHAT IS DRIVEN. Each route's real handler, its real stream, the real model
// loop against the scripted model endpoint, the real MCP client against a
// loopback fixture for Socrata and Data Commons, the real consent module and
// the real flows statement. THE CENSUS: every `fetch` this process makes, every
// request either loopback server receives, and every call to the rate limiter,
// counted per drive. A refused request must read zero on all of them.
//
// STUBS, and why: `next/headers`, `next-auth`, `@/lib/auth` (a session set per
// drive); `@/lib/rate-limit` (counts its calls); `@/lib/sandbox` (the notebook
// executor returns the notebook it was given); `@/lib/sources/consent-store`
// (an in-memory row per account id); `@/lib/db`, `@/lib/storage` and
// `@/lib/evidence/sealed-access` (the replay route's record row and package).
//
// WHAT MAKES IT ABLE TO FAIL. At the base no route reads a consent: every drive
// here is served, the model is called, Data Commons is offered and recorded
// `configured`, and no root span carries a flows statement.
//
// `api/compare` writes no trace (G0 finding 3, the seat's ruling), so the gate
// and the selection apply there and the flows attribute does not.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');

// --- Module hooks ---------------------------------------------------------------

interface Gate {
  session: unknown;
  rows: Map<string, unknown>;
  checks: number;
  increments: number;
  record: Record<string, unknown> | null;
  packages: Record<string, unknown>;
}
const globals = globalThis as unknown as { __r6w2Gate: Gate };
globals.__r6w2Gate = { session: null, rows: new Map(), checks: 0, increments: 0, record: null, packages: {} };

const STUB_PREFIX = 'file:///r6-w2-gate-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.21' }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__r6w2Gate.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { globalThis.__r6w2Gate.checks += 1; return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() { globalThis.__r6w2Gate.increments += 1; }
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook(notebook) {
      return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
  '@/lib/sources/consent-store': `
    const rows = () => globalThis.__r6w2Gate.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) { rows().set(userId, { userId, ...row, consentedAt: new Date(), updatedAt: new Date() }); }
    export async function deleteConsentRow(userId) { rows().delete(userId); }`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `export async function getPackage(key) { return globalThis.__r6w2Gate.packages[key] ?? null; }`,
  '@/lib/db': `
    export const db = {
      select() {
        const chain = { from: () => chain, where: () => chain, limit: async () => (globalThis.__r6w2Gate.record ? [globalThis.__r6w2Gate.record] : []) };
        return chain;
      },
    };`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`r6-w2 gate test hook: cannot resolve ${specifier}`);
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

// --- The census and the loopback data sources ---------------------------------------

const realFetch = globalThis.fetch;
const FETCHED: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  FETCHED.push(`${url.host}${url.pathname}`);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const DC_GUIDANCE = 'Fixture Data Commons instructions, offered only with Data Commons.';
const SOCRATA_GUIDANCE = 'Fixture Socrata skill guidance.';
const RECEIVED: Array<{ path: string; method: string }> = [];

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  RECEIVED.push({ path: p, method: msg.method ?? '' });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    const instructions = p.startsWith('/dc/') ? { instructions: DC_GUIDANCE } : {};
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'r6-w2-gate-fixture', version: '0' }, ...instructions } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: SOCRATA_GUIDANCE } }] } })}\n\n`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ value: 41895 }], total_rows: 1 }) }], isError: false } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH',
  'MODEL_API_VERSION', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH', 'OPENROUTER_API_KEY', 'SITE_PORTAL_LOCKED',
  'SITE_DEFAULT_PORTAL', 'EXECUTOR_DRIVER', 'VERCEL_ENV', 'APP_HOST', 'NEXTAUTH_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
]) delete process.env[name];
process.env.MODEL_API_KEY = 'placeholder-model-key-r6-w2-gate';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;

const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
// The packager states a signing key id; the test suite's, as the other packaging tests set it.
process.env.PUBLISHER_KEY_ID ??= 'platform:test-suite-kid';

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
const { getDefaultModel } = await import('@/lib/model-resolver');
const { RUN_RECORD_ATTRIBUTE } = await import('../../lib/evidence/trace.ts');
const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');

type Handler = (request: Request, ctx?: { params: Promise<{ slug: string }> }) => Promise<Response>;
const compareStream = (await import('./compare-stream/route.ts')) as unknown as { POST: Handler };
const notebook = (await import('./query-notebook/route.ts')) as unknown as { POST: Handler };
const compare = (await import('./compare/route.ts')) as unknown as { POST: Handler };
const replayRoute = (await import('./evidence/[slug]/replay/route.ts')) as unknown as { POST: Handler };

/** The modules W2 adds, by specifiers typed `string` so the red commit type-checks. */
const CONSENT: string = '@/lib/sources/consent';
const STATEMENT: string = '@/lib/flows/statement';
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const consent = (await import(CONSENT).catch(() => null)) as Mod | null;
const flows = (await import(STATEMENT).catch(() => null)) as Mod | null;

/**
 * The statement in force for this process's configuration as it is at the
 * moment of a drive (each drive points the model endpoint at a fresh loopback
 * port, which is a different model host and so a different base version), or
 * null at a base that has none.
 */
async function statementNow(): Promise<Record<string, any> | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return flows?.buildFlowsStatement ? await flows.buildFlowsStatement() : null;
}

/** The states a drive's consent cookie gives; the cookie itself is built inside the drive. */
interface CookieSpec { states: Record<string, string> }
const cookieFor = (states: Record<string, string>): CookieSpec => ({ states });

/** A consent cookie for `spec`, built by the real encoder against `statement`; undefined at the base. */
function cookieValue(spec: CookieSpec, statement: Record<string, any> | null): string | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!consent?.encodeConsentCookie || !consent?.CONSENT_COOKIE_NAME || !statement) return undefined;
  const versionOf = (id: string) => statement.sources.find((s: { sourceId: string }) => s.sourceId === id)?.version ?? 'f'.repeat(64);
  const value = consent.encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(Object.entries(spec.states).map(([id, state]) => [id, { state, since: '2026-10-19', version: versionOf(id) }])),
  });
  return `${consent.CONSENT_COOKIE_NAME}=${value}`;
}

// --- One drive ---------------------------------------------------------------------

interface OtlpSpan { name?: string; attributes?: Array<{ key: string; value: { stringValue?: string; boolValue?: boolean } }> }

interface Drive {
  status: number;
  contentType: string;
  events: Record<string, unknown>[];
  json: Record<string, unknown> | null;
  fetched: string[];
  received: Array<{ path: string; method: string }>;
  modelRequests: Record<string, unknown>[];
  checks: number;
  increments: number;
  /** The statement in force during the drive: its hash and date, or null at the base. */
  flowsHash: string | null;
  flowsDate: string | null;
}

async function drain(response: Response): Promise<string> {
  const deadline = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('the response did not close within 20 s')), 20_000).unref());
  return Promise.race([response.text(), deadline]);
}

const DC_TOOL = 'data_commons__search_indicators';
const TOOL_THEN_ANSWER = [
  { toolCalls: [{ id: 'c1', name: DC_TOOL, args: { query: 'median household income', places: ['Bronx County'] } }] },
  { content: 'The figure could not be retrieved from the sources used for this question.' },
];

async function drive(
  handler: Handler,
  url: string,
  body: Record<string, unknown>,
  options: { session: unknown; cookie?: CookieSpec; replies?: Array<Record<string, unknown>>; slug?: string },
): Promise<Drive> {
  const scripted = await startScriptedModelServer(options.replies ?? TOOL_THEN_ANSWER);
  process.env.MODEL_API_BASE_URL = scripted.url;
  _resetDefaultModelClientForTests();
  globals.__r6w2Gate.session = options.session;
  globals.__r6w2Gate.checks = 0;
  globals.__r6w2Gate.increments = 0;
  const statement = await statementNow();
  const cookie = options.cookie ? cookieValue(options.cookie, statement) : undefined;
  const fetchedBefore = FETCHED.length;
  const receivedBefore = RECEIVED.length;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const response = options.slug ? await handler(request, { params: Promise.resolve({ slug: options.slug }) }) : await handler(request);
    const text = await drain(response);
    const contentType = response.headers.get('content-type') ?? '';
    let json: Record<string, unknown> | null = null;
    if (contentType.includes('application/json')) {
      try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
    }
    const events = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
    return {
      status: response.status,
      contentType,
      events,
      json,
      fetched: FETCHED.slice(fetchedBefore),
      received: RECEIVED.slice(receivedBefore),
      modelRequests: [...scripted.requests],
      checks: globals.__r6w2Gate.checks,
      increments: globals.__r6w2Gate.increments,
      flowsHash: statement && flows?.statementHash ? flows.statementHash(statement) : null,
      flowsDate: statement ? statement.date : null,
    };
  } finally {
    _resetDefaultModelClientForTests();
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

function spansOf(trace: unknown): OtlpSpan[] {
  const spans: OtlpSpan[] = [];
  const t = (trace ?? {}) as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }> };
  for (const rs of t.resourceSpans ?? []) for (const ss of rs.scopeSpans ?? []) spans.push(...(ss.spans ?? []));
  return spans;
}
const attr = (span: OtlpSpan | undefined, key: string) => span?.attributes?.find((a) => a.key === key)?.value;
const traceOf = (d: Drive): unknown => d.events.find((e) => e.type === 'trace')?.data ?? d.events.find((e) => e.type === 'publish_inputs')?.trace;
const rootOf = (d: Drive) => spansOf(traceOf(d)).find((s) => attr(s, RUN_RECORD_ATTRIBUTE.sourcesOffered) !== undefined);
const statedOffered = (d: Drive) => JSON.parse(attr(rootOf(d), RUN_RECORD_ATTRIBUTE.sourcesOffered)?.stringValue ?? '[]') as Array<{ sourceId: string; reason: string }>;
const toolNames = (request: Record<string, unknown> | undefined) => ((request?.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '');
const systemOf = (request: Record<string, unknown> | undefined) => {
  const system = ((request?.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : '';
};

/** The typed refusal, whichever channel the route answers on: a JSON body, or the stream's error events. */
function refusalOf(d: Drive): { code?: unknown; flowsVersion?: unknown } | null {
  if (d.json && d.json.code !== undefined) return d.json as { code?: unknown; flowsVersion?: unknown };
  const error = d.events.find((e) => e.type === 'error');
  return error ? (error as { code?: unknown; flowsVersion?: unknown }) : null;
}

const QUESTION = 'What was the median household income in the Bronx?';
const ANON = null;
const SIGNED_IN_NO_DB = { user: { id: 'gh-fixture-account' } };
const SIGNED_IN_DB = { user: { id: 'gh-fixture-account', dbId: '55555555-5555-4555-8555-555555555555' } };

// The replay route's record: a package that offered Socrata and Data Commons.
const REPLAY_PACKAGE = {
  prompt: { text: QUESTION },
  cost: { model: 'fake/model' },
  queries: [],
  dataSources: [],
  extensions: {
    'org.civicaitools.composition': {
      assertedDate: '2026-10-01',
      sourcesOffered: [
        { sourceId: 'socrata', alias: 'socrata', reason: 'configured' },
        { sourceId: 'data-commons', alias: 'data_commons', reason: 'configured' },
        { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
        { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-configured' },
      ],
      components: [],
    },
  },
};
globals.__r6w2Gate.packages['pkg/gate.json'] = REPLAY_PACKAGE;
globals.__r6w2Gate.record = { id: 'rec-gate', slug: 'gate', basePackageStorageKey: 'pkg/gate.json', visibility: 'public', creatorId: 'fixture-account' };

const STREAM_URL = 'http://localhost/api/compare-stream';
const STREAM_BODY = { query: QUESTION, model: getDefaultModel().id, mcpOnly: true };
const NOTEBOOK_URL = 'http://localhost/api/query-notebook';
const NOTEBOOK_BODY = { query: QUESTION };
const COMPARE_URL = 'http://localhost/api/compare';
const COMPARE_BODY = { query: QUESTION, model: getDefaultModel().id };
const REPLAY_URL = 'http://localhost/api/evidence/gate/replay';
const REPLAY_BODY = { modelApiKey: 'placeholder-model-key-r6-w2-replay' };
const ANSWER_ONLY = [{ content: 'An answer.' }];

// --- The drives, in order, before any test ---------------------------------------------

const DC_OFF = cookieFor({ socrata: 'on', 'data-commons': 'off' });

const REFUSED: Array<[string, Drive]> = [
  ['/api/compare-stream', await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: ANON })],
  ['/api/query-notebook', await drive(notebook.POST, NOTEBOOK_URL, NOTEBOOK_BODY, { session: ANON })],
  ['/api/compare', await drive(compare.POST, COMPARE_URL, COMPARE_BODY, { session: ANON, replies: ANSWER_ONLY })],
  ['/api/evidence/[slug]/replay', await drive(replayRoute.POST, REPLAY_URL, REPLAY_BODY, { session: SIGNED_IN_NO_DB, replies: ANSWER_ONLY, slug: 'gate' })],
];

const SERVED_DC_OFF: Array<[string, Drive]> = [
  ['/api/compare-stream', await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: ANON, cookie: DC_OFF })],
  ['/api/query-notebook', await drive(notebook.POST, NOTEBOOK_URL, NOTEBOOK_BODY, { session: ANON, cookie: DC_OFF })],
];
const COMPARE_DC_OFF = await drive(compare.POST, COMPARE_URL, COMPARE_BODY, { session: ANON, cookie: DC_OFF, replies: ANSWER_ONLY });
const REPLAY_DC_OFF = await drive(replayRoute.POST, REPLAY_URL, REPLAY_BODY, { session: SIGNED_IN_NO_DB, cookie: DC_OFF, replies: ANSWER_ONLY, slug: 'gate' });

const STALE = await drive(compareStream.POST, STREAM_URL, STREAM_BODY, {
  session: ANON,
  cookie: cookieFor({ socrata: 'on', 'data-commons': 'ask-first', 'retired-source': 'on' }),
});

globals.__r6w2Gate.rows = new Map();
const DB_NO_ROW = await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: SIGNED_IN_DB, cookie: cookieFor({ socrata: 'on', 'data-commons': 'on' }) });
const SIGNED_IN_ON_COOKIE = await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: SIGNED_IN_NO_DB, cookie: DC_OFF });

// --- Criterion 4: nothing is sent before consent ---------------------------------------------

for (const [route, d] of REFUSED) {
  test(`criterion 4 (${route}): a request with no consent reaches no model endpoint and no source — the census reads zero`, () => {
    assert.deepEqual(d.fetched, [], `${route} made outbound requests with no consent in force`);
    assert.deepEqual(d.received, [], `${route} reached a data source with no consent in force`);
    assert.equal(d.modelRequests.length, 0, `${route} called the model with no consent in force`);
  });

  // The replay route has no rate limiter to order against; its census above is its whole check.
  if (route !== '/api/evidence/[slug]/replay') test(`criterion 4 (${route}): it is refused before the rate limiter spends anything`, () => {
    assert.equal(d.checks, 0, `${route} read the reader's allowance for a request it refused`);
    assert.equal(d.increments, 0, `${route} spent the reader's allowance for a request it refused`);
  });

  test(`criterion 4 (${route}): the refusal is the typed consent_required, carrying the current flows version`, () => {
    const refusal = refusalOf(d);
    assert.equal(refusal?.code, 'consent_required', `${route} answered ${d.status}: ${JSON.stringify(d.json ?? d.events.slice(0, 2))}`);
    assert.ok(d.flowsHash, 'premise: the current statement has a hash');
    assert.equal(refusal?.flowsVersion, d.flowsHash);
  });
}

// --- Criterion 4: with consent and one source Off, three things agree -----------------------------

for (const [route, d] of SERVED_DC_OFF) {
  test(`criterion 4 (${route}): with Data Commons Off, the tools array, the prompt and the record's sourcesOffered agree`, () => {
    assert.ok(d.modelRequests.length > 0, `${route} was not served on a consent in force: ${JSON.stringify(d.json ?? d.events.slice(0, 2))}`);
    const tools = toolNames(d.modelRequests[0]);
    assert.ok(tools.some((name) => name.startsWith('socrata__')), 'premise: Socrata, On, is offered');
    assert.ok(!tools.some((name) => name.startsWith('data_commons__')), `${route} offered Data Commons, which the reader turned Off`);
    assert.ok(!systemOf(d.modelRequests[0]).includes(DC_GUIDANCE), `${route}'s prompt carries Data Commons' guidance`);
    const reasons = Object.fromEntries(statedOffered(d).map((s) => [s.sourceId, s.reason]));
    assert.equal(reasons.socrata, 'selected');
    assert.equal(reasons['data-commons'], 'reader-off', `${route} recorded Data Commons as ${reasons['data-commons']}`);
    assert.equal(d.received.filter((r) => r.path === '/dc/mcp').length, 0, `${route} sent a request to Data Commons`);
  });

  test(`criterion 4 (${route}): the root span carries analysis.flows_statement — exactly the url, hash and date`, () => {
    const value = attr(rootOf(d), 'analysis.flows_statement')?.stringValue;
    assert.ok(value, `${route}'s root span carries no flows statement`);
    assert.equal(value, JSON.stringify({ url: 'http://localhost/api/flows', hash: d.flowsHash, date: d.flowsDate }));
  });

  test(`premise (${route}): served on a consent in force, it read and spent the allowance as before`, () => {
    assert.ok(d.checks >= 1 && d.increments >= 1, `${route}: checks ${d.checks}, increments ${d.increments}`);
  });
}

test('criterion 4 (/api/compare): with Data Commons Off the run offers no Data Commons tool and writes no trace to carry a flows statement', () => {
  assert.equal(COMPARE_DC_OFF.status, 200, JSON.stringify(COMPARE_DC_OFF.json));
  const withTools = COMPARE_DC_OFF.modelRequests.filter((r) => Array.isArray(r.tools) && (r.tools as unknown[]).length > 0);
  assert.ok(withTools.length > 0, 'premise: the run with data tools was sent');
  for (const request of withTools) {
    assert.ok(!toolNames(request).some((name) => name.startsWith('data_commons__')), '/api/compare offered Data Commons, which the reader turned Off');
    assert.ok(!systemOf(request).includes(DC_GUIDANCE));
  }
  assert.ok(!JSON.stringify(COMPARE_DC_OFF.json).includes('analysis.flows_statement'), 'the compare route writes no trace');
});

test('criterion 4 (replay, C6): the replayer\'s own selection narrows the offered set and the tools', () => {
  assert.equal(REPLAY_DC_OFF.status, 200, JSON.stringify(REPLAY_DC_OFF.json));
  const offeredSet = (REPLAY_DC_OFF.json?.offeredSet ?? {}) as { from?: string; sources?: string[] };
  assert.equal(offeredSet.from, 'sourcesOffered');
  assert.deepEqual(offeredSet.sources, ['socrata'], 'the replay was offered a source its replayer turned Off');
  assert.ok(!toolNames(REPLAY_DC_OFF.modelRequests[0]).some((name) => name.startsWith('data_commons__')));
});

// --- Criterion 4: the stale cookie, and the two signed-in shapes (D12) -------------------------------

test('criterion 4: a stale cookie naming a removed source is ignored, and the reason list carries no entry for it', () => {
  assert.ok(STALE.modelRequests.length > 0, `the stale cookie was refused: ${JSON.stringify(STALE.events.slice(0, 2))}`);
  const offered = statedOffered(STALE);
  assert.ok(!offered.some((s) => s.sourceId === 'retired-source'), 'the record names a source the instance does not have');
  assert.equal(offered.find((s) => s.sourceId === 'data-commons')?.reason, 'not-consented', 'Ask first is recorded not-consented');
  assert.deepEqual(offered.map((s) => s.sourceId), ['socrata', 'data-commons', 'boston-opencontext', 'nyc-charter']);
});

test('criterion 4 (D12): a session carrying a dbId, with no row, is refused consent_required even with an anonymous cookie present', () => {
  assert.equal(refusalOf(DB_NO_ROW)?.code, 'consent_required', `served on the cookie: ${JSON.stringify(DB_NO_ROW.events.slice(0, 2))}`);
  assert.equal(DB_NO_ROW.modelRequests.length, 0);
  assert.deepEqual(DB_NO_ROW.received, []);
});

test('criterion 4 (D12): a signed-in session without a dbId is served on its cookie', () => {
  assert.ok(SIGNED_IN_ON_COOKIE.modelRequests.length > 0, `refused: ${JSON.stringify(SIGNED_IN_ON_COOKIE.events.slice(0, 2))}`);
  assert.ok(!toolNames(SIGNED_IN_ON_COOKIE.modelRequests[0]).some((name) => name.startsWith('data_commons__')), 'the cookie\'s Off did not reach the tools');
  assert.equal(Object.fromEntries(statedOffered(SIGNED_IN_ON_COOKIE).map((s) => [s.sourceId, s.reason]))['data-commons'], 'reader-off');
});

// --- Criterion 4: the record packaged from a consented run (D2 = A) -----------------------------------

test('criterion 4: a record packaged from a consented run carries composition.flowsStatement — the statement\'s url, hash and date', () => {
  const [, d] = SERVED_DC_OFF[0];
  const trace = traceOf(d) as Record<string, unknown>;
  assert.ok(trace, 'premise: the run emitted a trace');
  const { pkg } = buildEvidencePackage({
    trace,
    prompt: QUESTION,
    output: 'The figure could not be retrieved from the sources used for this question.',
    toolCalls: [{ name: DC_TOOL, args: { query: 'median household income', places: ['Bronx County'] }, failed: true, failureKind: 'not_offered' }],
    model: getDefaultModel().id,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'R6 W2 criterion 4',
    summary: 'R6 W2 criterion 4.',
    captureMethod: 'chat-flow-stream',
  });
  const composition = (pkg.extensions as Record<string, Record<string, unknown>> | undefined)?.['org.civicaitools.composition'];
  assert.ok(composition, 'premise: the package carries a composition block');
  assert.deepEqual(composition!.flowsStatement, { url: 'http://localhost/api/flows', hash: d.flowsHash, date: d.flowsDate });
  const reasons = Object.fromEntries((composition!.sourcesOffered as Array<{ sourceId: string; reason: string }>).map((s) => [s.sourceId, s.reason]));
  assert.equal(reasons['data-commons'], 'reader-off', 'the signed reasons are the reader\'s');
});
