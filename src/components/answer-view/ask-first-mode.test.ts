// #644 W2, fix round 1, item 1: the Sources panel's Ask first line promises
// an ask only where this site can ask.
//
// THE RULE (`src/lib/sources/copy.ts`'s header): a text that would be false
// on an instance that lacks the thing it describes renders only when the
// instance has it. A question stops to ask the reader only under
// `SOURCE_ROUTING=in-loop`; under `all-sources`, the default, no question
// stops. So the panel's Ask first row reads the owner's ruled words (card F)
// only when this instance runs in-loop, and the words that are true on every
// instance otherwise, including when the mode could not be read.
//
// HOW THE PANEL LEARNS THE MODE. The panel is a client component with no
// props, mounted from files W2 does not edit, so the decision route answers
// a `GET` with `{ routing }` (and `store`, R9 P1a), read through the leaf module
// `src/lib/mcp/source-routing-mode.ts`, and `useSourceConsent.ts` reads it
// beside the status and the statement.
//
// R9 P1 (#666, its second half): the row reads card F's words only where a
// question can stop: the mode is `in-loop` AND the decision store pair is set
// (the `GET`'s `store`). Under `in-loop` with no store a question cannot stop
// to ask (every Ask-first load records `no-answer`), so the row reads the
// words true on every instance; under `all-sources` the store does not matter.
//
// WHAT IS DRIVEN. The decision route's real `GET`, under each value of the
// variable; and the real Sources panel on R6's surface harness
// (`src/components/sources/surface-test-harness.ts`), whose request for the
// mode is answered by that same real `GET`, or by the harness's own
// unmatched reply (599), or by a 200 whose body names no mode. The two R6
// pins of the bare words (`sources-panel.test.ts` criterion 15 and
// `consent-texts-ruled.test.ts`'s T6) stay as they are and keep passing.
//
// Run with: npm test

import { test } from 'node:test';
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
  textOf,
  type Surface,
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

// The store pair unset: the GET's `store` (R9 P1a, #681) reads false here.
for (const name of ['DATA_COMMONS_MCP_URL', 'NYC_CHARTER_HOSTING', 'SITE_DEPLOYMENT_GUIDE_URL', 'APP_HOST', 'NEXTAUTH_URL', 'SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
process.env.RATE_LIMIT_SECRET = 'fixture-w2fix1-secret'; // gitleaks:allow

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const ORIGIN = 'https://site.fixture.example';
const copy = await load('lib/sources/copy.ts');
const panelModule = await load('components/sources/SourcesPanel.tsx');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

/** The owner's ruled words for Ask first, card F = A (2026-10-22), pinned here byte for byte. */
const F_RULED = 'Ask first: nothing is sent to this source until you turn it On, here or when the site asks you during a question. If you choose Allow then, it stays On for later questions.';
/** The words true on every instance (R6's T6, `consent-texts-ruled.test.ts`). */
const T6 = 'Ask first: nothing is sent to this source until you turn it On.';

/**
 * `SOURCE_ROUTING` set to `value` (or unset) for the length of `run`, and every warning the server logs meanwhile;
 * with `store`, the decision store pair set to fixture values too (R9 P1), else left unset.
 */
async function withRouting<T>(value: string | undefined, run: () => Promise<T>, store = false): Promise<{ result: T; warned: string[] }> {
  const prior = process.env.SOURCE_ROUTING;
  const warn = console.warn;
  const warned: string[] = [];
  if (value === undefined) delete process.env.SOURCE_ROUTING;
  else process.env.SOURCE_ROUTING = value;
  if (store) {
    process.env.KV_REST_API_URL = 'https://kv.fixture.example';
    process.env.KV_REST_API_TOKEN = 'fixture-kv-token';
  }
  console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(' ')); };
  try {
    return { result: await run(), warned };
  } finally {
    console.warn = warn;
    if (prior === undefined) delete process.env.SOURCE_ROUTING;
    else process.env.SOURCE_ROUTING = prior;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
}

function getRoute(): (request: Request) => Promise<Response> {
  assert.equal(typeof decisionRoute.GET, 'function', 'src/app/api/sources/consent/decision/route.ts exports no GET');
  return decisionRoute.GET as (request: Request) => Promise<Response>;
}

async function askRoute(value: string | undefined): Promise<{ status: number; body: unknown; cache: string | null; warned: string[] }> {
  const GET = getRoute();
  const { result, warned } = await withRouting(value, async () => {
    const response = await GET(new Request(`${ORIGIN}/api/sources/consent/decision`, { method: 'GET' }));
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  });
  return { ...result, warned };
}

// --- The route's GET ------------------------------------------------------------------------

test('item 1: the decision route\'s GET answers in-loop under SOURCE_ROUTING=in-loop, with no-store', async () => {
  const answer = await askRoute('in-loop');
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { routing: 'in-loop', store: false });
  assert.equal(answer.cache, 'no-store');
  assert.deepEqual(answer.warned, []);
});

test('item 1: the decision route\'s GET answers all-sources with the variable unset, empty, or set to a value outside the set', async () => {
  for (const value of [undefined, '', 'sideways']) {
    const answer = await askRoute(value);
    assert.equal(answer.status, 200, `SOURCE_ROUTING=${JSON.stringify(value)}`);
    assert.deepEqual(answer.body, { routing: 'all-sources', store: false }, `SOURCE_ROUTING=${JSON.stringify(value)}`);
    assert.equal(answer.cache, 'no-store', `SOURCE_ROUTING=${JSON.stringify(value)}`);
    // parseSourceRouting's rule: a value outside the set is logged once, by name, never by value.
    assert.equal(answer.warned.length, value === 'sideways' ? 1 : 0, `SOURCE_ROUTING=${JSON.stringify(value)}: ${JSON.stringify(answer.warned)}`);
    for (const line of answer.warned) assert.ok(!line.includes('sideways'), `the log prints the value: ${line}`);
  }
});

// --- The pin ---------------------------------------------------------------------------------

test('item 1: ASK_FIRST_MEANS_WITH_PAUSE is card F\'s ruled words, and ASK_FIRST_MEANS the words true on every instance', () => {
  assert.equal(copy.ASK_FIRST_MEANS_WITH_PAUSE, F_RULED, 'ASK_FIRST_MEANS_WITH_PAUSE is not card F\'s words');
  assert.equal(copy.ASK_FIRST_MEANS, T6, 'ASK_FIRST_MEANS is not the words true on every instance');
});

// --- The panel ---------------------------------------------------------------------------------

/** How the test answers the panel's read of the mode; `store` sets the decision store pair for the route's GET (R9 P1). */
type ModeAnswer = { label: string; routing?: string; store?: boolean; reply?: () => Response };

const ANSWERS: Record<'inLoop' | 'inLoopNoStore' | 'allSources' | 'allSourcesStore' | 'unset' | 'unmatched' | 'noMode', ModeAnswer> = {
  inLoop: { label: 'the route, under in-loop with the store pair set', routing: 'in-loop', store: true },
  inLoopNoStore: { label: 'the route, under in-loop with the store pair unset', routing: 'in-loop', store: false },
  allSources: { label: 'the route, under all-sources', routing: 'all-sources' },
  allSourcesStore: { label: 'the route, under all-sources with the store pair set', routing: 'all-sources', store: true },
  unset: { label: 'the route, with the variable unset', routing: undefined },
  // The harness's own reply to a request it has no answer for.
  unmatched: { label: 'the harness\'s unmatched reply (599)', reply: () => new Response(JSON.stringify({ error: 'no answer for /api/sources/consent/decision' }), { status: 599 }) },
  // A 200 that names no mode: what R6's own suites answer it with, since their
  // `/api/sources/consent` answer is matched by prefix.
  noMode: { label: 'a 200 that names no mode', reply: () => new Response(JSON.stringify({ inForce: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }) },
};

async function panelUnder(answer: ModeAnswer): Promise<{ panel: Surface; row: () => string }> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/sources/consent/decision': async (request: Request) => {
      assert.equal(request.method, 'GET', 'the panel posted a decision');
      if (answer.reply) return answer.reply();
      return (await withRouting(answer.routing, () => getRoute()(request), answer.store === true)).result;
    },
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  const statement = await buildFlowsStatement();
  const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, s.sourceId === 'boston-opencontext' ? 'ask-first' : 'on']));
  const put = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(put.status, 200, 'premise: the consent write was refused');
  const panel = await mount(h(panelModule.default as ComponentType));
  await panel.settle();
  const row = () => textOf(panel.elements().find((el) => el.props['data-source'] === 'boston-opencontext')!);
  assert.ok(row().includes(T6.slice(0, -1)), `premise: the Boston row is not Ask first: ${row()}`);
  return { panel, row };
}

test('item 1: the panel on an in-loop instance: the Ask first row reads card F\'s words, not the bare line alone', async () => {
  assert.equal(typeof copy.ASK_FIRST_MEANS_WITH_PAUSE, 'string', 'copy.ts exports no ASK_FIRST_MEANS_WITH_PAUSE');
  const { panel, row } = await panelUnder(ANSWERS.inLoop);
  assert.ok(row().includes(copy.ASK_FIRST_MEANS_WITH_PAUSE), `the in-loop Ask first row: ${row()}`);
  assert.ok(row().includes('when the site asks you') && row().includes('If you choose Allow'), `the in-loop Ask first row: ${row()}`);
  panel.unmount();
});

test('R9 P1 (#666): the route\'s GET under in-loop says whether the store pair is set, and nothing else', async () => {
  const set = await withRouting('in-loop', async () => (await getRoute()(new Request(`${ORIGIN}/api/sources/consent/decision`, { method: 'GET' }))).json(), true);
  assert.deepEqual(set.result, { routing: 'in-loop', store: true });
  assert.deepEqual((await askRoute('in-loop')).body, { routing: 'in-loop', store: false });
});

for (const key of ['inLoopNoStore', 'allSources', 'allSourcesStore', 'unset', 'unmatched', 'noMode'] as const) {
  test(`item 1: the panel when the mode reads not in-loop (${ANSWERS[key].label}): the Ask first row reads the bare line and promises no ask`, async () => {
    const { panel, row } = await panelUnder(ANSWERS[key]);
    assert.ok(row().includes(T6), `the Ask first row: ${row()}`);
    assert.ok(!row().includes('when the site asks you'), `the Ask first row promises an ask: ${row()}`);
    assert.ok(!row().includes('If you choose Allow'), `the Ask first row promises an ask: ${row()}`);
    panel.unmount();
  });
}
