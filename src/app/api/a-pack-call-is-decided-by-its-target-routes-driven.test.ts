// S2-B F1 (npstorey/civic-ai-tools#309), criterion 6, the two streaming routes: a pack's call is decided once,
// from the target the dispatch sends to.
//
// WHAT IS DRIVEN. Each streaming route's real `POST`, its real stream, the real streaming loop
// (`queryWithMcpStreaming`) against the scripted model endpoint, and the real MCP client against a loopback base that
// counts every request. The reader's consent has Socrata and Data Commons Off and City Record On, so the run's
// selection is City Record alone. Each route is driven twice: all-sources (the transport the route builds beside its
// `callMcpTool`), and in loop (`SOURCE_ROUTING=in-loop`, the routing the route creates), where the model loads
// City Record first. The model then calls a bare `get_data` naming a portal and a dataset outside City Record's.
//
// SHAPED TO FAIL. The dispatch resolves that bare name to City Record, whose calls go to the base's server, and the
// base answers every call: a route whose transport carried no decision sends it, and the base counts a
// `tools/call`. The trace each route emits is read off its own stream (`trace` on `/api/compare-stream`,
// `publish_inputs` on `/api/query-notebook`).
//
// STUBS, as `the-selection-reaches-the-streaming-routes-driven.test.ts` has them: `next/headers`, `next-auth`,
// `@/lib/auth`, `@/lib/rate-limit`, `@/lib/sandbox`. No network: every address is loopback and every key a
// placeholder.
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

// --- Module hooks -------------------------------------------------------------

const STUB_PREFIX = 'file:///s2b-f1-routes-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.12' }); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() {}
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
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
        } catch { /* next candidate */ }
      }
      throw new Error(`s2b-f1 test hook: cannot resolve ${specifier}`);
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

const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- The loopback base ------------------------------------------------------------

const RECEIVED: Array<{ path: string; method: string; tool?: string }> = [];

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }) : {};
  const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  RECEIVED.push({ path: p, method: msg.method ?? '', ...(msg.method === 'tools/call' ? { tool: msg.params?.name } : {}) });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 's2b-f1-route-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture skill guidance.' } }] } })}\n\n`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ value: 1 }], total_rows: 1 }) }], isError: false } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_API_KEY',
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH', 'OPENROUTER_API_KEY',
  'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'EXECUTOR_DRIVER', 'SOURCE_ROUTING',
]) delete process.env[name];
process.env.MODEL_API_KEY = 'placeholder-model-key-s2b-f1-routes';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
const { getDefaultModel } = await import('@/lib/model-resolver');
const compareRoute = (await import('./compare-stream/route.ts')) as { POST: (request: Request) => Promise<Response> };
const notebookRoute = (await import('./query-notebook/route.ts')) as { POST: (request: Request) => Promise<Response> };

// --- One drive per route and mode ---------------------------------------------------

interface OtlpSpan {
  name?: string;
  attributes?: Array<{ key: string; value: { stringValue?: string; boolValue?: boolean } }>;
}

interface Drive {
  socrataToolCalls: string[];
  events: Record<string, unknown>[];
  spans: OtlpSpan[];
  modelRequests: Record<string, unknown>[];
}

async function drain(response: Response): Promise<string> {
  const deadline = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error('the response stream did not close within 20 s')), 20_000).unref(),
  );
  return Promise.race([response.text(), deadline]);
}

function spansOf(trace: unknown): OtlpSpan[] {
  const spans: OtlpSpan[] = [];
  const t = (trace ?? {}) as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }> };
  for (const rs of t.resourceSpans ?? []) for (const ss of rs.scopeSpans ?? []) spans.push(...(ss.spans ?? []));
  return spans;
}

const BARE_OUTSIDE = { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.sfgov.org', query: 'SELECT * LIMIT 1' };

async function drive(
  route: { POST: (request: Request) => Promise<Response> },
  url: string,
  body: Record<string, unknown>,
  mode: 'all-sources' | 'in-loop',
  traceOf: (events: Record<string, unknown>[]) => unknown,
): Promise<Drive> {
  const scripted = await startScriptedModelServer([
    ...(mode === 'in-loop' ? [{ toolCalls: [{ id: 'l1', name: 'load_source', args: { alias: 'nyc_record' } }] }] : []),
    { toolCalls: [{ id: 'c1', name: 'get_data', args: BARE_OUTSIDE }] },
    { content: 'The figure could not be retrieved from the sources used for this question.' },
  ]);
  process.env.MODEL_API_BASE_URL = scripted.url;
  if (mode === 'in-loop') process.env.SOURCE_ROUTING = 'in-loop';
  else delete process.env.SOURCE_ROUTING;
  _resetDefaultModelClientForTests();
  const before = RECEIVED.length;
  try {
    const cookie = consentCookieForTests({ socrata: 'off', 'data-commons': 'off', 'nyc-record': 'on' });
    const response = await route.POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }));
    const text = await drain(response);
    const events = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
    const during = RECEIVED.slice(before);
    return {
      socrataToolCalls: during.filter((r) => r.path === '/socrata/mcp' && r.method === 'tools/call').map((r) => String(r.tool)),
      events,
      spans: spansOf(traceOf(events)),
      modelRequests: scripted.requests,
    };
  } finally {
    delete process.env.SOURCE_ROUTING;
    _resetDefaultModelClientForTests();
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

const QUERY = 'What public hearings are there in NYC this week?';
const DRIVES: Array<[string, Drive]> = [];
for (const mode of ['all-sources', 'in-loop'] as const) {
  DRIVES.push([
    `/api/compare-stream, ${mode}`,
    await drive(compareRoute, 'http://localhost/api/compare-stream', { query: QUERY, model: getDefaultModel().id, mcpOnly: true }, mode, (events) =>
      events.find((e) => e.type === 'trace')?.data),
  ]);
  DRIVES.push([
    `/api/query-notebook, ${mode}`,
    await drive(notebookRoute, 'http://localhost/api/query-notebook', { query: QUERY }, mode, (events) =>
      events.find((e) => e.type === 'publish_inputs')?.trace),
  ]);
}

const attr = (span: OtlpSpan | undefined, key: string) => span?.attributes?.find((a) => a.key === key)?.value;
const offeredIn = (request: Record<string, unknown> | undefined) =>
  ((request?.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name);

for (const [label, run] of DRIVES) {
  const callSpan = run.spans.find((s) => s.name === 'mcp_tool_call' && attr(s, 'tool.name')?.stringValue === 'get_data');

  test(`premise (${label}): the run was offered City Record's tools and not Socrata's, and the model called the bare name`, () => {
    assert.ok(run.spans.length > 0, `the route emitted no trace; its events: ${JSON.stringify(run.events.map((e) => e.type))}`);
    const everOffered = run.modelRequests.flatMap(offeredIn);
    assert.ok(everOffered.includes('nyc_record__get_data'), `premise: City Record's get_data was not offered; offered ${JSON.stringify(everOffered)}`);
    assert.ok(!everOffered.includes('socrata__get_data'), 'premise: Socrata was offered');
    if (label.endsWith('in-loop')) assert.deepEqual(offeredIn(run.modelRequests[0]), ['load_source'], 'premise: the run did not start in loop');
    else assert.ok(!offeredIn(run.modelRequests[0]).includes('load_source'), 'premise: the run did not run all-sources');
    assert.ok(callSpan, 'the trace carries no span for the bare get_data');
  });

  test(`${label}: a bare get_data the dispatch resolves to City Record, outside its portal and dataset, reaches no server`, () => {
    assert.deepEqual(run.socrataToolCalls, [], `${label} sent the call to the base`);
  });

  test(`${label}: its span names the pack and is marked failed`, () => {
    assert.equal(attr(callSpan, 'mcp.pack_id')?.stringValue, 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx', `${label}: the span names no pack`);
    assert.equal(attr(callSpan, 'error')?.boolValue, true);
    assert.equal(attr(callSpan, 'error.kind')?.stringValue, 'unknown');
  });
}
