// #599 W4 — each query route writes what its run had onto the trace, and a
// record published later states it (#495, #475; hub ADR-0033).
//
// WHAT IS DRIVEN. The REAL `/api/compare-stream` and `/api/query-notebook`
// handlers, through the real prompt composer, the real MCP client, the real
// loop core and the real trace builder, as in
// `src/lib/an-unconfigured-source-is-absent.test.ts`: `module.registerHooks()`
// in-file resolves the `@/` alias and stubs the four modules that need a
// request scope, a sign-in provider or a sandbox (the executor returns the
// notebook it was given, so the notebook route reaches `publish_inputs`). The
// model is a loopback server that records each request and answers by what it
// is asked; the three sources are one loopback MCP server on three paths.
//
// WHAT EACH SOURCE IS MADE TO DO, so the three guidance origins all occur in
// one run: the Socrata path refuses `prompts/get` (the block is the package's
// fallback: `fallback`); the Data Commons path advertises instructions at
// `initialize` (`endpoint`); the Boston path advertises none (the block is
// the package's text alone: `inline`).
//
// WHAT IS ASSERTED, per route, from the trace the route emits:
//   - the five root-span attributes exist;
//   - `analysis.asserted_date` is the date the system message the MODEL
//     received states;
//   - `analysis.tool_definitions` is, byte for byte, the `tools` the model
//     received;
//   - `analysis.mcp_servers` is the configuration the run had;
//   - `analysis.sources_offered` states `configured` for all three;
//   - `analysis.components` names the three manifest entries and the router
//     package, and each block's hash is the hash of the block the router's own
//     per-source function composes from the same answers — a block the system
//     message carries verbatim.
// Then the instance is RESTARTED with a different Boston address (#495), and a
// record built from the notebook route's trace names the run's servers in
// `mcpServers` and in the Boston agent's address.
//
// RED at the base (a787452): the routes write none of the five attributes.
//
// No live endpoint, no credential: every key is a placeholder and every
// address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/a-run-records-its-inputs-driven.test.ts)

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

// --- The outbound recorder: loopback only -----------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks ------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-r2-w4-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.44' }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  // The real error class; an executor that returns the notebook it was given,
  // so the route goes on to emit its publish inputs. No sandbox is created.
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
      throw new Error(`R2 W4 test hook: cannot resolve ${specifier}`);
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

// --- The loopback MCP sources ------------------------------------------------

const ONE_ROW = JSON.stringify({ data: [{ count: '512' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  const route = req.url ?? '';
  if (msg.method === 'initialize') {
    const instructions = route.startsWith('/dc/') ? { instructions: DATA_COMMONS_INSTRUCTIONS } : {};
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r2-w4' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r2-w4-fixture', version: '0' }, ...instructions } }));
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
const RUN_SOCRATA = `${MCP_ORIGIN}/socrata/mcp`;
const RUN_DATA_COMMONS = `${MCP_ORIGIN}/dc/mcp`;
const RUN_BOSTON = `${MCP_ORIGIN}/boston/mcp`;
const RESTARTED_BOSTON = `${MCP_ORIGIN}/boston-after-restart/mcp`;

// --- The loopback model --------------------------------------------------------

const MODEL_REQUESTS: Array<{ raw: string; body: Record<string, unknown> }> = [];
const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(raw) as Record<string, unknown>;
    MODEL_REQUESTS.push({ raw, body });
    const messages = (body.messages ?? []) as Array<{ role?: string }>;
    const pickTools = Array.isArray(body.tools) && body.tools.length > 0 && !messages.some((m) => m.role === 'tool');
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-r2-w4', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = [
      { id: 'call-socrata', type: 'function', function: { name: 'socrata__get_data', arguments: JSON.stringify({ type: 'query', dataset_id: 'aaaa-1111', limit: 1 }) } },
      { id: 'call-boston', type: 'function', function: { name: 'boston__ckan__query_data', arguments: JSON.stringify({ resource_id: 'r-1', limit: 1 }) } },
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-r2-w4',
      object: 'chat.completion',
      created: 1,
      model: 'fake/model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: pickTools ? null : ANSWER, ...(pickTools ? { tool_calls: toolCalls } : {}) },
        finish_reason: pickTools ? 'tool_calls' : 'stop',
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
]) {
  delete process.env[name];
}
// The rate limiter is the real module, and it derives its key from this
// secret (#516 P1); an inert fixture value, not a real secret.
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = RUN_SOCRATA;
process.env.DATA_COMMONS_MCP_URL = RUN_DATA_COMMONS;
process.env.BOSTON_OPENCONTEXT_MCP_URL = RUN_BOSTON;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-r2-w4';
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
const { DATA_COMMONS_PUBLICATION_HOST } = await import('../../lib/mcp/data-commons-skill.ts');
const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');

// --- The drives -------------------------------------------------------------------

interface Drive { name: string; body: string; requests: Array<{ raw: string; body: Record<string, unknown> }> }

async function drive(name: string, run: () => Promise<Response>): Promise<Drive> {
  const from = MODEL_REQUESTS.length;
  const response = await run();
  const body = await response.text();
  return { name, body, requests: MODEL_REQUESTS.slice(from) };
}

// R6 W2 (#632): every route that sends a question refuses one with no consent in force; this
// suite's requests carry a consent (every configured source On), as a browser that had answered
// the consent card would. Nothing it asserts changes.
const { consentCookieForTests } = await import('../../lib/sources/consent-fixture.ts');
const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: consentCookieForTests() }, body: JSON.stringify(body) }) as never;

const compareStreamRoute = await import('./compare-stream/route.ts');
const notebookRoute = await import('./query-notebook/route.ts');
const COMPARE_STREAM = await drive('/api/compare-stream', () =>
  compareStreamRoute.POST(post('/api/compare-stream', { query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true })));
const NOTEBOOK = await drive('/api/query-notebook', () =>
  notebookRoute.POST(post('/api/query-notebook', { query: QUESTION, portal: PORTAL })));

// --- Readers -------------------------------------------------------------------------

type Json = Record<string, unknown>;
interface Span { name: string; parentSpanId?: string; attributes: Array<{ key: string; value: { stringValue?: string } }> }

function events(d: Drive): Json[] {
  return d.body.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice('data: '.length)) as Json]; } catch { return []; }
  });
}

/** The trace a route hands its reader for publishing. */
function traceOf(d: Drive): Json {
  const all = events(d);
  const fromCompare = all.find((e) => e.type === 'trace')?.data as Json | undefined;
  const fromNotebook = all.find((e) => e.type === 'publish_inputs')?.trace as Json | undefined;
  const trace = fromCompare ?? fromNotebook;
  assert.ok(trace, `${d.name}: premise — the route emitted no trace:\n${d.body.slice(0, 600)}`);
  return trace!;
}

function rootAttributes(trace: Json): Record<string, string> {
  const spans = (trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find((s) => !s.parentSpanId);
  assert.ok(root, 'premise — the trace has no root span');
  return Object.fromEntries(root!.attributes.map((a) => [a.key, a.value.stringValue ?? '']));
}

/** The first request of a drive that offered tools: the MCP half's first turn. */
function mcpRequest(d: Drive): { raw: string; body: Json } {
  const offered = d.requests.find((r) => Array.isArray(r.body.tools) && (r.body.tools as unknown[]).length > 0);
  assert.ok(offered, `${d.name}: premise — no model request offered any tool`);
  return offered!;
}

function systemText(request: { body: Json }): string {
  const messages = (request.body.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const system = messages.find((m) => m.role === 'system');
  assert.ok(system && typeof system.content === 'string', 'premise — the MCP request carries no system message');
  return system!.content as string;
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Each source's block as the router's own per-source function composes it
 *  from the answers the loopback sources give: independent of the app's
 *  composition code. */
async function expectedBlocks(): Promise<Record<string, string>> {
  const view = router.civicRouter.aliasedView;
  const context = (instructions: string | null) => ({
    portal: PORTAL,
    publicationHost: DATA_COMMONS_PUBLICATION_HOST,
    fetchPrompt: async (): Promise<string> => { throw new Error('refused'); },
    fetchInstructions: async () => instructions,
  });
  return {
    socrata: await router.socrataGuidanceText(context(null), view),
    'data-commons': await router.dataCommonsGuidanceText(context(DATA_COMMONS_INSTRUCTIONS), view),
    'boston-opencontext': await router.bostonGuidanceText(context(null), view),
  };
}

const ROUTER_VERSION = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules/@typedstandards/civic-typed-router/package.json'), 'utf8')) as { version: string }).version;

// --- Tests ---------------------------------------------------------------------------

for (const d of [COMPARE_STREAM, NOTEBOOK]) {
  test(`${d.name}: the root span carries the five run attributes`, () => {
    const root = rootAttributes(traceOf(d));
    for (const key of ['analysis.asserted_date', 'analysis.mcp_servers', 'analysis.tool_definitions', 'analysis.sources_offered', 'analysis.components']) {
      assert.ok(Object.hasOwn(root, key), `${d.name}: the root span carries no ${key}`);
    }
  });

  test(`${d.name}: the asserted date is the date the model's system message states`, () => {
    const root = rootAttributes(traceOf(d));
    const stated = /Today's date is (\d{4}-\d{2}-\d{2})\./.exec(systemText(mcpRequest(d)))?.[1];
    assert.ok(stated, 'premise — the system message states no date');
    assert.equal(root['analysis.asserted_date'], stated);
  });

  test(`${d.name}: the tool definitions are, byte for byte, the tools the model was offered`, () => {
    const root = rootAttributes(traceOf(d));
    const offered = JSON.stringify(mcpRequest(d).body.tools);
    assert.ok(offered.includes('socrata__get_data') && offered.includes('boston__ckan__query_data'), 'premise — the model was offered the aliased tools');
    assert.equal(root['analysis.tool_definitions'], offered);
  });

  test(`${d.name}: the servers and the offered reasons are the run's configuration`, () => {
    const root = rootAttributes(traceOf(d));
    assert.deepEqual(JSON.parse(root['analysis.mcp_servers'] ?? 'null'), [
      { url: RUN_SOCRATA, name: 'socrata' },
      { url: RUN_DATA_COMMONS, name: 'data-commons' },
      { url: RUN_BOSTON, name: 'boston-opencontext' },
    ]);
    // R6 W2 (#632, D3 = A): every run now carries the reader's selection
    // (configured ∩ On, from the consent), so a source the reader has On is
    // `selected`, the router's reason when a selection is passed; `configured`
    // is stated only by a run given no selection, which W2 leaves none of.
    assert.deepEqual(JSON.parse(root['analysis.sources_offered'] ?? 'null'), [
      { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
      { sourceId: 'data-commons', alias: 'data_commons', reason: 'selected' },
      { sourceId: 'boston-opencontext', alias: 'boston', reason: 'selected' },
      // Router 0.3.0's hosted source, with NYC_CHARTER_HOSTING unset: the row
      // the anchor names for the pin (#617 P3). No component and no server
      // entry come with it.
      { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-configured' },
    ]);
  });

  test(`${d.name}: the components hash the blocks the model received, with their three origins`, async () => {
    const root = rootAttributes(traceOf(d));
    const system = systemText(mcpRequest(d));
    const blocks = await expectedBlocks();
    for (const [sourceId, block] of Object.entries(blocks)) {
      assert.ok(system.includes(block), `premise — the system message does not carry the ${sourceId} block the router composes`);
    }
    assert.deepEqual(JSON.parse(root['analysis.components'] ?? 'null'), [
      { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: sha(blocks.socrata), guidanceOrigin: 'fallback' },
      { id: 'datacommons-mcp@https://github.com/datacommonsorg/agent-toolkit', guidanceHash: sha(blocks['data-commons']), guidanceOrigin: 'endpoint' },
      { id: 'opencontext@https://data-mcp.boston.gov/mcp', guidanceHash: sha(blocks['boston-opencontext']), guidanceOrigin: 'inline' },
      { id: '@typedstandards/civic-typed-router', version: ROUTER_VERSION },
    ]);
  });
}

test('#495 at the routes: after a restart with a different Boston address, the record names the run\'s servers', () => {
  const trace = traceOf(NOTEBOOK);
  const saved = process.env.BOSTON_OPENCONTEXT_MCP_URL;
  process.env.BOSTON_OPENCONTEXT_MCP_URL = RESTARTED_BOSTON;
  try {
    const toolCalls = (events(NOTEBOOK).filter((e) => e.type === 'phase_a_tool_call')).map((e) => ({
      name: e.name as string,
      args: (e.args ?? {}) as Record<string, unknown>,
    }));
    assert.deepEqual(toolCalls.map((c) => c.name), ['socrata__get_data', 'boston__ckan__query_data'], 'premise — the run called Socrata and Boston');
    const { pkg } = buildEvidencePackage({
      trace,
      prompt: QUESTION,
      output: ANSWER,
      toolCalls,
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
    const environment = pkg.extensions?.['org.civicaitools.environment'] as Json;
    assert.deepEqual(environment.mcpServers, [
      { url: RUN_SOCRATA, name: 'socrata' },
      { url: RUN_DATA_COMMONS, name: 'data-commons' },
      { url: RUN_BOSTON, name: 'boston-opencontext' },
    ], 'the record names the servers configured at publish');
    const graph = (pkg.provenance as { '@graph': Array<Record<string, unknown>> })['@graph'];
    const boston = graph.find((n) => n['civic:sourceId'] === 'boston-opencontext' && String(n['@id']).includes(':mcp-server:'));
    assert.equal(boston?.['civic:serverUrl'], RUN_BOSTON, 'the Boston agent carries the address configured at publish');
    assert.ok(!JSON.stringify(pkg).includes(RESTARTED_BOSTON), 'the package names the Boston address configured at publish');
    assert.equal(Object.hasOwn(environment, 'temperature'), false);
  } finally {
    process.env.BOSTON_OPENCONTEXT_MCP_URL = saved;
  }
});
