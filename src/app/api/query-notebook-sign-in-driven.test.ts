// The rule: the notebook route requires sign-in, as documented
// (docs/deploy.md, "Sign-in prerequisite").
//
// `POST /api/query-notebook`, driven through the real handler. A request with
// no session is refused 401, after the executor-off refusal and before the
// body is read, before the limiter is checked or charged, before any model
// call and before the sandbox. Under `EXECUTOR_DRIVER=none` the executor-off
// refusal still comes first. A signed-in request runs as before: the limiter
// is checked and charged once, and the model is called.
//
// STUBS, as `query-notebook-none-driven.test.ts` has them, with the session
// set per case:
//   - `next/headers`, `next-auth`, `@/lib/auth`: no request scope and no
//     sign-in provider outside Next;
//   - `@/lib/rate-limit`: counts `checkRateLimit` and `incrementRateLimit`;
//     never limits;
//   - `@/lib/mcp/socrata-skill`: the prompt is a fixture string;
//   - `@/lib/openrouter-streaming`: counts every model call and refuses it, so
//     a signed-in run ends at Phase A and the stream closes;
//   - `@/lib/sandbox`: counts `executeNotebook`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
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

interface Counters { sessionReads: number; checks: number; increments: number; modelCalls: number; executions: number }
interface Globals { __signIn: Counters; __signInSession: unknown }
const globals = globalThis as unknown as Globals;
const ZERO: Counters = { sessionReads: 0, checks: 0, increments: 0, modelCalls: 0, executions: 0 };
globals.__signIn = { ...ZERO };
globals.__signInSession = null;

const STUB_PREFIX = 'file:///notebook-sign-in-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.7' }); }`,
  'next-auth': `export async function getServerSession() { globalThis.__signIn.sessionReads++; return globalThis.__signInSession; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { globalThis.__signIn.checks++; return { remaining: 99, limit: 100, reset: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() { globalThis.__signIn.increments++; }
    export async function consumeRateLimit(...a) { const info = await checkRateLimit(...a); await incrementRateLimit(...a); return info; }
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/mcp/socrata-skill': `
    export const DEFAULT_SOURCE_SELECTION = undefined;
    export async function buildSystemPrompt() { return 'fixture system prompt'; }
    export async function composeSystemPrompt() {
      return { prompt: 'fixture system prompt', assertedDate: '2026-01-15', sourcesOffered: [], components: [] };
    }
    export function withPortalLockGuidance(prompt) { return prompt; }`,
  '@/lib/openrouter-streaming': `
    export async function queryWithMcpStreaming() {
      globalThis.__signIn.modelCalls++;
      throw new Error('fixture model endpoint refuses every call');
    }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook() { globalThis.__signIn.executions++; throw new NotebookExecutionError('fixture'); }`,
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
      throw new Error(`notebook sign-in test hook: cannot resolve ${specifier}`);
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

/** A request carrying a consent in force; `bodyUsed` says whether the route read its body. */
function request(body: string = JSON.stringify({ query: 'How many?' })): { request: Request; bodyRead: () => boolean } {
  const req = new Request('http://localhost/api/query-notebook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: consentCookieForTests() },
    body,
  });
  return { request: req, bodyRead: () => req.bodyUsed };
}

function reset(session: unknown): void {
  globals.__signIn = { ...ZERO };
  globals.__signInSession = session;
}

async function drain(response: Response): Promise<string> {
  const deadline = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error('the response stream did not close within 10 s')), 10_000).unref(),
  );
  return Promise.race([response.text(), deadline]);
}

const SIGNED_IN = { user: { id: 'fixture-account' } };

test('the notebook route requires sign-in: a request with no session is refused 401, before the body, the limiter, the model and the sandbox', async () => {
  for (const [name, session] of [['no session', null], ['a session with no account', { user: {} }]] as const) {
    reset(session);
    const { request: req, bodyRead } = request();
    const response = await POST(req);
    const text = await drain(response);
    assert.equal(response.status, 401, `${name}: ${text.slice(0, 200)}`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/, name);
    assert.equal(bodyRead(), false, `${name}: the body was read`);
    assert.deepEqual(
      globals.__signIn,
      { ...ZERO, sessionReads: 1 },
      `${name}: the limiter, the model or the sandbox was reached`,
    );
  }
});

test('the notebook route requires sign-in: with EXECUTOR_DRIVER=none, the executor-off refusal comes first', async () => {
  process.env.EXECUTOR_DRIVER = 'none';
  try {
    for (const session of [null, SIGNED_IN]) {
      reset(session);
      const response = await POST(request().request);
      const text = await drain(response);
      assert.equal(response.status, 501, text.slice(0, 200));
      assert.equal((JSON.parse(text) as { code?: string }).code, 'notebooks_not_offered');
      assert.deepEqual(globals.__signIn, ZERO, 'the session, the limiter, the model or the sandbox was reached');
    }
  } finally {
    delete process.env.EXECUTOR_DRIVER;
  }
});

test('the notebook route requires sign-in: a signed-in request runs as before', async () => {
  reset(SIGNED_IN);
  const { request: req, bodyRead } = request();
  const response = await POST(req);
  const text = await drain(response);
  assert.equal(response.status, 200, text.slice(0, 200));
  assert.equal(bodyRead(), true, 'the body was not read');
  assert.equal(globals.__signIn.checks, 1, 'the limiter was not checked');
  assert.equal(globals.__signIn.increments, 1, 'the limiter was not charged');
  assert.equal(globals.__signIn.modelCalls, 1, 'the model was not called');
});
