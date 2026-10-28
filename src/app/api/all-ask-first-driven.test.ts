// R9 P1a (#681): a question whose every configured source is Ask first runs
// where the site can ask, and is refused `no_sources_on` everywhere else.
//
// THE DEFECT. R6 W3's gate refused every consent whose selection
// (configured ∩ On) was empty, and every route ran the gate before it read
// the routing mode, so under `SOURCE_ROUTING=in-loop` the loop's own handling
// of an all-Ask-first question (the pause, `consent-pause.test.ts`'s
// `ALL_ASK_FIRST`) was never reached from a request.
//
// WHAT IS DRIVEN. The REAL `/api/compare-stream`, `/api/query-notebook`,
// `/api/compare`, `/api/evidence/[slug]/replay` and
// `/api/sources/consent/decision` handlers, the real gate, prompt composer,
// MCP client, loop core, trace builder and packager, as
// `consent-pause-driven.test.ts` drives them. The model is a loopback server
// that loads Boston, uses it if it loaded, then answers; the three sources are
// one loopback MCP server on three paths. STUBS: `next/headers`, `next-auth`
// and `@/lib/auth` (a session per drive: a `dbId` for the row, none for the
// cookie); the consent row store (in memory); `@/lib/sandbox` (the notebook
// runs nowhere); `@vercel/kv` (the fake store, `decision-store-for-tests.ts`);
// and, for replay, `@/lib/db`, `@/lib/storage` and
// `@/lib/evidence/sealed-access` (one public record).
//
// THE CENSUS per drive: every model request, and every request the loopback
// sources receive.
//
// WHAT MAKES IT ABLE TO FAIL. At the base every all-Ask-first drive is
// refused `no_sources_on` before the model is called, whatever the mode and
// the store: the served legs carry no `consent_pause` and the census is zero.
// The refusing legs are each shown served first by a contrast drive that
// differs in the one condition the leg names, so a refusal cannot come from
// a broken drive.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';

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

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const CONSENT_STORE_FILE = path.join(SRC, 'lib', 'sources', 'consent-store.ts');

const QUESTION = 'How many service requests did Boston record in 2025?';
const ANSWER = 'One figure was retrieved.';
const DB_ID = '5ca1ab1e-0000-4000-8000-0000000a11a5';
const SIGNED_IN_ROW = { user: { id: 'gh-fixture-r9-p1a', dbId: DB_ID } };
const SIGNED_IN_COOKIE = { user: { id: 'gh-fixture-r9-p1a-cookie' } };

// --- The outbound recorder: loopback only -------------------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks ----------------------------------------------------------------------

interface Row { userId: string; states: Record<string, { state: string; since: string }>; flowsHash: string; flowsStatement: unknown; consentedAt: Date; updatedAt: Date }
interface Globals {
  __r9p1aRoutes: { session: unknown; rows: Map<string, Row>; record: Json; packages: Record<string, unknown> };
  __w2DecisionKv: FakeDecisionKv;
}
const globals = globalThis as unknown as Globals;
globals.__r9p1aRoutes = { session: SIGNED_IN_ROW, rows: new Map(), record: {}, packages: {} };
const kv = new FakeDecisionKv();
globals.__w2DecisionKv = kv;

const STUB_PREFIX = 'file:///civic-r9-p1a-routes-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const CONSENT_STORE_STUB = `
  const rows = () => globalThis.__r9p1aRoutes.rows;
  export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
  export async function writeConsentRow(userId, row) {
    const prior = rows().get(userId);
    const now = row.now ?? new Date();
    rows().set(userId, { userId, states: row.states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement, consentedAt: prior?.consentedAt ?? now, updatedAt: now });
  }
  export async function deleteConsentRow(userId) { rows().delete(userId); }`;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.81' }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__r9p1aRoutes.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@vercel/kv': FAKE_VERCEL_KV_MODULE,
  '@/lib/sources/consent-store': CONSENT_STORE_STUB,
  '@/lib/sandbox': `
     import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
     export { NotebookExecutionError };
     export async function executeNotebook(notebook) {
       return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
     }`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `export async function getPackage(key) { return globalThis.__r9p1aRoutes.packages[key] ?? null; }`,
  '@/lib/db': `
    export const db = {
      select() {
        const chain = { from: () => chain, where: () => chain, limit: async () => [globalThis.__r9p1aRoutes.record] };
        return chain;
      },
    };`,
};
const stub = (key: string): ResolveResult => ({ url: `${STUB_PREFIX}${encodeURIComponent(key)}.mjs`, format: 'module', shortCircuit: true });

function firstFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) return stub(specifier);
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    let file: string | null = null;
    if (specifier.startsWith('@/')) {
      file = firstFile(path.join(SRC, specifier.slice(2)));
      if (file === null) throw new Error(`R9 P1a test hook: cannot resolve ${specifier}`);
    } else {
      const parent = (context as { parentURL?: string }).parentURL;
      if (specifier.startsWith('.') && parent?.startsWith('file:') && !parent.startsWith(STUB_PREFIX)) {
        file = firstFile(path.resolve(path.dirname(fileURLToPath(parent)), specifier));
      }
    }
    if (file === CONSENT_STORE_FILE) return stub('@/lib/sources/consent-store');
    if (file !== null) return { url: pathToFileURL(file).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// --- The loopback MCP sources ------------------------------------------------------------

const RECEIVED: string[] = [];
const ONE_ROW = JSON.stringify({ data: [{ count: '77' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  RECEIVED.push(`${new URL(req.url ?? '/', 'http://127.0.0.1').pathname} ${msg.method ?? ''}`);
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r9-p1a' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r9-p1a-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// --- The loopback model: load Boston, then use it if it was loaded, then answer ---------

const MODEL_REQUESTS: Json[] = [];
type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
const call = (id: string, name: string, args: Record<string, unknown>): Call => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function turnFor(body: Json): Call[] | null {
  const tools = ((body.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
  if (tools.length === 0) return null;
  const assistantTurns = ((body.messages ?? []) as Array<{ role?: string }>).filter((m) => m.role === 'assistant').length;
  if (assistantTurns === 0 && tools.includes('load_source')) return [call('call-load-boston', 'load_source', { alias: 'boston' })];
  if (assistantTurns === 1 && tools.includes('boston__ckan__query_data')) return [call('call-boston', 'boston__ckan__query_data', { resource_id: 'r-1', limit: 1 })];
  return null;
}

const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
    MODEL_REQUESTS.push(body);
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Json) => `data: ${JSON.stringify({ id: 'chatcmpl-r9-p1a', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = turnFor(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-r9-p1a', object: 'chat.completion', created: 1, model: 'fake/model',
      choices: [{ index: 0, message: { role: 'assistant', content: toolCalls ? null : ANSWER, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
      usage,
    }));
  });
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Environment, before any app module loads -----------------------------------------------

for (const name of [
  'DATA_COMMONS_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'MODEL_API_KEY', 'OPENAI_API_KEY',
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'EXECUTOR_DRIVER', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING',
  'NYS_LEGISLATION_HOSTING', 'SOURCE_ROUTING', 'APP_HOST', 'NEXTAUTH_URL',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
]) delete process.env[name];
process.env.RATE_LIMIT_SECRET = 'fixture';
const KV_URL = 'https://kv.fixture.example';
const KV_TOKEN = 'fixture-kv-token';
process.env.KV_REST_API_URL = KV_URL;
process.env.KV_REST_API_TOKEN = KV_TOKEN;
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.OPENROUTER_API_KEY = 'fixture';
process.env.MODEL_API_BASE_URL = `${MODEL_ORIGIN}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  { id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true, endpointModel: 'example-fixture-deployment', model: 'vendor/model-fixture-1', default: true, evaluator: 1 },
]);
const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';

const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
_resetDefaultModelClientForTests();
const { buildFlowsStatement, statementHash } = (await import('../../lib/flows/statement.ts')) as Mod;
const { CONSENT_COOKIE_NAME, encodeConsentCookie } = (await import('../../lib/sources/consent.ts')) as Mod;
const { friendlyStreamError } = (await import('../../lib/streaming.ts')) as Mod;
const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');
const { RUN_RECORD_ATTRIBUTE } = await import('../../lib/evidence/trace.ts');
const compareStreamRoute = (await import('./compare-stream/route.ts')) as Mod;
const notebookRoute = (await import('./query-notebook/route.ts')) as Mod;
const compareRoute = (await import('./compare/route.ts')) as Mod;
const replayRoute = (await import('./evidence/[slug]/replay/route.ts')) as Mod;
const decisionRoute = (await import('./sources/consent/decision/route.ts')) as Mod;

// The replay route's record: a public package that offered the three sources.
globals.__r9p1aRoutes.packages['pkg/r9-p1a.json'] = {
  prompt: { text: QUESTION },
  cost: { model: 'vendor/model-fixture-1' },
  queries: [],
  dataSources: [],
  extensions: {
    'org.civicaitools.composition': {
      assertedDate: '2026-10-28',
      sourcesOffered: [
        { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
        { sourceId: 'data-commons', alias: 'data_commons', reason: 'selected' },
        { sourceId: 'boston-opencontext', alias: 'boston', reason: 'selected' },
      ],
      components: [],
    },
  },
};
globals.__r9p1aRoutes.record = { id: 'rec-r9-p1a', slug: 'r9-p1a', basePackageStorageKey: 'pkg/r9-p1a.json', visibility: 'public', creatorId: 'fixture-account' };

// --- The consent in force: the row, or the cookie ----------------------------------------

type States = Record<string, 'on' | 'ask-first' | 'off'>;
const ALL_ASK_FIRST: States = { socrata: 'ask-first', 'data-commons': 'ask-first', 'boston-opencontext': 'ask-first' };
const ALL_OFF: States = { socrata: 'off', 'data-commons': 'off', 'boston-opencontext': 'off' };
/** One source On beside an Off and an Ask first: served at the base too, the reasons' reference. */
const ONE_ON: States = { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' };
/** The same Off and Ask first with the On source moved to Ask first: no source On. */
const NONE_ON: States = { socrata: 'ask-first', 'data-commons': 'off', 'boston-opencontext': 'ask-first' };

async function consentFor(store: 'row' | 'cookie', states: States): Promise<string | undefined> {
  const statement = await buildFlowsStatement();
  if (store === 'row') {
    globals.__r9p1aRoutes.session = SIGNED_IN_ROW;
    globals.__r9p1aRoutes.rows.set(DB_ID, {
      userId: DB_ID,
      states: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since: '2026-10-28' }])),
      flowsHash: statementHash(statement),
      flowsStatement: statement,
      consentedAt: new Date('2026-10-28T00:00:00Z'),
      updatedAt: new Date('2026-10-28T00:00:00Z'),
    });
    return undefined;
  }
  globals.__r9p1aRoutes.session = SIGNED_IN_COOKIE;
  globals.__r9p1aRoutes.rows.clear();
  const versionOf = (id: string) => statement.sources.find((s: { sourceId: string }) => s.sourceId === id).version;
  return `${CONSENT_COOKIE_NAME}=${encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since: '2026-10-28', version: versionOf(id) }])),
  })}`;
}

// --- One drive ------------------------------------------------------------------------------

interface Condition {
  store: 'row' | 'cookie';
  states: States;
  /** `SOURCE_ROUTING` for the drive; undefined leaves it unset (all-sources). */
  routing?: 'in-loop';
  /** False unsets the decision store pair for the drive. */
  kv?: boolean;
}

interface Drive {
  status: number;
  contentType: string;
  body: string;
  events: Json[];
  json: Json | null;
  decided: number[];
  modelRequests: number;
  received: string[];
}

function parse(line: string): Json | null {
  if (!line.startsWith('data: ')) return null;
  try { return JSON.parse(line.slice('data: '.length)) as Json; } catch { return null; }
}

async function postDecision(key: string, choice: 'allow' | 'not-now'): Promise<number> {
  const response = (await decisionRoute.POST(new Request('http://localhost/api/sources/consent/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, decision: choice }),
  }))) as Response;
  return response.status;
}

const comparePause = (e: Json) => (e.type === 'progress' && e.phase === 'consent_pause' ? (e.pause as Json) : undefined);
const notebookPause = (e: Json) => (e.type === 'phase_a_progress' && e.phase === 'consent_pause' ? (e.pause as Json) : undefined);
const anyPause = (e: Json) => comparePause(e) ?? notebookPause(e);

/** Read a response to its end; on the first event carrying a pause key, answer Allow. */
async function read(response: Response): Promise<Pick<Drive, 'body' | 'events' | 'json' | 'decided'>> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await response.text();
    let json: Json | null = null;
    try { json = JSON.parse(body) as Json; } catch { json = null; }
    return { body, events: [], json, decided: [] };
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let body = '';
  const events: Json[] = [];
  const decided: number[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    body += text;
    buffered += text;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const event = parse(line);
      if (!event) continue;
      events.push(event);
      const pause = anyPause(event);
      if (pause && typeof pause.key === 'string' && decided.length === 0) decided.push(await postDecision(pause.key, 'allow'));
    }
  }
  return { body, events, json: null, decided };
}

type Handler = (request: Request, ctx?: { params: Promise<{ slug: string }> }) => Promise<Response>;

async function drive(handler: Handler, route: string, body: Json, condition: Condition, slug?: string): Promise<Drive> {
  const cookie = await consentFor(condition.store, condition.states);
  if (condition.routing) process.env.SOURCE_ROUTING = condition.routing;
  else delete process.env.SOURCE_ROUTING;
  if (condition.kv === false) {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
  const modelBefore = MODEL_REQUESTS.length;
  const receivedBefore = RECEIVED.length;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const request = new Request(`http://localhost${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const response = slug ? await handler(request, { params: Promise.resolve({ slug }) }) : await handler(request);
    const read_ = await read(response);
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      ...read_,
      modelRequests: MODEL_REQUESTS.length - modelBefore,
      received: RECEIVED.slice(receivedBefore),
    };
  } finally {
    delete process.env.SOURCE_ROUTING;
    process.env.KV_REST_API_URL = KV_URL;
    process.env.KV_REST_API_TOKEN = KV_TOKEN;
  }
}

const STREAM_BODY = { query: QUESTION, model: 'fixture-fast', portal: 'data.example.org', mcpOnly: true };
const NOTEBOOK_BODY = { query: QUESTION, portal: 'data.example.org' };
const COMPARE_BODY = { query: QUESTION, model: 'fixture-fast', portal: 'data.example.org' };
const REPLAY_BODY = { modelApiKey: 'fixture' };

const compareStream = (condition: Condition) => drive(compareStreamRoute.POST, '/api/compare-stream', STREAM_BODY, condition);
const notebook = (condition: Condition) => drive(notebookRoute.POST, '/api/query-notebook', NOTEBOOK_BODY, condition);
const compareJson = (condition: Condition) => drive(compareRoute.POST, '/api/compare', COMPARE_BODY, condition);
const replay = (condition: Condition) => drive(replayRoute.POST, '/api/evidence/r9-p1a/replay', REPLAY_BODY, condition, 'r9-p1a');

/** The typed refusal, whichever channel the route answers on: a JSON body, or the stream's error events. */
function refusalOf(d: Drive): Json | null {
  if (d.json && d.json.code !== undefined) return d.json;
  return d.events.find((e) => e.type === 'error') ?? null;
}

// --- The drives, in order, before any test ---------------------------------------------------

const IN_LOOP_STORE = { routing: 'in-loop' as const };

const SERVED_ROW = await compareStream({ store: 'row', states: ALL_ASK_FIRST, ...IN_LOOP_STORE });
const SERVED_COOKIE = await compareStream({ store: 'cookie', states: ALL_ASK_FIRST, ...IN_LOOP_STORE });
const NOTEBOOK_SERVED = await notebook({ store: 'row', states: ALL_ASK_FIRST, ...IN_LOOP_STORE });

const REFUSED: Array<[string, Drive]> = [
  ['/api/compare-stream, every source Off, in-loop with the store', await compareStream({ store: 'row', states: ALL_OFF, ...IN_LOOP_STORE })],
  ['/api/compare-stream, every source Ask first, all-sources with the store', await compareStream({ store: 'row', states: ALL_ASK_FIRST })],
  ['/api/compare-stream, every source Ask first, in-loop with the store pair unset', await compareStream({ store: 'row', states: ALL_ASK_FIRST, routing: 'in-loop', kv: false })],
  ['/api/compare-stream (cookie), every source Ask first, in-loop with the store pair unset', await compareStream({ store: 'cookie', states: ALL_ASK_FIRST, routing: 'in-loop', kv: false })],
  ['/api/compare (JSON), every source Ask first, in-loop with the store', await compareJson({ store: 'row', states: ALL_ASK_FIRST, ...IN_LOOP_STORE })],
  ['/api/evidence/[slug]/replay, every source Ask first, in-loop with the store', await replay({ store: 'row', states: ALL_ASK_FIRST, ...IN_LOOP_STORE })],
];

// Contrasts: the JSON route and replay, on the same in-loop instance, served once one source is On.
const COMPARE_ONE_ON = await compareJson({ store: 'row', states: ONE_ON, ...IN_LOOP_STORE });
const REPLAY_ONE_ON = await replay({ store: 'row', states: ONE_ON, ...IN_LOOP_STORE });

// Criterion 4: the same Off and Ask first, with one source On (served at the base) and with none.
const REASONS_ONE_ON = await compareStream({ store: 'row', states: ONE_ON, ...IN_LOOP_STORE });
const REASONS_NONE_ON = await compareStream({ store: 'row', states: NONE_ON, ...IN_LOOP_STORE });

// --- Criterion 1: served where the site can ask -------------------------------------------------

for (const [what, d] of [['row', SERVED_ROW], ['cookie', SERVED_COOKIE]] as Array<[string, Drive]>) {
  test(`R9 P1a criterion 1 (/api/compare-stream, ${what}): in-loop with the store and every source Ask first, the run is served and the loop asks`, () => {
    assert.equal(d.status, 200);
    assert.match(d.contentType, /text\/event-stream/);
    const refusal = refusalOf(d);
    assert.equal(refusal, null, `the route refused: ${JSON.stringify(refusal)}`);
    const pauses = d.events.filter((e) => comparePause(e));
    assert.equal(pauses.length, 1, `the stream carried ${pauses.length} consent_pause events:\n${d.body.slice(0, 800)}`);
    const pause = comparePause(pauses[0])!;
    assert.equal(pause.holds, true, 'the pause did not hold');
    assert.equal((pause.source as Json).sourceId, 'boston-opencontext');
    assert.deepEqual(d.decided, [200], 'the Allow posted with the event\'s key was not answered 200');
    assert.ok(d.modelRequests > 0, 'the model was not called');
    assert.ok(d.events.some((e) => e.type === 'complete' && e.panel === 'withMcp'), 'the run did not complete');
    assert.ok(d.received.some((r) => r.startsWith('/boston/mcp tools/call')), `after Allow the run did not reach the source: ${JSON.stringify(d.received)}`);
  });
}

test('R9 P1a criterion 1 (/api/query-notebook): in-loop with the store and every source Ask first, the run is served and the pause forwarded', () => {
  assert.equal(NOTEBOOK_SERVED.status, 200, NOTEBOOK_SERVED.body.slice(0, 300));
  assert.equal(refusalOf(NOTEBOOK_SERVED), null, `the route refused: ${NOTEBOOK_SERVED.body.slice(0, 300)}`);
  const forwarded = NOTEBOOK_SERVED.events.filter((e) => notebookPause(e));
  assert.equal(forwarded.length, 1, `query-notebook forwarded ${forwarded.length} pause lines:\n${NOTEBOOK_SERVED.body.slice(0, 800)}`);
  assert.equal(notebookPause(forwarded[0])!.holds, true);
  assert.deepEqual(NOTEBOOK_SERVED.decided, [200]);
  assert.ok(NOTEBOOK_SERVED.modelRequests > 0, 'the model was not called');
});

// --- Criterion 1: refused everywhere a run could reach no source ----------------------------------

const NO_SOURCES_ON_TEXT: string = friendlyStreamError({ code: 'no_sources_on' });

for (const [what, d] of REFUSED) {
  test(`R9 P1a criterion 1 (${what}): refused no_sources_on before the model or any source is called`, async () => {
    const refusal = refusalOf(d);
    assert.equal(refusal?.code, 'no_sources_on', `${what} answered ${d.status}: ${d.body.slice(0, 400)}`);
    assert.equal(refusal?.error ?? refusal?.message, NO_SOURCES_ON_TEXT);
    assert.deepEqual(refusal?.reask, { base: false, sources: [] });
    assert.equal(refusal?.flowsVersion, statementHash(await buildFlowsStatement()));
    if (!what.startsWith('/api/compare-stream')) assert.equal(d.status, 403, `${what} refused with ${d.status}`);
    assert.equal(d.modelRequests, 0, `${what} called the model`);
    assert.deepEqual(d.received, [], `${what} reached a data source`);
    assert.equal(d.events.filter((e) => anyPause(e)).length, 0, `${what} paused`);
  });
}

test('R9 P1a criterion 1 (contrast): on the same in-loop instance, the JSON route and replay are served once one source is On', () => {
  assert.equal(COMPARE_ONE_ON.status, 200, COMPARE_ONE_ON.body.slice(0, 300));
  assert.ok(COMPARE_ONE_ON.modelRequests > 0);
  assert.equal(REPLAY_ONE_ON.status, 200, REPLAY_ONE_ON.body.slice(0, 300));
  assert.ok(REPLAY_ONE_ON.modelRequests > 0);
});

// --- Criterion 4: the record's reasons ---------------------------------------------------------

type Span = { name: string; attributes: Array<{ key: string; value: { stringValue?: string } }> };
function traceOf(d: Drive): Json {
  const trace = d.events.find((e) => e.type === 'trace')?.data as Json | undefined;
  assert.ok(trace, `premise: the route emitted no trace:\n${d.body.slice(0, 600)}`);
  return trace!;
}
function toolCallsOf(d: Drive): Json[] {
  const complete = d.events.find((e) => e.type === 'complete' && e.panel === 'withMcp');
  const called = (complete?.data as { tools_called?: unknown[] } | undefined)?.tools_called;
  assert.ok(Array.isArray(called), 'premise: no completed tool calls');
  return called as Json[];
}
function statedOffered(d: Drive): Array<{ sourceId: string; alias: string; reason: string }> {
  const { pkg } = buildEvidencePackage({
    trace: traceOf(d),
    prompt: QUESTION,
    output: ANSWER,
    toolCalls: toolCallsOf(d) as never,
    model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'Service requests',
    summary: 'Service requests.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
  });
  const composition = (pkg.extensions as Record<string, Json> | undefined)?.['org.civicaitools.composition'];
  assert.ok(composition, 'premise: the package carries no composition block');
  const offered = composition!.sourcesOffered as Array<{ sourceId: string; alias: string; reason: string }>;
  const key = RUN_RECORD_ATTRIBUTE.sourcesOffered;
  const root = (traceOf(d) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans
    .find((s) => s.attributes.some((a) => a.key === key));
  assert.ok(root, 'premise: no span states the offered reasons');
  const traced = JSON.parse(root!.attributes.find((a) => a.key === key)!.value.stringValue ?? '[]');
  assert.deepEqual(traced, offered, 'the package states reasons the trace did not');
  return offered;
}

test('R9 P1a criterion 4: the all-Ask-first run\'s record states not-consented for every configured source, each entry byte-identical to the base\'s', () => {
  const oneOn = statedOffered(REASONS_ONE_ON);
  const allAskFirst = statedOffered(SERVED_ROW);
  const byId = (list: typeof oneOn) => Object.fromEntries(list.map((s) => [s.sourceId, s]));
  // The reference, served at the base: Socrata On, Data Commons Off, Boston Ask first.
  assert.deepEqual(
    oneOn.slice(0, 3).map((s) => [s.sourceId, s.reason]),
    [['socrata', 'selected'], ['data-commons', 'reader-off'], ['boston-opencontext', 'not-consented']],
  );
  // Boston is Ask first in both runs: its entry, byte for byte.
  assert.equal(JSON.stringify(byId(allAskFirst)['boston-opencontext']), JSON.stringify(byId(oneOn)['boston-opencontext']));
  for (const id of ['socrata', 'data-commons', 'boston-opencontext']) {
    assert.equal(byId(allAskFirst)[id].reason, 'not-consented', `${id}, Ask first, is recorded ${byId(allAskFirst)[id].reason}`);
  }
  // The sources this instance does not configure: unchanged by the states.
  assert.equal(JSON.stringify(allAskFirst.slice(3)), JSON.stringify(oneOn.slice(3)));
});

test('R9 P1a criterion 4: with no source On, the Off source is recorded reader-off and the Ask-first ones not-consented, each entry byte-identical to the base\'s', () => {
  const oneOn = statedOffered(REASONS_ONE_ON);
  const noneOn = statedOffered(REASONS_NONE_ON);
  assert.equal(refusalOf(REASONS_NONE_ON), null, 'premise: the run with no source On was refused');
  const byId = (list: typeof oneOn) => Object.fromEntries(list.map((s) => [s.sourceId, JSON.stringify(s)]));
  // Data Commons Off and Boston Ask first in both runs: their entries, byte for byte.
  assert.equal(byId(noneOn)['data-commons'], byId(oneOn)['data-commons']);
  assert.equal(byId(noneOn)['boston-opencontext'], byId(oneOn)['boston-opencontext']);
  assert.equal(JSON.parse(byId(noneOn).socrata).reason, 'not-consented');
  assert.deepEqual(noneOn.map((s) => s.sourceId), oneOn.map((s) => s.sourceId));
});
