// The rule: the rate limit counts a request before it checks it.
//
// WHAT IS DRIVEN. The three routes that count a question (`/api/compare`,
// `/api/compare-stream`, `/api/query-notebook`), through their real handlers
// and the real limiter (`src/lib/rate-limit.ts`), on both of the limiter's
// stores: the shared key-value store (a double whose `get` and `incr` each
// yield before they answer, `incr` atomic as the store's is) and the
// per-instance memory store (no store configured). With one question left in
// the allowance, N requests are sent at once: exactly one passes, and N-1 are
// refused with 429.
//
// THE PINS. For the same history, `/api/rate-limit` reads what it read before
// (the limit less the questions that passed, and 0 once none are left), and
// the 429 body keeps its shape, with `remaining` 0.
//
// STUBS, and why (as `rate-limit-secret-refusal-driven.test.ts`): `next/headers`,
// `next-auth`, `@/lib/auth` (no request scope or sign-in provider outside
// Next); `@vercel/kv` (the double above); `@/lib/sandbox` (no sandbox is
// created). The model endpoint and the data source are loopback servers; every
// other `fetch` is refused without being sent.
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
const SRC = path.resolve(HERE, '../..');

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (target.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// The limiter reads its limits once, at load: set them before any app module loads.
const LIMIT = 3;
process.env.ANONYMOUS_RATE_LIMIT = String(LIMIT);
process.env.AUTHENTICATED_RATE_LIMIT = String(LIMIT);
process.env.RATE_LIMIT_SECRET = 'fixture';

const globals = globalThis as unknown as {
  __clKvStore: Record<string, number>; __clAddress: string; __clSession: unknown;
};
globals.__clKvStore = Object.create(null) as Record<string, number>;
globals.__clAddress = '203.0.113.60';
globals.__clSession = null;

const STUB_PREFIX = 'file:///civic-counts-first-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': globalThis.__clAddress }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__clSession; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@vercel/kv': `
    const turn = () => new Promise((resolve) => setTimeout(resolve, 1));
    export const kv = {
      async get(key) { const value = globalThis.__clKvStore[key] ?? null; await turn(); return value; },
      async incr(key) { const value = (globalThis.__clKvStore[key] = (globalThis.__clKvStore[key] ?? 0) + 1); await turn(); return value; },
      async expire() { await turn(); return 1; },
    };`,
  '@/lib/sandbox': `
    import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
    export { NotebookExecutionError };
    export async function executeNotebook() {
      throw new NotebookExecutionError('fixture executor', { exitCode: 1, stderr: '' });
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
      throw new Error(`counts-first test hook: cannot resolve ${specifier}`);
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
      return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(loadUrl), 'utf8')};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- Loopback: a model endpoint that refuses, and a source that answers --------------

const model = http.createServer(async (req, res) => {
  await new Promise<void>((resolve) => { req.resume(); req.on('end', () => resolve()); });
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'fixture endpoint refuses every request', type: 'invalid_request_error' } }));
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();

const source = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (fields: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...fields });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'counts-first-session' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'cl', version: '0' } } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (msg.method === 'prompts/get') {
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Guidance.' } }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: '{"data":[]}' }] } })}\n\n`);
});
await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', () => resolve()));
source.unref();
const SOURCE_URL = `http://127.0.0.1:${(source.address() as AddressInfo).port}/mcp`;

// --- Environment, before any app module loads ------------------------------------------

for (const name of [
  'MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'MODEL_API_KIND', 'MODEL_API_AUTH',
  'MODEL_API_VERSION', 'MODEL_CATALOG_PATH', 'SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'EXECUTOR_DRIVER',
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'APP_TIER_RATE_LIMIT', 'SIGN_IN_ALLOWLIST',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = SOURCE_URL;
process.env.DATA_COMMONS_MCP_URL = SOURCE_URL;
process.env.MODEL_API_KEY = 'fixture';
process.env.MODEL_API_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  { id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true, endpointModel: 'example-fixture-deployment', model: 'vendor/model-fixture-1', default: true, evaluator: 1 },
]);
type Post = (r: Request) => Promise<Response>;
const compare = (await import('./compare/route.ts')) as unknown as { POST: Post };
const compareStream = (await import('./compare-stream/route.ts')) as unknown as { POST: Post };
const notebook = (await import('./query-notebook/route.ts')) as unknown as { POST: Post };
const rateLimit = (await import('./rate-limit/route.ts')) as unknown as { GET: () => Promise<Response> };

// --- The drives -------------------------------------------------------------------------

const QUESTION = 'How many noise complaints were filed last year?';
const ROUTES: [route: string, post: Post, body: Record<string, unknown>, signedIn: boolean][] = [
  ['/api/compare', compare.POST, { query: QUESTION, model: 'fixture-fast' }, false],
  ['/api/compare-stream', compareStream.POST, { query: QUESTION, model: 'fixture-fast', mcpOnly: true }, false],
  ['/api/query-notebook', notebook.POST, { query: QUESTION }, true],
];

const STORES = {
  'the shared store': () => { process.env.KV_REST_API_URL = 'http://127.0.0.1:9'; process.env.KV_REST_API_TOKEN = 'fixture'; },
  'the memory store': () => { delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; },
} as const;

let reader = 0;
/** A reader no drive has counted yet: a fresh address, and a fresh account for the signed-in route. */
function freshReader(signedIn: boolean): void {
  reader += 1;
  globals.__clAddress = `203.0.113.${100 + reader}`;
  globals.__clSession = signedIn ? { user: { id: `fixture-account-${reader}` } } : null;
}

async function send(post: Post, route: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const response = await post(new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: consentCookieForTests() },
    body: JSON.stringify(body),
  }));
  return { status: response.status, text: await response.text() };
}

async function allowance(): Promise<Record<string, unknown>> {
  return (await (await rateLimit.GET()).json()) as Record<string, unknown>;
}

const N = 5;

for (const [storeName, useStore] of Object.entries(STORES)) {
  for (const [route, post, body, signedIn] of ROUTES) {
    test(`the rate limit counts a request before it checks it: ${route}, ${storeName}, ${N} at once with one left`, async () => {
      useStore();
      freshReader(signedIn);
      for (let i = 0; i < LIMIT - 1; i++) {
        const passed = await send(post, route, body);
        assert.notEqual(passed.status, 429, `premise: question ${i + 1} of ${LIMIT} was refused`);
      }
      assert.equal((await allowance()).remaining, 1, 'premise: one question is left');
      const results = await Promise.all(Array.from({ length: N }, () => send(post, route, body)));
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((s) => s !== 429).length, 1, `not exactly one passed: ${JSON.stringify(statuses)}`);
      assert.equal(statuses.filter((s) => s === 429).length, N - 1, `not ${N - 1} refused: ${JSON.stringify(statuses)}`);
    });
  }

  test(`for the same history, /api/rate-limit reads what it read before, and the 429 body keeps its shape: ${storeName}`, async () => {
    useStore();
    const [route, post, body] = ROUTES[0];
    freshReader(false);
    assert.deepEqual(Object.keys(await allowance()).sort(), ['authenticated', 'limit', 'remaining', 'resets_at']);
    assert.equal((await allowance()).remaining, LIMIT, 'a reader with no history');
    assert.notEqual((await send(post, route, body)).status, 429);
    assert.equal((await allowance()).remaining, LIMIT - 1, 'after one question');
    for (let i = 1; i < LIMIT; i++) assert.notEqual((await send(post, route, body)).status, 429);
    assert.equal((await allowance()).remaining, 0, 'after the last question');
    const refused = await send(post, route, body);
    assert.equal(refused.status, 429);
    const refusal = JSON.parse(refused.text) as { error: unknown; rateLimit: Record<string, unknown> };
    assert.deepEqual(Object.keys(refusal).sort(), ['error', 'rateLimit']);
    assert.equal(refusal.error, 'Rate limit exceeded');
    assert.deepEqual(Object.keys(refusal.rateLimit).sort(), ['authenticated', 'limit', 'remaining', 'resets_at']);
    assert.equal(refusal.rateLimit.remaining, 0);
    assert.equal(refusal.rateLimit.limit, LIMIT);
    assert.equal(refusal.rateLimit.authenticated, false);
    assert.equal((await allowance()).remaining, 0, 'after a refused question');
  });
}
