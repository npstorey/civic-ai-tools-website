// #644 W1 beside R6's W5: an in-loop run's usage row.
//
// WHAT IS DRIVEN. The REAL `/api/compare-stream`, `/api/query-notebook` and
// `/api/compare` handlers under `SOURCE_ROUTING=in-loop`, and the same
// configuration under all-sources, through the real loop core, the real MCP
// client, the real in-loop session and the real usage module
// (`src/lib/usage/count.ts`). The row is read where W5's own module hands it
// to the database: the database client (`src/lib/db/index.ts`, by its
// resolved URL) is replaced by one that records each insert's values, which
// are `usageRow(...)`'s output. Stubs as `in-loop-routing-driven.test.ts`
// has them: `next/headers`, `next-auth`, `@/lib/auth`, `@/lib/sandbox`.
//
// THE FIXTURE. The directory lists Socrata, Data Commons and Boston. The
// model loads Data Commons only (a strict subset), calls a Data Commons tool
// that answers, and calls a Boston tool, which is refused `not_offered`
// because Boston is listed and not loaded; nothing else touches Boston. So a
// count that named a load's source, a refused call's source, or the
// directory, would write something other than `data-commons`. A count that
// resolved `load_source` to Socrata would write `data-commons,socrata`: that
// plant is the red this file was seen to give (phase report).
//
// WHAT IS ASSERTED, per route: `sources_used` is exactly `data-commons`;
// `sources_offered` is what the all-sources run of the same configuration
// states. And the claim the routes rely on, measured rather than assumed: for
// each call of the run that answered, W5's resolver (`routedSourceId` over the
// run's selection) and the in-loop session's (over the loaded set) name the
// same source, and neither names one for `load_source`.
//
// No live endpoint, no credential: every key is a placeholder and every
// address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/in-loop-usage-row-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
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
const DB_MODULE_URL = pathToFileURL(path.join(SRC, 'lib', 'db', 'index.ts')).href;

const PORTAL = 'data.example.org';
const QUESTION = 'What is the median household income in Bronx County?';
const ANSWER = 'One figure was retrieved.';

// --- The outbound recorder: loopback only -----------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks: the four request-scope stubs, and the database client -----

const ROWS = ((globalThis as unknown as { __w1UsageRows?: unknown[] }).__w1UsageRows = []) as Array<Record<string, unknown>>;
const STUB_PREFIX = 'file:///civic-r8-w1-usage-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.49' }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/sandbox': `
     import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
     export { NotebookExecutionError };
     export async function executeNotebook(notebook) {
       return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
     }`,
  db: `
    export const db = {
      insert() {
        const chain = {
          values(values) { globalThis.__w1UsageRows.push(values); return chain; },
          onConflictDoUpdate() { return chain; },
          then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); },
          catch(reject) { return Promise.resolve([]).catch(reject); },
        };
        return chain;
      },
    };`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier) && specifier !== 'db') {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    let resolved: ResolveResult | null = null;
    if (specifier === 'next/server') resolved = nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) { resolved = { url: pathToFileURL(candidate).href, shortCircuit: true }; break; }
        } catch { /* next extension */ }
      }
      if (!resolved) throw new Error(`R8 W1 usage test hook: cannot resolve ${specifier}`);
    }
    resolved ??= nextResolve(specifier, context);
    // The database client, whichever spelling reached it.
    if (resolved.url === DB_MODULE_URL) return { url: `${STUB_PREFIX}db.mjs`, format: 'module', shortCircuit: true };
    return resolved;
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
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r8-w1-usage' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r8-w1-usage', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  if (msg.method === 'tools/call') MCP_CALLS.push({ path: req.url ?? '', tool: msg.params?.name });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// --- The loopback model --------------------------------------------------------
//
// In loop: load Data Commons; then a Data Commons call and a Boston call (not
// loaded); then answer. All-sources: the same Data Commons call; then answer.

type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
const call = (id: string, name: string, args: Record<string, unknown>): Call =>
  ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const DC_CALL = call('call-dc', 'data_commons__search_indicators', { query: 'median household income', places: ['Bronx County'] });

function turnFor(body: Record<string, unknown>): Call[] | null {
  const tools = (body.tools ?? []) as Array<{ function: { name: string } }>;
  if (tools.length === 0) return null;
  const turns = ((body.messages ?? []) as Array<{ role?: string }>).filter((m) => m.role === 'assistant').length;
  if (!tools.some((t) => t.function.name === 'load_source')) return turns === 0 ? [DC_CALL] : null;
  if (turns === 0) return [call('call-load-dc', 'load_source', { alias: 'data_commons' })];
  if (turns === 1) return [DC_CALL, call('call-boston', 'boston__ckan__query_data', { resource_id: 'r-1', limit: 1 })];
  return null;
}

const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-r8-w1-usage', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = turnFor(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-r8-w1-usage',
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
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-r8-w1-usage';
process.env.MODEL_API_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  {
    id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true,
    endpointModel: 'example-fixture-deployment', model: 'vendor/model-fixture-1', default: true, evaluator: 1,
  },
]);
const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
_resetDefaultModelClientForTests();
const { readMcpEnvFromProcess, routedSourceId } = await import('../../lib/mcp/registry.ts');

// --- The drives -------------------------------------------------------------------

const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: consentCookieForTests() }, body: JSON.stringify(body) }) as never;

interface Drive { name: string; row: Record<string, unknown>; mcpCalls: Array<{ path: string; tool?: string }> }

async function drive(name: string, routing: string | undefined, run: () => Promise<Response>): Promise<Drive> {
  if (routing === undefined) delete process.env.SOURCE_ROUTING;
  else process.env.SOURCE_ROUTING = routing;
  const rowsFrom = ROWS.length;
  const mcpFrom = MCP_CALLS.length;
  try {
    const response = await run();
    await response.text();
    // The count's write starts once the response has ended; wait for it.
    for (let waited = 0; ROWS.length === rowsFrom && waited < 2_000; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(ROWS.length, rowsFrom + 1, `${name}: premise — the run wrote ${ROWS.length - rowsFrom} usage rows`);
    return { name, row: ROWS[rowsFrom], mcpCalls: MCP_CALLS.slice(mcpFrom) };
  } finally {
    delete process.env.SOURCE_ROUTING;
  }
}

const compareStreamRoute = await import('./compare-stream/route.ts');
const notebookRoute = await import('./query-notebook/route.ts');
const compareRoute = await import('./compare/route.ts');
const runCompareStream = () => compareStreamRoute.POST(post('/api/compare-stream', { query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true }));
const runNotebook = () => notebookRoute.POST(post('/api/query-notebook', { query: QUESTION, portal: PORTAL }));
const runCompare = () => compareRoute.POST(post('/api/compare', { query: QUESTION, model: 'fixture-fast', portal: PORTAL }));

const IN_LOOP = [
  await drive('compare-stream, in-loop', 'in-loop', runCompareStream),
  await drive('query-notebook, in-loop', 'in-loop', runNotebook),
  await drive('compare, in-loop', 'in-loop', runCompare),
];
const ALL_SOURCES: Record<string, Drive> = {
  'compare-stream, in-loop': await drive('compare-stream, all-sources', undefined, runCompareStream),
  'query-notebook, in-loop': await drive('query-notebook, all-sources', undefined, runNotebook),
  'compare, in-loop': await drive('compare, all-sources', undefined, runCompare),
};

// --- Tests -------------------------------------------------------------------------

for (const d of IN_LOOP) {
  test(`${d.name}: the usage row's sources_used is the loaded source whose call answered, and nothing else`, () => {
    // Premise: the run made the calls the fixture is shaped around. The Data
    // Commons call reached its server; the Boston call was refused, so nothing
    // reached Boston, and Socrata was never called.
    assert.deepEqual(d.mcpCalls, [{ path: '/dc/mcp', tool: 'search_indicators' }]);
    assert.equal(d.row.sourcesUsed, 'data-commons');
    assert.equal(d.row.outcome, 'complete');
  });

  test(`${d.name}: the usage row's sources_offered is what an all-sources run of the same configuration states`, () => {
    const allSources = ALL_SOURCES[d.name];
    assert.equal(allSources.row.sourcesUsed, 'data-commons', 'premise — the all-sources run used Data Commons');
    assert.equal(d.row.sourcesOffered, allSources.row.sourcesOffered);
    assert.equal(d.row.sourcesOffered, 'boston-opencontext,data-commons,socrata');
  });
}

test('the resolver W5 counts with and the in-loop session\'s agree on every answered call, and neither names a source for load_source', () => {
  const configured = readMcpEnvFromProcess();
  // The run's selection while the consent gate is dormant, and the session's
  // loaded set at the time the Data Commons call was made.
  const runSelection = undefined;
  const loaded = ['data-commons'];
  assert.equal(routedSourceId(DC_CALL.function.name, configured, runSelection), 'data-commons');
  assert.equal(routedSourceId(DC_CALL.function.name, configured, loaded), 'data-commons');
  assert.equal(routedSourceId('load_source', configured, runSelection), undefined);
  assert.equal(routedSourceId('load_source', configured, loaded), undefined);
});
