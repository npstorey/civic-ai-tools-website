// R9 P1, criterion 2 (#669 D2): the card outlives the hold.
//
// THE RULING. After the hold's end (`expiresAt`, 60 s) the card keeps its
// equal Allow and Not now for the entry's life (600 s from the pause's
// start, `entryExpiresAt` on the event), with words that say the run went on
// without the answer and that an answer now applies to the reader's next
// question. Allow then posts to the decision route, which answers 200 and
// moves the source On (measured at G0); the card says the choice applies to
// the next question, and the panel shows the source On. Not now says nothing
// has changed. At the entry's end, or on a 404, the buttons go and the card
// says the question is no longer waiting; a 409 says an answer was already
// given. The Sources panel's row renders the same card for the same life.
// The run's own "moved on" state (`isComplete` on the step) changes the
// card's words, never its buttons (the seat's note 4).
//
// WHAT IS DRIVEN. The real card and the real Sources panel on R6's surface
// harness, the bus in `useSourceConsent.ts`, and the REAL decision route
// (`POST` and `GET`) over the fake store of `decision-store-for-tests.ts`
// (stubbed in as `@vercel/kv`), on ONE fake clock: node:test's mocked
// `setTimeout` and `Date` drive the card's timers and the store's expiry
// alike, so "the entry's end" is the same instant on both sides. The entry is
// written as the pause writes it (`{ sourceId }`, `EX 600`). The consent is
// the session cookie, written through the real consent route, so Allow's
// move of the source is the route's own. The isComplete legs drive the home
// page (`ProgressLog`) and `/ask` in notebook mode (`AnswerView`'s step
// view) through their real hooks on a held stream.
//
// THE SHAPE THAT CAN FAIL. Every after-hold leg is read at a time between the
// hold's end and the entry's end, where today's card already shows no
// buttons; the entry's-end leg is read one millisecond either side of 600 s.
//
// Run with: npm test

import { afterEach, mock, test } from 'node:test';
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
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, '@vercel/kv': FAKE_VERCEL_KV_MODULE, './BpmnViewer': 'export default function BpmnViewer() { return null; }' });

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
process.env.SOURCE_ROUTING = 'in-loop';
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.KV_REST_API_URL = 'https://kv.fixture.example';
process.env.KV_REST_API_TOKEN = 'fixture-kv-token';

const kv = new FakeDecisionKv();
(globalThis as unknown as { __w2DecisionKv: FakeDecisionKv }).__w2DecisionKv = kv;

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
  document: { ...target, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Card = (await load('components/answer-view/ConsentStep.tsx')).default as ComponentType<Json>;
const SourcesPanel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const bus = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The words, as the card must render them (hypotheses until the research check) --------

const ENDED = 'The question went on without your answer, so it did not use this source.';
const STILL = 'You can still answer for your next question.';
const AFTER_CHOICES = 'Allow: it is turned On for later questions. Not now: nothing changes.';
const ALLOWED_AFTER = 'You chose Allow. It is On for your next question.';
const DECLINED_AFTER = 'You chose Not now. Nothing has changed.';
const GONE = 'This question is no longer waiting for an answer.';
const DECIDED = 'An answer was already given for this question.';
const WAIT = 'The question waits up to a minute for your answer.';

// --- The fixture -----------------------------------------------------------------------------

const T0 = Date.parse('2026-10-29T12:00:00.000Z');
const statement = await buildFlowsStatement();
const BOSTON = statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext');
let run = 0;
/** A key per pause per test (the harness can leave subscriptions on the bus between tests). */
const nextKey = () => `af7e${String(++run).padStart(4, '0')}0123456789abcdef01234567`;
const iso = (t: number) => new Date(t).toISOString();
const pauseAt = (key: string, start: number) => ({ key, source: BOSTON, outbound: [], links: statement.links, expiresAt: iso(start + 60_000), entryExpiresAt: iso(start + 600_000), holds: true });

const mounted: Surface[] = [];
afterEach(() => {
  for (const page of mounted.splice(0)) page.unmount();
  mock.timers.reset();
});

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/compare-stream': held,
    '/api/query-notebook': held,
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

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const c of node) yield* within(c); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

interface CardRead { inRow: boolean; text: string; outcome: string | null; buttons: HostElement[] }

/** Every consent card on the surface, with whether it sits in a Sources panel row. */
function cards(surface: Surface): CardRead[] {
  const rows = surface.elements().filter((el) => el.props['data-source'] !== undefined);
  const inRow = new Set<unknown>();
  for (const row of rows) for (const el of within(row)) inRow.add(el);
  return surface.elements().filter((el) => el.props['data-part'] === 'consent-step').map((el) => {
    const inner = [...within(el.props.children)];
    const outcome = inner.find((x) => x.props['data-part'] === 'consent-outcome');
    return { inRow: inRow.has(el), text: textOf(el), outcome: outcome ? textOf(outcome) : null, buttons: inner.filter((x) => x.type === 'button') };
  });
}
const summary = (surface: Surface) => JSON.stringify(cards(surface).map(({ inRow, outcome, buttons, text }) => ({ inRow, outcome, buttons: buttons.map((b) => textOf(b)), text: text.slice(0, 160) })));
function stepsCard(surface: Surface): CardRead {
  const found = cards(surface).filter((c) => !c.inRow);
  assert.equal(found.length, 1, `expected one card in the run's steps: ${summary(surface)}`);
  return found[0];
}
function rowCards(surface: Surface): CardRead[] {
  return cards(surface).filter((c) => c.inRow);
}
const labels = (c: CardRead) => c.buttons.map((b) => textOf(b));
function buttonOf(c: CardRead, label: string): HostElement {
  const found = c.buttons.find((b) => textOf(b) === label);
  assert.ok(found, `the card has no ${label}: ${c.text.slice(0, 300)}`);
  return found!;
}
function bostonState(surface: Surface): string | undefined {
  const row = surface.elements().find((el) => el.props['data-source'] === 'boston-opencontext');
  assert.ok(row, 'premise: the panel has no Boston row');
  return [...within(row!)].find((el) => el.type === 'input' && el.props.checked === true)?.props.value as string | undefined;
}

/**
 * The fake clock at T0, the entry written as the pause writes it, the pause
 * reported to the bus, and the run's card beside the real Sources panel.
 */
async function pausedOnClock(): Promise<{ page: Surface; key: string; tick: (ms: number) => Promise<void> }> {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const key = nextKey();
  assert.equal(await kv.set(`consent-decision:${key}`, { sourceId: 'boston-opencontext' }, { ex: 600, nx: true }), 'OK', 'premise: the entry was written');
  const pause = pauseAt(key, T0);
  bus.reportConsentPause(pause);
  const page = await mount(h('div', null, h(Card, { pause }), h(SourcesPanel)));
  mounted.push(page);
  await page.settle();
  assert.equal(bostonState(page), 'ask-first', 'premise: Boston is Ask first');
  assert.deepEqual(labels(stepsCard(page)), ['Allow', 'Not now'], `premise: the card offers both during the hold: ${summary(page)}`);
  const tick = async (ms: number) => {
    mock.timers.tick(ms);
    await page.settle();
  };
  return { page, key, tick };
}

// --- After the hold, before the entry's end ---------------------------------------------------

test('criterion 2: after the hold\'s end the card says the run went on without the answer, keeps Allow and Not now, and the panel row renders the same card', async () => {
  const { page, tick } = await pausedOnClock();
  await tick(60_000);
  const card = stepsCard(page);
  assert.deepEqual(labels(card), ['Allow', 'Not now'], `the card after the hold's end: ${card.text}`);
  for (const sentence of [ENDED, STILL, AFTER_CHOICES]) assert.ok(card.text.includes(sentence), `the card after the hold lacks "${sentence}": ${card.text}`);
  assert.ok(!card.text.includes(WAIT), 'the card still says the question waits');
  assert.equal(card.outcome, null, `the card shows an outcome before any answer: ${card.outcome}`);
  const row = rowCards(page);
  assert.equal(row.length, 1, `the row shows ${row.length} cards after the hold's end: ${summary(page)}`);
  assert.deepEqual(labels(row[0]), ['Allow', 'Not now'], 'the row\'s card lost its buttons at the hold\'s end');
  for (const sentence of [ENDED, STILL, AFTER_CHOICES]) assert.ok(row[0].text.includes(sentence), `the row's card lacks "${sentence}"`);
  // The two buttons stay equal (fix round 1).
  assert.deepEqual(card.buttons[0].props.style, card.buttons[1].props.style, 'the two buttons are styled differently after the hold');
});

test('criterion 2: Allow after the hold posts to the decision route (200), the card says it applies to the next question, and the panel shows the source On', async () => {
  const { page, key, tick } = await pausedOnClock();
  await tick(60_000);
  await tick(240_000);
  await page.click(buttonOf(stepsCard(page), 'Allow'));
  await page.settle();
  const stored = JSON.parse(kv.entries.get(`consent-decision:${key}`)?.value ?? '{}') as Json;
  assert.equal(stored.decision, 'allow', 'the decision route did not save the answer');
  const card = stepsCard(page);
  assert.equal(card.outcome, ALLOWED_AFTER, `the card after Allow: ${card.text}`);
  assert.deepEqual(labels(card), [], 'the buttons stay after a decision');
  assert.equal(bostonState(page), 'on', 'the panel does not show the source On after Allow');
  const row = rowCards(page);
  assert.ok(row.every((c) => c.outcome === ALLOWED_AFTER && c.buttons.length === 0), `the row's card after Allow: ${summary(page)}`);
});

test('criterion 2: Not now after the hold says nothing has changed, and the source stays Ask first', async () => {
  const { page, key, tick } = await pausedOnClock();
  await tick(120_000);
  await page.click(buttonOf(stepsCard(page), 'Not now'));
  await page.settle();
  const stored = JSON.parse(kv.entries.get(`consent-decision:${key}`)?.value ?? '{}') as Json;
  assert.equal(stored.decision, 'not-now', 'the decision route did not save the answer');
  assert.equal(stepsCard(page).outcome, DECLINED_AFTER, `the card after Not now: ${stepsCard(page).text}`);
  assert.equal(bostonState(page), 'ask-first', 'Not now moved the source');
});

// --- The entry's end, a 404 and a 409 ----------------------------------------------------------

test('criterion 2: the buttons stay until the entry\'s end, 600 s from the pause\'s start; then they go, the card says the question is no longer waiting, and the row\'s card goes', async () => {
  const { page, key, tick } = await pausedOnClock();
  await tick(599_999);
  assert.deepEqual(labels(stepsCard(page)), ['Allow', 'Not now'], `the buttons went before the entry's end: ${stepsCard(page).text}`);
  assert.equal(rowCards(page).length, 1, `the row's card went before the entry's end: ${summary(page)}`);
  await tick(1);
  const card = stepsCard(page);
  assert.deepEqual(labels(card), [], `the buttons outlived the entry: ${card.text}`);
  assert.equal(card.outcome, GONE, `the card at the entry's end: ${card.text}`);
  assert.equal(rowCards(page).length, 0, `the row keeps a card after the entry's end: ${summary(page)}`);
  // The server agrees, on the same clock: the entry is gone.
  const late = await fetch('/api/sources/consent/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, decision: 'allow' }) });
  assert.equal(late.status, 404, 'premise: the store still holds the entry at 600 s');
});

test('criterion 2: a 404 after the hold (the entry gone early) takes the buttons and says the question is no longer waiting', async () => {
  const { page, key, tick } = await pausedOnClock();
  await tick(90_000);
  kv.entries.delete(`consent-decision:${key}`);
  await page.click(buttonOf(stepsCard(page), 'Allow'));
  await page.settle();
  const card = stepsCard(page);
  assert.equal(card.outcome, GONE, `the card after a 404: ${card.text}`);
  assert.deepEqual(labels(card), []);
});

test('criterion 2: a 409 after the hold (answered elsewhere) says an answer was already given', async () => {
  const { page, key, tick } = await pausedOnClock();
  await tick(90_000);
  await kv.set(`consent-decision:${key}`, { sourceId: 'boston-opencontext', decision: 'not-now' }, { xx: true, keepTtl: true });
  await page.click(buttonOf(stepsCard(page), 'Allow'));
  await page.settle();
  const card = stepsCard(page);
  assert.equal(card.outcome, DECIDED, `the card after a 409: ${card.text}`);
  assert.deepEqual(labels(card), []);
});

// --- The row shows the latest pause about its source -----------------------------------------------

test('criterion 2, the row: an earlier question\'s pause, unanswered and alive, never comes back in the row once a later pause about the same source is answered', async () => {
  const { page, tick } = await pausedOnClock();
  await tick(60_000);
  assert.equal(rowCards(page).length, 1, 'premise: the row shows the earlier pause after its hold');
  // A later question pauses on the same source; the reader answers it in the row while the run waits.
  const key = nextKey();
  assert.equal(await kv.set(`consent-decision:${key}`, { sourceId: 'boston-opencontext' }, { ex: 600, nx: true }), 'OK', 'premise: the entry was written');
  bus.reportConsentPause(pauseAt(key, Date.now()));
  await page.settle();
  const row = rowCards(page);
  assert.equal(row.length, 1, `the row shows ${row.length} cards: ${summary(page)}`);
  assert.ok(row[0].text.includes(WAIT), `the row does not show the later pause: ${row[0].text}`);
  await page.click(buttonOf(row[0], 'Allow'));
  await page.settle();
  bus.reportConsentPause(null);
  await page.settle();
  assert.equal(rowCards(page).length, 0, `the row brought back the earlier pause after the later one was answered: ${summary(page)}`);
});

// --- The run's moved-on state never hides the buttons (note 4) -----------------------------------

interface Held { response: Response; push: (event: Json) => void; close: () => void }
let streams: Held[] = [];
function held(): Response {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const enc = new TextEncoder();
  const stream: Held = {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (event) => { if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); },
    close: () => { if (!closed) { closed = true; controller.close(); } },
  };
  streams.push(stream);
  return stream.response;
}
afterEach(() => {
  for (const s of streams.splice(0)) s.close();
});

async function ask(page: Surface): Promise<void> {
  const box = page.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  assert.ok(box, 'premise: no question box');
  await page.type(box!, 'How many service requests did Boston record in 2025?');
  await page.submit(page.elements().find((el) => el.type === 'form' && page.elements().some((x) => x.type === 'textarea'))!);
}
const settle = async (page: Surface) => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await page.settle();
};

test('note 4, ProgressLog (the home page): the run moves on and completes with the question unanswered; the card in the steps changes its words and keeps both buttons', async () => {
  ANON();
  streams = [];
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mount(h(Home));
  mounted.push(page);
  await ask(page);
  const stream = streams[0];
  assert.ok(stream, 'premise: the page started a run');
  const pause = pauseAt(nextKey(), Date.now());
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, args: { alias: 'boston' }, toolName: 'load_source', operationType: 'load_source' });
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Waiting for your answer about Boston OpenContext, which is set to Ask first', phase: 'consent_pause', pause });
  await settle(page);
  assert.deepEqual(labels(stepsCard(page)), ['Allow', 'Not now'], `premise: the card offers both during the hold: ${summary(page)}`);
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Loaded the Boston OpenContext source', phase: 'tool_complete', iteration: 1, duration_ms: 60_000, toolName: 'load_source', operationType: 'load_source' });
  stream.push({ type: 'complete', panel: 'withMcp', data: { content: 'An answer.', duration_ms: 1, tools_called: [] } });
  stream.push({ type: 'complete', panel: 'withoutMcp', data: { content: 'An answer.', duration_ms: 1 } });
  stream.close();
  await settle(page);
  const card = stepsCard(page);
  assert.deepEqual(labels(card), ['Allow', 'Not now'], `the card in the steps lost its buttons when the run moved on: ${card.text}`);
  assert.ok(card.text.includes(ENDED) && card.text.includes(STILL), `the card after the run moved on: ${card.text}`);
});

test('note 4, AnswerView (/ask, notebook mode): the run moves on with the question unanswered; the card in the step view changes its words and keeps both buttons', async () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  sessions.rows.clear();
  streams = [];
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mount(h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' }));
  mounted.push(page);
  await ask(page);
  const stream = streams[0];
  assert.ok(stream, 'premise: the page started a run');
  const pause = pauseAt(nextKey(), Date.now());
  stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  stream.push({ type: 'phase_a_progress', message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, args: { alias: 'boston' }, toolName: 'load_source', operationType: 'load_source' });
  stream.push({ type: 'phase_a_progress', message: 'Waiting for your answer about Boston OpenContext, which is set to Ask first', phase: 'consent_pause', pause });
  await settle(page);
  assert.deepEqual(labels(stepsCard(page)), ['Allow', 'Not now'], `premise: the card offers both during the hold: ${summary(page)}`);
  // The run goes on (its step view stays: the notebook has not arrived, #667 is not this test's).
  stream.push({ type: 'phase_a_progress', message: 'Loaded the Boston OpenContext source', phase: 'tool_complete', iteration: 1, duration_ms: 60_000, toolName: 'load_source', operationType: 'load_source' });
  stream.push({ type: 'phase_a_progress', message: 'Searching for datasets about service requests', phase: 'tool_start', iteration: 2, args: { query: 'service requests' }, toolName: 'search', operationType: 'search' });
  await settle(page);
  const card = stepsCard(page);
  assert.deepEqual(labels(card), ['Allow', 'Not now'], `the card in the step view lost its buttons when the run moved on: ${card.text}`);
  assert.ok(card.text.includes(ENDED) && card.text.includes(STILL), `the card after the run moved on: ${card.text}`);
});
