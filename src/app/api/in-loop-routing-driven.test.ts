// #644 W1 — in-loop routing at the routes.
//
// WHAT IS DRIVEN. The REAL `/api/compare-stream`, `/api/query-notebook` and
// `/api/compare` handlers, through the real prompt composer, the real MCP
// client, the real loop core and the real trace builder, as
// `a-run-records-its-inputs-driven.test.ts` drives them: `module.registerHooks()`
// resolves the `@/` alias and stubs the four modules that need a request
// scope, a sign-in provider or a sandbox. The model is a loopback server that
// records each request and answers by what it is asked; the three sources are
// one loopback MCP server on three paths. `SOURCE_ROUTING` is set per drive,
// before the request, because the routes read it at request time.
//
// Criterion 2: with `SOURCE_ROUTING` unset, `all-sources`, or a third value,
// every request the model receives is byte-identical, and a third value logs
// one line naming the variable and its two values and never the value. The
// in-loop drive's first request differs from them, so the comparison can fail.
//
// Criterion 3, at each route: the first in-loop request carries the
// directory and one tool, `load_source`.
//
// Criterion 5, the record. Under in-loop the routes write `analysis.routing`
// and `analysis.definition_hash`, and the after-loop `analysis.components`
// (the loaded set, then the router) and `analysis.tool_definitions` (the
// final request's tools); `skill.text_hash` is the final prompt's. A record
// packaged from the run carries `composition.routing` and
// `composition.definitionHash`, its load spans with their outcomes, and
// `dataSources[]` from the data calls only, and passes the offline §9.2
// checks that need no key. A record of an all-sources run carries neither
// key. The in-loop run loads one of three sources, so its components and
// tools differ from the all-sources run's and the comparison can fail; its
// refused call is to Boston, which no successful call touches.
//
// S2-B W2 and W3 (npstorey/civic-ai-tools#309), at the end of this file: an
// in-loop run that loads NYC City Record, a pack over the Socrata server since
// router 0.8.0, and calls its tools. The pack's calls reach the Socrata path
// with the filter's portal and dataset, are attributed to the base, name the
// pack, and a call outside the filter is refused before any request.
//
// No live endpoint, no credential: every key is a placeholder and every
// address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/in-loop-routing-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `module.registerHooks()` is Node 22.15+ but not in the pinned `@types/node`.
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

const PORTAL = 'data.example.org';
const QUESTION = 'How many potholes were reported in 2025?';
const ANSWER = 'Two figures were retrieved.';
const DATA_COMMONS_INSTRUCTIONS = 'Fixture Data Commons instructions: name places by DCID.';
const SENTINEL = 'value-SENTINEL-DO-NOT-LEAK';

// --- The outbound recorder: loopback only -----------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks ------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-r8-w1-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.48' }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/sandbox': `
     import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
     export { NotebookExecutionError };
     export async function executeNotebook(notebook) {
       return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
     }`,
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
        } catch { /* next extension */ }
      }
      throw new Error(`R8 W1 test hook: cannot resolve ${specifier}`);
    }
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

// R6 W3 (#632): the consent gate is on, so each gated request carries a consent
// in force, built by the real encoder (`consentCookieForTests`).
const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- The loopback MCP sources ------------------------------------------------

const ONE_ROW = JSON.stringify({ data: [{ count: '512' }], total_rows: 1 });
const MCP_CALLS: Array<{ path: string; tool?: string }> = [];
/** The same calls with their arguments, for S2-B's pack drive (MCP_CALLS keeps its shape). */
const MCP_CALL_ARGS: Array<{ path: string; tool?: string; args?: Record<string, unknown> }> = [];
// S2-B P3R (the seat's ruling 12): the Socrata path reports what the deployed
// server reported at the GR read, and lists its tools as it listed them there,
// so the base check finds the pack's pin (`src/lib/mcp/fixtures/socrata-tools-at-gr.json`,
// copied by script; `socrata-tools-at-gr.test.ts` holds each pinned entry to its pin).
const GR = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../lib/mcp/fixtures/socrata-tools-at-gr.json'), 'utf8')) as { serverInfo: { name: string; version: string }; tools: unknown[] };
const MCP_LISTS: string[] = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  const route = req.url ?? '';
  if (msg.method === 'initialize') {
    const instructions = route.startsWith('/dc/') ? { instructions: DATA_COMMONS_INSTRUCTIONS } : {};
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r8-w1' });
    const serverInfo = route.startsWith('/socrata/') ? GR.serverInfo : { name: 'civic-r8-w1-fixture', version: '0' };
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo, ...instructions } }));
    return;
  }
  if (msg.method === 'tools/list') {
    MCP_LISTS.push(route);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { tools: route.startsWith('/socrata/') ? GR.tools : [] } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  if (msg.method === 'tools/call') {
    MCP_CALLS.push({ path: route, tool: msg.params?.name });
    MCP_CALL_ARGS.push({ path: route, tool: msg.params?.name, args: msg.params?.arguments });
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// --- The loopback model --------------------------------------------------------
//
// All-sources: the first turn calls a Socrata tool and a Boston tool, the
// next answers. In-loop (the request offers `load_source`): the first turn
// loads Socrata; the second calls the Socrata tool, a tool of Boston (in the
// directory, never loaded) and loads an alias no source of the directory has;
// the third answers.

const MODEL_REQUESTS: Array<{ raw: string; body: Record<string, unknown> }> = [];
type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
const call = (id: string, name: string, args: Record<string, unknown>): Call =>
  ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

// S2-B's pack drive: the first turn loads City Record; the second calls its
// tools five times, told apart by `limit`: (1) with the filter's portal and
// dataset, (2) with neither, (3) naming another portal, (4) naming another
// dataset, and a `fetch` of an identifier outside the dataset; the third
// answers. The run's portal is `PORTAL`, never the filter's, so a call that
// omits `portal` shows whose value is sent.
const PACK_QUESTION = 'Which notices did the City Record publish about sidewalk repair?';
const PACK_FILTER = { portal: 'data.cityofnewyork.us', dataset_id: 'dg92-zbpx' } as const;
const OTHER_PORTAL = 'data.sfgov.org';
const OTHER_DATASET = 'erm2-nwe9';
const OUTSIDE_ID = `dataset:${PACK_FILTER.portal}:${OTHER_DATASET}`;

function packTurn(assistantTurns: number): Call[] | null {
  if (assistantTurns === 0) return [call('call-load-record', 'load_source', { alias: 'nyc_record' })];
  if (assistantTurns === 1) {
    return [
      call('call-pack-filter', 'nyc_record__get_data', { type: 'query', ...PACK_FILTER, query: 'sidewalk repair', limit: 1 }),
      call('call-pack-omitted', 'nyc_record__get_data', { type: 'query', query: 'sidewalk repair', limit: 2 }),
      call('call-pack-portal', 'nyc_record__get_data', { type: 'query', portal: OTHER_PORTAL, dataset_id: PACK_FILTER.dataset_id, limit: 3 }),
      call('call-pack-dataset', 'nyc_record__get_data', { type: 'query', portal: PACK_FILTER.portal, dataset_id: OTHER_DATASET, limit: 4 }),
      call('call-pack-fetch', 'nyc_record__fetch', { id: OUTSIDE_ID }),
    ];
  }
  return null;
}

function turnFor(body: Record<string, unknown>): Call[] | null {
  const tools = (body.tools ?? []) as Array<{ function: { name: string } }>;
  if (tools.length === 0) return null;
  const messages = (body.messages ?? []) as Array<{ role?: string }>;
  const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
  const inLoop = tools.some((t) => t.function.name === 'load_source');
  if (inLoop && JSON.stringify(body.messages ?? []).includes(PACK_QUESTION)) return packTurn(assistantTurns);
  if (!inLoop) {
    return assistantTurns === 0
      ? [
          call('call-socrata', 'socrata__get_data', { type: 'query', dataset_id: 'aaaa-1111', limit: 1 }),
          call('call-boston', 'boston__ckan__query_data', { resource_id: 'r-1', limit: 1 }),
        ]
      : null;
  }
  if (assistantTurns === 0) return [call('call-load-socrata', 'load_source', { alias: 'socrata' })];
  if (assistantTurns === 1) {
    return [
      call('call-socrata', 'socrata__get_data', { type: 'query', dataset_id: 'aaaa-1111', limit: 1 }),
      call('call-boston', 'boston__ckan__query_data', { resource_id: 'r-1', limit: 1 }),
      call('call-load-unknown', 'load_source', { alias: 'nyc_charter' }),
    ];
  }
  return null;
}

const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(raw) as Record<string, unknown>;
    MODEL_REQUESTS.push({ raw, body });
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-r8-w1', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = turnFor(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-r8-w1',
      object: 'chat.completion',
      created: 1,
      model: 'fake/model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: toolCalls ? null : ANSWER, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      }],
      usage,
    }));
  });
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Environment, before any app module loads ----------------------------------

for (const name of [
  'DATA_COMMONS_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'MODEL_API_KEY', 'OPENAI_API_KEY',
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'EXECUTOR_DRIVER', 'NYC_CHARTER_HOSTING',
  'SOURCE_ROUTING',
]) {
  delete process.env[name];
}
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-r8-w1';
process.env.MODEL_API_BASE_URL = `${MODEL_ORIGIN}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  {
    id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true,
    endpointModel: 'example-fixture-deployment', model: 'vendor/model-fixture-1', default: true, evaluator: 1,
  },
]);
const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';

const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
_resetDefaultModelClientForTests();
const router = await import('@typedstandards/civic-typed-router');
const { readMcpEnvFromProcess } = await import('../../lib/mcp/registry.ts');
const { DATA_COMMONS_PUBLICATION_HOST } = await import('../../lib/mcp/data-commons-skill.ts');
const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');
const verify = await import('@typedstandards/verify-core');

// --- The drives -------------------------------------------------------------------

interface Drive { name: string; body: string; requests: Array<{ raw: string; body: Record<string, unknown> }>; warnings: string[]; mcpCalls: Array<{ path: string; tool?: string }> }

const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: consentCookieForTests() }, body: JSON.stringify(body) }) as never;

async function drive(name: string, routing: string | undefined, run: () => Promise<Response>): Promise<Drive> {
  if (routing === undefined) delete process.env.SOURCE_ROUTING;
  else process.env.SOURCE_ROUTING = routing;
  const realWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  const from = MODEL_REQUESTS.length;
  const mcpFrom = MCP_CALLS.length;
  try {
    const response = await run();
    const body = await response.text();
    return { name, body, requests: MODEL_REQUESTS.slice(from), warnings, mcpCalls: MCP_CALLS.slice(mcpFrom) };
  } finally {
    console.warn = realWarn;
    delete process.env.SOURCE_ROUTING;
  }
}

const compareStreamRoute = await import('./compare-stream/route.ts');
const notebookRoute = await import('./query-notebook/route.ts');
const compareRoute = await import('./compare/route.ts');
const streamBody = { query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true };
const runCompareStream = () => compareStreamRoute.POST(post('/api/compare-stream', streamBody));

const UNSET = await drive('compare-stream, unset', undefined, runCompareStream);
const ALL_SOURCES = await drive('compare-stream, all-sources', 'all-sources', runCompareStream);
const THIRD_VALUE = await drive('compare-stream, a third value', SENTINEL, runCompareStream);
const IN_LOOP = await drive('compare-stream, in-loop', 'in-loop', runCompareStream);
const NOTEBOOK_IN_LOOP = await drive('query-notebook, in-loop', 'in-loop', () =>
  notebookRoute.POST(post('/api/query-notebook', { query: QUESTION, portal: PORTAL })));
const COMPARE_IN_LOOP = await drive('compare, in-loop', 'in-loop', () =>
  compareRoute.POST(post('/api/compare', { query: QUESTION, model: 'fixture-fast', portal: PORTAL })));
const PACK_ARGS_FROM = MCP_CALL_ARGS.length;
const PACK_LISTS_FROM = MCP_LISTS.length;
const PACK = await drive('compare-stream, in-loop, City Record', 'in-loop', () =>
  compareStreamRoute.POST(post('/api/compare-stream', { ...streamBody, query: PACK_QUESTION })));
const PACK_MCP_CALLS = MCP_CALL_ARGS.slice(PACK_ARGS_FROM);
const PACK_LISTS = MCP_LISTS.slice(PACK_LISTS_FROM);

// --- Readers -------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** The requests of a drive that offered tools: the MCP half's turns. */
function mcpRequests(d: Drive): Array<{ raw: string; body: Json }> {
  const offered = d.requests.filter((r) => Array.isArray(r.body.tools) && (r.body.tools as unknown[]).length > 0);
  assert.ok(offered.length > 0, `${d.name}: premise — no model request offered any tool:\n${d.body.slice(0, 600)}`);
  return offered;
}

function toolNames(request: { body: Json }): string[] {
  return ((request.body.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
}

function systemText(request: { body: Json }): string {
  const messages = (request.body.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const system = messages.find((m) => m.role === 'system');
  assert.ok(system && typeof system.content === 'string', 'premise — the MCP request carries no system message');
  return system!.content as string;
}

const configured = readMcpEnvFromProcess();
// S2-B: router 0.8.0 offers NYC City Record (a pack over Socrata) wherever Socrata is, On in the consent sent.
const DIRECTORY_IDS = ['socrata', 'data-commons', 'boston-opencontext', 'nyc-record'];
const today = () => new Date().toISOString().slice(0, 10);

// --- Criterion 2 ------------------------------------------------------------------------

test('criterion 2: unset, all-sources and a third value send every request byte for byte alike', () => {
  const unset = UNSET.requests.map((r) => r.raw);
  assert.ok(unset.length >= 2, 'premise — the all-sources drive made a tool turn and an answer turn');
  assert.deepEqual(ALL_SOURCES.requests.map((r) => r.raw), unset);
  assert.deepEqual(THIRD_VALUE.requests.map((r) => r.raw), unset);
});

test('criterion 2: the comparison can fail — the in-loop drive\'s first request differs', () => {
  assert.notEqual(mcpRequests(IN_LOOP)[0].raw, mcpRequests(UNSET)[0].raw);
});

test('criterion 2: a third value logs one line naming the variable and both values, never the value; the others log none', () => {
  const routingLines = (d: Drive) => d.warnings.filter((w) => w.includes('SOURCE_ROUTING'));
  assert.deepEqual(routingLines(UNSET), []);
  assert.deepEqual(routingLines(ALL_SOURCES), []);
  const lines = routingLines(THIRD_VALUE);
  assert.equal(lines.length, 1, `logged: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /all-sources/);
  assert.match(lines[0], /in-loop/);
  assert.ok(!THIRD_VALUE.warnings.some((w) => w.includes(SENTINEL)), 'the value reached the log');
});

// --- Criterion 3 ------------------------------------------------------------------------

for (const d of [IN_LOOP, NOTEBOOK_IN_LOOP, COMPARE_IN_LOOP]) {
  test(`criterion 3, ${d.name}: the first request carries the directory and one tool, load_source`, () => {
    const first = mcpRequests(d)[0];
    assert.deepEqual(toolNames(first), ['load_source']);
    assert.equal(systemText(first), router.civicRouter.directoryPrompt({ configured, today: today(), selection: DIRECTORY_IDS }));
  });
}

// --- Criterion 5: the record ------------------------------------------------------

interface Span { name: string; parentSpanId?: string; attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }> }

function events(d: Drive): Json[] {
  return d.body.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice('data: '.length)) as Json]; } catch { return []; }
  });
}

function traceOf(d: Drive): Json {
  const all = events(d);
  const trace = (all.find((e) => e.type === 'trace')?.data ?? all.find((e) => e.type === 'publish_inputs')?.trace) as Json | undefined;
  assert.ok(trace, `${d.name}: premise — the route emitted no trace:\n${d.body.slice(0, 600)}`);
  return trace!;
}

function spans(trace: Json): Span[] {
  return (trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
}

function attrPairs(span: Span): Array<[string, string | boolean | undefined]> {
  return span.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.boolValue]);
}

function rootAttributes(trace: Json): Record<string, string> {
  const root = spans(trace).find((s) => !s.parentSpanId);
  assert.ok(root, 'premise — the trace has no root span');
  return Object.fromEntries(attrPairs(root!)) as Record<string, string>;
}

/** The tool calls the compare-stream route completed with, as a publish posts them. */
function toolCallsOf(d: Drive): Array<{ name: string; args: Record<string, unknown>; operationType?: string; failed?: boolean; failureKind?: string }> {
  const complete = events(d).find((e) => e.type === 'complete' && e.panel === 'withMcp');
  const called = (complete?.data as { tools_called?: unknown[] } | undefined)?.tools_called;
  assert.ok(Array.isArray(called), `${d.name}: premise — no completed tool calls`);
  return called as Array<{ name: string; args: Record<string, unknown> }>;
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
    title: 'Potholes',
    summary: 'Potholes.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
  });
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const ROUTER_VERSION = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules/@typedstandards/civic-typed-router/package.json'), 'utf8')) as { version: string }).version;

/**
 * S2-B W4: the inventory an in-loop run was routed against, in the record's form (ADR-0033 amendment 3):
 * the installed router's `CIVIC_INVENTORY`, its `version` in build-metadata form `<version>+<hash12>`, computed
 * here from the package, never typed. The definition's components name it by `id` and that `version`.
 */
const { CIVIC_INVENTORY } = router;
const INVENTORY_REFERENCE = {
  id: CIVIC_INVENTORY.id,
  version: `${CIVIC_INVENTORY.version}+${CIVIC_INVENTORY.hash.slice(0, 12)}`,
  hash: CIVIC_INVENTORY.hash,
};
const INVENTORY_COMPONENT = { id: INVENTORY_REFERENCE.id, version: INVENTORY_REFERENCE.version };

/** The Socrata block the router composes from the loopback answers. */
async function socrataBlock(): Promise<string> {
  return router.socrataGuidanceText({
    portal: PORTAL,
    publicationHost: DATA_COMMONS_PUBLICATION_HOST,
    fetchPrompt: async (): Promise<string> => { throw new Error('refused'); },
    fetchInstructions: async () => null,
  }, router.civicRouter.aliasedView);
}

test('criterion 5, compare-stream: the root span states routing, the definition hash, the loaded components and the final tools', async () => {
  const root = rootAttributes(traceOf(IN_LOOP));
  const requests = mcpRequests(IN_LOOP);
  const last = requests[requests.length - 1];
  assert.deepEqual(JSON.parse(root['analysis.routing'] ?? 'null'), { method: 'in-loop', version: ROUTER_VERSION });
  const block = await socrataBlock();
  assert.ok(systemText(last).includes(block), 'premise — the final prompt carries the Socrata block the router composes');
  // S2-B P3R (criterion 4): the run read the Socrata server, so its component states what it reported.
  const components = [
    { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: sha(block), guidanceOrigin: 'fallback', reportedName: 'socrata-mcp-server', reportedVersion: '0.9.2' },
    { id: '@typedstandards/civic-typed-router', version: ROUTER_VERSION },
  ];
  assert.deepEqual(JSON.parse(root['analysis.components'] ?? 'null'), components);
  assert.equal(root['analysis.tool_definitions'], JSON.stringify(last.body.tools));
  // The property kept: the hash is the router's definition over the loaded set and the record's components.
  // S2-B W4 (npstorey/civic-ai-tools#309): the definition's components also name the inventory the run was routed
  // against, which the record's components do not (the W4 test at the end of this file holds both).
  const definition = router.civicRouter.harnessDefinition({ configured, selection: ['socrata'], chosenBy: 'model', components: [...components, INVENTORY_COMPONENT] });
  assert.equal(root['analysis.definition_hash'], definition.hash);
  // As composed (C4): the directory set's reasons, not recomputed after loads.
  // R6 W3 (#632, contract item 10): with the gate on and every source On, the
  // record states the router's `selected` where it stated `configured` before
  // W3 — the signed-byte move the gate record names.
  assert.deepEqual(JSON.parse(root['analysis.sources_offered'] ?? 'null').map((s: { reason: string }) => s.reason), ['selected', 'selected', 'selected', 'not-configured', 'not-configured', 'selected', 'not-configured']);
  // Router 0.6.0 (R8 W3): the three new hosted sources, switches unset, are not configured; since router 0.8.0
  // (S2-B) NYC City Record, sixth in the manifest, is a pack over Socrata, configured and On, so `selected`.
  // skill.text_hash is the final prompt's.
  const skill = spans(traceOf(IN_LOOP)).find((s) => s.name === 'skill_fetch');
  assert.equal(Object.fromEntries(attrPairs(skill!))['skill.text_hash'], sha(systemText(last)));
});

test('criterion 5, query-notebook: the four after-loop attributes are written once, at the root\'s end', () => {
  const root = spans(traceOf(NOTEBOOK_IN_LOOP)).find((s) => !s.parentSpanId)!;
  const keys = root.attributes.map((a) => a.key);
  for (const key of ['analysis.tool_definitions', 'analysis.components', 'analysis.routing', 'analysis.definition_hash', 'analysis.asserted_date', 'analysis.sources_offered']) {
    assert.equal(keys.filter((k) => k === key).length, 1, `${key} is written ${keys.filter((k) => k === key).length} times`);
  }
  const requests = mcpRequests(NOTEBOOK_IN_LOOP);
  const attrsByKey = Object.fromEntries(attrPairs(root)) as Record<string, string>;
  assert.equal(attrsByKey['analysis.tool_definitions'], JSON.stringify(requests[requests.length - 1].body.tools));
  assert.deepEqual(JSON.parse(attrsByKey['analysis.routing']), { method: 'in-loop', version: ROUTER_VERSION });
});

test('criterion 5: a packaged in-loop record states routing, the definition hash, the loaded components and the final tools', () => {
  const { pkg } = packageOf(IN_LOOP);
  const composition = pkg.extensions?.['org.civicaitools.composition'] as Json;
  const root = rootAttributes(traceOf(IN_LOOP));
  assert.deepEqual(composition.routing, { method: 'in-loop', version: ROUTER_VERSION });
  assert.equal(composition.definitionHash, root['analysis.definition_hash']);
  // The property kept: routing and definitionHash close the block, in the harness's order; S2-B W4 adds considered after them.
  assert.deepEqual(Object.keys(composition).slice(-3), ['routing', 'definitionHash', 'considered'], 'routing, definitionHash and considered are not the block\'s last three keys');
  assert.deepEqual((composition.components as Array<{ id: string }>).map((c) => c.id), ['socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', '@typedstandards/civic-typed-router']);
  const environment = pkg.extensions?.['org.civicaitools.environment'] as Json;
  const requests = mcpRequests(IN_LOOP);
  assert.equal(JSON.stringify(environment.toolDefinitions), JSON.stringify(requests[requests.length - 1].body.tools));
  const last = requests[requests.length - 1];
  assert.equal((pkg as unknown as { skillMetadata: { systemPromptHash?: string } }).skillMetadata.systemPromptHash, sha(systemText(last)));
});

test('criterion 5: the record has one load span loaded and one not-offered, and dataSources[] from the data calls only', () => {
  const { pkg } = packageOf(IN_LOOP);
  const loads = spans(traceOf(IN_LOOP)).filter((s) => s.name === 'mcp_tool_call').map((s) => Object.fromEntries(attrPairs(s)))
    .filter((a) => a['tool.operation_type'] === 'load_source');
  assert.deepEqual(loads.map((a) => a['tool.load_outcome']), ['loaded', 'not-offered']);
  const graph = (pkg.provenance as { '@graph': Array<Record<string, unknown>> })['@graph'];
  assert.deepEqual(graph.filter((n) => 'civic:loadOutcome' in n).map((n) => n['civic:loadOutcome']), ['loaded', 'not-offered']);
  // Socrata answered; Boston was refused and no successful call touched it.
  assert.deepEqual((pkg.dataSources as Array<{ sourceId?: string; datasetId?: string }>).map((d) => d.datasetId ?? d.sourceId), ['aaaa-1111']);
  assert.equal(JSON.stringify(pkg.dataSources).includes('boston'), false);
  assert.deepEqual(IN_LOOP.mcpCalls, [{ path: '/socrata/mcp', tool: 'get_data' }], 'the in-loop run sent a call other than the Socrata one');
});

test('criterion 5: the packaged in-loop record passes the offline §9.2 checks that need no key', () => {
  const { pkg, hash } = packageOf(IN_LOOP);
  const json = pkg as unknown as Record<string, unknown>;
  assert.equal(verify.recomputePackageHash(json), hash, '#1 envelope hash');
  const canon = verify.resolveContentCanonicalization(json);
  assert.equal(canon.status, 'ok', '#3 canonicalization rule');
  assert.equal(verify.verifyContentHash(json, canon).status, 'ok', '#4 content hash');
  assert.equal(verify.resolvePackageType(json).status, 'ok', '#12 type');
  assert.equal(verify.checkCaptureMethodVocab(json).status, 'ok', '#15 captureMethod vocabulary');
});

test('criterion 5: an all-sources record states neither key, and differs from the in-loop one in components and tools', () => {
  const allSources = packageOf(UNSET).pkg;
  const inLoop = packageOf(IN_LOOP).pkg;
  const a = allSources.extensions?.['org.civicaitools.composition'] as Json;
  const b = inLoop.extensions?.['org.civicaitools.composition'] as Json;
  assert.equal(Object.hasOwn(a, 'routing'), false);
  assert.equal(Object.hasOwn(a, 'definitionHash'), false);
  assert.notDeepEqual(a.components, b.components);
  const envA = allSources.extensions?.['org.civicaitools.environment'] as Json;
  const envB = inLoop.extensions?.['org.civicaitools.environment'] as Json;
  assert.notEqual(JSON.stringify(envA.toolDefinitions), JSON.stringify(envB.toolDefinitions));
  const rootA = rootAttributes(traceOf(UNSET));
  assert.equal(Object.hasOwn(rootA, 'analysis.routing'), false);
  assert.equal(Object.hasOwn(rootA, 'analysis.definition_hash'), false);
});

// --- R10 P1 criterion 4 (#682): the record page over a record this packager built ----------------
//
// The in-loop run above loads Socrata, asks for no other source, and never
// asks for Data Commons or Boston OpenContext, both in its directory set; its
// load of `nyc_charter` names no source of the set (`not-offered`), so NYC
// Charter is in no group. The all-sources run states no `routing` key.

/** The record adapter and the chooser's lines, by specifiers typed `string`, so the red commit type-checks. */
const ADAPT_RECORD: string = '../../components/answer-view/adapt-record.ts';
const SOURCE_CHOOSER: string = '../../lib/flows/source-chooser.ts';
const COPY: string = '../../lib/sources/copy.ts';
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function recordView(d: Drive): Promise<Loose> {
  const { adaptRecord } = (await import(ADAPT_RECORD)) as Loose;
  const { pkg } = packageOf(d);
  return adaptRecord({ stored: pkg, resolution: null, row: { slug: 'r10-p1', summary: 'Potholes.', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' }, instance: null, servedStatement: null });
}

test('R10 P1 P-d: the packaged in-loop record\'s routing.version and its router component\'s version agree', () => {
  const composition = packageOf(IN_LOOP).pkg.extensions?.['org.civicaitools.composition'] as Json;
  const router = (composition.components as Array<{ id: string; version?: string }>).find((c) => c.id === '@typedstandards/civic-typed-router');
  assert.equal((composition.routing as { version: string }).version, router?.version);
  assert.equal(router?.version, ROUTER_VERSION);
});

test('R10 P1 criterion 4: adaptRecord over the packaged in-loop record shows the chooser line and the card', async () => {
  const { SOURCE_CHOOSER_TEXT: T, SOURCE_CHOOSER_CARD: CARD } = (await import(COPY)) as Loose;
  const { chooserLines } = (await import(SOURCE_CHOOSER)) as Loose;
  const model = await recordView(IN_LOOP);
  const composition = packageOf(IN_LOOP).pkg.extensions?.['org.civicaitools.composition'] as Json;
  const environment = model.disclosure.environment as Array<{ label: string; value: string; mono?: boolean }>;
  assert.deepEqual(environment.find((i) => i.label === CARD.label), { label: CARD.label, value: CARD.inLoop('@typedstandards/civic-typed-router', ROUTER_VERSION) });
  assert.deepEqual(environment.find((i) => i.label === CARD.definitionLabel), { label: CARD.definitionLabel, value: (composition.definitionHash as string).slice(0, 12), mono: true });
  assert.equal(typeof chooserLines, 'function', 'source-chooser.ts exports no chooserLines');
  assert.deepEqual(chooserLines(model.whereItWent?.chooser), [
    // The property kept: the in-loop sentence opens the line. S2-B F9 (case 1; bundle `:70`, `:88`): the record
    // carries composition.considered, so that entry's two sentences follow it, the inventory by its id as written.
    { text: `${T.inLoop} The model was shown 4 of the 7 sources in the source inventory civic (version ${INVENTORY_REFERENCE.version}). Those were the sources set up on the site that ran this question, less any turned off for it.` },
    { text: `${T.loaded}Socrata.` },
    { text: `${T.askedNotLoaded}${T.none}.` },
    // S2-B: NYC City Record, in the directory set since router 0.8.0, is never asked about either.
    { text: `${T.neverAsked}Data Commons${T.separator}Boston OpenContext${T.separator}NYC City Record.` },
  ]);
});

test('R10 P1 criterion 4: adaptRecord over the packaged all-sources record shows "not recorded" in both places', async () => {
  const { SOURCE_CHOOSER_TEXT: T, SOURCE_CHOOSER_CARD: CARD } = (await import(COPY)) as Loose;
  const { chooserLines } = (await import(SOURCE_CHOOSER)) as Loose;
  const model = await recordView(UNSET);
  const environment = model.disclosure.environment as Array<{ label: string; value: string }>;
  assert.deepEqual(environment.find((i) => i.label === CARD.label), { label: CARD.label, value: CARD.notRecorded });
  assert.equal(environment.find((i) => i.label === CARD.definitionLabel), undefined);
  assert.equal(typeof chooserLines, 'function', 'source-chooser.ts exports no chooserLines');
  assert.deepEqual(chooserLines(model.whereItWent?.chooser), [{ text: T.notRecorded }]);
});

// --- S2-B W2 and W3 (npstorey/civic-ai-tools#309): City Record, a pack over the Socrata server ------
//
// G0-B5 A, both parts: a pack's call states the base's `mcp.source`
// (`socrata`), `mcp.alias` (`socrata`) and `mcp.server.id`, and the pack's
// inventory id as `mcp.pack_id`; the record states the same on the call's
// activity (`civic:sourceId`, `civic:sourceAlias`, `civic:serverId`,
// `civic:packId`), mints no agent for the pack, and its `dataSources[]` carries
// Socrata's entry for the pack's dataset. At f0c1eca (router 0.6.0) the pack's
// tools are not in the dispatch map: every call is refused before any request
// ("No MCP server registered", `registry.ts:674`), so the Socrata path receives
// nothing.
//
// WHAT MAKES IT ABLE TO FAIL. The refused calls name another portal and another
// dataset, which no answered call touches, so a refused call that reached the
// record would show as its own `dataSources` entry; the omitted call would
// carry the run's portal (`PORTAL`) if that, not the filter's, were injected.
// The two decoys rewrite only `mcp.source` on the answered pack calls (to the
// pack's id, then to its `sourceId`) and must fail the same assertions.

const PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';
const SOCRATA_SERVER_ID = 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server';

type SpanAttrs = Record<string, string | boolean | undefined>;

/** The pack drive's tool-call spans, by the `limit` (or, for `fetch`, the name) each call carried. */
function packSpan(trace: Json, which: number | 'fetch'): SpanAttrs | undefined {
  return spans(trace)
    .filter((s) => s.name === 'mcp_tool_call')
    .map((s) => Object.fromEntries(attrPairs(s)) as SpanAttrs)
    .find((a) => {
      if (which === 'fetch') return a['tool.name'] === 'nyc_record__fetch';
      if (a['tool.name'] !== 'nyc_record__get_data') return false;
      try { return (JSON.parse(String(a['tool.arguments'] ?? '{}')) as { limit?: unknown }).limit === which; } catch { return false; }
    });
}

/** What the run's loopback model was told about each tool result of its second turn: the evidence of a refusal's cause. */
function packToolResults(): string {
  const last = PACK.requests[PACK.requests.length - 1]?.body.messages as Array<{ role?: string; tool_call_id?: string; content?: unknown }> | undefined;
  return (last ?? []).filter((m) => m.role === 'tool').map((m) => `${m.tool_call_id}: ${String(m.content).slice(0, 200)}`).join('\n');
}

function packageFrom(trace: Json, toolCalls: unknown) {
  return buildEvidencePackage({
    trace,
    prompt: PACK_QUESTION,
    output: ANSWER,
    toolCalls: toolCalls as never,
    model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'City Record notices',
    summary: 'City Record notices.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
  });
}

/** W2's record assertions, over any package: the decoys run the same function. */
function assertPackCallRecorded(pkg: ReturnType<typeof packageFrom>['pkg']): void {
  const graph = (pkg.provenance as { '@graph': Array<Record<string, unknown>> })['@graph'];
  const activities = graph.filter((n) => String(n['dcterms:description'] ?? '').startsWith('MCP tool call: nyc_record__get_data') && n['civic:failed'] !== true);
  assert.equal(activities.length, 2, `the record does not state the two answered pack calls: ${activities.length}`);
  for (const activity of activities) {
    assert.equal(activity['civic:sourceId'], 'socrata', 'the pack call\'s activity is not attributed to the base');
    assert.equal(activity['civic:sourceAlias'], 'socrata', 'the pack call\'s activity does not state the base\'s alias');
    assert.equal(activity['civic:serverId'], SOCRATA_SERVER_ID, 'the pack call\'s activity does not state the Socrata server');
    assert.equal(activity['civic:packId'], PACK_ID, 'the pack call\'s activity does not name the pack');
  }
  const agents = graph.filter((n) => [n['@type']].flat().includes('prov:Agent'));
  const packAgents = agents.filter((n) => n['civic:sourceId'] === PACK_ID || n['civic:sourceId'] === 'nyc-record');
  assert.deepEqual(packAgents.map((n) => n['@id']), [], 'the record mints an agent for the pack');
  const sources = pkg.dataSources as Array<{ sourceId: string; datasetId?: string; datasetUrl?: string }>;
  assert.ok(
    sources.some((d) => d.sourceId === 'socrata' && d.datasetId === PACK_FILTER.dataset_id && d.datasetUrl === `https://${PACK_FILTER.portal}/d/${PACK_FILTER.dataset_id}`),
    `dataSources[] carries no Socrata entry for ${PACK_FILTER.dataset_id}: ${JSON.stringify(sources)}`,
  );
  const text = JSON.stringify(sources);
  for (const absent of [OTHER_DATASET, OTHER_PORTAL, 'nyc-record']) {
    assert.equal(text.includes(absent), false, `dataSources[] names ${absent}, which no answered call reached: ${text}`);
  }
}

/** The pack drive's trace with `mcp.source` rewritten on every pack span that answered. */
function decoyTrace(source: string): Json {
  const trace = JSON.parse(JSON.stringify(traceOf(PACK))) as Json;
  let rewritten = 0;
  for (const span of spans(trace)) {
    const attrs = Object.fromEntries(attrPairs(span)) as SpanAttrs;
    if (span.name !== 'mcp_tool_call' || !String(attrs['tool.name'] ?? '').startsWith('nyc_record__') || attrs['tool.response_hash'] === undefined) continue;
    const at = span.attributes.find((a) => a.key === 'mcp.source');
    if (at) { at.value = { stringValue: source }; rewritten += 1; }
  }
  assert.equal(rewritten, 2, `premise: the decoy rewrites the two answered pack calls (${rewritten} found)`);
  return trace;
}

test('S2-B W2: the pack\'s calls reach the Socrata path as get_data, with the filter\'s portal and dataset', () => {
  assert.deepEqual(
    PACK_MCP_CALLS.map((c) => ({ path: c.path, tool: c.tool, portal: c.args?.portal, dataset_id: c.args?.dataset_id, limit: c.args?.limit })),
    [
      { path: '/socrata/mcp', tool: 'get_data', ...PACK_FILTER, limit: 1 },
      { path: '/socrata/mcp', tool: 'get_data', ...PACK_FILTER, limit: 2 },
    ],
    `the Socrata path did not receive the two pack calls; the model was told:\n${packToolResults()}`,
  );
});

test('S2-B W2: the pack call\'s span states the base\'s source, alias and server, and the pack\'s id', () => {
  const span = packSpan(traceOf(PACK), 1);
  assert.ok(span, 'premise: the trace has a span for the pack call');
  assert.deepEqual(
    {
      source: span!['mcp.source'], alias: span!['mcp.alias'], server: span!['mcp.server.id'], pack: span!['mcp.pack_id'],
      upstream: span!['tool.upstream_name'], failed: span!['error'] ?? false,
    },
    { source: 'socrata', alias: 'socrata', server: SOCRATA_SERVER_ID, pack: PACK_ID, upstream: 'get_data', failed: false },
    `the pack call's span is not the base's with the pack named; the model was told:\n${packToolResults()}`,
  );
});

test('S2-B W2: the record packaged from the run attributes the pack\'s calls to the base, names the pack, and mints no agent for it', () => {
  const { pkg } = packageFrom(traceOf(PACK), toolCallsOf(PACK));
  assertPackCallRecorded(pkg);
});

for (const [label, source] of [['the pack\'s id', PACK_ID], ['the pack\'s sourceId', 'nyc-record']] as const) {
  test(`S2-B W2 decoy: a trace whose pack calls write mcp.source = ${label} fails W2's record assertions`, () => {
    const { pkg } = packageFrom(decoyTrace(source), toolCallsOf(PACK));
    // Fails at the attribution, not on something unrelated inside the assertions (the ORCH's tightening of tree 1).
    assert.throws(() => assertPackCallRecorded(pkg), (error: unknown) => error instanceof assert.AssertionError && /not attributed to the base/.test(error.message));
  });
}

test('S2-B W3: the filter\'s values are sent when the call omits them, not the run\'s portal', () => {
  const omitted = PACK_MCP_CALLS.find((c) => c.args?.limit === 2);
  assert.ok(omitted, `the call that omitted portal and dataset_id never reached the Socrata path; the model was told:\n${packToolResults()}`);
  assert.deepEqual({ portal: omitted!.args?.portal, dataset_id: omitted!.args?.dataset_id }, { ...PACK_FILTER });
  assert.notEqual(omitted!.args?.portal, PORTAL);
});

for (const [label, which] of [[`portal ${OTHER_PORTAL}`, 3], [`dataset_id ${OTHER_DATASET}`, 4], [`a fetch of ${OUTSIDE_ID}`, 'fetch']] as const) {
  test(`S2-B W3: a pack call naming ${label} is refused before any request and recorded as a rejected call naming the pack`, () => {
    const sent = PACK_MCP_CALLS.filter((c) => (which === 'fetch' ? c.tool === 'fetch' : c.args?.limit === which));
    assert.deepEqual(sent, [], 'the refused call reached the Socrata path');
    const span = packSpan(traceOf(PACK), which);
    assert.ok(span, 'premise: the trace has a span for the refused call');
    assert.equal(span!['error'], true, 'the call is not recorded as rejected');
    assert.equal(span!['mcp.pack_id'], PACK_ID, 'the rejected call does not name the pack');
    const recorded = toolCallsOf(PACK).filter((c) => (which === 'fetch' ? c.name === 'nyc_record__fetch' : c.name === 'nyc_record__get_data' && c.args?.limit === which));
    assert.equal(recorded.length, 1, 'premise: the completed tool calls hold the refused call once');
    assert.equal(recorded[0].failed, true, 'the completed tool call is not marked failed');
  });
}

// --- S2-B W4 (npstorey/civic-ai-tools#309): the inventory an in-loop run was routed against -----------------
//
// G0-B7 A: an in-loop run's root span states `analysis.considered` (a third in-loop attribute), and the record
// packaged from it states `composition.considered`, the same object: the inventory by reference (`id`, `version`
// in `<version>+<hash12>` form, `hash`), `total` its entries, `listed` the directory set the model was shown,
// `rule` `directory-set`, `ruleVersion` `'1'`. An all-sources run states neither (the decoy). The harness
// definition's components name the inventory; the record's `components[]` do not, so `definitionHash` moves for
// every in-loop record from this release.
//
// WHY THE FORM. The harness carries the span's object into the record unchanged and refuses a `version` that is not
// `<YYYY-MM-DD>.<n>+<hash12>`: the F3 decoy builds the composition block from the span's value with the bare
// `CIVIC_INVENTORY.version` and is refused. At tree 3 no route writes the attribute.

const harness = await import('@typedstandards/civic-typed-harness');
const EXPECTED_CONSIDERED = {
  inventory: INVENTORY_REFERENCE,
  total: router.civicRouter.manifest.length,
  listed: DIRECTORY_IDS.length,
  rule: 'directory-set',
  ruleVersion: '1',
};

test('S2-B W4 premise: the installed router\'s inventory is civic 2026-11-12.1, seven entries, and the drives\' directory set lists four', () => {
  assert.equal(CIVIC_INVENTORY.id, 'civic');
  assert.equal(CIVIC_INVENTORY.version, '2026-11-12.1');
  assert.equal(router.civicRouter.manifest.length, 7);
  assert.deepEqual(DIRECTORY_IDS, ['socrata', 'data-commons', 'boston-opencontext', 'nyc-record']);
});

for (const d of [IN_LOOP, NOTEBOOK_IN_LOOP, PACK]) {
  test(`S2-B W4, ${d.name}: the root span states analysis.considered once: the inventory, seven entries, the four listed, directory-set version 1`, () => {
    const root = spans(traceOf(d)).find((s) => !s.parentSpanId)!;
    const written = root.attributes.filter((a) => a.key === 'analysis.considered');
    assert.equal(written.length, 1, `analysis.considered is written ${written.length} times`);
    // Byte for byte: the harness's key order, the inventory in the record's form.
    assert.equal(written[0].value.stringValue, JSON.stringify(EXPECTED_CONSIDERED));
  });
}

test('S2-B W4: the record packaged from the in-loop run states composition.considered, last, equal to the span\'s', () => {
  const { pkg } = packageOf(IN_LOOP);
  const composition = pkg.extensions?.['org.civicaitools.composition'] as Json;
  assert.deepEqual(composition.considered, EXPECTED_CONSIDERED);
  assert.equal((composition.considered as { inventory: { version: string } }).inventory.version, `${CIVIC_INVENTORY.version}+${CIVIC_INVENTORY.hash.slice(0, 12)}`);
  assert.equal(Object.keys(composition).at(-1), 'considered');
  assert.deepEqual(JSON.parse(rootAttributes(traceOf(IN_LOOP))['analysis.considered'] ?? 'null'), composition.considered);
});

test('S2-B W4 decoy (G0-B7 A): an all-sources run states no considered, on the span or in the record', () => {
  for (const d of [UNSET, ALL_SOURCES, THIRD_VALUE]) {
    assert.equal(Object.hasOwn(rootAttributes(traceOf(d)), 'analysis.considered'), false, `${d.name}: the root span states analysis.considered`);
  }
  const composition = packageOf(UNSET).pkg.extensions?.['org.civicaitools.composition'] as Json;
  assert.equal(Object.hasOwn(composition, 'considered'), false, 'the all-sources record carries a considered key');
});

test('S2-B W4: the definition\'s components name the inventory and the record\'s components do not, so definitionHash moves', (t) => {
  const root = rootAttributes(traceOf(IN_LOOP));
  const recordComponents = (packageOf(IN_LOOP).pkg.extensions?.['org.civicaitools.composition'] as Json).components as Array<{ id: string; version?: string; guidanceHash?: string }>;
  const spanComponents = JSON.parse(root['analysis.components'] ?? 'null') as Array<{ id: string }>;
  assert.deepEqual(spanComponents.map((c) => c.id), recordComponents.map((c) => c.id), 'premise: the record\'s components are the span\'s');
  assert.equal(recordComponents.some((c) => c.id === INVENTORY_REFERENCE.id), false, 'the record\'s components name the inventory');
  const before = router.civicRouter.harnessDefinition({ configured, selection: ['socrata'], chosenBy: 'model', components: recordComponents });
  const after = router.civicRouter.harnessDefinition({ configured, selection: ['socrata'], chosenBy: 'model', components: [...recordComponents, INVENTORY_COMPONENT] });
  assert.ok(after.components.some((c) => c.id === INVENTORY_REFERENCE.id && c.version === INVENTORY_REFERENCE.version), 'the definition\'s components do not name the inventory');
  t.diagnostic(`definitionHash for this run: before (record components only) ${before.hash}; after (with ${INVENTORY_COMPONENT.id} ${INVENTORY_COMPONENT.version}) ${after.hash}`);
  assert.notEqual(before.hash, after.hash, 'premise: naming the inventory moves the definition hash');
  assert.equal(root['analysis.definition_hash'], after.hash, 'the run\'s definition hash is not the definition that names the inventory');
});

test('S2-B W4 decoy (F3): a considered whose inventory version is the bare CIVIC_INVENTORY.version is refused by the harness; the span\'s is accepted', () => {
  const stated = JSON.parse(rootAttributes(traceOf(IN_LOOP))['analysis.considered'] ?? 'null') as typeof EXPECTED_CONSIDERED | null;
  assert.ok(stated, 'premise: the in-loop root span states analysis.considered');
  assert.doesNotThrow(() => harness.buildCompositionExtension({ considered: stated! }));
  const bare = { ...stated!, inventory: { ...stated!.inventory, version: CIVIC_INVENTORY.version } };
  assert.throws(
    () => harness.buildCompositionExtension({ considered: bare }),
    (error: unknown) => error instanceof harness.RecordFieldError && /inventory\.version/.test((error as Error).message),
  );
});

// --- S2-B W6, D3 and R5 (npstorey/civic-ai-tools#309): the pack's credit, its base, and the chooser line ------
//
// W6 (bundle `:49`; card G0-B8 A): the pack's component is its id with `version` `<version>+<hash12>`, read from the
// installed manifest entry's `pack` member, and its guidance fields when its block is in the prompt. The pack
// drive loads City Record and not Socrata, so its base is stated too, as `{ id }`, at its manifest position. The
// definition's components carry the per-source components, so the credit moves this run's definition hash.
//
// D3 = A and R5: the record page names the loaded pack with bundle `:331`'s fallback clause, the id whole in one code
// part, and states R5's definition once after the groups. The in-loop drive, which loads Socrata only, is the decoy.
//
// RED at tree 5b (d99f2532): the pack's component has no version and no base is stated; the Loaded line names no pack.

const PACK_ENTRY = router.civicRouter.manifest.find((entry) => entry.sourceId === 'nyc-record')!;
const PACK_CREDIT = `${PACK_ENTRY.pack!.version}+${PACK_ENTRY.pack!.hash.slice(0, 12)}`;
const PACK_DEFINITION = 'A pack is a source with no server of its own. Its requests go through the server of the source named after “using”, limited to what the pack fixes in advance, such as one dataset.';

test('S2-B W6: the pack drive\'s trace and record credit the pack and state its base, which the run did not load', () => {
  const stated = JSON.parse(rootAttributes(traceOf(PACK))['analysis.components'] ?? 'null') as Array<{ id: string; version?: string; guidanceHash?: string; guidanceOrigin?: string }>;
  assert.deepEqual(stated.map((c) => c.id), [SOCRATA_SERVER_ID, PACK_ID, '@typedstandards/civic-typed-router']);
  // S2-B P3R (criterion 4): the base's bare { id }, with what the base reported on the read the check compared.
  assert.deepEqual(stated[0], { id: SOCRATA_SERVER_ID, reportedName: 'socrata-mcp-server', reportedVersion: '0.9.2' }, 'the base is not stated as { id } with its report alone');
  const pack = stated[1];
  assert.equal(pack.version, PACK_CREDIT);
  assert.equal(PACK_CREDIT, '1.1+ef1b4b6089e9');
  assert.match(pack.guidanceHash ?? '', /^[0-9a-f]{64}$/);
  assert.equal(pack.guidanceOrigin, 'inline');
  const record = (packageFrom(traceOf(PACK), toolCallsOf(PACK)).pkg.extensions?.['org.civicaitools.composition'] as Json).components;
  assert.deepEqual(record, stated, 'the record\'s components are not the span\'s');
});

test('S2-B W6: the pack drive\'s definition hash is the definition over the credited components and the stated base', (t) => {
  const root = rootAttributes(traceOf(PACK));
  const stated = JSON.parse(root['analysis.components'] ?? 'null') as Array<{ id: string; version?: string }>;
  assert.equal(stated.find((c) => c.id === PACK_ID)?.version, PACK_CREDIT, 'the run does not credit the pack');
  const uncredited = stated.filter((c) => c.id !== SOCRATA_SERVER_ID).map((c) => (c.id === PACK_ID ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'version')) : c)) as typeof stated;
  const before = router.civicRouter.harnessDefinition({ configured, selection: ['nyc-record'], chosenBy: 'model', components: [...uncredited, INVENTORY_COMPONENT] });
  const after = router.civicRouter.harnessDefinition({ configured, selection: ['nyc-record'], chosenBy: 'model', components: [...stated, INVENTORY_COMPONENT] });
  t.diagnostic(`pack drive definitionHash: before (no credit, no base) ${before.hash}; after ${after.hash}`);
  assert.notEqual(before.hash, after.hash, 'premise: the credit and the base move the definition hash');
  assert.equal(root['analysis.definition_hash'], after.hash, 'the run\'s definition hash is not the definition over the credited components');
  // S2-B P3R (the seat's ruling 4): the reported keys sit beside `id`, so the definition is the same without them.
  const unreported = stated.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'reportedName' && k !== 'reportedVersion'))) as typeof stated;
  assert.notDeepEqual(unreported, stated, 'premise: the stated components carry reported keys');
  const withoutKeys = router.civicRouter.harnessDefinition({ configured, selection: ['nyc-record'], chosenBy: 'model', components: [...unreported, INVENTORY_COMPONENT] });
  assert.equal(withoutKeys.hash, after.hash, 'the reported keys moved the definition hash');
});

test('S2-B P3R: the pack drive read the base\'s list once, on the Socrata path, for its two sent pack calls', () => {
  assert.deepEqual(PACK_LISTS, ['/socrata/mcp'], `the pack drive's tools/list reads: ${JSON.stringify(PACK_LISTS)}`);
  assert.equal(PACK_MCP_CALLS.length, 2, 'premise: two pack calls were sent');
});

test('S2-B D3 and R5: adaptRecord over the pack drive\'s record names the pack on the Loaded line, the id whole in a code part, then the definition once', async () => {
  const { adaptRecord } = (await import(ADAPT_RECORD)) as Loose;
  const { chooserLines } = (await import(SOURCE_CHOOSER)) as Loose;
  const model = adaptRecord({ stored: packageFrom(traceOf(PACK), toolCallsOf(PACK)).pkg, resolution: null, row: { slug: 's2b-d3', summary: 'City Record notices.', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' }, instance: null, servedStatement: null });
  const lines = chooserLines(model.whereItWent?.chooser) as Loose[];
  const loaded = lines.find((l) => String(l.text).startsWith('Loaded: '));
  assert.equal(loaded?.text, `Loaded: NYC City Record (a pack recorded as ${PACK_ID}, using Socrata).`);
  assert.deepEqual(loaded?.parts, [{ text: 'Loaded: NYC City Record (a pack recorded as ' }, { text: PACK_ID, code: true }, { text: ', using Socrata).' }]);
  assert.deepEqual(lines.filter((l) => l.kind === 'definition'), [{ text: PACK_DEFINITION, kind: 'definition' }]);
  assert.deepEqual(lines.at(-1), { text: PACK_DEFINITION, kind: 'definition' });
});

test('S2-B R5 decoy: adaptRecord over the in-loop drive\'s record, which loads no pack, shows no clause and no definition', async () => {
  const { chooserLines } = (await import(SOURCE_CHOOSER)) as Loose;
  const model = await recordView(IN_LOOP);
  const lines = chooserLines(model.whereItWent?.chooser) as Loose[];
  assert.equal(lines.some((l) => l.kind !== undefined || l.parts !== undefined || String(l.text).includes('A pack is')), false);
});
