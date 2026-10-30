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
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  const route = req.url ?? '';
  if (msg.method === 'initialize') {
    const instructions = route.startsWith('/dc/') ? { instructions: DATA_COMMONS_INSTRUCTIONS } : {};
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r8-w1' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r8-w1-fixture', version: '0' }, ...instructions } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  if (msg.method === 'tools/call') MCP_CALLS.push({ path: route, tool: msg.params?.name });
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

function turnFor(body: Record<string, unknown>): Call[] | null {
  const tools = (body.tools ?? []) as Array<{ function: { name: string } }>;
  if (tools.length === 0) return null;
  const messages = (body.messages ?? []) as Array<{ role?: string }>;
  const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
  const inLoop = tools.some((t) => t.function.name === 'load_source');
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
const DIRECTORY_IDS = ['socrata', 'data-commons', 'boston-opencontext'];
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
  const components = [
    { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: sha(block), guidanceOrigin: 'fallback' },
    { id: '@typedstandards/civic-typed-router', version: ROUTER_VERSION },
  ];
  assert.deepEqual(JSON.parse(root['analysis.components'] ?? 'null'), components);
  assert.equal(root['analysis.tool_definitions'], JSON.stringify(last.body.tools));
  const definition = router.civicRouter.harnessDefinition({ configured, selection: ['socrata'], chosenBy: 'model', components });
  assert.equal(root['analysis.definition_hash'], definition.hash);
  // As composed (C4): the directory set's reasons, not recomputed after loads.
  // R6 W3 (#632, contract item 10): with the gate on and every source On, the
  // record states the router's `selected` where it stated `configured` before
  // W3 — the signed-byte move the gate record names.
  assert.deepEqual(JSON.parse(root['analysis.sources_offered'] ?? 'null').map((s: { reason: string }) => s.reason), ['selected', 'selected', 'selected', 'not-configured', 'not-configured', 'not-configured', 'not-configured']);
  // Router 0.6.0 (R8 W3): the three new hosted sources, switches unset, are not configured.
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
  assert.deepEqual(Object.keys(composition).slice(-2), ['routing', 'definitionHash'], 'routing and definitionHash are not the block\'s last two keys');
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
  assert.deepEqual(environment.find((i) => i.label === CARD.label), { label: CARD.label, value: CARD.inLoop(ROUTER_VERSION) });
  assert.deepEqual(environment.find((i) => i.label === CARD.definitionLabel), { label: CARD.definitionLabel, value: (composition.definitionHash as string).slice(0, 12), mono: true });
  assert.equal(typeof chooserLines, 'function', 'source-chooser.ts exports no chooserLines');
  assert.deepEqual(chooserLines(model.whereItWent?.chooser), [
    T.inLoop,
    `${T.loaded}Socrata.`,
    `${T.askedNotLoaded}${T.none}.`,
    `${T.neverAsked}Data Commons${T.separator}Boston OpenContext.`,
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
  assert.deepEqual(chooserLines(model.whereItWent?.chooser), [T.notRecorded]);
});
