// #644 W2 — the pause at the routes: who may hold, what the wire carries, and
// what the record does not.
//
// WHAT IS DRIVEN. The REAL `/api/compare-stream`, `/api/query-notebook`,
// `/api/compare` and `/api/sources/consent/decision` handlers, the real
// prompt composer, MCP client, loop core, trace builder and packager, as
// `in-loop-routing-driven.test.ts` drives them, with `SOURCE_ROUTING=in-loop`.
// The model is a loopback server; the three sources are one loopback MCP
// server on three paths. STUBS: `next/headers`, `next-auth` and `@/lib/auth`
// (a signed-in session with a `dbId`, so the consent is the row); the consent
// row store (in memory, by specifier and by its resolved path, since
// `decision.ts` imports it relatively); `@/lib/sandbox` (the notebook runs
// nowhere); `@vercel/kv` (the fake store of `decision-store-for-tests.ts`,
// which the rate limiter and the pause both reach, so no request leaves).
//
// Criterion 1, its two route legs: the JSON compare route records `declined`
// with no event and no hold; replay passes no hold, and a replayed load emits
// no `consent_pause`.
//
// The wire (step 3): `compare-stream` carries `consent_pause` as a progress
// event with no iteration and the pause's fields; `query-notebook` forwards
// it as a `phase_a_progress` line with the same fields. A decision posted to
// the decision route with the event's key ends the hold within one poll.
//
// Criterion 7, the byte census, on a held run decided Allow, driven and
// packaged: its trace and its package contain none of the key, the raw
// `dbId`, its reader code, or the decision token as stored; the token is
// matched against an unheld control run, because a bare "allow" can appear
// in model text. The load span carries the base's five attributes. The census
// is shown catching a planted key in the trace and the package first.
//
// R9 P1 (#669 D2, the seat's note 1): the wire's pause also carries
// `entryExpiresAt`, and the census above is re-run over a payload that has it.
// (#668, note 3), measured first and then built: a reader who drops the
// stream mid-hold (the request's signal aborted, or the response body
// cancelled, each on its own) ends the hold `no-answer` at the next poll; an
// Allow posted afterwards finds the entry (200, left for the reader's card)
// and the run does not go on to the source.
//
// No live endpoint, no credential: every key is a placeholder and every
// address is loopback.
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
const DB_ID = '5ca1ab1e-0000-4000-8000-00000000f00d';

// --- The outbound recorder: loopback only -------------------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks ----------------------------------------------------------------------

interface Row { userId: string; states: Record<string, { state: string; since: string }>; flowsHash: string; flowsStatement: unknown; consentedAt: Date; updatedAt: Date }
interface Globals { __w2Routes: { session: unknown; rows: Map<string, Row> }; __w2DecisionKv: FakeDecisionKv }
const globals = globalThis as unknown as Globals;
globals.__w2Routes = { session: { user: { id: 'gh-fixture-w2', dbId: DB_ID } }, rows: new Map() };
const kv = new FakeDecisionKv();
globals.__w2DecisionKv = kv;

const STUB_PREFIX = 'file:///civic-r8-w2-routes-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const CONSENT_STORE_STUB = `
  const rows = () => globalThis.__w2Routes.rows;
  export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
  export async function writeConsentRow(userId, row) {
    const prior = rows().get(userId);
    const now = row.now ?? new Date();
    rows().set(userId, { userId, states: row.states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement, consentedAt: prior?.consentedAt ?? now, updatedAt: now });
  }
  export async function deleteConsentRow(userId) { rows().delete(userId); }`;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.77' }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__w2Routes.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@vercel/kv': FAKE_VERCEL_KV_MODULE,
  '@/lib/sources/consent-store': CONSENT_STORE_STUB,
  '@/lib/sandbox': `
     import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
     export { NotebookExecutionError };
     export async function executeNotebook(notebook) {
       return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
     }`,
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
      if (file === null) throw new Error(`R8 W2 test hook: cannot resolve ${specifier}`);
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

const ONE_ROW = JSON.stringify({ data: [{ count: '77' }], total_rows: 1 });
/** Every request the sources were sent, as `<path> <method>` (R9 P1's dropped-stream legs count them). */
const MCP_CALLS: string[] = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  MCP_CALLS.push(`${req.url ?? ''} ${msg.method ?? ''}`);
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r8-w2' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r8-w2-fixture', version: '0' } } }));
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

type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
const call = (id: string, name: string, args: Record<string, unknown>): Call => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function turnFor(body: Json): Call[] | null {
  const tools = ((body.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
  if (tools.length === 0) return null;
  const assistantTurns = ((body.messages ?? []) as Array<{ role?: string }>).filter((m) => m.role === 'assistant').length;
  if (assistantTurns === 0) return [call('call-load-boston', 'load_source', { alias: 'boston' })];
  if (assistantTurns === 1 && tools.includes('boston__ckan__query_data')) return [call('call-boston', 'boston__ckan__query_data', { resource_id: 'r-1', limit: 1 })];
  return null;
}

/** How many requests the model endpoint was sent. */
let MODEL_REQUESTS = 0;
const model = http.createServer((req, res) => {
  MODEL_REQUESTS += 1;
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Json) => `data: ${JSON.stringify({ id: 'chatcmpl-r8-w2', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = turnFor(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-r8-w2', object: 'chat.completion', created: 1, model: 'fake/model',
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
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'EXECUTOR_DRIVER', 'NYC_CHARTER_HOSTING', 'SOURCE_ROUTING', 'APP_HOST', 'NEXTAUTH_URL',
]) delete process.env[name];
process.env.RATE_LIMIT_SECRET = 'fixture-w2-secret';
process.env.KV_REST_API_URL = 'https://kv.fixture.example';
process.env.KV_REST_API_TOKEN = 'fixture-kv-token';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-r8-w2';
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
const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');
const compareStreamRoute = (await import('./compare-stream/route.ts')) as Mod;
const notebookRoute = (await import('./query-notebook/route.ts')) as Mod;
const compareRoute = (await import('./compare/route.ts')) as Mod;
const { replayLoopOptionsForPackage } = await import('../../lib/model-loop/replay-loop.ts');
const { runToolLoop } = await import('../../lib/model-loop/run-tool-loop.ts');
const { createModelClient } = await import('../../lib/model-client.ts');

/** What W2 adds (specifiers typed `string`, so the red commit type-checks). */
const DECISION_ROUTE: string = pathToFileURL(path.join(HERE, 'sources', 'consent', 'decision', 'route.ts')).href;
const DECISION: string = pathToFileURL(path.join(SRC, 'lib', 'sources', 'decision.ts')).href;
const decisionRoute = (await import(DECISION_ROUTE).catch(() => null)) as Mod | null;
const decision = (await import(DECISION).catch(() => null)) as Mod | null;

// --- The consent in force: the row ------------------------------------------------------

async function setRow(states: Record<string, string>): Promise<void> {
  const statement = await buildFlowsStatement();
  globals.__w2Routes.rows.set(DB_ID, {
    userId: DB_ID,
    states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: states[s.sourceId] ?? 'on', since: '2026-10-21' }])),
    flowsHash: statementHash(statement),
    flowsStatement: statement,
    consentedAt: new Date('2026-10-21T00:00:00Z'),
    updatedAt: new Date('2026-10-21T00:00:00Z'),
  });
}
const BOSTON_ASK_FIRST = { 'boston-opencontext': 'ask-first' };

// --- Driving a streaming route, answering the pause as it arrives --------------------------

interface Drive { events: Json[]; body: string; decided: number[] }

function parse(line: string): Json | null {
  if (!line.startsWith('data: ')) return null;
  try { return JSON.parse(line.slice('data: '.length)) as Json; } catch { return null; }
}

async function postDecision(key: string, choice: 'allow' | 'not-now'): Promise<number> {
  assert.ok(decisionRoute, 'src/app/api/sources/consent/decision/route.ts does not exist');
  const response = await decisionRoute!.POST(new Request('http://localhost/api/sources/consent/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, decision: choice }),
  }));
  return response.status;
}

/** Read a stream to its end; on the first event that carries a pause key, decide. */
async function readAnswering(response: Response, choice: 'allow' | 'not-now' | null, pauseOf: (e: Json) => Json | undefined): Promise<Drive> {
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
      const pause = pauseOf(event);
      if (pause && choice && typeof pause.key === 'string' && decided.length === 0) decided.push(await postDecision(pause.key, choice));
    }
  }
  return { events, body, decided };
}

const streamBody = { query: QUESTION, model: 'fixture-fast', portal: 'data.example.org', mcpOnly: true };
const request = (route: string, body: unknown) => new Request(`http://localhost${route}`, { method: 'POST', body: JSON.stringify(body) }) as never;
const comparePause = (e: Json) => (e.type === 'progress' && e.phase === 'consent_pause' ? (e.pause as Json) : undefined);
const notebookPause = (e: Json) => (e.type === 'phase_a_progress' && e.phase === 'consent_pause' ? (e.pause as Json) : undefined);

async function driveCompareStream(states: Record<string, string>, choice: 'allow' | 'not-now' | null): Promise<Drive> {
  await setRow(states);
  process.env.SOURCE_ROUTING = 'in-loop';
  try {
    const response = (await compareStreamRoute.POST(request('/api/compare-stream', streamBody))) as Response;
    return await readAnswering(response, choice, comparePause);
  } finally {
    delete process.env.SOURCE_ROUTING;
  }
}

const HELD = await driveCompareStream(BOSTON_ASK_FIRST, 'allow');
const CONTROL = await driveCompareStream({}, null);

// --- Readers -------------------------------------------------------------------------------

type Span = { name: string; parentSpanId?: string; attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }> };
function traceOf(d: Drive): Json {
  const trace = (d.events.find((e) => e.type === 'trace')?.data ?? d.events.find((e) => e.type === 'publish_inputs')?.trace) as Json | undefined;
  assert.ok(trace, `premise — the route emitted no trace:\n${d.body.slice(0, 600)}`);
  return trace!;
}
function spans(trace: Json): Span[] {
  return (trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
}
function loadSpanAttributes(trace: Json): Array<Record<string, unknown>> {
  return spans(trace).filter((s) => s.name === 'mcp_tool_call')
    .map((s) => Object.fromEntries(s.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.boolValue])))
    .filter((a) => a['tool.operation_type'] === 'load_source');
}
function toolCallsOf(d: Drive): Array<Json> {
  const complete = d.events.find((e) => e.type === 'complete' && e.panel === 'withMcp');
  const called = (complete?.data as { tools_called?: unknown[] } | undefined)?.tools_called;
  assert.ok(Array.isArray(called), 'premise — no completed tool calls');
  return called as Json[];
}
function packageOf(d: Drive) {
  return buildEvidencePackage({
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
}

/** Every census value found in `text`, by name. */
function censusHits(text: string, values: Record<string, string>): string[] {
  return Object.entries(values).filter(([, value]) => value.length > 0 && text.includes(value)).map(([name]) => name);
}
const count = (text: string, needle: string) => text.split(needle).length - 1;

// --- The wire ------------------------------------------------------------------------------

test('step 3: compare-stream carries consent_pause as a progress event with no iteration and the pause\'s fields', () => {
  const pauses = HELD.events.filter((e) => comparePause(e));
  assert.equal(pauses.length, 1, `the stream carried ${pauses.length} pause events:\n${HELD.body.slice(0, 800)}`);
  const event = pauses[0];
  assert.equal(event.panel, 'withMcp');
  assert.equal(Object.hasOwn(event, 'iteration'), false);
  const pause = event.pause as Json;
  assert.equal(pause.holds, true);
  assert.match(String(pause.key), /^[0-9a-f]{32}$/);
  assert.equal((pause.source as Json).sourceId, 'boston-opencontext');
  assert.ok(typeof event.message === 'string' && (event.message as string).length > 0, 'the pause event carries no reader line');
  assert.ok(!String(event.message).includes(String(pause.key)), 'the reader line carries the key');
  assert.equal(Object.hasOwn(event, 'args'), false, 'the pause event carries args');
  // R9 P1 (note 1): the entry's end, from the hold's own start: the hold's end plus the difference of the two bounds.
  assert.equal(typeof pause.entryExpiresAt, 'string', 'the pause event carries no entryExpiresAt');
  assert.equal(Date.parse(String(pause.entryExpiresAt)) - Date.parse(String(pause.expiresAt)), 540_000, `expiresAt ${String(pause.expiresAt)}, entryExpiresAt ${String(pause.entryExpiresAt)}`);
});

test('step 2: the decision posted with the event\'s key is answered 200, and the load records loaded', () => {
  assert.deepEqual(HELD.decided, [200]);
  assert.deepEqual(loadSpanAttributes(traceOf(HELD)).map((a) => a['tool.load_outcome']), ['loaded']);
  assert.ok(toolCallsOf(HELD).some((c) => c.name === 'boston__ckan__query_data'), 'after Allow the run did not use the source');
  // Allow moved the source to On in the row the gate reads.
  assert.equal(globals.__w2Routes.rows.get(DB_ID)?.states['boston-opencontext'].state, 'on', 'Allow did not move the source to On');
});

test('the control run holds nothing: no pause event and no entry', () => {
  assert.equal(CONTROL.events.filter((e) => comparePause(e)).length, 0);
  assert.deepEqual(loadSpanAttributes(traceOf(CONTROL)).map((a) => a['tool.load_outcome']), ['loaded']);
});

// --- Criterion 7: the census -------------------------------------------------------------

function heldCensus(): Record<string, string> {
  assert.ok(decision, 'src/lib/sources/decision.ts does not exist');
  const pause = HELD.events.map(comparePause).find(Boolean) as Json | undefined;
  assert.ok(pause, 'premise — the held run carried no pause');
  const key = String(pause!.key);
  const stored = kv.entries.get(`${decision!.DECISION_KEY_PREFIX}${key}`);
  assert.ok(stored, 'premise — the store holds no entry for the key');
  const token = '"decision":"allow"';
  assert.ok(stored!.value.includes(token), `premise — the stored entry does not hold the token as matched: ${stored!.value}`);
  return { key, dbId: DB_ID, readerCode: decision!.readerCode(DB_ID, 'fixture-w2-secret'), storedEntry: stored!.value };
}

test('criterion 7: the census catches a key planted in the trace and in the package', () => {
  const values = heldCensus();
  const trace = traceOf(HELD);
  const planted = JSON.parse(JSON.stringify(trace)) as Json;
  spans(planted)[0].attributes.push({ key: 'planted', value: { stringValue: values.key } });
  assert.deepEqual(censusHits(JSON.stringify(planted), values), ['key']);
  const pkg = packageOf(HELD).pkg as unknown as Json;
  assert.deepEqual(censusHits(JSON.stringify({ ...pkg, planted: `x${values.readerCode}x` }), values), ['readerCode']);
});

test('criterion 7: the held run\'s trace and package contain none of the key, the dbId, its reader code or the stored entry', () => {
  const values = heldCensus();
  assert.deepEqual(censusHits(JSON.stringify(traceOf(HELD)), values), [], 'the trace');
  assert.deepEqual(censusHits(JSON.stringify(packageOf(HELD).pkg), values), [], 'the package');
});

test('criterion 7: the decision token, matched as stored, appears in the held run no more than in the unheld control', () => {
  heldCensus();
  const token = '"decision":"allow"';
  for (const [what, held, control] of [
    ['trace', JSON.stringify(traceOf(HELD)), JSON.stringify(traceOf(CONTROL))],
    ['package', JSON.stringify(packageOf(HELD).pkg), JSON.stringify(packageOf(CONTROL).pkg)],
  ] as const) {
    assert.equal(count(held, token), count(control, token), `the ${what} carries the stored token`);
    assert.equal(count(held, token), 0, `the ${what} carries the stored token`);
  }
});

test('criterion 7: the held load span carries no attribute beyond the base\'s five', () => {
  const [span] = loadSpanAttributes(traceOf(HELD));
  assert.deepEqual(Object.keys(span).sort(), ['tool.arguments', 'tool.duration_ms', 'tool.load_outcome', 'tool.name', 'tool.operation_type']);
});

// --- query-notebook forwards the pause ----------------------------------------------------

test('step 3: query-notebook forwards consent_pause as a phase_a_progress line with the pause\'s fields; Not now records declined', async () => {
  await setRow(BOSTON_ASK_FIRST);
  process.env.SOURCE_ROUTING = 'in-loop';
  let drive: Drive;
  try {
    const response = (await notebookRoute.POST(request('/api/query-notebook', { query: QUESTION, portal: 'data.example.org' }))) as Response;
    drive = await readAnswering(response, 'not-now', notebookPause);
  } finally {
    delete process.env.SOURCE_ROUTING;
  }
  const forwarded = drive.events.filter((e) => notebookPause(e));
  assert.equal(forwarded.length, 1, `query-notebook forwarded ${forwarded.length} pause lines:\n${drive.body.slice(0, 800)}`);
  const pause = forwarded[0].pause as Json;
  assert.equal(pause.holds, true);
  assert.equal((pause.source as Json).sourceId, 'boston-opencontext');
  assert.equal(Object.hasOwn(forwarded[0], 'iteration'), false);
  assert.deepEqual(drive.decided, [200]);
  const trace = traceOf(drive);
  assert.deepEqual(loadSpanAttributes(trace).map((a) => a['tool.load_outcome']), ['declined']);
  assert.ok(!JSON.stringify(trace).includes(String(pause.key)), 'the key reached the notebook run\'s trace');
});

// --- Criterion 1: who may not hold ----------------------------------------------------------

test('criterion 1: the JSON compare route records declined with no event and no hold', async () => {
  await setRow(BOSTON_ASK_FIRST);
  kv.calls.length = 0;
  process.env.SOURCE_ROUTING = 'in-loop';
  const started = Date.now();
  let body: Json;
  try {
    const response = (await compareRoute.POST(request('/api/compare', { query: QUESTION, model: 'fixture-fast', portal: 'data.example.org' }))) as Response;
    body = (await response.json()) as Json;
  } finally {
    delete process.env.SOURCE_ROUTING;
  }
  const elapsed = Date.now() - started;
  const calls = JSON.stringify(body);
  assert.match(calls, /"loadOutcome":"declined"/, `the compare route did not record declined: ${calls.slice(0, 600)}`);
  assert.ok(!calls.includes('consent_pause'));
  assert.deepEqual(kv.calls.filter((c) => c.key.startsWith('consent-decision:')), [], 'the compare route wrote or polled a decision entry');
  assert.ok(elapsed < 5_000, `the compare route held for ${elapsed} ms`);
});

test('criterion 1: replay passes no hold, and a replayed load emits no consent_pause', async () => {
  kv.calls.length = 0;
  const pkg = {
    prompt: { text: QUESTION },
    queries: [],
    dataSources: [],
    extensions: {
      'org.civicaitools.composition': {
        assertedDate: '2026-10-21',
        sourcesOffered: [
          { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
          { sourceId: 'data-commons', alias: 'data_commons', reason: 'selected' },
          { sourceId: 'boston-opencontext', alias: 'boston', reason: 'selected' },
        ],
        components: [{ id: '@typedstandards/civic-typed-router', version: '0.6.0' }],
        routing: { method: 'in-loop', version: '0.6.0' },
        definitionHash: '0'.repeat(64),
      },
    },
  };
  const options = await replayLoopOptionsForPackage({
    pkg: pkg as never,
    client: createModelClient({ apiKey: 'placeholder-model-key-r8-w2' }),
    endpointModel: 'example-fixture-deployment',
    requestSettings: undefined,
    prompt: QUESTION,
  });
  assert.ok(options.loadStep, 'premise — an in-loop record replays with the load step');
  const events: Json[] = [];
  const result = await runToolLoop({ ...options, onEvent: (event) => events.push(event as unknown as Json) });
  assert.deepEqual(events.filter((e) => e.type === 'consent_pause'), []);
  assert.deepEqual(result.toolCalls.filter((c) => c.operationType === 'load_source').map((c) => c.loadOutcome), ['loaded']);
  assert.deepEqual(kv.calls.filter((c) => c.key.startsWith('consent-decision:')), []);
});

// --- R9 P1 (#668, note 3): the reader drops the stream mid-hold ------------------------------

interface Dropped { key: string; readsAtDrop: number; readsAfter: number; allowStatus: number; bostonCalls: number; rest: Drive | null }

/**
 * Start a held run, read to its pause, then drop the stream the way `how`
 * says: `signal` aborts the request's signal and goes on reading the body
 * (so the run's trace can be read to its end), `cancel` cancels the body and
 * aborts nothing. Waits, counts the hold's reads of the store, posts Allow
 * with the pause's key, waits again, and counts the calls to Boston.
 */
async function dropMidHold(route: 'compare-stream' | 'query-notebook', how: 'signal' | 'cancel'): Promise<Dropped> {
  await setRow(BOSTON_ASK_FIRST);
  const controller = new AbortController();
  process.env.SOURCE_ROUTING = 'in-loop';
  let response: Response;
  try {
    const body = route === 'compare-stream' ? streamBody : { query: QUESTION, portal: 'data.example.org' };
    const req = new Request(`http://localhost/api/${route}`, { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
    response = (await (route === 'compare-stream' ? compareStreamRoute : notebookRoute).POST(req as never)) as Response;
  } finally {
    delete process.env.SOURCE_ROUTING;
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let key: string | null = null;
  while (key === null) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    key = /"key":"([0-9a-f]{32})"/.exec(text)?.[1] ?? null;
  }
  assert.ok(key, `premise: the run did not pause:\n${text.slice(0, 600)}`);
  const name = `consent-decision:${key}`;
  const reads = () => kv.calls.filter((c) => c.op === 'get' && c.key === name).length;
  const bostonBefore = MCP_CALLS.filter((c) => c.startsWith('/boston/mcp tools/call')).length;
  // Let the hold poll first, so a hold that never polled could not pass.
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  assert.ok(reads() >= 1, 'premise: the hold never read the store');
  if (how === 'signal') controller.abort();
  else await reader.cancel();
  // One poll may already be in flight when the stream goes.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const readsAtDrop = reads();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const readsAfter = reads();
  const allowStatus = await postDecision(key!, 'allow');
  // Read what is left of the stream (the signal leg's body was never cancelled), or wait as long.
  let rest: Drive | null = null;
  if (how === 'signal') {
    const tail = await readAnswering(new Response(new ReadableStream({ async pull(c) { const { value, done } = await reader.read(); if (done) c.close(); else c.enqueue(value); } })), null, () => undefined);
    rest = { events: tail.events, body: text + tail.body, decided: [] };
  } else {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  const bostonCalls = MCP_CALLS.filter((c) => c.startsWith('/boston/mcp tools/call')).length - bostonBefore;
  return { key: key!, readsAtDrop, readsAfter, allowStatus, bostonCalls, rest };
}

for (const how of ['signal', 'cancel'] as const) {
  test(`R9 P1 (#668): compare-stream, the stream dropped mid-hold (${how === 'signal' ? 'the request\'s signal aborted' : 'the response body cancelled'}): the hold stops polling, and an Allow posted afterwards is saved but the run does not go on to the source`, async () => {
    const modelBefore = MODEL_REQUESTS;
    const d = await dropMidHold('compare-stream', how);
    assert.equal(d.readsAfter, d.readsAtDrop, `the hold kept reading the store after the stream was dropped: ${d.readsAtDrop} reads at the drop, ${d.readsAfter} 1.5 s later`);
    // The entry is left for the reader's card (D2): the answer is saved, and moves the source On for later questions.
    assert.equal(d.allowStatus, 200, 'the entry was not left for the reader');
    assert.equal(d.bostonCalls, 0, `the run went on to the source after the stream was dropped (${d.bostonCalls} call(s) to Boston)`);
    assert.ok(MODEL_REQUESTS > modelBefore, 'premise: the model was never asked');
    if (d.rest) {
      // The record says what it says for any hold that ended unanswered: no-answer, and the base's five attributes.
      const trace = traceOf(d.rest);
      const loads = loadSpanAttributes(trace);
      assert.deepEqual(loads.map((a) => a['tool.load_outcome']), ['no-answer']);
      assert.deepEqual(Object.keys(loads[0]).sort(), ['tool.arguments', 'tool.duration_ms', 'tool.load_outcome', 'tool.name', 'tool.operation_type']);
      assert.ok(!JSON.stringify(trace).includes(d.key), 'the key reached the trace');
    }
  });
}

test('R9 P1 (#668): query-notebook, the request\'s signal aborted mid-hold: the hold stops polling, and an Allow posted afterwards does not reach the source', async () => {
  const d = await dropMidHold('query-notebook', 'signal');
  assert.equal(d.readsAfter, d.readsAtDrop, `the hold kept reading the store after the stream was dropped: ${d.readsAtDrop} reads at the drop, ${d.readsAfter} 1.5 s later`);
  assert.equal(d.allowStatus, 200, 'the entry was not left for the reader');
  assert.equal(d.bostonCalls, 0, `the run went on to the source after the stream was dropped (${d.bostonCalls} call(s) to Boston)`);
});
