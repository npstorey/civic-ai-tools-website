// #516 P1 — without `RATE_LIMIT_SECRET`, every rate-limited route refuses by
// name, before any quota is spent or any model is called. Driven through the
// real handlers.
//
// THE FOUR ROUTES. `/api/compare`, `/api/compare-stream` and
// `/api/query-notebook` count a question against the reader's daily
// allowance; `/api/rate-limit` reads that allowance. With the secret absent,
// and again with it empty, each answers with a typed refusal that names the
// variable: `code: "rate_limit_not_configured"`, on the channel the route
// already uses for its configuration refusals (a 503 JSON body; on
// `/api/compare-stream`, an `error` event per panel, as its model-credential
// refusal does). No key is computed, the key-value store is not reached, no
// data source is asked for anything and the model endpoint receives nothing.
//
// THE ORDER UNDER `EXECUTOR_DRIVER=none`. The notebook route's 501
// (`notebooks_not_offered`, #547) still comes first: an instance that runs no
// notebooks says so whatever else is missing.
//
// WHAT MAKES THE ASSERTIONS ABLE TO FAIL. The same requests are driven again
// with the fixture secret set, and there the counters must move: the store is
// handed a `rate:` key and the model endpoint is called. A route that refused
// whatever the secret, or an instrument that saw nothing, fails that half.
// Against the base of #516 P1 (`931fa48`), the refusal half fails: each route
// counts the question and calls the model.
//
// STUBS, and why each is one (`module.registerHooks()` in-file, as in
// `errors-out-of-logs-driven.test.ts`):
//   - `next/headers`, `next-auth`, `@/lib/auth`: no request scope and no
//     sign-in provider outside Next — an anonymous reader at a fixed address;
//   - `@vercel/kv`: a fake that records every key it is handed, so "no quota
//     is spent" is read at the store;
//   - `@/lib/sandbox`: no sandbox is created (this project's sandbox scope is
//     shared with production); the real error class, an executor that throws.
// Everything else is the real module: the routes, the rate limiter, the model
// client against a loopback endpoint, the MCP client against a loopback source.
// Every `fetch` to a host other than loopback is refused without being sent.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/rate-limit-secret-refusal-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Typed here because the installed `@types/node` predates `registerHooks`.
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

// --- No request leaves this machine ---------------------------------------------

const realFetch = globalThis.fetch;
const OFF_LOOPBACK: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (target.hostname !== '127.0.0.1') {
    OFF_LOOPBACK.push(target.host);
    throw new TypeError('fetch failed');
  }
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks ----------------------------------------------------------------

interface KvCall { op: string; key: string }
const globals = globalThis as unknown as {
  __p1Kv: KvCall[]; __p1KvStore: Record<string, number>; __p1Executions: number; __p1Address: string;
};
globals.__p1Kv = [];
globals.__p1Address = '203.0.113.51';
globals.__p1KvStore = Object.create(null) as Record<string, number>;
globals.__p1Executions = 0;

const STUB_PREFIX = 'file:///civic-516-p1-route-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  // The reader's address is switchable, so the counted drives below start
  // from a fresh allowance whatever the refused drives did.
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': globalThis.__p1Address }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@vercel/kv': `
    export const kv = {
      async get(key) { globalThis.__p1Kv.push({ op: 'get', key }); return globalThis.__p1KvStore[key] ?? null; },
      async incr(key) {
        globalThis.__p1Kv.push({ op: 'incr', key });
        globalThis.__p1KvStore[key] = (globalThis.__p1KvStore[key] ?? 0) + 1;
        return globalThis.__p1KvStore[key];
      },
      async expire(key) { globalThis.__p1Kv.push({ op: 'expire', key }); return 1; },
    };`,
  '@/lib/sandbox': `
    import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
    export { NotebookExecutionError };
    export async function executeNotebook() {
      globalThis.__p1Executions++;
      throw new NotebookExecutionError('fixture executor: no sandbox in this test', { exitCode: 1, stderr: '' });
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
      throw new Error(`#516 P1 test hook: cannot resolve ${specifier}`);
    }
    // Next's bundler resolves an extensionless relative import; Node's does not.
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

// --- Loopback: a model endpoint that counts and refuses ---------------------------

let modelRequests = 0;
const model = http.createServer(async (req, res) => {
  await new Promise<void>((resolve) => { req.resume(); req.on('end', () => resolve()); });
  modelRequests++;
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'fixture endpoint refuses every request', type: 'invalid_request_error' } }));
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();

// --- Loopback: an MCP source that counts and answers --------------------------------

let sourceRequests = 0;
const source = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  sourceRequests++;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-516-p1-session' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p1', version: '0' } } }));
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

// --- Environment, before any app module loads --------------------------------------

for (const name of [
  'MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'MODEL_API_KIND', 'MODEL_API_AUTH',
  'MODEL_API_VERSION', 'MODEL_CATALOG_PATH', 'SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'EXECUTOR_DRIVER',
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'RATE_LIMIT_SECRET',
  'ANONYMOUS_RATE_LIMIT', 'AUTHENTICATED_RATE_LIMIT', 'APP_TIER_RATE_LIMIT', 'SIGN_IN_ALLOWLIST',
]) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = SOURCE_URL;
process.env.DATA_COMMONS_MCP_URL = SOURCE_URL;
// Presence is all the routes' guard checks; the loopback endpoint never authenticates.
process.env.MODEL_API_KEY = 'fixture';
process.env.MODEL_API_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  {
    id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true,
    endpointModel: 'example-fixture-deployment', model: 'vendor/model-fixture-1', default: true, evaluator: 1,
  },
]);
// The counter goes to the faked key-value store; presence is all the module checks.
process.env.KV_REST_API_URL = 'http://127.0.0.1:9';
process.env.KV_REST_API_TOKEN = 'fixture';

const compare = (await import('./compare/route.ts')) as unknown as { POST: (r: Request) => Promise<Response> };
const compareStream = (await import('./compare-stream/route.ts')) as unknown as { POST: (r: Request) => Promise<Response> };
const notebook = (await import('./query-notebook/route.ts')) as unknown as { POST: (r: Request) => Promise<Response> };
const rateLimit = (await import('./rate-limit/route.ts')) as unknown as { GET: () => Promise<Response> };

// --- The drives -----------------------------------------------------------------------

const QUESTION = 'How many noise complaints were filed last year?';

// R6 W2 (#632): every route that sends a question refuses one with no consent in force; this
// suite's requests carry a consent (every configured source On), as a browser that had answered
// the consent card would. Nothing it asserts changes.
const { consentCookieForTests } = await import('../../lib/sources/consent-fixture.ts');
function post(route: string, body: unknown): Request {
  return new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: consentCookieForTests() },
    body: JSON.stringify(body),
  });
}

interface Drive { route: string; status: number; body: string; kv: KvCall[]; model: number; source: number; executions: number }

async function drive(route: string, run: () => Promise<Response>): Promise<Drive> {
  const kvFrom = globals.__p1Kv.length;
  const modelFrom = modelRequests;
  const sourceFrom = sourceRequests;
  const executionsFrom = globals.__p1Executions;
  const response = await run();
  let timer: NodeJS.Timeout | undefined;
  const body = await Promise.race([
    response.text(),
    new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error(`${route}: the response did not end`)), 20_000); }),
  ]).finally(() => clearTimeout(timer));
  return {
    route,
    status: response.status,
    body,
    kv: globals.__p1Kv.slice(kvFrom),
    model: modelRequests - modelFrom,
    source: sourceRequests - sourceFrom,
    executions: globals.__p1Executions - executionsFrom,
  };
}

const ROUTES: Array<[string, () => Promise<Response>]> = [
  ['/api/compare', () => compare.POST(post('/api/compare', { query: QUESTION, model: 'fixture-fast' }))],
  ['/api/compare-stream', () => compareStream.POST(post('/api/compare-stream', { query: QUESTION, model: 'fixture-fast', mcpOnly: true }))],
  ['/api/query-notebook', () => notebook.POST(post('/api/query-notebook', { query: QUESTION }))],
  ['/api/rate-limit', () => rateLimit.GET()],
];

/** The typed refusal, read off whichever channel the route answered on. */
function refusals(d: Drive): Array<{ message?: unknown; error?: unknown; code?: unknown }> {
  if (d.route === '/api/compare-stream' && d.status === 200) {
    return d.body
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map((frame) => JSON.parse(frame.slice('data: '.length)) as { type?: string; message?: unknown; code?: unknown })
      .filter((event) => event.type === 'error');
  }
  try {
    return [JSON.parse(d.body) as { error?: unknown; code?: unknown }];
  } catch {
    return [];
  }
}

const REFUSED: Record<string, Drive[]> = { absent: [], empty: [] };
for (const label of ['absent', 'empty'] as const) {
  if (label === 'absent') delete process.env.RATE_LIMIT_SECRET;
  else process.env.RATE_LIMIT_SECRET = '';
  for (const [route, run] of ROUTES) REFUSED[label].push(await drive(route, run));
}

delete process.env.RATE_LIMIT_SECRET;
process.env.EXECUTOR_DRIVER = 'none';
const NONE_DRIVE = await drive('/api/query-notebook', ROUTES[2][1]);
delete process.env.EXECUTOR_DRIVER;

process.env.RATE_LIMIT_SECRET = 'fixture';
globals.__p1Address = '203.0.113.52';
const COUNTED: Drive[] = [];
for (const [route, run] of ROUTES) COUNTED.push(await drive(route, run));

// --- Acceptance 3: the refusal ---------------------------------------------------------

for (const label of ['absent', 'empty'] as const) {
  test(`#516 P1 (3): with the secret ${label}, each of the four routes refuses by name`, () => {
    assert.equal(REFUSED[label].length, 4);
    for (const d of REFUSED[label]) {
      if (d.route === '/api/compare-stream') {
        assert.equal(d.status, 200, `${d.route}: the stream route refuses on its event channel, as its credential refusal does`);
      } else {
        assert.equal(d.status, 503, `${d.route}: an operator's configuration failure, not the caller's (status ${d.status}, body ${d.body.slice(0, 200)})`);
      }
      const typed = refusals(d);
      assert.ok(typed.length > 0, `${d.route}: no typed refusal in ${d.body.slice(0, 200)}`);
      for (const r of typed) {
        assert.equal(r.code, 'rate_limit_not_configured', `${d.route}: ${d.body.slice(0, 200)}`);
        assert.match(String(r.message ?? r.error), /RATE_LIMIT_SECRET/, `${d.route}: the refusal names the variable`);
      }
    }
  });

  test(`#516 P1 (3): with the secret ${label}, no quota is spent, no source is asked and no model is called`, () => {
    for (const d of REFUSED[label]) {
      assert.deepEqual(d.kv, [], `${d.route}: the key-value store was reached`);
      assert.equal(d.model, 0, `${d.route}: the model endpoint was called`);
      assert.equal(d.source, 0, `${d.route}: a data source was asked`);
      assert.equal(d.executions, 0, `${d.route}: a notebook was executed`);
    }
  });
}

test('#516 P1 (3): under EXECUTOR_DRIVER=none the notebook route still answers 501 first', () => {
  assert.equal(NONE_DRIVE.status, 501, NONE_DRIVE.body.slice(0, 200));
  assert.equal((JSON.parse(NONE_DRIVE.body) as { code?: unknown }).code, 'notebooks_not_offered');
  assert.deepEqual(NONE_DRIVE.kv, []);
  assert.equal(NONE_DRIVE.model, 0);
});

// --- The converse: with the secret, the same requests are counted ------------------------

test('#516 P1 (3): with the fixture secret, each route reaches the counter, and each query route the model', () => {
  for (const d of COUNTED) {
    assert.ok(d.kv.some((c) => c.key.startsWith('rate:')), `${d.route}: the counter was not reached (${d.body.slice(0, 200)})`);
    if (d.route === '/api/rate-limit') continue;
    assert.ok(d.kv.some((c) => c.op === 'incr'), `${d.route}: the question was not counted`);
    assert.ok(d.model > 0, `${d.route}: the model endpoint was not called`);
  }
});

// --- Acceptance 4: the limits and the response shape are unchanged ------------------------

test('#516 P1 (4): /api/rate-limit answers the same four fields, with the anonymous limit of 10', () => {
  const d = COUNTED[3];
  assert.equal(d.route, '/api/rate-limit');
  assert.equal(d.status, 200);
  const info = JSON.parse(d.body) as Record<string, unknown>;
  assert.deepEqual(Object.keys(info).sort(), ['authenticated', 'limit', 'remaining', 'resets_at']);
  assert.equal(info.limit, 10);
  assert.equal(info.authenticated, false);
  // Three questions were counted for this reader above, one per query route.
  assert.equal(info.remaining, 7);
});

test('#516 P1: nothing in this file left the machine', () => {
  assert.deepEqual(OFF_LOOPBACK, []);
});
