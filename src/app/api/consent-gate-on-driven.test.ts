// R6 W3 (#632), criteria 6, 9 and 10: the consent gate switched ON, driven
// through the four gated routes with the switch AS SHIPPED.
//
// W2 shipped the gate dormant (`CONSENT_GATE_ENFORCED = false`); W3 turns it
// on in the same change as the card (criterion 6). From then on:
//   - a request with no consent is refused `consent_required` before anything
//     is sent (criterion 6, the routes' half; the pin is
//     `src/lib/sources/consent-enforced.test.ts`);
//   - a consent in force whose selection is empty — every configured source
//     Off or Ask first — is refused `no_sources_on` before the model or any
//     source is called, so the prompt composed over an empty selection is
//     never sent (criterion 9; #644 comment 6274954918, 5(b));
//   - a record packaged through the real packager from a consented run states
//     each source's reason from the reader's state — `selected` for On,
//     `reader-off` for Off, `not-consented` for Ask first — and carries
//     `composition.flowsStatement` (criterion 10). On new records `configured`
//     becomes `selected`: a signed-byte move the gate record names.
//
// WHAT IS DRIVEN. The harness of `consent-gate-driven.test.ts`, unchanged
// except that `@/lib/sources/consent-enforced` is NOT stubbed: each route's
// real handler and stream, the real model loop against the scripted model
// endpoint, the real MCP client against loopback fixtures for Socrata, Data
// Commons and Boston, the real consent module and flows statement. THE CENSUS:
// every `fetch` this process makes, every request a loopback server receives,
// and every model request, per drive.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the switch is off: every drive is
// served, the census is not zero, nothing is refused, and the record states
// the router's `configured` with no flows statement.
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
const globals = globalThis as unknown as { __r6w3GateOn: Gate };
globals.__r6w3GateOn = { session: null, rows: new Map(), checks: 0, increments: 0, record: null, packages: {} };

const STUB_PREFIX = 'file:///r6-w3-gate-on-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.21' }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__r6w3GateOn.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { globalThis.__r6w3GateOn.checks += 1; return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() { globalThis.__r6w3GateOn.increments += 1; }
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook(notebook) {
      return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
  '@/lib/sources/consent-store': `
    const rows = () => globalThis.__r6w3GateOn.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) { rows().set(userId, { userId, ...row, consentedAt: new Date(), updatedAt: new Date() }); }
    export async function deleteConsentRow(userId) { rows().delete(userId); }`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `export async function getPackage(key) { return globalThis.__r6w3GateOn.packages[key] ?? null; }`,
  '@/lib/db': `
    export const db = {
      select() {
        const chain = { from: () => chain, where: () => chain, limit: async () => (globalThis.__r6w3GateOn.record ? [globalThis.__r6w3GateOn.record] : []) };
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
      throw new Error(`r6-w3 gate-on test hook: cannot resolve ${specifier}`);
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
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'r6-w3-gate-on-fixture', version: '0' }, ...instructions } }));
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
// Boston at the same loopback, so a third source can be Ask first (criterion 10).
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;

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
  globals.__r6w3GateOn.session = options.session;
  globals.__r6w3GateOn.checks = 0;
  globals.__r6w3GateOn.increments = 0;
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
      checks: globals.__r6w3GateOn.checks,
      increments: globals.__r6w3GateOn.increments,
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
globals.__r6w3GateOn.packages['pkg/gate.json'] = REPLAY_PACKAGE;
globals.__r6w3GateOn.record = { id: 'rec-gate', slug: 'gate', basePackageStorageKey: 'pkg/gate.json', visibility: 'public', creatorId: 'fixture-account' };

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

const ALL_OFF = cookieFor({ socrata: 'off', 'data-commons': 'off', 'boston-opencontext': 'off' });
const ALL_HELD = cookieFor({ socrata: 'ask-first', 'data-commons': 'off', 'boston-opencontext': 'ask-first' });
const MIXED = cookieFor({ socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' });

const NO_CONSENT: Array<[string, Drive]> = [
  ['/api/compare-stream', await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: ANON })],
  ['/api/query-notebook', await drive(notebook.POST, NOTEBOOK_URL, NOTEBOOK_BODY, { session: ANON })],
  ['/api/compare', await drive(compare.POST, COMPARE_URL, COMPARE_BODY, { session: ANON, replies: ANSWER_ONLY })],
  ['/api/evidence/[slug]/replay', await drive(replayRoute.POST, REPLAY_URL, REPLAY_BODY, { session: SIGNED_IN_NO_DB, replies: ANSWER_ONLY, slug: 'gate' })],
];

const NONE_ON: Array<[string, Drive]> = [
  ['/api/compare-stream', await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: ANON, cookie: ALL_OFF })],
  ['/api/query-notebook', await drive(notebook.POST, NOTEBOOK_URL, NOTEBOOK_BODY, { session: ANON, cookie: ALL_OFF })],
  ['/api/compare', await drive(compare.POST, COMPARE_URL, COMPARE_BODY, { session: ANON, cookie: ALL_OFF, replies: ANSWER_ONLY })],
  ['/api/evidence/[slug]/replay', await drive(replayRoute.POST, REPLAY_URL, REPLAY_BODY, { session: SIGNED_IN_NO_DB, cookie: ALL_OFF, replies: ANSWER_ONLY, slug: 'gate' })],
  ['/api/compare-stream (Off and Ask first)', await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: ANON, cookie: ALL_HELD })],
];

const CONSENTED = await drive(compareStream.POST, STREAM_URL, STREAM_BODY, { session: ANON, cookie: MIXED });

// --- Criterion 6: the switch is on, as shipped --------------------------------------------

for (const [route, d] of NO_CONSENT) {
  test(`criterion 6 (${route}): with the gate on as shipped, a request with no consent is refused consent_required and sends nothing`, () => {
    assert.equal(d.modelRequests.length, 0, `${route} called the model with no consent in force (${d.modelRequests.length} requests)`);
    assert.deepEqual(d.received, [], `${route} reached a data source with no consent in force`);
    assert.deepEqual(d.fetched, [], `${route} made outbound requests with no consent in force`);
    assert.equal(refusalOf(d)?.code, 'consent_required', `${route} answered ${d.status}: ${JSON.stringify(d.json ?? d.events.slice(0, 2)).slice(0, 300)}`);
  });
}

// --- Criterion 9: no source On -----------------------------------------------------------------

for (const [route, d] of NONE_ON) {
  test(`criterion 9 (${route}): a consent with no source On is refused no_sources_on before the model or any source is called`, () => {
    assert.equal(d.modelRequests.length, 0, `${route} called the model with no source On (${d.modelRequests.length} requests)`);
    assert.deepEqual(d.received, [], `${route} reached a data source with no source On`);
    assert.deepEqual(d.fetched, [], `${route} made outbound requests with no source On`);
    assert.equal(refusalOf(d)?.code, 'no_sources_on', `${route} answered ${d.status}: ${JSON.stringify(d.json ?? d.events.slice(0, 2)).slice(0, 300)}`);
    if (!route.startsWith('/api/compare-stream')) assert.equal(d.status, 403, `${route} refused with ${d.status}`);
  });
}

test('criterion 9: the refusal has its own kind, whose reader text points to the panel', async () => {
  const streaming = (await import('@/lib/streaming')) as Mod;
  const kinds = streaming.STREAM_ERROR_KINDS as readonly string[];
  assert.ok(kinds.includes('no_sources_on'), 'no_sources_on is not a stream error kind');
  const text: string = streaming.friendlyStreamError({ code: 'no_sources_on' });
  assert.notEqual(text, streaming.friendlyStreamError({ code: 'generic' }), 'no_sources_on reads as the generic failure');
  assert.match(text, /beside the question box|panel/i, `the reader text does not point to the panel: ${text}`);
  const [, d] = NONE_ON[0];
  const refusal = refusalOf(d) as { message?: unknown } | null;
  assert.equal(refusal?.message, text, 'the stream refusal does not carry the kind\'s reader text');
});

// Green at the base too, where the dormant gate composes over every source; it
// goes red only on a tree that switched the gate on and lets an empty
// selection through to the model, which is the case criterion 9 closes.
test('criterion 9: the prompt composed over an empty selection is never sent', async () => {
  const skill = (await import('@/lib/mcp/socrata-skill')) as Mod;
  const registry = (await import('@/lib/mcp/registry')) as Mod;
  const composed = await skill.composeSystemPrompt({ portal: '', configured: registry.readMcpEnvFromProcess(), selection: [] });
  assert.ok(typeof composed.prompt === 'string' && composed.prompt.length > 0, 'premise: a prompt is composed over an empty selection');
  for (const [route, d] of NONE_ON) {
    for (const request of d.modelRequests) {
      assert.notEqual(systemOf(request), composed.prompt, `${route} sent the prompt composed over an empty selection (${composed.prompt.length} characters)`);
    }
  }
});

// --- Criterion 10: the record's reasons once the gate is on --------------------------------------

test('criterion 10: a record packaged from a consented run states selected, reader-off and not-consented, with composition.flowsStatement', () => {
  assert.ok(CONSENTED.modelRequests.length > 0, `the consented run was not served: ${JSON.stringify(CONSENTED.events.slice(0, 2)).slice(0, 300)}`);
  const trace = traceOf(CONSENTED) as Record<string, unknown>;
  assert.ok(trace, 'premise: the run emitted a trace');
  const { pkg } = buildEvidencePackage({
    trace,
    prompt: QUESTION,
    output: 'The figure could not be retrieved from the sources used for this question.',
    toolCalls: [{ name: DC_TOOL, args: { query: 'median household income', places: ['Bronx County'] }, failed: true, failureKind: 'not_offered' }],
    model: getDefaultModel().id,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'R6 W3 criterion 10',
    summary: 'R6 W3 criterion 10.',
    captureMethod: 'chat-flow-stream',
  });
  const composition = (pkg.extensions as Record<string, Record<string, unknown>> | undefined)?.['org.civicaitools.composition'];
  assert.ok(composition, 'premise: the package carries a composition block');
  const reasons = Object.fromEntries((composition!.sourcesOffered as Array<{ sourceId: string; reason: string }>).map((s) => [s.sourceId, s.reason]));
  const traced = JSON.parse(attr(rootOf(CONSENTED), RUN_RECORD_ATTRIBUTE.sourcesOffered)?.stringValue ?? '[]') as Array<{ sourceId: string; reason: string }>;
  assert.deepEqual(Object.fromEntries(traced.map((s) => [s.sourceId, s.reason])), reasons, 'the package states reasons the run\'s trace did not');
  assert.deepEqual(
    { socrata: reasons.socrata, 'data-commons': reasons['data-commons'], 'boston-opencontext': reasons['boston-opencontext'] },
    { socrata: 'selected', 'data-commons': 'reader-off', 'boston-opencontext': 'not-consented' },
    'the signed reasons are not the reader\'s states',
  );
  assert.deepEqual(composition!.flowsStatement, { url: 'http://localhost/api/flows', hash: CONSENTED.flowsHash, date: CONSENTED.flowsDate });
});
