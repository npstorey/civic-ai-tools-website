// FIX-1 FX2 (#786 item 2; website #807): after the route refuses a question for consent, no panel keeps a waiting
// line beside the consent card.
//
// THE OBSERVATION (#786 item 2). A headless read answered a send in the page with one SSE `error` event per panel
// carrying a consent code. The card showed, and the "With data tools" panel kept "Connecting..." beside it. The issue
// asked that it be measured on the route's real refusal before anything is built.
//
// WHAT IS DRIVEN. The home page (`src/app/(marketing)/page.tsx`, the comparison, two panels) and `/ask`'s surface in
// Standard (`QuerySurface`, answer-first, one panel) on the surface harness. Every request the page makes is answered by
// a REAL route handler: `/api/models`, `/api/flows`, `/api/sources/consent`, and `/api/compare-stream`, which reads the
// REAL consent gate and writes its own refusal stream. The page reads a consent in force (the race the guard cannot
// see, as `composer-dock.test.ts` criterion 6 drives it) while the request carries no consent cookie, so the route
// refuses with `consent_required`. The route's bytes are recorded as they reached the page and printed with each test.
//
// THE PROPERTY. Once the refusal shows (the card's Allow button), no element reads "Connecting..." and the without-data
// panel's waiting line ("Answering from training data only — no access to current databases.") is not shown either: the
// run is over, and nothing is coming.
//
// WHAT MAKES IT ABLE TO FAIL. At the base (`ca5868e`) the surface passes `isStreaming={true}` to the comparison
// unconditionally (`QuerySurface.tsx:338`), and the panel is active while `isStreaming && !duration_ms && !error`
// (`ResponsePanel.tsx:173`); a refused panel is complete with no duration and no error, so the spinner stays.
//
// THE PIN. A run that completes renders its panels as at the base: the same steps and the same answer, with the
// waiting lines gone once content arrives (the last test).
//
// STUBS, and why: `next/headers` (the route reads the forwarded address) and `@/lib/rate-limit` (counted; the refusal
// comes before it, and its own configuration refusal would otherwise answer first). The consent gate is not stubbed.
//
// BLIND SPOTS, stated. No layout and no browser: "beside the card" is read as "on the page while the card shows". The
// route's refusal is driven with no session (anonymous); a signed-in refusal takes the same branch of the route.
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

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.41' }); }`,
  // The limiter, counted: the refusal under test comes before it, so a refused drive reads zero calls.
  '@/lib/rate-limit': `
    globalThis.__fx2Limiter = { checks: 0, increments: 0, limited: false };
    export async function checkRateLimit() { globalThis.__fx2Limiter.checks += 1; return { remaining: globalThis.__fx2Limiter.limited ? 0 : 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return globalThis.__fx2Limiter.limited; }
    export async function incrementRateLimit() { globalThis.__fx2Limiter.increments += 1; }
    export async function consumeRateLimit(...a) { const info = await checkRateLimit(...a); await incrementRateLimit(...a); return info; }
    export function getMissingRateLimitSecretError() { return null; }`,
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'MODEL_API_AUTH',
  'MODEL_API_VERSION', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH', 'OPENROUTER_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
// A placeholder: the route's configuration refusals come first, and the refusal under test comes before any model call.
process.env.MODEL_API_KEY = 'placeholder-model-key-fx2';
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    scrollBy() {},
    innerHeight: 852,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const modelsRoute = await load('app/api/models/route.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const compareStream = await load('app/api/compare-stream/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

const statement = await buildFlowsStatement();

/** The bytes each run route wrote, as the page read them. */
let recorded: string[] = [];
/** A held stream a test completes (the pin's run). */
let held: { push: (event: Json) => void; close: () => void } | null = null;
let holdNext = false;

function answers() {
  recorded = [];
  held = null;
  return installFetch(ORIGIN, {
    '/api/models': () => modelsRoute.GET(),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': async (request: Request) => {
      if (request.method === 'GET') return new Response(JSON.stringify({ routing: 'in-loop', store: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const body = JSON.parse(await request.text()) as Json;
      return new Response(JSON.stringify({ decision: body.decision, sourceId: 'boston-opencontext' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => new Response(JSON.stringify({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/compare-stream': async (request: Request) => {
      if (holdNext) {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        let closed = false;
        const enc = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
        held = {
          push: (event) => { if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); },
          close: () => { if (!closed) { closed = true; try { controller.close(); } catch { /* cancelled */ } } },
        };
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      const response = (await compareStream.POST(request)) as Response;
      const text = await response.text();
      recorded.push(`${response.status} ${response.headers.get('content-type')}\n${text}`);
      return new Response(text, { status: response.status, headers: response.headers });
    },
  });
}

/** The page reads a consent in force; the request carries none, so the real gate refuses it. */
function pageReadsConsentInForce(): () => void {
  const real = (globalThis as { fetch: typeof fetch }).fetch;
  const inForce = { inForce: true, store: 'cookie', flowsVersion: statementHash(statement), states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: '2026-11-21' }])) };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const p = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
    if (p === '/api/sources/consent' && (init?.method ?? 'GET').toUpperCase() === 'GET') {
      return new Response(JSON.stringify(inForce), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

const mounted: Surface[] = [];
const limiter = () => (globalThis as unknown as { __fx2Limiter: { checks: number; increments: number; limited: boolean } }).__fx2Limiter;
beforeEach(() => {
  Object.assign(limiter(), { checks: 0, increments: 0, limited: false });
  storage.clear();
  sessions.rows.clear();
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  holdNext = false;
});
afterEach(() => {
  held?.close();
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
});

const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};

async function mountPage(element: ReturnType<typeof h>): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  await settle(p);
  return p;
}

async function ask(surface: Surface, question: string): Promise<void> {
  const box = surface.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  assert.ok(box, 'premise: no question box');
  await surface.type(box!, question);
  await surface.submit(surface.elements().find((el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea'))!);
  await settle(surface, 150);
}

const CONNECTING = 'Connecting...';
const TRAINING_ONLY = 'Answering from training data only — no access to current databases.';

for (const [where, element, panels] of [
  ['the home page (the comparison, two panels)', () => h(Home), ['withoutMcp', 'withMcp']],
  ["/ask's surface in Standard (answer-first, one panel)", () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'standard' }), ['withMcp']],
] as const) {
  test(`#786 item 2, ${where}: after the real route refuses for consent, the card shows and no panel keeps a waiting line beside it`, async (t) => {
    answers();
    const restore = pageReadsConsentInForce();
    try {
      const page = await mountPage(element());
      await ask(page, 'How many service requests did Boston record in 2025?');
      assert.equal(recorded.length, 1, 'premise: the question reached the real route once');
      t.diagnostic(`the route's refusal, as the page read it:\n${recorded[0]}`);
      // The real refusal's shape: an SSE stream of one `error` event per panel, each carrying `consent_required`.
      const events = recorded[0].split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as Json);
      assert.deepEqual(events.map((e) => [e.type, e.panel, e.code]), panels.map((p) => ['error', p, 'consent_required']), 'premise: the route refused with consent_required, one error event per panel');
      assert.deepEqual((globalThis as unknown as { __fx2Limiter: Json }).__fx2Limiter, { checks: 0, increments: 0, limited: false }, 'premise: the refusal came before the limiter');
      assert.equal(page.buttons('Allow').length, 1, `premise: the refusal shows the consent card; the page reads: ${page.text().slice(0, 400)}`);
      const text = page.text();
      assert.ok(!text.includes(CONNECTING), `"${CONNECTING}" shows beside the consent card after the refusal`);
      assert.ok(!text.includes(TRAINING_ONLY), `the without-data panel's waiting line shows beside the consent card after the refusal`);
    } finally {
      restore();
    }
  });
}

test("#788's case, recorded (Refs #788, which stays open): after the real route's daily-limit refusal (429), no panel keeps a waiting line beside the refusal", async (t) => {
  answers();
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, 'on'])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
  limiter().limited = true;
  const page = await mountPage(h(Home));
  await ask(page, 'How many service requests did Boston record in 2025?');
  assert.equal(recorded.length, 1, 'premise: the question reached the real route once');
  t.diagnostic(`the route's refusal, as the page read it:\n${recorded[0]}`);
  assert.ok(recorded[0].startsWith('429 '), 'premise: the route refused with 429');
  assert.equal(limiter().checks, 1, 'premise: the limiter was read');
  const alert = page.elements().filter((el) => el.props.role === 'alert');
  assert.equal(alert.length, 1, `premise: the refusal shows; the page reads: ${page.text().slice(0, 400)}`);
  const text = page.text();
  assert.ok(!text.includes(CONNECTING), `"${CONNECTING}" shows beside the daily-limit refusal`);
  assert.ok(!text.includes(TRAINING_ONLY), 'the without-data panel\'s waiting line shows beside the daily-limit refusal');
});

test('#786 item 2, the pin: a run that completes on the home page still shows its waiting lines while it streams, and its answers once complete', async () => {
  answers();
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, 'on'])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
  holdNext = true;
  const page = await mountPage(h(Home));
  await ask(page, 'How many service requests did Boston record in 2025?');
  assert.ok(held, 'premise: the run started');
  assert.ok(page.text().includes(CONNECTING), 'the with-data panel no longer shows "Connecting..." before any event');
  assert.ok(page.text().includes(TRAINING_ONLY), 'the without-data panel no longer shows its waiting line while it streams');
  held!.push({ type: 'complete', panel: 'withoutMcp', data: { content: 'An answer from training data.', duration_ms: 5 } });
  held!.push({ type: 'complete', panel: 'withMcp', data: { content: 'PINANSWER: **42** requests.', duration_ms: 7, tools_called: [] } });
  held!.close();
  await settle(page, 100);
  const text = page.text();
  assert.ok(text.includes('An answer from training data.'), 'the without-data answer is not shown');
  assert.ok(text.includes('PINANSWER: 42 requests.'), 'the with-data answer is not shown');
  assert.ok(!text.includes(CONNECTING), '"Connecting..." stays after the answer');
});
