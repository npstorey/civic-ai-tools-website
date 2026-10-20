// R6 W3 (#632), criteria 1, 2 and 15 (Q2): the first-consent card on the
// three surfaces that send a question — the home page, `/explore` and `/ask`
// — driven through their real components.
//
// THE RULE (design §4.4; anchor W3 item 2). Nothing is sent anywhere before
// the reader answers the card. The card is shown before the first submit on a
// fresh session, and when a route answers `consent_required`. **Allow** stores
// the defaults of D6 (every configured source On, the manifest's
// `consentDefault`) and then sends the question; **Not now** sends nothing,
// and the form stays disabled with the local-only line. Nothing is stored on
// Not now, so a new session shows the card again (Q2).
//
// WHAT IS DRIVEN. The home page component (`src/app/(marketing)/page.tsx`),
// `/explore`'s diagram (`McpFlowDiagram`, with only its BPMN canvas replaced:
// it loads a browser-only library and a stylesheet), and `/ask`'s surface as
// `src/app/(app)/ask/page.tsx` mounts it (`QuerySurface` with
// `presentation="answer-first"`, `defaultMode="notebook"`), each on the
// surface harness (`./surface-test-harness.ts`). Every request the page makes
// is answered here: `/api/flows` and `/api/sources/consent` by their REAL
// route handlers, with a cookie jar between requests as a browser keeps one;
// `/api/models` with one model; and each query route by a stand-in that asks
// the REAL consent gate (`consentInForce`, with the switch as shipped) and
// answers its refusal in the route's own shape, or an empty stream when the
// gate lets the question through. THE CENSUS is every request the page sends
// to a query route.
//
// "NO REQUEST LEAVES THE PAGE" is read as: no request reaches a route that
// sends the question onward (the three query routes). The page's own reads of
// this site — the model list, the flows statement, the consent status, and
// the consent write — carry no question and are counted separately.
//
// WHAT MAKES IT ABLE TO FAIL. At the base no surface shows a card: the
// submitted question goes straight to the query route, and the census reads
// one request.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType, ReactElement } from 'react';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  sessions,
  textOf,
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  // `/explore`'s BPMN canvas: a browser-only library and a stylesheet import.
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

// --- The configuration ----------------------------------------------------------

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';

// The browser globals the surfaces read: session storage for the sticky
// choices, and listeners that are never fired here.
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

// --- The modules -------------------------------------------------------------------

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { CIVIC_MANIFEST } = (await import('@typedstandards/civic-typed-router')) as unknown as { CIVIC_MANIFEST: Array<{ sourceId: string; consentDefault?: string }> };

/** The copy W3 adds (a specifier typed `string`, so the red commit type-checks). */
const COPY: string = '@/lib/sources/copy';
const copy = (await import(COPY).catch(() => null)) as Mod | null;

/** The consent-required copy a surface without the card falls back to (`friendlyStreamError`). */
const { friendlyStreamError } = await load('lib/streaming.ts');
const BARE_REFUSAL: string = friendlyStreamError({ code: 'consent_required' });

// --- The answers ---------------------------------------------------------------------

const QUERY_ROUTES = ['/api/compare-stream', '/api/query-notebook', '/api/compare'];

const sse = (events: Array<Record<string, unknown>>) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/** A query route as the gate makes it: refused in the route's shape, or an empty stream. */
function queryRoute(routePath: string) {
  return async (request: Request): Promise<Response> => {
    const body = JSON.parse(await request.clone().text() || '{}') as { mcpOnly?: boolean };
    const decision = await consentInForce(request, sessions.server);
    if (!decision.ok) {
      if (routePath === '/api/compare-stream') {
        const panels = body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
        return sse(panels.map((panel) => ({ type: 'error', panel, message: decision.payload.error, code: decision.payload.code, flowsVersion: decision.payload.flowsVersion, reask: decision.payload.reask })));
      }
      return new Response(JSON.stringify(decision.payload), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    // Served: each panel completes, so the surface's run ends and its form is free again.
    if (routePath === '/api/compare-stream') {
      const panels = body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
      return sse(panels.map((panel) => ({ type: 'complete', panel, data: { content: 'An answer.', duration_ms: 1, tools_called: [] } })));
    }
    return sse([]);
  };
}

/** While set, a consent write waits for this promise before the real handler answers it. */
let holdWrites: Promise<void> | null = null;

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': async (request: Request) => {
      const handler = consentRoute[request.method] as ((r: Request) => Promise<Response>) | undefined;
      if (request.method === 'PUT' && holdWrites) await holdWrites;
      return handler ? handler(request) : new Response('', { status: 405 });
    },
    ...Object.fromEntries(QUERY_ROUTES.map((p) => [p, queryRoute(p)])),
  });
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};
const SIGNED_IN_DB = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '77777777-7777-4777-8777-777777777777' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

// --- Driving a surface -----------------------------------------------------------------

const QUESTION = 'What was the median household income in the Bronx?';

const queryRequests = (sent: Array<{ path: string; body: string }>) => sent.filter((r) => QUERY_ROUTES.includes(r.path));

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}; the surface reads: ${surface.text().slice(0, 500)}`);
  return found[0];
}

/** The home page's and `/ask`'s form: type the question, then submit. */
async function askOnQueryForm(surface: Surface): Promise<void> {
  const box = one(surface, 'question box', (el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  await surface.type(box, QUESTION);
  const form = one(surface, 'form holding the question box', (el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea'));
  await surface.submit(form);
}

/** `/explore`: the "Try your own" tab, the question, submit, and the 400 ms fullscreen beat. */
async function askOnExplore(surface: Surface): Promise<void> {
  await surface.click(surface.button('Try your own'));
  const box = one(surface, 'live question input', (el) => el.type === 'input' && el.props.className === 'live-query-input');
  await surface.type(box, QUESTION);
  const form = one(surface, 'live question form', (el) => el.type === 'form');
  await surface.submit(form);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await surface.settle();
}

/** The card is on the page: its two answers, Allow and Not now, each one button. */
function assertCardShown(page: Surface, where: string): void {
  assert.ok(page.buttons('Allow').length === 1 && page.buttons('Not now').length === 1, `${where} shows no consent card (no Allow and Not now): ${page.text().slice(0, 400)}`);
  assert.ok(page.text().includes(cardHeading()), `${where} shows the buttons without the card's heading`);
}

const cardHeading = (): string => {
  assert.ok(copy, `no consent copy: ${COPY} does not exist`);
  assert.equal(typeof copy!.CONSENT_CARD?.heading, 'string', `${COPY} exports no CONSENT_CARD.heading`);
  return copy!.CONSENT_CARD.heading as string;
};

const SURFACES: Array<{ name: string; route: string; session: () => void; element: () => ReactElement; ask: (s: Surface) => Promise<void> }> = [
  { name: 'home', route: '/api/compare-stream', session: ANON, element: () => h(Home), ask: askOnQueryForm },
  { name: '/explore', route: '/api/compare-stream', session: ANON, element: () => h(McpFlowDiagram), ask: askOnExplore },
  {
    name: '/ask',
    route: '/api/query-notebook',
    session: SIGNED_IN_DB,
    element: () => h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' }),
    ask: askOnQueryForm,
  },
];

// --- Criterion 2: nothing leaves the page with the card unanswered ------------------------

for (const surface of SURFACES) {
  test(`criterion 2 (${surface.name}): with the card unanswered, a submitted question sends no request to a query route`, async () => {
    surface.session();
    sessions.rows.clear();
    const net = answers();
    const page = await mount(surface.element());
    await surface.ask(page);
    assert.deepEqual(queryRequests(net.sent).map((r) => r.path), [], `${surface.name} sent the question before the reader answered the card`);
    assertCardShown(page, surface.name);
    assert.ok(!page.text().includes(BARE_REFUSAL), `${surface.name} shows the bare refusal sentence instead of the card`);
    page.unmount();
  });

  test(`criterion 2 (${surface.name}): Allow stores the defaults of D6, then sends the one question`, async () => {
    surface.session();
    sessions.rows.clear();
    const net = answers();
    const page = await mount(surface.element());
    await surface.ask(page);
    assert.deepEqual(queryRequests(net.sent), [], `${surface.name} sent the question before the reader answered the card`);
    assertCardShown(page, surface.name);
    await page.click(page.button('Allow'));
    if (surface.name === '/explore') { await new Promise((resolve) => setTimeout(resolve, 600)); await page.settle(); }
    const writes = net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'PUT');
    assert.equal(writes.length, 1, 'Allow wrote no consent');
    const statement = await buildFlowsStatement();
    const written = JSON.parse(writes[0].body) as { states: Record<string, string>; flowsVersion: string };
    assert.equal(written.flowsVersion, statementHash(statement), 'the consent was written against a statement other than the one in force');
    const defaults = Object.fromEntries(
      statement.sources.map((s: { sourceId: string }) => [s.sourceId, CIVIC_MANIFEST.find((e) => e.sourceId === s.sourceId)?.consentDefault ?? 'on']),
    );
    assert.deepEqual(written.states, defaults, 'Allow did not store the defaults of D6');
    const sent = queryRequests(net.sent);
    assert.equal(sent.length, 1, `${surface.name} sent ${sent.length} questions after Allow`);
    assert.equal(sent[0].path, surface.route);
    assert.ok(sent[0].body.includes(QUESTION), 'the question sent after Allow is not the one asked');
    page.unmount();
  });
}

test('criterion 2 (home) and Q2: Not now sends nothing; the form stays disabled and shows the local-only line', async () => {
  ANON();
  const net = answers();
  const page = await mount(h(Home));
  await askOnQueryForm(page);
  assert.deepEqual(queryRequests(net.sent), [], 'the question was sent before the reader answered the card');
  assertCardShown(page, 'the home page');
  await page.click(page.button('Not now'));
  assert.deepEqual(queryRequests(net.sent), [], 'Not now sent the question');
  assert.deepEqual(net.sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`), [], 'Not now wrote something');
  assert.ok(copy?.LOCAL_ONLY_OFFER && copy?.NO_GUIDE_SENTENCE, `${COPY} exports no LOCAL_ONLY_OFFER / NO_GUIDE_SENTENCE`);
  assert.ok(page.text().includes(copy!.LOCAL_ONLY_OFFER), 'after Not now the local-only line is not shown');
  assert.ok(page.text().includes(copy!.NO_GUIDE_SENTENCE), 'with no guide address, the omission is not stated');
  const submit = one(page, 'submit button', (el) => el.type === 'button' && el.props.type === 'submit');
  assert.equal(submit.props.disabled, true, 'after Not now the form can still be submitted');
  const form = one(page, 'form', (el) => el.type === 'form');
  await page.submit(form);
  assert.deepEqual(queryRequests(net.sent), [], 'a second submit after Not now sent the question');
  page.unmount();
});

test('criterion 15 (Q2): nothing is stored after Not now, so a new session shows the card again', async () => {
  ANON();
  const first = answers();
  const page = await mount(h(Home));
  await askOnQueryForm(page);
  assertCardShown(page, 'the first session');
  await page.click(page.button('Not now'));
  assert.equal(first.jar.size, 0, 'Not now left a cookie');
  page.unmount();
  // A new browser session: a fresh jar and a fresh page.
  const second = answers();
  const again = await mount(h(Home));
  await askOnQueryForm(again);
  assert.deepEqual(queryRequests(second.sent), [], 'the new session sent the question without asking');
  assertCardShown(again, 'the new session');
  again.unmount();
});

// --- Criterion 1: the panel's revoke, then the next submit -------------------------------

test('criterion 1: for a session without a dbId, after the panel\'s revoke the next submit shows the card', async () => {
  ANON();
  const net = answers();
  const page = await mount(h(Home));
  await askOnQueryForm(page);
  assert.deepEqual(queryRequests(net.sent), [], 'the question was sent before the reader answered the card');
  assertCardShown(page, 'the home page');
  await page.click(page.button('Allow'));
  assert.equal(queryRequests(net.sent).length, 1, 'premise: after Allow the question was sent');
  const revoke = page.elements().filter((el) => el.type === 'button' && /withdraw/i.test(textOf(el)));
  assert.equal(revoke.length, 1, `the panel shows no withdraw control: ${page.text().slice(0, 400)}`);
  await page.click(revoke[0]);
  assert.equal(net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'DELETE').length, 1, 'the panel\'s revoke did not call DELETE');
  await askOnQueryForm(page);
  assert.equal(queryRequests(net.sent).length, 1, 'after the revoke the next question was sent without asking');
  assertCardShown(page, 'after the revoke, the next submit');
  page.unmount();
});

test('criterion 1: the panel awaits its write before the form can submit', async () => {
  ANON();
  const net = answers();
  const page = await mount(h(Home));
  await askOnQueryForm(page);
  assertCardShown(page, 'the home page');
  await page.click(page.button('Allow'));
  assert.equal(queryRequests(net.sent).length, 1, 'premise: after Allow the question was sent');
  let release = () => {};
  holdWrites = new Promise<void>((resolve) => { release = resolve; });
  try {
    const off = page.elements().filter((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'off'
      && String(el.props.name ?? '').includes('data-commons'));
    assert.equal(off.length, 1, 'the panel offers no Off choice for Data Commons');
    // The change is made, and its write has not been answered yet.
    void page.check(off[0]);
    await new Promise((resolve) => setImmediate(resolve));
    await askOnQueryForm(page);
    assert.equal(queryRequests(net.sent).length, 1, 'the form sent a question while the panel\'s write was still pending');
  } finally {
    holdWrites = null;
    release();
  }
  await page.settle();
  await askOnQueryForm(page);
  assert.equal(queryRequests(net.sent).length, 2, 'after the write was answered the next question was not sent');
  page.unmount();
});

// --- Criterion 9's surface: no source On ------------------------------------------------
//
// A consent in force with every source Off: the route refuses `no_sources_on`
// (criterion 9), and the reader is told, in that kind's words, to turn a source
// On in the panel — whether the surface stops the question itself or reads the
// route's refusal (an SSE `error` event on the home page and `/explore`, a 403
// body through `SSEError` on `/ask`). Never the generic failure, never an answer.

for (const surface of SURFACES) {
  test(`criterion 9 (${surface.name}): with every source Off, the reader is told to turn one On, in the no_sources_on words`, async () => {
    const expected: string = friendlyStreamError({ code: 'no_sources_on' });
    assert.notEqual(expected, friendlyStreamError({ code: 'generic' }), 'no_sources_on has no reader text of its own');
    surface.session();
    sessions.rows.clear();
    const net = answers();
    const statement = await buildFlowsStatement();
    const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, 'off']));
    const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
    assert.equal(written.status, 200, 'premise: the all-Off consent was written');
    net.clear();
    const page = await mount(surface.element());
    await surface.ask(page);
    assert.ok(page.text().includes(expected), `${surface.name} does not tell the reader to turn a source On: ${page.text().slice(0, 400)}`);
    assert.ok(!page.text().includes('An answer.'), `${surface.name} showed an answer with no source On`);
    page.unmount();
  });
}

// --- Criterion 2: a refusal the route answers is the card, never the bare sentence ----------
//
// The race the card cannot prevent by itself: the page read the consent as in
// force, and by the time the question reached the route it was not (the
// statement changed, or the cookie went). Here the status read is answered
// "in force" while the request carries no consent, so the REAL gate refuses
// it; the surface must turn that refusal into the card.

for (const surface of SURFACES) {
  test(`criterion 2 (${surface.name}): a question the route refuses consent_required shows the card, never the bare sentence`, async () => {
    surface.session();
    sessions.rows.clear();
    const net = answers();
    const real = (globalThis as { fetch: typeof fetch }).fetch;
    const statement = await buildFlowsStatement();
    const inForce = { inForce: true, store: 'cookie', flowsVersion: statementHash(statement), states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: '2026-10-19' }])) };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const p = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
      if (p === '/api/sources/consent' && (init?.method ?? 'GET').toUpperCase() === 'GET') {
        return new Response(JSON.stringify(inForce), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return real(input, init);
    }) as typeof fetch;
    try {
      const page = await mount(surface.element());
      await surface.ask(page);
      assert.ok(queryRequests(net.sent).length >= 1, `premise: ${surface.name} sent the question on a consent it read as in force`);
      assert.ok(!page.text().includes(BARE_REFUSAL), `${surface.name} showed the reader the bare refusal sentence`);
      assertCardShown(page, `${surface.name}, on a refused question,`);
      page.unmount();
    } finally {
      globalThis.fetch = real;
    }
  });
}
