// R8 W2 fix round 2, item 1 (F1 of the G10 cold read, #644): two Ask-first
// sources pause in one run, and each card keeps its own outcome.
//
// THE DEFECT. The bus in `useSourceConsent.ts` held one pause, and the card
// found its decision only through it. When a second Ask-first source paused
// in the same run, the first card lost its answer and read "The question
// went on without your answer, so it did not use this source.", though the
// reader had answered and the run had used the source.
//
// WHAT IS DRIVEN. The home page's real component on R6's surface harness
// (`src/components/sources/surface-test-harness.ts`, not edited), fed by a
// held stream through its real hook (`useStreamingComparison` →
// `reportConsentPause` and the steps part → `ProgressLog` → `ConsentStep`).
// The decision route is answered by the test. The Sources panel, mounted
// beside the page, reads the same bus.
//
// THE SHAPE THAT CAN FAIL. Source A is answered, the run reports A's load
// and then B's pause: the line that ended A's pause under the one-slot bus.
// Every card for A is read after B's pause, and B's cards must still offer
// both buttons, so a fix that kept A's answer by ending nothing would fail.
// (e) is the one decision whose consent could not be moved (item 2): the
// route answers `moved: false`, and the card must not say "It is On now."
//
// Adapted from the cold read's scratch suite (`g10-two-pauses.test.ts`,
// test 1). Run with: npm test

import { afterEach, test } from 'node:test';
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
  type HostElement,
  type Surface,
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, './BpmnViewer': 'export default function BpmnViewer() { return null; }' });

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
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
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const SourcesPanel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The text the cards must read -------------------------------------------------------------

const ALLOWED = 'You chose Allow. It is On now.';
const DECLINED = 'You chose Not now. Nothing is sent to it for this question.';
const ALLOWED_NOT_MOVED = 'You chose Allow. This question is sent to it, but it could not be turned On for later questions. You can turn it On in the panel.';

// --- The stream, the route answers, the pauses -----------------------------------------------

interface Held { response: Response; push: (event: Json) => void; close: () => void }
function heldStream(): Held {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (event) => { if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); },
    close: () => { if (!closed) { closed = true; controller.close(); } },
  };
}

const mounted: Surface[] = [];
let streams: Held[] = [];
let decisions: Json[] = [];
/** What the decision route answers on a 200: `moved: false` when the consent could not be moved (item 2). */
let moved: boolean | undefined;
afterEach(() => {
  for (const s of streams) s.close();
  for (const p of mounted.splice(0)) p.unmount();
  moved = undefined;
});

const statement = await buildFlowsStatement();
const src = (id: string) => {
  const found = statement.sources.find((s: { sourceId: string }) => s.sourceId === id);
  assert.ok(found, `premise: the statement names ${id}`);
  return found;
};
const A = 'boston-opencontext';
const B = 'data-commons';
// A key per pause per test, as the server mints one per pause: the surface harness can leave a
// subscription on the bus after a surface unmounts (measured: two listeners left after (c)), so the
// bus is not always emptied between tests, and a key reused across tests would find an earlier entry.
let run = 0;
let KEY_A = '';
let KEY_B = '';
const keyOf = (prefix: string) => `${prefix}${String(run).padStart(8, '0')}89abcdef4b1d2c3e`;
const pauseOf = (id: string, key: string) => ({ key, source: src(id), outbound: [], links: statement.links, expiresAt: new Date(Date.now() + 60_000).toISOString(), holds: true });

function answers() {
  streams = [];
  decisions = [];
  run += 1;
  KEY_A = keyOf('aaaaaaaa');
  KEY_B = keyOf('bbbbbbbb');
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': async (request: Request) => {
      if (request.method === 'GET') return new Response(JSON.stringify({ routing: 'in-loop' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const body = JSON.parse(await request.text()) as Json;
      decisions.push(body);
      const sourceId = body.key === KEY_A ? A : B;
      return new Response(JSON.stringify({ decision: body.decision, sourceId, ...(moved === undefined ? {} : { moved }) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/compare-stream': () => { const s = heldStream(); streams.push(s); return s.response; },
  });
}

async function consentWith(states: Record<string, string>): Promise<void> {
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, states[s.sourceId] ?? 'on'])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
}

// --- Reading the cards ---------------------------------------------------------------------

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const c of node) yield* within(c); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

interface CardRead { source: string; outcome: string | null; buttons: string[]; element: HostElement }
function cardsIn(elements: HostElement[]): CardRead[] {
  return elements.filter((el) => el.props['data-part'] === 'consent-step').map((el) => {
    const inner = [...within(el.props.children)];
    const outcome = inner.find((x) => x.props['data-part'] === 'consent-outcome');
    return { source: String(el.props['data-consent-source']), outcome: outcome ? textOf(outcome) : null, buttons: inner.filter((x) => x.type === 'button').map((x) => textOf(x)), element: el };
  });
}
const cardsFor = (surface: Surface, id: string) => cardsIn(surface.elements()).filter((c) => c.source === id);
const summary = (surface: Surface) => JSON.stringify(cardsIn(surface.elements()).map(({ source, outcome, buttons }) => ({ source, outcome, buttons })));

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}`);
  return found[0];
}

async function ask(surface: Surface): Promise<void> {
  const box = one(surface, 'question box', (el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  await surface.type(box, 'How many service requests did Boston record in 2025?');
  await surface.submit(one(surface, 'form', (el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea')));
}
const settle = async (...surfaces: Surface[]) => {
  await new Promise((r) => setTimeout(r, 50));
  for (const s of surfaces) await s.settle();
};

/** The button labelled `label` in the first card for `id`. */
function buttonOf(surface: Surface, id: string, label: string): HostElement {
  const card = cardsFor(surface, id)[0];
  assert.ok(card, `no card for ${id}: ${summary(surface)}`);
  const button = [...within(card.element.props.children)].find((x) => x.type === 'button' && textOf(x) === label);
  assert.ok(button, `the card for ${id} has no ${label}: ${summary(surface)}`);
  return button!;
}

const loadStart = (alias: string, label: string, iteration: number): Json => ({ type: 'progress', panel: 'withMcp', message: `Loading the ${label} source`, phase: 'tool_start', iteration, args: { alias }, toolName: 'load_source', operationType: 'load_source' });
const pauseLine = (id: string, key: string, label: string): Json => ({ type: 'progress', panel: 'withMcp', message: `Waiting for your answer about ${label}, which is set to Ask first`, phase: 'consent_pause', pause: pauseOf(id, key) });
const loadDone = (label: string, iteration: number): Json => ({ type: 'progress', panel: 'withMcp', message: `Loaded the ${label} source`, phase: 'tool_complete', iteration, duration_ms: 4000, toolName: 'load_source', operationType: 'load_source' });

/**
 * The home page, both sources Ask first, a run held open: pause A is answered
 * with `choice`, A's load completes, and B pauses. Returns the page and the
 * stream, at B's pause.
 */
async function twoPauses(choice: 'Allow' | 'Not now', beside?: (page: Surface) => Promise<Surface>): Promise<{ page: Surface; stream: Held; panel?: Surface }> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  answers();
  await consentWith({ [A]: 'ask-first', [B]: 'ask-first' });
  const page = await mount(h(Home));
  mounted.push(page);
  const panel = beside ? await beside(page) : undefined;
  const all = panel ? [page, panel] : [page];
  await ask(page);
  const stream = streams[0];
  assert.ok(stream, 'premise: the page started a run');
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
  stream.push(loadStart('boston', 'Boston OpenContext', 1));
  stream.push(pauseLine(A, KEY_A, 'Boston OpenContext'));
  await settle(...all);
  assert.ok(cardsFor(page, A).length > 0, `premise: the page shows A's card: ${summary(page)}`);
  await page.click(buttonOf(page, A, choice));
  await settle(...all);
  assert.deepEqual(decisions, [{ key: KEY_A, decision: choice === 'Allow' ? 'allow' : 'not-now' }], 'premise: A\'s answer was posted with A\'s key');
  stream.push(loadDone('Boston OpenContext', 1));
  stream.push(loadStart('data_commons', 'Data Commons', 2));
  stream.push(pauseLine(B, KEY_B, 'Data Commons'));
  await settle(...all);
  return { page, stream, panel };
}

// --- (a), (b): each card keeps its own outcome ----------------------------------------------

for (const [choice, sentence] of [['Allow', ALLOWED], ['Not now', DECLINED]] as const) {
  test(`item 1 (${choice === 'Allow' ? 'a' : 'b'}): after ${choice} on source A and a pause from source B in the same run, A's card reads its own outcome and B's card offers both buttons`, async () => {
    const { page } = await twoPauses(choice);
    const a = cardsFor(page, A);
    const b = cardsFor(page, B);
    assert.ok(a.length > 0 && b.length > 0, `premise: both cards are on the page: ${summary(page)}`);
    for (const card of a) {
      assert.equal(card.outcome, sentence, `card A's outcome after pause B: ${card.outcome}`);
      assert.deepEqual(card.buttons, [], 'card A offers buttons again');
    }
    for (const card of b) {
      assert.equal(card.outcome, null, `card B shows an outcome before any answer: ${card.outcome}`);
      assert.deepEqual(card.buttons, ['Allow', 'Not now'], `card B's buttons: ${card.buttons.join(', ')}`);
    }
  });
}

// --- (c) the panel's rows -------------------------------------------------------------------

test('item 1 (c): the Sources panel beside the page: after pause B only B\'s row shows the card; after B is answered and the run goes on, neither row does', async () => {
  const rowCards = (panel: Surface, id: string) => {
    const row = panel.elements().find((el) => el.props['data-source'] === id);
    assert.ok(row, `premise: the panel has a row for ${id}`);
    return cardsIn([...within(row!)]);
  };
  const { page, stream, panel } = await twoPauses('Allow', async () => {
    const p = await mount(h(SourcesPanel));
    mounted.push(p);
    await p.settle();
    return p;
  });
  assert.ok(panel);
  const bRow = rowCards(panel!, B);
  assert.equal(bRow.length, 1, `B's row shows ${bRow.length} cards: ${summary(panel!)}`);
  assert.deepEqual(bRow[0].buttons, ['Allow', 'Not now'], `B's row card: ${bRow[0].buttons.join(', ')}`);
  assert.equal(rowCards(panel!, A).length, 0, `A's row still shows a card once the run moved past A: ${summary(panel!)}`);

  // B answered from the panel's own row, then a later line of the run.
  await panel!.click(buttonOf(panel!, B, 'Allow'));
  await settle(page, panel!);
  assert.deepEqual(decisions.at(-1), { key: KEY_B, decision: 'allow' }, 'premise: B\'s answer was posted with B\'s key');
  for (const card of cardsFor(page, B)) assert.equal(card.outcome, ALLOWED, `card B on the page after Allow in the panel: ${card.outcome}`);
  stream.push(loadDone('Data Commons', 2));
  await settle(page, panel!);
  assert.equal(rowCards(panel!, A).length + rowCards(panel!, B).length, 0, `a row keeps a card after the run moved on: ${summary(panel!)}`);
  for (const card of cardsFor(page, A)) assert.equal(card.outcome, ALLOWED, `card A at the end: ${card.outcome}`);
  for (const card of cardsFor(page, B)) assert.equal(card.outcome, ALLOWED, `card B at the end: ${card.outcome}`);
});

// --- (e) item 2's card: the answer was saved, the consent could not be moved ------------------

test('item 2 (e): when the route answers Allow with moved: false, the card says the question uses the source but it is not On', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  answers();
  moved = false;
  await consentWith({ [A]: 'ask-first' });
  const page = await mount(h(Home));
  mounted.push(page);
  await ask(page);
  const stream = streams[0];
  assert.ok(stream, 'premise: the page started a run');
  stream.push(loadStart('boston', 'Boston OpenContext', 1));
  stream.push(pauseLine(A, KEY_A, 'Boston OpenContext'));
  await settle(page);
  await page.click(buttonOf(page, A, 'Allow'));
  await settle(page);
  const a = cardsFor(page, A);
  assert.ok(a.length > 0, `premise: A's card is on the page: ${summary(page)}`);
  for (const card of a) assert.equal(card.outcome, ALLOWED_NOT_MOVED, `card A after an Allow whose consent was not moved: ${card.outcome}`);
  // The run goes on with the source: the outcome stays.
  stream.push(loadDone('Boston OpenContext', 1));
  await settle(page);
  for (const card of cardsFor(page, A)) assert.equal(card.outcome, ALLOWED_NOT_MOVED, `card A after the load: ${card.outcome}`);
});
