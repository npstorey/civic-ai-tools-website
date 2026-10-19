// R6 W2 (#632), the owner's ruling: the consent gate ships DORMANT.
//
// Until W3 ships the consent card, `CONSENT_GATE_ENFORCED`
// (`src/lib/sources/consent-enforced.ts`) is `false`, and every gated route
// behaves exactly as it did before W2: no refusal, no selection (the routes'
// `DEFAULT_SOURCE_SELECTION`), the router's reasons recorded as it gives them
// (`configured`, `not-configured`), no `analysis.flows_statement`, and replay
// with no replayer selection. The consent endpoint, the store, `/api/flows`,
// the classifier and the privacy page's statements stay live; the gate's own
// behaviour is driven with the constant stubbed on, in
// `consent-gate-driven.test.ts`.
//
// WHAT IS DRIVEN. The four gated routes' real handlers, with the real model
// loop, MCP client and composition, a request that carries NO consent, and
// the constant as shipped (not stubbed). THE CENSUS is every request the
// scripted model endpoint and the loopback sources receive and every call to
// the rate limiter, compared with the base's: the figures below were measured
// by running this same file against a `git archive c7ba6e3` tree with its own
// install (the stage-B fix report states the run). Nothing here imports a
// module W2 adds, so the file runs at the base unchanged.
//
// WHAT MAKES IT ABLE TO FAIL. At aa76e23 the gate enforced: each of these
// requests was refused `consent_required` and the census read zero.
//
// STUBS, as the gate test's: `next/headers`, `next-auth`, `@/lib/auth`,
// `@/lib/rate-limit` (counting), `@/lib/sandbox`, and the replay route's
// `@/lib/db`, `@/lib/storage`, `@/lib/evidence/sealed-access`. The consent
// store is stubbed too, to an empty one, so a read of it would find nothing.
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
const globals = globalThis as unknown as { __r6w2Dormant: Gate };
globals.__r6w2Dormant = { session: null, rows: new Map(), checks: 0, increments: 0, record: null, packages: {} };

const STUB_PREFIX = 'file:///r6-w2-dormant-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.21' }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__r6w2Dormant.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { globalThis.__r6w2Dormant.checks += 1; return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() { globalThis.__r6w2Dormant.increments += 1; }
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook(notebook) {
      return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
  '@/lib/sources/consent-store': `
    const rows = () => globalThis.__r6w2Dormant.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) { rows().set(userId, { userId, ...row, consentedAt: new Date(), updatedAt: new Date() }); }
    export async function deleteConsentRow(userId) { rows().delete(userId); }`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `export async function getPackage(key) { return globalThis.__r6w2Dormant.packages[key] ?? null; }`,
  '@/lib/db': `
    export const db = {
      select() {
        const chain = { from: () => chain, where: () => chain, limit: async () => (globalThis.__r6w2Dormant.record ? [globalThis.__r6w2Dormant.record] : []) };
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
      throw new Error(`r6-w2 dormant test hook: cannot resolve ${specifier}`);
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
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'r6-w2-dormant-fixture', version: '0' }, ...instructions } }));
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

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH',
  'MODEL_API_VERSION', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH', 'OPENROUTER_API_KEY', 'SITE_PORTAL_LOCKED',
  'SITE_DEFAULT_PORTAL', 'EXECUTOR_DRIVER', 'VERCEL_ENV', 'APP_HOST', 'NEXTAUTH_URL',
]) delete process.env[name];
process.env.MODEL_API_KEY = 'placeholder-model-key-r6-w2-dormant';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
const { getDefaultModel } = await import('@/lib/model-resolver');

type Handler = (request: Request, ctx?: { params: Promise<{ slug: string }> }) => Promise<Response>;
const compareStream = (await import('./compare-stream/route.ts')) as unknown as { POST: Handler };
const notebook = (await import('./query-notebook/route.ts')) as unknown as { POST: Handler };
const compare = (await import('./compare/route.ts')) as unknown as { POST: Handler };
const replayRoute = (await import('./evidence/[slug]/replay/route.ts')) as unknown as { POST: Handler };

interface OtlpSpan { name?: string; attributes?: Array<{ key: string; value: { stringValue?: string } }> }
interface Drive {
  status: number;
  events: Record<string, unknown>[];
  json: Record<string, unknown> | null;
  /** Model requests, each as the names of the tools it offered. */
  modelTools: string[][];
  /** Every request a loopback source received, as `path method` (compared sorted: two arms run in parallel). */
  received: string[];
  checks: number;
  increments: number;
}

async function drain(response: Response): Promise<string> {
  const deadline = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('the response did not close within 20 s')), 20_000).unref());
  return Promise.race([response.text(), deadline]);
}

const DC_TOOL = 'data_commons__search_indicators';
const TOOL_THEN_ANSWER = [
  { toolCalls: [{ id: 'c1', name: DC_TOOL, args: { query: 'median household income', places: ['Bronx County'] } }] },
  { content: 'The median household income in the Bronx was 41,895 dollars.' },
];
const ANSWER_ONLY = [{ content: 'An answer.' }];

async function drive(handler: Handler, url: string, body: Record<string, unknown>, session: unknown, replies: Array<Record<string, unknown>>, slug?: string): Promise<Drive> {
  const scripted = await startScriptedModelServer(replies);
  process.env.MODEL_API_BASE_URL = scripted.url;
  _resetDefaultModelClientForTests();
  globals.__r6w2Dormant.session = session;
  globals.__r6w2Dormant.checks = 0;
  globals.__r6w2Dormant.increments = 0;
  const receivedBefore = RECEIVED.length;
  try {
    // No cookie: the request carries no consent.
    const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const response = slug ? await handler(request, { params: Promise.resolve({ slug }) }) : await handler(request);
    const text = await drain(response);
    let json: Record<string, unknown> | null = null;
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
    }
    const events = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
    return {
      status: response.status,
      events,
      json,
      modelTools: scripted.requests.map((r) => ((r.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '')),
      received: RECEIVED.slice(receivedBefore).map((r) => `${r.path} ${r.method}`),
      checks: globals.__r6w2Dormant.checks,
      increments: globals.__r6w2Dormant.increments,
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
const traceOf = (d: Drive): unknown => d.events.find((e) => e.type === 'trace')?.data ?? d.events.find((e) => e.type === 'publish_inputs')?.trace;
const rootOf = (d: Drive) => spansOf(traceOf(d)).find((s) => s.attributes?.some((a) => a.key === 'analysis.sources_offered'));
const rootAttr = (d: Drive, key: string) => rootOf(d)?.attributes?.find((a) => a.key === key)?.value?.stringValue;

const QUESTION = 'What was the median household income in the Bronx?';
globals.__r6w2Dormant.packages['pkg/dormant.json'] = {
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
globals.__r6w2Dormant.record = { id: 'rec-dormant', slug: 'dormant', basePackageStorageKey: 'pkg/dormant.json', visibility: 'public', creatorId: 'fixture-account' };

const model = getDefaultModel().id;
const DRIVES: Array<[string, Drive]> = [
  ['/api/compare-stream', await drive(compareStream.POST, 'http://localhost/api/compare-stream', { query: QUESTION, model, mcpOnly: true }, null, TOOL_THEN_ANSWER)],
  ['/api/query-notebook', await drive(notebook.POST, 'http://localhost/api/query-notebook', { query: QUESTION }, null, TOOL_THEN_ANSWER)],
  ['/api/compare', await drive(compare.POST, 'http://localhost/api/compare', { query: QUESTION, model }, null, ANSWER_ONLY)],
  ['/api/evidence/[slug]/replay', await drive(replayRoute.POST, 'http://localhost/api/evidence/dormant/replay', { modelApiKey: 'placeholder-model-key-r6-w2-dormant' }, { user: { id: 'gh-fixture-account' } }, ANSWER_ONLY, 'dormant')],
];

if (process.env.R6_W2_DORMANT_PRINT === '1') {
  process.stderr.write(`${JSON.stringify(Object.fromEntries(DRIVES.map(([route, d]) => [route, { status: d.status, models: d.modelTools.length, withDc: d.modelTools.filter((t) => t.some((n) => n.startsWith('data_commons__'))).length, received: [...d.received].sort(), checks: d.checks, increments: d.increments }])), null, 1)}\n`);
}

/** The census each route made at the base, c7ba6e3, on this file's inputs (R6_W2_DORMANT_PRINT=1 prints it). */
const AT_BASE: Record<string, { status: number; models: number; withDc: number; received: string[]; checks: number; increments: number }> = {
  '/api/compare-stream': {'status': 200, 'models': 2, 'withDc': 2, 'received': ['/dc/mcp initialize', '/dc/mcp notifications/initialized', '/dc/mcp tools/call', '/socrata/mcp initialize', '/socrata/mcp notifications/initialized', '/socrata/mcp prompts/get', '/socrata/mcp server/discover'], 'checks': 1, 'increments': 1},
  '/api/query-notebook': {'status': 200, 'models': 2, 'withDc': 2, 'received': ['/dc/mcp tools/call'], 'checks': 1, 'increments': 1},
  '/api/compare': {'status': 200, 'models': 2, 'withDc': 1, 'received': [], 'checks': 1, 'increments': 1},
  '/api/evidence/[slug]/replay': {'status': 200, 'models': 1, 'withDc': 1, 'received': [], 'checks': 0, 'increments': 0},
};

for (const [route, d] of DRIVES) {
  test(`dormant (${route}): a request with no consent is served — no consent_required`, () => {
    assert.equal(d.status, AT_BASE[route].status);
    assert.ok(!d.events.some((e) => e.code === 'consent_required') && d.json?.code !== 'consent_required', `${route} refused: ${JSON.stringify(d.json ?? d.events.slice(0, 2))}`);
  });

  test(`dormant (${route}): the census of model and source requests, and of the limiter, equals the base's`, () => {
    assert.deepEqual(
      { status: d.status, models: d.modelTools.length, withDc: d.modelTools.filter((t) => t.some((n) => n.startsWith('data_commons__'))).length, received: [...d.received].sort(), checks: d.checks, increments: d.increments },
      AT_BASE[route],
    );
  });
}

for (const [route, d] of DRIVES.slice(0, 2)) {
  test(`dormant (${route}): the record states the router's own reasons, configured, and no flows statement`, () => {
    assert.deepEqual(JSON.parse(rootAttr(d, 'analysis.sources_offered') ?? '[]'), [
      { sourceId: 'socrata', alias: 'socrata', reason: 'configured' },
      { sourceId: 'data-commons', alias: 'data_commons', reason: 'configured' },
      { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
      { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-configured' },
    ]);
    assert.equal(rootAttr(d, 'analysis.flows_statement'), undefined, `${route} wrote a flows statement while the gate is dormant`);
  });
}

test('dormant (replay): no replayer selection narrows the record\'s offered set', () => {
  const [, d] = DRIVES[3];
  assert.deepEqual(d.json?.offeredSet, { from: 'sourcesOffered', sources: ['socrata', 'data-commons'], lacking: [] });
});
