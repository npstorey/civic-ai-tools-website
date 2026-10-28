// R9 P1a (#681): the client guard refuses a question with no source On only
// where the run could reach no source — the rule the server gate applies.
//
// THE RULE. `guardQuestion` answers `none-on` (the surface shows
// `no_sources_on`'s words and sends nothing) when no configured source is On
// and either every one is Off, or this instance cannot ask the reader about
// an Ask-first source: the decision route's `GET` says `all-sources`, or says
// the store pair is not set. Under `in-loop` with the store set it runs the
// question, and the loop asks. When the `GET` failed (`routing: null`) it
// runs the question too (the seat's ruling): the server gate is
// authoritative, and a client refusal with no server call is the defect this
// phase removes; if the server refuses, the surface shows the server's words.
// Every source Off is refused whatever the `GET` said, since no mode reaches
// an Off source.
//
// WHAT IS DRIVEN. The real `useSourceConsent.ts` bus and guard; the real
// `/api/flows`, `/api/sources/consent` and decision route `GET` handlers,
// with a cookie jar between requests; the home page (`QueryForm`) and
// `/explore` (`TraceControls`) on the surface harness, each query route a
// stand-in that asks the REAL gate with this instance's mode and store flag.
// `@vercel/kv` is the fake store, whose call log shows the `GET` reads no key.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the guard answers `none-on` for
// every consent with no source On, whatever the mode, the store or a failed
// `GET`, and the `GET` carries no `store`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  sessions,
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  '@vercel/kv': FAKE_VERCEL_KV_MODULE,
  // `/explore`'s BPMN canvas: a browser-only library and a stylesheet import.
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});
const kv = new FakeDecisionKv();
(globalThis as unknown as { __w2DecisionKv: FakeDecisionKv }).__w2DecisionKv = kv;

// --- The configuration: three sources (Data Commons has a default address) --------------------------------------------------

for (const name of [
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING',
  'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
process.env.RATE_LIMIT_SECRET = 'fixture';

const ORIGIN = 'https://site.fixture.example';

// The browser globals the surfaces read.
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
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
// Typed `any`, so the gate's third argument type-checks on the base, whose gate takes two.
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { sourceRoutingMode } = await load('lib/mcp/source-routing-mode.ts');
const { decisionStoreFromEnv } = await load('lib/sources/decision.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { friendlyStreamError } = await load('lib/streaming.ts');
const bus = await load('components/sources/useSourceConsent.ts');

const NO_SOURCES_ON_TEXT: string = friendlyStreamError({ code: 'no_sources_on' });

// --- The answers ---------------------------------------------------------------------

const QUERY_ROUTES = ['/api/compare-stream', '/api/query-notebook', '/api/compare'];

const sse = (events: Array<Record<string, unknown>>) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/** A query route as the gate makes it, told this instance's mode and store flag as the streaming routes tell it. */
function queryRoute(routePath: string) {
  return async (request: Request): Promise<Response> => {
    const body = JSON.parse(await request.clone().text() || '{}') as { mcpOnly?: boolean };
    const decision = await consentInForce(request, sessions.server, { routing: sourceRoutingMode(), store: decisionStoreFromEnv() !== null });
    const panels = body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
    if (!decision.ok) {
      if (routePath === '/api/compare-stream') {
        return sse(panels.map((panel) => ({ type: 'error', panel, message: decision.payload.error, code: decision.payload.code, flowsVersion: decision.payload.flowsVersion, reask: decision.payload.reask })));
      }
      return new Response(JSON.stringify(decision.payload), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    if (routePath === '/api/compare-stream') {
      return sse(panels.map((panel) => ({ type: 'complete', panel, data: { content: 'An answer.', duration_ms: 1, tools_called: [] } })));
    }
    return sse([]);
  };
}

/** Every request answered; the decision route's `GET` by the real handler, or failed with a 500. */
function answers(options: { decisionGet: 'real' | 'failed' }) {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent/decision': (request: Request) =>
      request.method === 'GET' && options.decisionGet === 'failed'
        ? new Response(JSON.stringify({ error: 'fixture: the read failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        : (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    ...Object.fromEntries(QUERY_ROUTES.map((p) => [p, queryRoute(p)])),
  });
}

// --- One case: the instance, the reader's states ------------------------------------------------

type States = Record<string, 'on' | 'ask-first' | 'off'>;
interface Instance { label: string; routing?: 'in-loop'; store: boolean; decisionGet?: 'failed' }

const IN_LOOP_STORE: Instance = { label: 'in-loop, the store set', routing: 'in-loop', store: true };
const IN_LOOP_NO_STORE: Instance = { label: 'in-loop, the store unset', routing: 'in-loop', store: false };
const ALL_SOURCES_STORE: Instance = { label: 'all-sources, the store set', store: true };
const GET_FAILED: Instance = { label: 'the GET failed (routing null), in-loop with the store', routing: 'in-loop', store: true, decisionGet: 'failed' };

/** Set the instance's variables for the length of `run`. */
async function onInstance<T>(instance: Instance, run: () => Promise<T>): Promise<T> {
  if (instance.routing) process.env.SOURCE_ROUTING = instance.routing;
  else delete process.env.SOURCE_ROUTING;
  if (instance.store) {
    process.env.KV_REST_API_URL = 'https://kv.fixture.example';
    process.env.KV_REST_API_TOKEN = 'fixture-kv-token';
  }
  try {
    return await run();
  } finally {
    for (const name of ['SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[name];
  }
}

/** A fresh anonymous reader whose consent cookie holds `states`, written through the real consent route. */
async function consentWith(states: States, decisionGet: 'real' | 'failed'): Promise<ReturnType<typeof installFetch>> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  sessions.rows.clear();
  const net = answers({ decisionGet });
  const statement = await buildFlowsStatement();
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, 'premise: the consent was written');
  net.clear();
  return net;
}

/** The guard's answer, read after the bus has read the status, the statement and the GET afresh. */
async function guardOn(instance: Instance, states: States): Promise<{ result: string; ran: number; asked: number }> {
  return onInstance(instance, async () => {
    await consentWith(states, instance.decisionGet ?? 'real');
    await bus.refreshConsent();
    let ran = 0;
    let asked = 0;
    const result = await bus.guardQuestion(() => { ran += 1; }, () => { asked += 1; });
    return { result, ran, asked };
  });
}

const SOURCES = ['socrata', 'data-commons', 'boston-opencontext'];
const all = (state: 'on' | 'ask-first' | 'off'): States => Object.fromEntries(SOURCES.map((id) => [id, state]));
const ALL_ASK_FIRST = all('ask-first');
const ALL_OFF = all('off');
const OFF_AND_ASK_FIRST: States = { socrata: 'off', 'data-commons': 'off', 'boston-opencontext': 'ask-first' };
const ONE_ON: States = { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' };

test('premise: three sources are configured', async () => {
  const statement = await buildFlowsStatement();
  assert.deepEqual(statement.sources.map((s: { sourceId: string }) => s.sourceId), SOURCES);
});

// --- Criterion 3: the guard, branch by branch -----------------------------------------------

const CASES: Array<[Instance, string, States, 'ran' | 'none-on']> = [
  [IN_LOOP_STORE, 'every source Ask first', ALL_ASK_FIRST, 'ran'],
  [IN_LOOP_STORE, 'Off and Ask first', OFF_AND_ASK_FIRST, 'ran'],
  [IN_LOOP_STORE, 'one source On', ONE_ON, 'ran'],
  [IN_LOOP_STORE, 'every source Off', ALL_OFF, 'none-on'],
  [IN_LOOP_NO_STORE, 'every source Ask first', ALL_ASK_FIRST, 'none-on'],
  [IN_LOOP_NO_STORE, 'one source On', ONE_ON, 'ran'],
  [ALL_SOURCES_STORE, 'every source Ask first', ALL_ASK_FIRST, 'none-on'],
  [ALL_SOURCES_STORE, 'every source Off', ALL_OFF, 'none-on'],
  [GET_FAILED, 'every source Ask first', ALL_ASK_FIRST, 'ran'],
  [GET_FAILED, 'every source Off', ALL_OFF, 'none-on'],
];

for (const [instance, what, states, expected] of CASES) {
  test(`R9 P1a criterion 3: ${instance.label}, ${what}: the guard answers ${expected}`, async () => {
    const answer = await guardOn(instance, states);
    assert.equal(answer.result, expected, `${instance.label}, ${what}`);
    assert.equal(answer.ran, expected === 'ran' ? 1 : 0, 'the question was run a number of times other than the answer says');
    assert.equal(answer.asked, 0, 'the card was asked for with a consent in force');
  });
}

test('R9 P1a criterion 3: the bus keeps the GET\'s store beside routing, and null for both when the GET failed', async () => {
  for (const [instance, routing, store] of [
    [IN_LOOP_STORE, 'in-loop', true],
    [IN_LOOP_NO_STORE, 'in-loop', false],
    [ALL_SOURCES_STORE, 'all-sources', true],
    [GET_FAILED, null, null],
  ] as Array<[Instance, unknown, unknown]>) {
    await onInstance(instance, async () => {
      await consentWith(ALL_ASK_FIRST, instance.decisionGet ?? 'real');
      await bus.refreshConsent();
      // The snapshot is read through a subscription, as a surface reads it.
      let seen: Record<string, unknown> = {};
      const page = await mount(h(function Reader() { seen = bus.useSourceConsent() as Record<string, unknown>; return null; }));
      assert.equal(seen.routing, routing, `${instance.label}: routing`);
      assert.equal(seen.store, store, `${instance.label}: store`);
      page.unmount();
    });
  }
  assert.deepEqual(kv.calls, [], 'a GET reached the store');
});

// --- Criterion 3: the two surfaces that guard a question ---------------------------------------

const QUESTION = 'How many service requests were there in 2025?';
const queryRequests = (sent: Array<{ path: string }>) => sent.filter((r) => QUERY_ROUTES.includes(r.path));

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}; the surface reads: ${surface.text().slice(0, 500)}`);
  return found[0];
}

async function askOnQueryForm(surface: Surface): Promise<void> {
  const box = one(surface, 'question box', (el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  await surface.type(box, QUESTION);
  await surface.submit(one(surface, 'form holding the question box', (el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea')));
}

async function askOnExplore(surface: Surface): Promise<void> {
  await surface.click(surface.button('Try your own'));
  const box = one(surface, 'live question input', (el) => el.type === 'input' && el.props.className === 'live-query-input');
  await surface.type(box, QUESTION);
  await surface.submit(one(surface, 'live question form', (el) => el.type === 'form'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  await surface.settle();
}

const SURFACES: Array<{ name: string; element: () => ReturnType<typeof h>; ask: (s: Surface) => Promise<void> }> = [
  { name: 'home (QueryForm)', element: () => h(Home), ask: askOnQueryForm },
  { name: '/explore (TraceControls)', element: () => h(McpFlowDiagram), ask: askOnExplore },
];

for (const surface of SURFACES) {
  test(`R9 P1a criterion 3 (${surface.name}): in-loop with the store and every source Ask first, the question is sent and no refusal is shown`, async () => {
    await onInstance(IN_LOOP_STORE, async () => {
      const net = await consentWith(ALL_ASK_FIRST, 'real');
      await bus.refreshConsent();
      const page = await mount(surface.element());
      await surface.ask(page);
      assert.equal(queryRequests(net.sent).length, 1, `${surface.name} did not send the question: ${page.text().slice(0, 400)}`);
      assert.ok(!page.text().includes(NO_SOURCES_ON_TEXT), `${surface.name} showed the no_sources_on words`);
      page.unmount();
    });
  });

  test(`R9 P1a criterion 3 (${surface.name}): in-loop with the store unset and every source Ask first, nothing is sent and the no_sources_on words are shown`, async () => {
    await onInstance(IN_LOOP_NO_STORE, async () => {
      const net = await consentWith(ALL_ASK_FIRST, 'real');
      await bus.refreshConsent();
      const page = await mount(surface.element());
      await surface.ask(page);
      assert.deepEqual(queryRequests(net.sent), [], `${surface.name} sent a question no source could answer`);
      assert.ok(page.text().includes(NO_SOURCES_ON_TEXT), `${surface.name} does not show the no_sources_on words: ${page.text().slice(0, 400)}`);
      page.unmount();
    });
  });
}
