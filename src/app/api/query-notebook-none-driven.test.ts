// #547 C2 (anchor #555, ruling G0-4 A) — `POST /api/query-notebook` under
// `EXECUTOR_DRIVER=none`, driven through the real handler.
//
// Under `none` the route answers 501 with `code: "notebooks_not_offered"`
// before it reads the body, before any model call, and before the rate
// limiter is charged. Unset, and under each of the three drivers, the request
// goes on exactly as before: the limiter is checked and charged once, and the
// model is called.
//
// STUBS, and why each is one. `module.registerHooks()` in-file, as in
// `seal-only-handlers-driven.test.ts`:
//   - `next/headers`, `next-auth`, `@/lib/auth`: no request scope and no
//     sign-in provider outside Next — a signed-in fixture account;
//   - `@/lib/rate-limit`: counts `checkRateLimit` and `incrementRateLimit`
//     instead of reaching a KV store; never limits;
//   - `@/lib/mcp/socrata-skill`: the skill fetch reaches a data source; the
//     prompt is a fixture string;
//   - `@/lib/openrouter-streaming`: counts every model call and refuses it, so
//     the pipeline ends at Phase A with an error event and the stream closes;
//   - `@/lib/sandbox`: counts `executeNotebook`, which is never reached here.
// Everything else the handler imports is the real module: the model
// credential check, the catalog, the MCP routing check, the portal resolver,
// and `@/lib/notebook-availability`.
//
// WHAT MAKES THE ASSERTIONS ABLE TO FAIL. The same request runs under `none`
// and under every other value, and the counters must differ between them. A
// route that refused under every value, or under none, fails one half. Run
// against the route before this phase, the `none` half fails: status 200, the
// limiter charged once, the model called once.
//
// THE ORDERING, pinned by source position as well (the precedent and its
// method: `portal-lock-ordering.test.ts`). Each assertion compares two
// positions that must both exist, so moving the refusal below the limiter, or
// deleting it, fails. BLIND SPOT, stated: a source read cannot tell that the
// block it finds is the one that runs; a second, unreached copy above the
// limiter would satisfy it. The handler is one straight-line function with one
// `notebookRouteRefusal(` call, which the first assertion pins, and the driven
// half above shows the call is the one that runs.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
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

interface Counters { checks: number; increments: number; modelCalls: number; executions: number }
const globals = globalThis as unknown as { __p4: Counters };
globals.__p4 = { checks: 0, increments: 0, modelCalls: 0, executions: 0 };

const STUB_PREFIX = 'file:///civic-547-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.7' }); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { globalThis.__p4.checks++; return { remaining: 99, limit: 100, reset: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() { globalThis.__p4.increments++; }`,
  '@/lib/mcp/socrata-skill': `
    export async function buildSystemPrompt() { return 'fixture system prompt'; }
    export function withPortalLockGuidance(prompt) { return prompt; }`,
  '@/lib/openrouter-streaming': `
    export async function queryWithMcpStreaming() {
      globalThis.__p4.modelCalls++;
      throw new Error('fixture model endpoint refuses every call');
    }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook() { globalThis.__p4.executions++; throw new NotebookExecutionError('fixture'); }`,
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
      throw new Error(`#547 test hook: cannot resolve ${specifier}`);
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

// The configuration the route needs to get past its own guards when nothing
// refuses: a model key against the built-in endpoint and catalog, and a
// data-source endpoint that is never contacted (the skill fetch and the model
// loop are stubbed).
for (const name of [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'MODEL_API_VERSION', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH',
  'OPENROUTER_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'EXECUTOR_DRIVER',
]) {
  delete process.env[name];
}
process.env.MODEL_API_KEY = 'fixture';
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:9/mcp';

const { POST } = (await import('./query-notebook/route.ts')) as {
  POST: (request: Request) => Promise<Response>;
};

function request(body: string = JSON.stringify({ query: 'How many noise complaints last week?' })): Request {
  return new Request('http://localhost/api/query-notebook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function reset(): void {
  globals.__p4 = { checks: 0, increments: 0, modelCalls: 0, executions: 0 };
}

function setDriver(value: string | undefined): void {
  if (value === undefined) delete process.env.EXECUTOR_DRIVER;
  else process.env.EXECUTOR_DRIVER = value;
}

/** Read a response body to its end, with a deadline so a stream that never closes fails rather than hangs. */
async function drain(response: Response): Promise<string> {
  const deadline = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error('the response stream did not close within 10 s')), 10_000).unref(),
  );
  return Promise.race([response.text(), deadline]);
}

test('#547 C2: under EXECUTOR_DRIVER=none the route answers 501 notebooks_not_offered, and nothing runs', async () => {
  setDriver('none');
  try {
    for (const body of [undefined, '{not json']) {
      reset();
      const response = await POST(request(body));
      const text = await drain(response);
      assert.equal(response.status, 501, `status (body ${body ?? 'valid'}): ${text.slice(0, 200)}`);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      const parsed = JSON.parse(text) as { error?: string; code?: string };
      assert.equal(parsed.code, 'notebooks_not_offered');
      assert.match(parsed.error ?? '', /EXECUTOR_DRIVER=none/);
      assert.deepEqual(
        globals.__p4,
        { checks: 0, increments: 0, modelCalls: 0, executions: 0 },
        'the limiter, the model or the executor was reached under EXECUTOR_DRIVER=none',
      );
    }
  } finally {
    setDriver(undefined);
  }
});

test('#547 C2: unset, empty and each driver: the request goes on as before', async () => {
  for (const value of [undefined, '', 'vercel-sandbox', 'container', 'lambda']) {
    setDriver(value);
    reset();
    try {
      const response = await POST(request());
      await drain(response);
      assert.equal(response.status, 200, `EXECUTOR_DRIVER=${String(value)}`);
      assert.equal(globals.__p4.checks, 1, `EXECUTOR_DRIVER=${String(value)}: the limiter was not checked`);
      assert.equal(globals.__p4.increments, 1, `EXECUTOR_DRIVER=${String(value)}: the limiter was not charged`);
      assert.equal(globals.__p4.modelCalls, 1, `EXECUTOR_DRIVER=${String(value)}: the model was not called`);
    } finally {
      setDriver(undefined);
    }
  }
});

// --- The ordering, by source position ----------------------------------------

const ROUTE = fs.readFileSync(path.join(HERE, 'query-notebook/route.ts'), 'utf8');

function at(needle: string): number {
  const index = ROUTE.indexOf(needle);
  assert.ok(index > 0, `query-notebook/route.ts should contain ${needle}`);
  return index;
}

test('#547 C2: the refusal is made once, first in the handler', () => {
  assert.equal(ROUTE.split('notebookRouteRefusal(').length - 1, 1, 'the route asks for the refusal exactly once');
  const refusal = at('notebookRouteRefusal(');
  const handler = at('export async function POST(');
  assert.ok(handler < refusal, 'the refusal is outside the handler');
  for (const later of [
    'await request.json()',
    'resolveRunPortal(',
    'getMissingModelCredentialError()',
    'getMissingMcpRoutingError()',
    'getServerSession(',
    'checkRateLimit(',
    'incrementRateLimit(',
    'buildSystemPrompt(portal)',
    'queryWithMcpStreaming(',
    'executeNotebook(',
  ]) {
    assert.ok(refusal < at(later), `the route reaches ${later} before it refuses under EXECUTOR_DRIVER=none`);
  }
});
