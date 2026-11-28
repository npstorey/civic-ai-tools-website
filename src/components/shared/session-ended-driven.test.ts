// The rule: a reader whose session ended is asked to sign in again.
//
// WHAT IS DRIVEN. `/ask`'s surface in Sandbox (`QuerySurface`, answer-first,
// the notebook path) on the surface harness. The page reads a session (the
// reader signed in when the page loaded); the server reads none (the session
// has since ended). The question goes to the REAL notebook route
// (`/api/query-notebook`), which refuses it with its own 401, and the page's
// real stream client and hook read that refusal. The route's bytes are printed
// with the test.
//
// THE PROPERTY. The reader sees the sentence for an ended session, word for
// word, and not the generic one.
//
// THE PIN. Every other kind's sentence is as it was.
//
// STUBS, and why: `next/headers` (the route reads the forwarded address),
// `@/lib/rate-limit` (counted; the refusal comes before it), `@/lib/sandbox`
// (no sandbox is created). The route and the consent gate are not stubbed.
//
// BLIND SPOTS, stated. No browser: the header after the refusal is measured
// in Chrome (the phase's acceptance 4), not here.
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  sessions,
  type Surface,
} from '../sources/surface-test-harness.ts';

const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  // signOut records what it was called with: the page's sign-out on the 401 is read here, and its requests in Chrome.
  'next-auth/react': `
    const S = globalThis.__w3Sessions;
    export function useSession() { return { status: S.client.status, data: S.client.data, update: async () => S.client.data }; }
    export async function signIn() {}
    export async function signOut(options) { (globalThis.__seSignOuts ??= []).push(options ?? null); }
    export function SessionProvider({ children }) { return children; }`,
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.71' }); }`,
  '@/lib/rate-limit': `
    globalThis.__seLimiter = { calls: 0 };
    const info = () => { globalThis.__seLimiter.calls += 1; return { remaining: 99, limit: 100, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true }; };
    export async function checkRateLimit() { return info(); }
    export async function incrementRateLimit() { return info(); }
    export async function consumeRateLimit() { return info(); }
    export function isRateLimited() { return false; }
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
    export { NotebookExecutionError };
    export async function executeNotebook() { throw new NotebookExecutionError('fixture executor', { exitCode: 1, stderr: '' }); }`,
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.MODEL_API_KEY = 'placeholder-model-key-session-ended';
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
process.env.RATE_LIMIT_SECRET = 'fixture';

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/ask`, origin: ORIGIN, pathname: '/ask', search: '' },
    history: { replaceState() {}, pushState() {} },
    scrollTo() {},
    scrollBy() {},
    innerHeight: 852,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const notebookRoute = await load('app/api/query-notebook/route.ts');
const streaming = await load('lib/streaming.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();

const SENTENCE = 'You are no longer signed in, so nothing was sent. Sign in again, then ask your question again.';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let recorded: string[] = [];
/** The notebook route's answer: the real handler, or a fixture refusal (the pin's cases). */
let notebookAnswer: ((request: Request) => Promise<Response>) | null = null;
const signOuts = (): unknown[] => ((globalThis as unknown as { __seSignOuts?: unknown[] }).__seSignOuts ??= []);

function answers() {
  recorded = [];
  return installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 25, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true }),
    '/api/auth/session': () => json({}),
    '/api/query-notebook': async (request: Request) => {
      const response = notebookAnswer ? await notebookAnswer(request) : (await notebookRoute.POST(request)) as Response;
      const text = await response.text();
      recorded.push(`${response.status} ${response.headers.get('content-type')}\n${text}`);
      return new Response(text, { status: response.status, headers: response.headers });
    },
  });
}

const mounted: Surface[] = [];
beforeEach(() => {
  storage.clear();
  sessions.rows.clear();
  signOuts().length = 0;
  notebookAnswer = null;
  (globalThis as unknown as { __seLimiter: { calls: number } }).__seLimiter.calls = 0;
});
afterEach(() => {
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
});

const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};

/** A consent in force, the page signed in and the server reading no session; one question asked on the notebook path. */
async function askSignedIn(): Promise<Surface> {
  // The consent is in force (written while the server read no session, so it is the browser's own).
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  answers();
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, 'on'])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
  // The page read a session when it loaded; the server reads none now.
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture', id: 'gh-fixture-account' } } };
  const page = await mount(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
  mounted.push(page);
  await settle(page);
  const box = page.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  assert.ok(box, 'premise: no question box');
  await page.type(box!, 'How many service requests did Boston record in 2025?');
  await page.submit(page.elements().find((el) => el.type === 'form' && page.elements().some((x) => x.type === 'textarea'))!);
  await settle(page, 150);
  return page;
}

test('a reader whose session ended is asked to sign in again: the notebook route refuses with 401, and the reader sees the sentence for it', async (t) => {
  const page = await askSignedIn();
  assert.equal(recorded.length, 1, 'premise: the question reached the real notebook route once');
  t.diagnostic(`the route's refusal, as the page read it:\n${recorded[0]}`);
  assert.ok(recorded[0].startsWith('401 '), 'premise: the route refused with 401');
  assert.equal((globalThis as unknown as { __seLimiter: { calls: number } }).__seLimiter.calls, 0, 'premise: the refusal came before the limiter');
  const text = page.text();
  assert.ok(text.includes(SENTENCE), `the sentence for an ended session is not shown; the page reads: ${text.slice(0, 600)}`);
  assert.ok(!text.includes(streaming.friendlyStreamError({ code: 'generic' })), 'the generic sentence is shown');
  assert.deepEqual(signOuts(), [{ redirect: false }], 'the page did not sign out, once and without leaving the page');
});

/** Every other way a run is refused or fails: none of them signs the reader out. */
const OTHER_REFUSALS: [name: string, answer: () => Promise<Response>][] = [
  ['a 403 consent refusal', async () => json({ error: 'fixture', code: 'consent_required' }, 403)],
  ['a 403 with no source On', async () => json({ error: 'fixture', code: 'no_sources_on' }, 403)],
  ['the daily limit (429)', async () => json({ error: 'Rate limit exceeded', rateLimit: { remaining: 0, limit: 25, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true } }, 429)],
  ['a 500 with no kind', async () => json({ error: 'fixture' }, 500)],
  ['a 503 configuration refusal', async () => json({ error: 'fixture', code: 'model_not_configured' }, 503)],
  ['a network error', async () => { throw new TypeError('fetch failed'); }],
];

for (const [name, answer] of OTHER_REFUSALS) {
  test(`a reader whose session ended is asked to sign in again, and no one else is signed out: ${name} leaves the session as it was`, async () => {
    notebookAnswer = answer;
    const page = await askSignedIn();
    assert.ok(!page.text().includes(SENTENCE), `the sentence for an ended session is shown for ${name}`);
    assert.deepEqual(signOuts(), [], `the page signed out on ${name}`);
    assert.equal(sessions.client.status, 'authenticated', 'premise: the session is as it was');
  });
}

test('a reader whose session ended is asked to sign in again: only the stream client\'s 401 is read as an ended session', async () => {
  const { SSEError } = await load('lib/sse-client.ts');
  assert.equal(streaming.classifyStreamError(new SSEError('Authentication required', 401)), 'session_ended');
  // A 401 the server met calling something else keeps its classification.
  const upstream = Object.assign(new Error('Invalid API key'), { status: 401 });
  assert.equal(streaming.classifyStreamError(upstream), 'model_auth_rejected');
  assert.equal(streaming.classifyStreamError({ status: 401, message: 'fixture' }), 'generic');
  assert.equal(streaming.classifyStreamError(new SSEError('fixture', 403)), 'generic');
});

/** Every kind's sentence before this rule, byte for byte. */
const BEFORE: Record<string, string> = {
  rate_limit: 'You have no questions left today, so this question went no further than this site. Ask again after the count resets at midnight UTC.',
  model_rate_limited: 'The AI model service is limiting how many requests this server can make right now, so this query couldn’t run. This is not your own daily limit — please try again shortly.',
  model_not_configured: 'This server has no AI model API key configured, so queries can’t run. If you operate this instance, set MODEL_API_KEY in the server environment and restart.',
  model_auth_rejected: 'The AI model service rejected this server’s API key, so the query couldn’t run. If you operate this instance, check that the key in MODEL_API_KEY — or in its still-accepted prior-era name OPENROUTER_API_KEY — is valid for the endpoint this instance is configured to call.',
  mcp_not_configured: 'This server has no live data source configured, so queries can’t run. If you operate this instance, set SOCRATA_MCP_URL in the server environment and restart.',
  mcp_timeout: 'The live data source took too long to respond, so this query couldn’t finish. Try again in a moment, or narrow the question (for example, add a date range).',
  mcp_unavailable: 'The live data source is temporarily unavailable, so this query couldn’t be completed. Please try again shortly.',
  connection: 'The connection was interrupted before the response finished. Please try again.',
  notebook_execution: 'The notebook could not finish running. Please try again.',
  not_offered: 'This question did not use that data source, so nothing was sent to it.',
  consent_required: 'This site asks for your consent before it sends your question anywhere, so nothing has been sent yet.',
  // Moved by S4 W2b (npstorey/civic-ai-tools#335): S90.
  no_sources_on: 'No data source is enabled, so nothing was sent. Enable a source in Data source settings, then ask again.',
  no_picks_usable: 'None of the data sources you picked could be used, so nothing was sent. Pick again, or choose Auto.',
  generic: 'Something went wrong while running this query. Please try again in a moment.',
};

test("a reader whose session ended is asked to sign in again: every other kind's sentence is as it was", () => {
  const kinds = streaming.STREAM_ERROR_KINDS as readonly string[];
  for (const [kind, sentence] of Object.entries(BEFORE)) {
    assert.ok(kinds.includes(kind), `${kind} is no longer a kind`);
    assert.equal(streaming.streamErrorPayload(kind).message, sentence, `${kind}'s sentence changed`);
  }
});
