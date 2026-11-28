// S3-B W1 (npstorey/civic-ai-tools#318; G0-2 = A, G0-4 = A; criteria W1-1, W1-2, W1-5's server half and W1-7):
// "Only the ones I pick" at the three routes a question can reach.
//
// WHAT IS DRIVEN. The REAL `/api/compare-stream`, `/api/query-notebook` and `/api/compare` handlers, through the real
// consent gate, prompt composer, MCP client, loop core, trace builder and packager, as `in-loop-routing-driven.test.ts`
// drives them (`module.registerHooks()` resolves the `@/` alias and stubs the four modules that need a request scope,
// a sign-in provider or a sandbox). The model is a loopback server that records each request; the three remote sources
// are one loopback MCP server on three paths, recording every request by path. No live endpoint, no credential.
//
// THE FIXTURE. Configured: Socrata, Data Commons, Boston OpenContext and NYC City Record (a pack over Socrata). The
// consent in force: Socrata On, Data Commons On, Boston OpenContext Off, City Record Ask first. The picks sent:
// Socrata, City Record, Boston OpenContext (Off), NYC Charter (not configured), an id the manifest does not hold,
// Socrata again, and a number. So the surviving picks are Socrata and City Record, and the run lists those two.
//
// WHAT MAKES IT ABLE TO FAIL (the decoys). Data Commons is On and unpicked: the Auto run lists it, loads it when the
// model asks, and calls it, so every "never" below about Data Commons is shown false on the Auto drive first. The
// model's script is the same on every in-loop drive: it loads Socrata, then calls Socrata, loads Data Commons, calls
// Data Commons and calls Boston. At `15a52942` the routes ignore `picks`, so a picked run is an Auto run: it lists
// Data Commons, records `directory-set`, and no question is refused for its picks.
//
// BLIND SPOTS, stated. `/api/compare` writes no trace, so its `considered` and routing configuration are not on any
// wire: there it is read from what the model was sent and from "Where this question went". The pause is not held here
// (no decision store); a picked Ask-first source at the pause is `src/lib/sources/picks.test.ts`'s drive.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

const PORTAL = 'data.example.org';
/** A distinctive word in the question, so the server's requests to anything but the model can be scanned for it. */
const WORD = 'quillwort';
const QUESTION = `How many ${WORD} permits were issued in 2025?`;
const ANSWER = 'One figure was retrieved.';

// --- Every request this process sends: loopback only, recorded -------------------------------------------------

const FETCHES: Array<{ url: string; body: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  FETCHES.push({ url: url.href, body: typeof init?.body === 'string' ? init.body : '' });
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks ------------------------------------------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-s3b-w1-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.49' }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__notebookSession ?? null; }`,
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
      throw new Error(`S3-B W1 test hook: cannot resolve ${specifier}`);
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

const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- The loopback MCP sources, recording every request by path ---------------------------------------------------

const ONE_ROW = JSON.stringify({ data: [{ count: '512' }], total_rows: 1 });
const MCP: Array<{ path: string; method?: string; tool?: string; body: string }> = [];
const GR = JSON.parse(fs.readFileSync(path.join(SRC, 'lib/mcp/fixtures/socrata-tools-at-gr.json'), 'utf8')) as { serverInfo: { name: string; version: string }; tools: unknown[] };
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }) : {};
  const route = req.url ?? '';
  MCP.push({ path: route, method: msg.method, tool: msg.params?.name, body });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-s3b-w1' });
    const serverInfo = route.startsWith('/socrata/') ? GR.serverInfo : { name: 'civic-s3b-w1-fixture', version: '0' };
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo } }));
    return;
  }
  if (msg.method === 'tools/list') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { tools: route.startsWith('/socrata/') ? GR.tools : [] } }));
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

// --- The loopback model: one script for every drive --------------------------------------------------------------

const MODEL_REQUESTS: Array<{ raw: string; body: Record<string, unknown> }> = [];
type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
const call = (id: string, name: string, args: Record<string, unknown>): Call =>
  ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function turnFor(body: Record<string, unknown>): Call[] | null {
  const tools = (body.tools ?? []) as Array<{ function: { name: string } }>;
  if (tools.length === 0) return null;
  const assistantTurns = ((body.messages ?? []) as Array<{ role?: string }>).filter((m) => m.role === 'assistant').length;
  const inLoop = tools.some((t) => t.function.name === 'load_source');
  if (!inLoop) {
    return assistantTurns === 0
      ? [
          call('call-socrata', 'socrata__get_data', { type: 'query', dataset_id: 'aaaa-1111', limit: 1 }),
          call('call-dc', 'data_commons__search_indicators', { query: 'permits' }),
        ]
      : null;
  }
  if (assistantTurns === 0) return [call('call-load-socrata', 'load_source', { alias: 'socrata' })];
  if (assistantTurns === 1) {
    return [
      call('call-socrata', 'socrata__get_data', { type: 'query', dataset_id: 'aaaa-1111', limit: 1 }),
      call('call-load-dc', 'load_source', { alias: 'data_commons' }),
    ];
  }
  if (assistantTurns === 2) {
    return [
      call('call-dc', 'data_commons__search_indicators', { query: 'permits' }),
      call('call-boston', 'boston_opencontext__ckan__query_data', { resource_id: 'r-1', limit: 1 }),
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
        `data: ${JSON.stringify({ id: 'chatcmpl-s3b-w1', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = turnFor(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-s3b-w1',
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

// --- Environment, before any app module loads --------------------------------------------------------------------

for (const name of [
  'DATA_COMMONS_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'MODEL_API_KEY', 'OPENAI_API_KEY',
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'EXECUTOR_DRIVER', 'NYC_CHARTER_HOSTING',
  'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'SOURCE_ROUTING',
]) {
  delete process.env[name];
}
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-s3b-w1';
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
const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');
const { friendlyStreamError } = await import('../../lib/streaming.ts');
const { chooserFromTrace, chooserFromPackage, chooserLines } = await import('../../lib/flows/source-chooser.ts');
const verifyCore = await import('@typedstandards/verify-core');
const verifyCoreVersion = (await import('@typedstandards/verify-core/package.json', { with: { type: 'json' } })).default.version;
const { ed25519ph } = await import('@noble/curves/ed25519.js');

// --- The drives --------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
interface Drive {
  name: string;
  status: number;
  text: string;
  setCookie: string | null;
  requests: Array<{ raw: string; body: Json }>;
  mcp: Array<{ path: string; method?: string; tool?: string; body: string }>;
  fetches: Array<{ url: string; body: string }>;
}

const STATES = { socrata: 'on', 'data-commons': 'on', 'boston-opencontext': 'off', 'nyc-record': 'ask-first' } as const;
const COOKIE = consentCookieForTests(STATES);
/** The picks as sent: two that survive, and one of each kind that must add nothing. */
const PICKS: unknown[] = ['socrata', 'nyc-record', 'boston-opencontext', 'nyc-charter', 'not-a-source', 'socrata', 7];
const SURVIVORS = ['socrata', 'nyc-record'];
/** Picks none of which can be used: Off, not configured, unknown. */
const NONE_USABLE: unknown[] = ['boston-opencontext', 'nyc-charter', 'not-a-source'];

const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: COOKIE }, body: JSON.stringify(body) }) as never;

async function drive(name: string, routing: 'in-loop' | 'all-sources', run: () => Promise<Response>): Promise<Drive> {
  process.env.SOURCE_ROUTING = routing;
  const from = MODEL_REQUESTS.length;
  const mcpFrom = MCP.length;
  const fetchFrom = FETCHES.length;
  try {
    const response = await run();
    const text = await response.text();
    return {
      name, status: response.status, text, setCookie: response.headers.get('set-cookie'),
      requests: MODEL_REQUESTS.slice(from), mcp: MCP.slice(mcpFrom), fetches: FETCHES.slice(fetchFrom),
    };
  } finally {
    delete process.env.SOURCE_ROUTING;
  }
}

const compareStreamRoute = await import('./compare-stream/route.ts');
// The notebook route requires sign-in: its requests carry a session, and no other route's do.
const NOTEBOOK_SESSION = globalThis as unknown as { __notebookSession: unknown };
function signedIn<A extends unknown[]>(post: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args) => {
    NOTEBOOK_SESSION.__notebookSession = { user: { id: 'fixture-account' } };
    try { return await post(...args); } finally { NOTEBOOK_SESSION.__notebookSession = null; }
  };
}
const notebookRoute = { POST: signedIn((await import('./query-notebook/route.ts')).POST) };
const compareRoute = await import('./compare/route.ts');
const streamBody = (extra: Json = {}) => ({ query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true, ...extra });
const notebookBody = (extra: Json = {}) => ({ query: QUESTION, portal: PORTAL, ...extra });
const compareBody = (extra: Json = {}) => ({ query: QUESTION, model: 'fixture-fast', portal: PORTAL, ...extra });
const stream = (extra: Json = {}) => () => compareStreamRoute.POST(post('/api/compare-stream', streamBody(extra)));
const notebook = (extra: Json = {}) => () => notebookRoute.POST(post('/api/query-notebook', notebookBody(extra)));
const compare = (extra: Json = {}) => () => compareRoute.POST(post('/api/compare', compareBody(extra)));

const AUTO_STREAM = await drive('compare-stream, Auto', 'in-loop', stream());
const AUTO_NOTEBOOK = await drive('query-notebook, Auto', 'in-loop', notebook());
const AUTO_COMPARE = await drive('compare, Auto', 'in-loop', compare());
const PICKED_STREAM = await drive('compare-stream, picked', 'in-loop', stream({ picks: PICKS }));
const PICKED_NOTEBOOK = await drive('query-notebook, picked', 'in-loop', notebook({ picks: PICKS }));
const PICKED_COMPARE = await drive('compare, picked', 'in-loop', compare({ picks: PICKS }));
const PICKED_ALL_SOURCES = await drive('compare-stream, all-sources, picked', 'all-sources', stream({ picks: PICKS }));
const AUTO_ALL_SOURCES = await drive('compare-stream, all-sources, Auto', 'all-sources', stream());
const REFUSED = [
  await drive('compare-stream, no usable pick', 'in-loop', stream({ picks: NONE_USABLE })),
  await drive('query-notebook, no usable pick', 'in-loop', notebook({ picks: NONE_USABLE })),
  await drive('compare, no usable pick', 'in-loop', compare({ picks: NONE_USABLE })),
  await drive('compare-stream, picks not an array', 'in-loop', stream({ picks: 'socrata' })),
  await drive('query-notebook, picks an empty array', 'in-loop', notebook({ picks: [] })),
  // A6: only an Ask-first pick survives, and the run cannot pause to ask (no decision store; the JSON route never).
  await drive('compare, only an Ask-first pick', 'in-loop', compare({ picks: ['nyc-record'] })),
  await drive('compare-stream, only an Ask-first pick, no store', 'in-loop', stream({ picks: ['nyc-record'] })),
  // A7: an all-sources instance narrows to the surviving picks that are On; none, so refused.
  await drive('compare-stream, all-sources, no usable pick', 'all-sources', stream({ picks: NONE_USABLE })),
];

// --- Readers ---------------------------------------------------------------------------------------------------------

interface Span { name: string; parentSpanId?: string; attributes: Array<{ key: string; value: { stringValue?: string } }> }

function events(d: Drive): Json[] {
  return d.text.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice('data: '.length)) as Json]; } catch { return []; }
  });
}
function jsonOf(d: Drive): Json | null {
  try { return JSON.parse(d.text) as Json; } catch { return null; }
}
function traceOf(d: Drive): Json {
  const all = events(d);
  const trace = (all.find((e) => e.type === 'trace')?.data ?? (all.find((e) => e.type === 'publish_inputs') as Json | undefined)?.trace) as Json | undefined;
  assert.ok(trace, `${d.name}: premise — the route emitted no trace:\n${d.text.slice(0, 600)}`);
  return trace!;
}
function rootAttributes(trace: Json): Record<string, string> {
  const spans = (trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find((s) => !s.parentSpanId);
  assert.ok(root, 'premise — the trace has no root span');
  return Object.fromEntries(root!.attributes.map((a) => [a.key, a.value.stringValue ?? '']));
}
/** The requests that offered tools: the data half's turns. */
function toolRequests(d: Drive): Array<{ raw: string; body: Json }> {
  const offered = d.requests.filter((r) => Array.isArray(r.body.tools) && (r.body.tools as unknown[]).length > 0);
  assert.ok(offered.length > 0, `${d.name}: premise — no model request offered any tool:\n${d.text.slice(0, 600)}`);
  return offered;
}
type ToolSchema = { function: { name: string; parameters?: { properties?: { alias?: { enum?: string[] } } } } };
const toolNames = (r: { body: Json }): string[] => ((r.body.tools ?? []) as ToolSchema[]).map((t) => t.function.name);
const loadEnum = (r: { body: Json }): string[] | undefined => ((r.body.tools ?? []) as ToolSchema[]).find((t) => t.function.name === 'load_source')?.function.parameters?.properties?.alias?.enum;
function systemText(r: { body: Json }): string {
  const system = ((r.body.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : '';
}
/** "Where this question went" as each route carries it. */
function flowsOf(d: Drive): { notReached: Array<{ sourceId: string; whyNotSent: string }> } {
  const all = events(d);
  const flows = (all.find((e) => e.type === 'complete' && e.panel === 'withMcp')?.data as Json | undefined)?.flows
    ?? all.find((e) => e.type === 'phase' && e.name === 'complete')?.flows
    ?? ((jsonOf(d)?.withMcp as Json | undefined)?.flows);
  assert.ok(flows, `${d.name}: premise — no "Where this question went" on the wire`);
  return flows as { notReached: Array<{ sourceId: string; whyNotSent: string }> };
}
/** What a source path the run contacted: every MCP request, by the source its path names. */
const contacted = (d: Drive): string[] => [...new Set(d.mcp.map((r) => r.path.split('/')[1]))].sort();
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const configured = readMcpEnvFromProcess();
const today = () => new Date().toISOString().slice(0, 10);

const S10 = 'None of the data sources you picked could be used, so nothing was sent. Pick again, or choose Auto.';
const S11 = 'Not picked for this question.';

// --- The decoy, first: what the Auto run does with the same script ---------------------------------------------------

test('premise (decoy able to fail): an Auto run lists Data Commons, loads it and calls it, with the same model script', () => {
  for (const d of [AUTO_STREAM, AUTO_NOTEBOOK, AUTO_COMPARE]) {
    assert.deepEqual(loadEnum(toolRequests(d)[0]), ['socrata', 'data_commons', 'nyc_record'], `${d.name}: the Auto directory`);
    assert.ok(contacted(d).includes('dc'), `${d.name}: the Auto run never contacted Data Commons: ${contacted(d).join(', ')}`);
  }
});

// --- W1-1 (B1's picked line, B9) ---------------------------------------------------------------------------------------

for (const d of [PICKED_STREAM, PICKED_NOTEBOOK, PICKED_COMPARE]) {
  test(`W1-1 (${d.name}): the first request carries exactly load_source, over the surviving picks only`, () => {
    const first = toolRequests(d)[0];
    assert.deepEqual(toolNames(first), ['load_source']);
    assert.deepEqual(loadEnum(first), ['socrata', 'nyc_record']);
    assert.equal(systemText(first), router.civicRouter.directoryPrompt({ configured, today: today(), selection: SURVIVORS }));
  });
}

for (const d of [PICKED_STREAM, PICKED_NOTEBOOK]) {
  test(`W1-1 (${d.name}): considered reads reader-picked, version 1, listed the two surviving picks`, () => {
    const root = rootAttributes(traceOf(d));
    const considered = JSON.parse(root['analysis.considered'] ?? 'null') as Json | null;
    assert.ok(considered, `${d.name}: the root states no considered`);
    assert.equal(considered!.rule, 'reader-picked');
    assert.equal(considered!.ruleVersion, '1');
    assert.equal(considered!.listed, 2);
    assert.equal(considered!.total, router.civicRouter.manifest.length);
  });

  test(`W1-1 (${d.name}): the routing configuration reads rule reader-picked 1, cap none, search none`, () => {
    const stated = JSON.parse(rootAttributes(traceOf(d))['analysis.routing_configuration'] ?? 'null') as Json | null;
    assert.ok(stated, `${d.name}: the root states no routing configuration`);
    assert.deepEqual(stated!.rule, { id: 'reader-picked', version: '1' });
    assert.equal(stated!.cap, 'none');
    assert.equal(stated!.search, 'none');
  });
}

test('W1-1 decoy: the Auto runs still read directory-set 1, and their first request is the Auto one', () => {
  for (const d of [AUTO_STREAM, AUTO_NOTEBOOK]) {
    const root = rootAttributes(traceOf(d));
    assert.equal((JSON.parse(root['analysis.considered']) as Json).rule, 'directory-set');
    assert.deepEqual((JSON.parse(root['analysis.routing_configuration']) as Json).rule, { id: 'directory-set', version: '1' });
  }
  assert.notEqual(toolRequests(PICKED_STREAM)[0].raw, toolRequests(AUTO_STREAM)[0].raw, 'premise: the picked request differs from the Auto one');
});

/**
 * An Auto run's request and record bytes, read so that only what this suite cannot hold still is left out: the
 * loopback ports and the day. Every model request the Auto compare-stream run sent, then its root span's attributes
 * but the flows statement reference (whose hash covers the statement's loopback addresses).
 */
function autoBytes(): string {
  // The inventory's version is a date (`2026-11-18.1` since router 0.12.0, CKAN-2-WEB P1): it is held apart before the
  // run date is, so a run on the day an inventory was published normalizes the same as a run on any other day.
  const normal = (text: string) => text.split(MCP_ORIGIN).join('MCP').split(MODEL_ORIGIN).join('MODEL').split(router.CIVIC_INVENTORY.version).join('INVENTORY_VERSION').split(today()).join('TODAY');
  const root = rootAttributes(traceOf(AUTO_STREAM));
  delete root['analysis.flows_statement'];
  return normal(JSON.stringify({ requests: AUTO_STREAM.requests.map((r) => r.raw), root }));
}
/** Measured at `15a52942` (the base, which has no picks) by this function: `fe0b75f29d4d53e8a32802baa9a7abe4fbec01223445ce6c09ee7dc73820f3c3`.
 *  CKAN-1 P3 (router 0.11.0): re-measured at stage L, where these bytes moved, diffed through files against the
 *  base `71b43b0` with nothing else changed, by exactly the bump's named facts: Boston OpenContext's alias
 *  (`boston_opencontext`, in a tool name and its `sourcesOffered` row), the CKAN server's and the Boston pack's two
 *  not-configured rows, the router's version (component and routing), the inventory reference (version 4,
 *  `2026-11-13.1`, nine entries) and the two hashes over it (the definition and the routing configuration).
 *  CKAN-2-WEB P1 (router 0.12.0): re-measured, diffed against `6bb13276` with nothing else changed, by exactly the
 *  bump's named facts: the retired Boston pack's not-configured `sourcesOffered` row (gone), the router's version
 *  (component and routing, 0.11.0 to 0.12.0), the inventory reference (version 5, `2026-11-18.1`, its hash, eight
 *  entries for nine) and the two hashes over it (the definition and the routing configuration). The inventory's
 *  version is now held apart from the run date in `normal` (it is a date, and equal to the run date on the day it was
 *  published), so the bytes no longer depend on the day the suite runs. */
const AUTO_BYTES_SHA256 = '6d1bb1ef5c888afd362a517a3aaf46a9073662842fe89afe0bffa0513281c195';

test('W1-1 pin (decoy): an Auto run\'s request and record bytes do not move', () => {
  assert.equal(sha(autoBytes()), AUTO_BYTES_SHA256);
});

// --- W1-2 (B8, R5): picks narrow only ----------------------------------------------------------------------------------

for (const d of [PICKED_STREAM, PICKED_NOTEBOOK, PICKED_COMPARE]) {
  test(`W1-2 (${d.name}): no request lists or offers an Off, unconfigured, unknown or unpicked source, and no call reaches one`, () => {
    for (const r of toolRequests(d)) {
      const names = toolNames(r);
      // CKAN-1 P3 (router 0.11.0): Boston OpenContext's alias is `boston_opencontext`; `boston` is the Boston pack's.
      assert.ok(!names.some((n) => /^(data_commons|boston_opencontext|boston|nyc_charter)__/.test(n)), `${d.name}: a request offers ${names.join(', ')}`);
      const choices = loadEnum(r) ?? [];
      for (const alias of ['data_commons', 'boston_opencontext', 'boston', 'nyc_charter']) assert.ok(!choices.includes(alias), `${d.name}: ${alias} is in a load_source enum`);
    }
    assert.deepEqual(contacted(d), ['socrata'], `${d.name}: the run contacted ${contacted(d).join(', ')}`);
  });

  test(`W1-2 (${d.name}): "Where this question went" names Data Commons with S11, Boston with Off, City Record as Ask first`, () => {
    const why = Object.fromEntries(flowsOf(d).notReached.map((row) => [row.sourceId, row.whyNotSent]));
    assert.equal(why['data-commons'], S11);
    // Moved by S4 W2b (C3-O = B): S125[5] and S125[6].
    assert.equal(why['boston-opencontext'], 'Disabled.');
    assert.equal(why['nyc-record'], 'Not enabled: not asked for this question.');
  });
}

test('W1-2: the record states not-selected for the allowed source not picked, reader-off and not-consented as today', () => {
  for (const d of [PICKED_STREAM, PICKED_NOTEBOOK]) {
    const offered = JSON.parse(rootAttributes(traceOf(d))['analysis.sources_offered']) as Array<{ sourceId: string; reason: string }>;
    const reason = Object.fromEntries(offered.map((o) => [o.sourceId, o.reason]));
    assert.deepEqual(reason, {
      socrata: 'selected',
      'data-commons': 'not-selected',
      'boston-opencontext': 'reader-off',
      'nyc-charter': 'not-configured',
      'nyc-checkbook': 'not-configured',
      'nyc-record': 'not-consented',
      'nys-legislation': 'not-configured',
      // Router 0.11.0 (CKAN-1 P3): `CKAN_MCP_URL` unset. Router 0.12.0 (CKAN-2-WEB P1) retired the Boston pack, and its
      // `boston-ckan` row with it.
      'ckan-server': 'not-configured',
    }, d.name);
  }
});

test('W1-2: the chooser line leaves the unpicked source out, and names the reader\'s choice in revision 5\'s words', () => {
  const chooser = chooserFromTrace(traceOf(PICKED_STREAM));
  assert.ok(chooser, 'premise: the trace yields a chooser');
  const text = chooserLines(chooser!).map((line) => line.text + ((line as { items?: string[] }).items ?? []).join(' ')).join('\n');
  assert.ok(!text.includes('Data Commons'), text);
  assert.ok(text.includes('The person who asked this question picked those sources.'), text);
});

test('W1-2 (A7): an all-sources instance narrows to the surviving picks that are On, records no considered, and leaves Data Commons not-selected', () => {
  const d = PICKED_ALL_SOURCES;
  const names = toolNames(toolRequests(d)[0]);
  assert.ok(names.length > 0 && names.every((n) => n.startsWith('socrata__')), `the tools: ${names.join(', ')}`);
  assert.deepEqual(contacted(d), ['socrata']);
  const root = rootAttributes(traceOf(d));
  assert.ok(!('analysis.considered' in root), 'an all-sources picked run states considered');
  const reason = Object.fromEntries((JSON.parse(root['analysis.sources_offered']) as Array<{ sourceId: string; reason: string }>).map((o) => [o.sourceId, o.reason]));
  assert.equal(reason['data-commons'], 'not-selected');
  // Decoy: the Auto all-sources run offers and calls Data Commons.
  assert.ok(toolNames(toolRequests(AUTO_ALL_SOURCES)[0]).some((n) => n.startsWith('data_commons__')), 'premise: Auto all-sources offers Data Commons');
  assert.ok(contacted(AUTO_ALL_SOURCES).includes('dc'), 'premise: Auto all-sources calls Data Commons');
});

for (const d of REFUSED) {
  test(`W1-2 (${d.name}): refused with S10 before the model or any source is called`, () => {
    const refusal = (events(d).find((e) => e.type === 'error') ?? jsonOf(d)) as Json | null;
    assert.ok(refusal, `${d.name}: no refusal (status ${d.status}): ${d.text.slice(0, 400)}`);
    assert.equal(refusal!.code, 'no_picks_usable', `${d.name}: answered ${d.status}: ${d.text.slice(0, 400)}`);
    assert.equal(refusal!.message ?? refusal!.error, S10);
    assert.equal(d.requests.length, 0, `${d.name}: the model was called`);
    assert.equal(d.mcp.length, 0, `${d.name}: a source was contacted`);
  });
}

test('W1-2: S10 is friendlyStreamError\'s words for no_picks_usable', () => {
  assert.equal(friendlyStreamError({ code: 'no_picks_usable' }), S10);
});

// --- W1-4 pin (B10): a pick changes no stored consent -------------------------------------------------------------------

test('W1-4 pin: a picked question sets no cookie, so it changes no stored consent state', () => {
  for (const d of [PICKED_STREAM, PICKED_NOTEBOOK, PICKED_COMPARE, ...REFUSED]) assert.equal(d.setCookie, null, d.name);
});

// --- W1-5, the server half (B11) ----------------------------------------------------------------------------------------

test('W1-5: a picked run\'s requests to anything but the model carry no word of the question, as the Auto run\'s do', () => {
  for (const d of [AUTO_STREAM, PICKED_STREAM, PICKED_NOTEBOOK, PICKED_COMPARE]) {
    assert.ok(d.requests.some((r) => r.raw.includes(WORD)), `${d.name}: premise — the word never reached the model`);
    for (const sent of d.fetches) {
      if (sent.url.startsWith(MODEL_ORIGIN)) continue;
      assert.ok(sent.url.startsWith(MCP_ORIGIN), `${d.name}: a request went to another host: ${sent.url}`);
      assert.ok(!sent.body.includes(WORD), `${d.name}: a request to a source held the question's word`);
    }
    for (const r of d.mcp) assert.ok(!r.body.includes(WORD), `${d.name}: the source received the question's word`);
  }
});

// --- W1-7: the record ---------------------------------------------------------------------------------------------------

function packaged(): { pkg: Json; hash: string } {
  const trace = traceOf(PICKED_STREAM);
  const toolCalls = (events(PICKED_STREAM).find((e) => e.type === 'complete' && e.panel === 'withMcp')?.data as { tools_called?: unknown[] } | undefined)?.tools_called;
  const built = buildEvidencePackage({
    trace,
    prompt: QUESTION,
    output: ANSWER,
    toolCalls: toolCalls as never,
    model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'Permits',
    summary: 'Permits.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
  } as never);
  return { pkg: built.pkg as unknown as Json, hash: built.hash };
}

test('W1-7: the packaged record of the driven picked run verifies at verify-core 0.15.4', async () => {
  assert.equal(verifyCoreVersion, '0.15.4');
  const { pkg, hash: packageHash } = packaged();
  const seed = Uint8Array.from(Array.from({ length: 32 }, (_unused, i) => (i * 17 + 3) & 0xff));
  const raw = (await import('@noble/curves/ed25519.js')).ed25519.getPublicKey(seed);
  const spki = Buffer.concat([Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), Buffer.from(raw)]).toString('base64');
  const kid = String((pkg.metadata as Json).signingKeyId);
  const signature = { signature: Buffer.from(ed25519ph.sign(new TextEncoder().encode(packageHash), seed)).toString('base64'), publicKey: spki, algorithm: 'Ed25519ph', kid };
  const registry = { keys: [{ kid, publicKey: spki, status: 'active', activatedAt: '2026-01-01T00:00:00.000Z', deprecatedAt: null, revokedAt: null, signerIdentity: pkg.signer }] };
  const failFetch = (() => { throw new Error('verify-core touched the network'); }) as never;
  const result = await verifyCore.verifyEvidence(
    { package: pkg as never, packageHash, signature: signature as never, rekorEntryId: null, lifecycle: null },
    { registry: registry as never, fetch: failFetch },
  );
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureValid, true);
  assert.equal(result.contentHash?.status, 'ok');
});

test('W1-7: the packaged record names no unknown source, and states reader-picked in its composition block', () => {
  const { pkg } = packaged();
  const dataSources = (pkg.dataSources ?? []) as Array<{ sourceId?: string }>;
  assert.ok(dataSources.length > 0, 'premise: the record has a data source');
  assert.ok(!dataSources.some((entry) => entry.sourceId === 'unknown'), JSON.stringify(dataSources));
  const composition = (pkg.extensions as Json)['org.civicaitools.composition'] as Json;
  assert.equal((composition.considered as Json).rule, 'reader-picked');
  assert.deepEqual((composition.routingConfiguration as Json).rule, { id: 'reader-picked', version: '1' });
});

test('W1-7: the analysis page names the reader\'s choice in revision 5\'s reader-picked words, not directory-set\'s sentence', () => {
  const text = chooserLines(chooserFromPackage(packaged().pkg)).map((line) => line.text).join('\n');
  // Router 0.12.0 (CKAN-2-WEB P1): the inventory holds eight entries (the Boston pack retired), so the count is of 8.
  assert.ok(text.includes('The model was shown 2 of the 8 sources'), text);
  assert.ok(text.includes('The person who asked this question picked those sources. A picked source was left out if it was turned off, or not set up on the site that ran this question.'), text);
  assert.ok(!text.includes('Those were the sources set up on the site'), text);
  assert.ok(!text.includes('which this site has no words for'), text);
});

// --- M5: replaying a picked record ---------------------------------------------------------------------------------------

test('M5: a replay of the picked record lists only its surviving picks that were On, and offers no search', async () => {
  const replayLoop = await import('../../lib/model-loop/replay-loop.ts');
  const { createModelClient } = await import('../../lib/model-client.ts');
  const { pkg } = packaged();
  const offered = replayLoop.replayOfferedSet(pkg as never, configured);
  assert.deepEqual(offered.sources, ['socrata']);
  const options = await replayLoop.replayLoopOptionsForPackage({
    pkg: pkg as never,
    client: createModelClient({ apiKey: 'placeholder-model-key-s3b-w1' }),
    endpointModel: 'fake/model',
    requestSettings: undefined,
    prompt: QUESTION,
  });
  assert.ok(options.loadStep, 'premise: the record replays in loop');
  assert.deepEqual(options.tools.map((tool) => (tool as ToolSchema).function.name), ['load_source']);
  assert.deepEqual(loadEnum({ body: { tools: options.tools } as Json }), ['socrata']);
  assert.equal(options.searchStep, undefined);
});
