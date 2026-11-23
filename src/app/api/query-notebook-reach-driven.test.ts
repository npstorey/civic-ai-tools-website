// The notebook route hands the executor the reach of the notebook it wrote
// (#807): a notebook's sandbox reaches only the hosts its run's data steps
// read, and its environment holds a source's key only when its run reads that
// source.
//
// WHAT IS DRIVEN. The real `POST` of `/api/query-notebook` and its stream, the
// real model loop against a scripted model endpoint, the real MCP client
// against a loopback fixture, the real consent gate, the real
// `synthesizeNotebook`. Only the executor is a double: it records what it is
// given and returns the notebook unchanged. The harness is
// `where-it-went-driven.test.ts`'s.
//
// THE RUN. The reader's consent loads Data Commons alone (Socrata and Boston
// Off). The model calls Data Commons' `get_observations`, then answers with a
// Python block that requests a Socrata portal and `example.com`.
//
// WHAT MAKES IT ABLE TO FAIL. The answer's block names two hosts no data step
// reads, so a reach taken from the notebook's text, from the configured
// sources, or from the default portal is a different list from the one
// asserted; a route that passes no reach gives the executor none.
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

// --- Module hooks (as where-it-went-driven.test.ts) -----------------------------------

const STUB_PREFIX = 'file:///fx-s3-reach-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.57' }); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() {}
    export async function consumeRateLimit(...a) { const info = await checkRateLimit(...a); await incrementRateLimit(...a); return info; }
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook(notebook, opts) {
      (globalThis.__executorCalls ??= []).push({ notebook, opts });
      return { notebook, sandboxId: 'fixture-sandbox-reach', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
  '@/lib/sources/consent-store': `
    export async function readConsentRow() { return null; }
    export async function writeConsentRow() {}
    export async function deleteConsentRow() {}`,
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
      throw new Error(`reach test hook: cannot resolve ${specifier}`);
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

// --- The loopback data sources ------------------------------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const toolCallsSeen: Array<{ path: string; name: unknown }> = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: unknown } }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (answer: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...answer });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'reach-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture guidance.' } }] } })}\n\n`);
    return;
  }
  if (msg.method === 'tools/call') toolCallsSeen.push({ path: req.url ?? '', name: msg.params?.name });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const rows = { observations: [{ date: '2020', value: 8336817 }, { date: '2021', value: 8467513 }] };
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify(rows) }], isError: false } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH',
  'MODEL_API_VERSION', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH', 'OPENROUTER_API_KEY', 'SITE_PORTAL_LOCKED',
  'SITE_DEFAULT_PORTAL', 'EXECUTOR_DRIVER', 'VERCEL_ENV', 'APP_HOST', 'NEXTAUTH_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'SOURCE_ROUTING',
]) delete process.env[name];
process.env.MODEL_API_KEY = 'placeholder-model-key-fx-s3-reach';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.DATA_COMMONS_API_KEY = 'fixture';
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;

const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID ??= 'platform:test-suite-kid';

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
const { buildFlowsStatement } = await import('../../lib/flows/statement.ts');
const { CONSENT_COOKIE_NAME, encodeConsentCookie } = await import('../../lib/sources/consent.ts');
const { SYNTHESIS_CELL_ROLE } = await import('../../lib/notebook-author/prompt.ts');

type Handler = (request: Request) => Promise<Response>;
const notebookRoute = (await import('./query-notebook/route.ts')) as unknown as { POST: Handler };

// --- The run ---------------------------------------------------------------------------

const ANSWER = [
  'New York State had about 8.47 million residents in 2021.',
  '',
  '```python',
  'import requests',
  'requests.get("https://data.cityofnewyork.us/resource/erm2-nwe9.json")',
  'requests.get("https://example.com/")',
  '```',
].join('\n');
const REPLIES = [
  { toolCalls: [{ id: 'c1', name: 'data_commons__get_observations', args: { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' } }] },
  { content: ANSWER },
];
const STATES = { socrata: 'off', 'data-commons': 'on', 'boston-opencontext': 'off' };

// The built-in catalog is read while the built-in endpoint is still the configured one, as where-it-went does.
const { getDefaultModel } = await import('@/lib/model-resolver');
getDefaultModel();
const scripted = await startScriptedModelServer(REPLIES);
process.env.MODEL_API_BASE_URL = scripted.url;
_resetDefaultModelClientForTests();
const statement = await buildFlowsStatement();
const versionOf = (id: string) => statement.sources.find((s) => s.sourceId === id)?.version ?? 'f'.repeat(64);
const cookie = `${CONSENT_COOKIE_NAME}=${encodeConsentCookie({
  v: 1,
  flows: statement.version,
  states: Object.fromEntries(Object.entries(STATES).map(([id, state]) => [id, { state: state as 'on', since: '2026-11-23', version: versionOf(id) }])),
})}`;
let text = '';
try {
  const response = await notebookRoute.POST(new Request('http://localhost/api/query-notebook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query: 'How many people live in New York State?' }),
  }));
  text = await Promise.race([
    response.text(),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('the response did not close within 20 s')), 20_000).unref()),
  ]);
} finally {
  _resetDefaultModelClientForTests();
  await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
}
const events = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice('data: '.length)) as Record<string, unknown>);
const calls = ((globalThis as unknown as { __executorCalls?: Array<{ notebook: { cells: Array<{ cell_type: string; source: unknown; metadata?: { role?: string } }> }; opts?: { reach?: { hosts?: unknown; credentials?: unknown } } }> }).__executorCalls ?? []);

const sourceOf = (cell: { source: unknown }) => ([] as string[]).concat(cell.source as string | string[]).join('');

test('premise: the run read Data Commons alone, and its answer\'s block requests two other hosts', () => {
  assert.equal(calls.length, 1, `the executor ran ${calls.length} times: ${JSON.stringify(events.find((e) => e.type === 'error') ?? {}).slice(0, 300)}`);
  assert.deepEqual(toolCallsSeen.map((c) => c.path), ['/dc/mcp'], 'the run called a source other than Data Commons');
  const cells = calls[0]!.notebook.cells;
  assert.ok(cells.some((c) => c.cell_type === 'code' && sourceOf(c).includes('fetch_data_commons(')), 'no Data Commons data step was written');
  assert.ok(!cells.some((c) => c.cell_type === 'code' && /fetch_(socrata|ckan|opencontext)\(/.test(sourceOf(c))), 'a data step for another source was written');
  const synthesis = cells.find((c) => c.metadata?.role === SYNTHESIS_CELL_ROLE);
  assert.ok(synthesis && sourceOf(synthesis).includes('https://example.com/') && sourceOf(synthesis).includes('https://data.cityofnewyork.us/'), 'the synthesis cell does not carry the answer\'s block');
});

test('the executor is given the hosts the data steps read, exactly: Data Commons\' one host', () => {
  assert.equal(calls.length, 1, 'premise: the executor ran once');
  assert.deepEqual(calls[0]!.opts?.reach?.hosts, ['api.datacommons.org']);
});

test('the executor is given only the key of the source the run read', () => {
  assert.equal(calls.length, 1, 'premise: the executor ran once');
  assert.deepEqual(calls[0]!.opts?.reach?.credentials, ['DC_API_KEY']);
});
