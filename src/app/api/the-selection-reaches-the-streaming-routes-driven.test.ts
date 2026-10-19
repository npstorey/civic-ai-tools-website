// R6 W1, criteria 1 and 2 (#632), driven through the two streaming routes.
//
// Both routes compose their prompt and their tools array with the run's
// selection (#599 D3) and hand the loop a transport and a source resolver.
// Before W1 the transport and the resolver read the configuration alone, so a
// selection narrowed what the model was TOLD and nothing it could DO: a call
// to a configured source the selection left out was sent, and its span named
// that source. This file gives each route a selection and reads what it did.
//
// WHAT IS DRIVEN. Each route's real `POST`, its real stream, the real model
// loop (`queryWithMcpStreaming`) against the scripted model endpoint, the real
// MCP client against a loopback fixture for Socrata and Data Commons that
// counts every request per server, and the real `composeSystemPrompt`. The
// trace each route emits is read off its own stream: `trace` on
// `/api/compare-stream`, `publish_inputs` on `/api/query-notebook`.
//
// THE ONE CHANGED INPUT. Since W2 the routes take their selection from the
// reader's consent (configured ∩ On, #632 D3 = A), so each request carries a
// consent cookie with Socrata On and Data Commons Off: the route under test
// runs its own code with the selection `['socrata']`. (Until W2 this suite
// stubbed `DEFAULT_SOURCE_SELECTION` to that value; the routes no longer read
// it.)
//
// STUBS, and why: `next/headers`, `next-auth`, `@/lib/auth` (no request scope
// or sign-in provider outside Next); `@/lib/rate-limit` (no counter store);
// `@/lib/sandbox` (the notebook executor returns the notebook it was given).
// No network: every address is loopback and every key a placeholder.
//
// WHAT MAKES IT ABLE TO FAIL. Data Commons is configured and answering. At the
// base (5a8e975) both routes send the call (the census counts a `tools/call`),
// and the span names `data-commons` with no error.
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

const DC_TOOL = 'data_commons__search_indicators';
const DC_ARGS = { query: 'median household income', places: ['Bronx County'] };

// --- Module hooks -------------------------------------------------------------

const STUB_PREFIX = 'file:///r6-w1-selection-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.11' }); }`,
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
      throw new Error(`r6-w1 test hook: cannot resolve ${specifier}`);
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

// --- The loopback data sources --------------------------------------------------

const RECEIVED: Array<{ path: string; method: string }> = [];
const toolCallsTo = (p: string): number => RECEIVED.filter((r) => r.path === p && r.method === 'tools/call').length;

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  RECEIVED.push({ path: p, method: msg.method ?? '' });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'r6-w1-route-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture skill guidance.' } }] } })}\n\n`);
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
  'SITE_DEFAULT_PORTAL', 'EXECUTOR_DRIVER',
]) delete process.env[name];
process.env.MODEL_API_KEY = 'placeholder-model-key-r6-w1-routes';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { consentCookieForTests } = await import('../../lib/sources/consent-fixture.ts');
const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
const { getDefaultModel } = await import('@/lib/model-resolver');
const { RUN_RECORD_ATTRIBUTE } = await import('../../lib/evidence/trace.ts');
const compareRoute = (await import('./compare-stream/route.ts')) as { POST: (request: Request) => Promise<Response> };
const notebookRoute = (await import('./query-notebook/route.ts')) as { POST: (request: Request) => Promise<Response> };

// --- One drive per route ----------------------------------------------------------

interface OtlpSpan {
  name?: string;
  attributes?: Array<{ key: string; value: { stringValue?: string; boolValue?: boolean } }>;
}

interface Drive {
  dcToolCalls: number;
  events: Record<string, unknown>[];
  spans: OtlpSpan[];
  modelRequests: Record<string, unknown>[];
}

/** Read a response body to its end, with a deadline so a stream that never closes fails rather than hangs. */
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

async function drive(route: { POST: (request: Request) => Promise<Response> }, url: string, body: Record<string, unknown>, traceOf: (events: Record<string, unknown>[]) => unknown): Promise<Drive> {
  const scripted = await startScriptedModelServer([
    { toolCalls: [{ id: 'c1', name: DC_TOOL, args: DC_ARGS }] },
    { content: 'The figure could not be retrieved from the sources used for this question.' },
  ]);
  process.env.MODEL_API_BASE_URL = scripted.url;
  _resetDefaultModelClientForTests();
  const before = toolCallsTo('/dc/mcp');
  try {
    const cookie = consentCookieForTests({ socrata: 'on', 'data-commons': 'off' });
    const response = await route.POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }));
    const text = await drain(response);
    const events = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
    return { dcToolCalls: toolCallsTo('/dc/mcp') - before, events, spans: spansOf(traceOf(events)), modelRequests: scripted.requests };
  } finally {
    _resetDefaultModelClientForTests();
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

const DRIVES: Array<[string, Drive]> = [
  [
    '/api/compare-stream',
    await drive(compareRoute, 'http://localhost/api/compare-stream', { query: 'What was the median household income in the Bronx?', model: getDefaultModel().id, mcpOnly: true }, (events) =>
      events.find((e) => e.type === 'trace')?.data),
  ],
  [
    '/api/query-notebook',
    await drive(notebookRoute, 'http://localhost/api/query-notebook', { query: 'What was the median household income in the Bronx?' }, (events) =>
      events.find((e) => e.type === 'publish_inputs')?.trace),
  ],
];

const attr = (span: OtlpSpan | undefined, key: string) => span?.attributes?.find((a) => a.key === key)?.value;

for (const [route, run] of DRIVES) {
  const toolSpan = run.spans.find((s) => s.name === 'mcp_tool_call' && attr(s, 'tool.name')?.stringValue === DC_TOOL);
  const root = run.spans.find((s) => attr(s, RUN_RECORD_ATTRIBUTE.sourcesOffered) !== undefined);

  test(`premise (${route}): the route ran its loop with the selection, and the model called the tool it was not offered`, () => {
    assert.ok(run.spans.length > 0, `the route emitted no trace; its events: ${JSON.stringify(run.events.map((e) => e.type))}`);
    const offered = ((run.modelRequests[0]?.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name);
    assert.ok(offered.includes('socrata__get_data'), 'premise: the run offered the Socrata tools');
    assert.ok(!offered.some((name) => name?.startsWith('data_commons__')), 'premise: the selection did not reach the tools array');
    assert.ok(toolSpan, 'the trace carries no span for the Data Commons call');
    const stated = JSON.parse(attr(root, RUN_RECORD_ATTRIBUTE.sourcesOffered)?.stringValue ?? '[]') as Array<{ sourceId: string; reason: string }>;
    // W1 recorded the router's `not-selected` here; since W2 the record states
    // the reader's own state for it (D2 = A): Off is `reader-off`.
    assert.equal(stated.find((s) => s.sourceId === 'data-commons')?.reason, 'reader-off', 'the record states Data Commons as turned off by the reader');
  });

  test(`criterion 1 (${route}): the call outside the selection is sent to no source`, () => {
    assert.equal(run.dcToolCalls, 0, `${route} sent a call to the source its selection left out`);
  });

  test(`criterion 2 (${route}): its span names no source, and is marked failed, not_offered`, () => {
    assert.equal(attr(toolSpan, 'mcp.source')?.stringValue, 'unknown', `${route}'s span attributes the refused call to a source`);
    assert.equal(attr(toolSpan, 'error')?.boolValue, true, `${route}'s span records the refused call as answered`);
    assert.equal(attr(toolSpan, 'error.kind')?.stringValue, 'not_offered');
  });
}
