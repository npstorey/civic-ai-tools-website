// UX-2 HG: one pause card (D1 = A, D2 = A, D3 = A, D4 = A; the predicate as ruled on the stage-1 report).
//
// THE RULE. While the short box (`ConsentPausePrompt`) asks about a pause, it holds the only Allow, Don't allow and
// Allow all data sources on the page. The card in the run's steps for the same pause then has no button, and reads the
// heading, `asked`, `wait` and the source's lines, in the steps' own grey frame. The card has no buttons exactly when
// the short box shows the buttons for the same key. Every other state reads as it does today.
//
// THE RULED WORDS (W2 = A, W4 = b; #729 6920960303). The box also says the choice can be changed: the `change`
// sentence, with "Data source settings" as its link, straight after the choices sentence and before the buttons. In
// state (g) (the run's step closed while the box still asks) the card reads as a cancelled card reads: the heading, the
// source's lines, then `gone`, with no `asked` and no `wait`, no buttons, in the steps' frame; the box is unchanged.
//
// WHAT IS DRIVEN.
//   - Criterion 1: the three surfaces through their real page components on R6's surface harness
//     (`src/components/sources/surface-test-harness.ts`, not edited), each fed by a held stream through its real hook,
//     as `consent-step-surfaces-driven.test.ts` drives them: the home page (Standard, `useStreamingComparison`), `/ask`
//     in Sandbox mode (`useNotebookStream`) and `/explore` (Try your own, `useLiveTrace`).
//   - Criterion 2: the short box beside one card, the pause's state set through the bus's own functions
//     (`reportConsentPause`, `decideConsentPause` against a decision route the test answers, `cancelConsentPauses`, and
//     times already past). Guards (a)-(f) are the states that do not change; (g) is a red.
//   - (g) is also driven through the home page: an `error` event on the panel that paused closes the run's steps
//     (`closeStepsOnError`) and does not tell the bus, so the bus's hold stays open (#704). That is how a reader reaches
//     it.
//
// THE SHAPE THAT CAN FAIL. The base draws the buttons twice while the box asks, so criterion 1 and (g) are red on it.
// (g) is the state in which patch-a's predicate, which read `runMovedOn`, also drew two sets. Each guard reads the
// whole of what the card shows today (its buttons, the sentences that must and must not render, and its frame), so a
// predicate that took a state it should leave alone moves at least one of those. Each guard reads the box and the card
// in one assertion. The mutations each guard was shown failing under, run once against the fix: (a) the box's
// condition without "the hold has not ended"; (b) without "no decision"; (c) without "not expired"; (d) the card's
// predicate without "the pause has a key"; (e) without "in the run's steps"; (f) a predicate that reads no bus.
//
// BLIND SPOTS, stated. No layout, focus or browser events. Every pause mints its own key, since the bus keeps its
// entries between tests while a listener survives (the harness's known leak).
//
// Run with: npm test

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

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'DATABASE_URL',
]) delete process.env[name];
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
    innerHeight: 844,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const consentStep = await load('components/answer-view/ConsentStep.tsx');
const ConsentStep = consentStep.default as ComponentType<Record<string, unknown>>;
const ConsentPausePrompt = consentStep.ConsentPausePrompt as ComponentType;
const STEP = consentStep.CONSENT_STEP_TEXT as Record<string, string> & { heading: (name: string) => string };
const bus = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { sourceRowLines } = await load('lib/sources/source-name.ts');
const { SETTINGS_TEXT, SETTINGS_HREF } = await load('lib/sources/copy.ts');

const ALLOW = 'Allow';
const DONT_ALLOW = "Don't allow";
const ALLOW_ALL = 'Allow all data sources';
const STEPS_FRAME = '1px solid var(--border-color)';
const ACCENT_FRAME = '1px solid var(--accent)';

const statement = await buildFlowsStatement();
const BOSTON = statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext');
assert.ok(BOSTON, 'premise: the statement names boston-opencontext');
const HEADING = STEP.heading('Boston OpenContext');
const WHAT = (() => {
  const what = sourceRowLines(BOSTON).what as string;
  return what.charAt(0).toUpperCase() + what.slice(1);
})();
const LOGS = 'Who holds its logs';

// --- Keys, pauses, streams, route answers ----------------------------------------------------------------------------

let minted = 0;
/** A fresh decision key per pause: the bus can carry an earlier test's entry. */
const nextKey = () => `hg-pause-${(minted += 1)}-${Math.random().toString(16).slice(2, 10)}`;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
/** A pause about Boston: `holdMs` and `entryMs` from now (negative: already past). */
function pauseOf({ holds = true, holdMs = 60_000, entryMs = 600_000 }: { holds?: boolean; holdMs?: number; entryMs?: number } = {}): Json {
  return {
    ...(holds ? { key: nextKey(), entryExpiresAt: at(entryMs) } : {}),
    source: BOSTON,
    outbound: [],
    links: statement.links,
    expiresAt: at(holdMs),
    holds,
  };
}
const LOAD_START = { message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, args: { alias: 'boston_opencontext' }, toolName: 'load_source', operationType: 'load_source' };
const PAUSE_LINE = 'Waiting for your answer about Boston OpenContext, which is set to Ask first';

interface Held { response: Response; push: (event: Json) => void; close: () => void }
function heldStream(): Held {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (event) => { if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); },
    close: () => { if (!closed) { closed = true; controller.close(); } },
  };
}

let streams: Held[] = [];
/** What the decision route's POST answers: a status, or never (an answer in flight). */
let decisionStatus: number | 'never' = 200;
function answers() {
  streams = [];
  const held = () => {
    const stream = heldStream();
    streams.push(stream);
    return stream.response;
  };
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': async (request: Request) => {
      if (request.method === 'GET') return new Response(JSON.stringify({ routing: 'in-loop', store: true }), { status: 200 });
      if (decisionStatus === 'never') return new Promise<Response>(() => {});
      return new Response(JSON.stringify({ decision: 'allow', sourceId: 'boston-opencontext' }), { status: decisionStatus });
    },
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/compare-stream': held,
    '/api/query-notebook': held,
  });
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};
const SIGNED_IN_DB = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

async function consentWith(states: Record<string, string>): Promise<void> {
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, states[s.sourceId] ?? 'on'])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
}

const mounted: Surface[] = [];
afterEach(() => {
  for (const stream of streams) stream.close();
  for (const page of mounted.splice(0)) page.unmount();
  // A hold a test left open never reaches the next test's box.
  bus.cancelConsentPauses();
  decisionStatus = 200;
});
async function mountTracked(element: ReturnType<typeof h>): Promise<Surface> {
  const page = await mount(element);
  mounted.push(page);
  return page;
}
const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};

// --- Reading the page ------------------------------------------------------------------------------------------------

const QUESTION = 'How many service requests did Boston record in 2025?';

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}; the surface reads: ${surface.text().slice(0, 500)}`);
  return found[0];
}

async function askOnQueryForm(surface: Surface): Promise<void> {
  const box = one(surface, 'question box', (el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  await surface.type(box, QUESTION);
  const form = one(surface, 'form holding the question box', (el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea'));
  await surface.submit(form);
}

async function askOnExplore(surface: Surface): Promise<void> {
  await surface.click(surface.button('Try your own'));
  const box = one(surface, 'live question box', (el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  await surface.type(box, QUESTION);
  await surface.submit(one(surface, 'live question form', (el) => el.type === 'form'));
  await settle(surface, 600);
}

/** Every host element under `node`, in document order (the node itself excluded). */
function under(node: HostElement): HostElement[] {
  const found: HostElement[] = [];
  const walk = (child: unknown): void => {
    if (Array.isArray(child)) { for (const c of child) walk(c); return; }
    if (child === null || typeof child !== 'object' || !('props' in (child as object))) return;
    const el = child as HostElement;
    if (typeof el.type === 'string') found.push(el);
    walk((el.props as { children?: unknown }).children);
  };
  walk((node.props as { children?: unknown }).children);
  return found;
}
const buttonLabels = (node: HostElement): string[] => under(node).filter((el) => el.type === 'button').map((el) => textOf(el));
const prompts = (surface: Surface): HostElement[] => surface.elements().filter((el) => el.props['data-part'] === 'consent-pause-prompt');
const stepCards = (surface: Surface): HostElement[] =>
  surface.elements().filter((el) => el.props['data-part'] === 'consent-step' && el.props['data-consent-place'] === 'steps');

/** What a card shows: its buttons, which of the card's sentences it reads, and its frame. */
interface CardReading { buttons: string[]; says: string[]; frame: string }
const SENTENCES = ['asked', 'wait', 'choices', 'change', 'ended', 'stillAnswer', 'afterChoices', 'gone', 'cannotAsk', 'nextQuestion', 'allowed'] as const;
function readCard(card: HostElement): CardReading {
  const text = textOf(card);
  return {
    buttons: buttonLabels(card),
    says: SENTENCES.filter((k) => text.includes(STEP[k])),
    frame: String((card.props.style as { border?: unknown } | undefined)?.border),
  };
}

/** Criterion 1 on one surface, with the pause holding, unanswered and on the bus. */
function assertOnePlace(surface: Surface, where: string): void {
  const page = surface.elements();
  const boxes = prompts(surface);
  assert.equal(boxes.length, 1, `${where}: premise: one short box, found ${boxes.length}; the page reads: ${surface.text().slice(0, 400)}`);
  const inBox = new Set(under(boxes[0]));
  for (const label of [ALLOW, DONT_ALLOW, ALLOW_ALL]) {
    const all = page.filter((el) => el.type === 'button' && textOf(el) === label);
    assert.equal(all.length, 1, `${where}: the document has ${all.length} "${label}" buttons, not one`);
    assert.ok(inBox.has(all[0]), `${where}: the one "${label}" is not inside data-part="consent-pause-prompt"`);
  }
  // W2 A: the box says the choice can be changed, with Data source settings as its link, after the choices and before
  // the buttons.
  const boxText = textOf(boxes[0]);
  assert.ok(boxText.includes(STEP.change), `${where}: the short box does not carry the change sentence: ${boxText}`);
  assert.ok(boxText.indexOf(STEP.choices) >= 0 && boxText.indexOf(STEP.choices) < boxText.indexOf(STEP.change), `${where}: the change sentence does not follow the choices sentence in the box`);
  const boxEls = under(boxes[0]);
  const link = boxEls.filter((el) => el.type === 'a' && textOf(el) === SETTINGS_TEXT.link);
  assert.equal(link.length, 1, `${where}: the short box does not link "${SETTINGS_TEXT.link}" once`);
  assert.equal(link[0].props.href, SETTINGS_HREF, `${where}: the box's link does not lead to Data source settings`);
  const firstButton = boxEls.findIndex((el) => el.type === 'button');
  assert.ok(boxEls.indexOf(link[0]) < firstButton, `${where}: the change sentence does not come before the buttons`);
  const cards = stepCards(surface);
  assert.equal(cards.length, 1, `${where}: premise: one step card, found ${cards.length}`);
  const card = cards[0];
  const text = textOf(card);
  assert.deepEqual(buttonLabels(card), [], `${where}: the step card has buttons`);
  assert.ok(!text.includes(STEP.choices), `${where}: the step card reads the choices sentence`);
  assert.ok(!text.includes(STEP.change), `${where}: the step card reads the change sentence`);
  const order = [HEADING, STEP.asked, STEP.wait, WHAT, LOGS].map((s) => text.indexOf(s));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `${where}: the card is not heading, asked, wait, then the source's lines (${order.join(', ')}): ${text.slice(0, 400)}`);
  assert.equal((card.props.style as { border?: unknown }).border, STEPS_FRAME, `${where}: the card's frame is not the steps' own`);
}

// --- Criterion 1: one set of buttons, in the short box ---------------------------------------------------------------

test('HG criterion 1 (D1 A, D2 A), the home page (Standard): while the box asks, its three buttons are the only ones, and the step card reads heading, asked, wait, then the source\'s lines, in the steps\' frame', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountTracked(h(Home));
  await askOnQueryForm(page);
  assert.equal(streams.length, 1, 'premise: the question was sent');
  const stream = streams[0];
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf() });
  await settle(page);
  assertOnePlace(page, 'the home page');
});

test('HG criterion 1 (D1 A, D2 A), /ask (Sandbox): while the box asks, its three buttons are the only ones, and the step card reads heading, asked, wait, then the source\'s lines, in the steps\' frame', async () => {
  SIGNED_IN_DB();
  sessions.rows.clear();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountTracked(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
  await askOnQueryForm(page);
  assert.equal(streams.length, 1, 'premise: the question was sent');
  const stream = streams[0];
  stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  stream.push({ type: 'phase_a_progress', ...LOAD_START });
  stream.push({ type: 'phase_a_progress', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf() });
  await settle(page);
  assertOnePlace(page, '/ask');
});

test('HG criterion 1 (D3 A), /explore (Try your own): while the box asks, its three buttons are the only ones, and the response panel\'s card reads heading, asked, wait, then the source\'s lines, in the steps\' frame', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountTracked(h(McpFlowDiagram));
  await askOnExplore(page);
  assert.equal(streams.length, 1, 'premise: the question was sent');
  const stream = streams[0];
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf() });
  await settle(page);
  assertOnePlace(page, '/explore');
});

// --- Criterion 2: the box beside one card, state by state -------------------------------------------------------------

/**
 * The short box and the given cards, mounted together, read once the state has settled: the box's buttons (`null` when
 * it asks nothing) and each card's reading, compared in one assertion so a state the box and the card part on fails it.
 */
interface Reading { box: string[] | null; cards: CardReading[] }
async function boxAndCards(cards: Array<Record<string, unknown>>): Promise<{ reading: Reading; texts: string[] }> {
  const s = await mountTracked(h('div', null, h(ConsentPausePrompt), ...cards.map((props, i) => h(ConsentStep, { key: i, ...props }))));
  await settle(s);
  const box = prompts(s);
  const all = s.elements().filter((el) => el.props['data-part'] === 'consent-step');
  return { reading: { box: box.length === 0 ? null : buttonLabels(box[0]), cards: all.map(readCard) }, texts: all.map((el) => textOf(el)) };
}

test('HG criterion 2 (a), a guard: the hold ends unanswered: the card reads ended, stillAnswer and afterChoices, keeps Allow and Don\'t allow, and has no Allow all data sources', async () => {
  answers();
  const pause = pauseOf();
  bus.reportConsentPause(pause);
  // A later line of the run: the bus's hold ends, and the run's step is marked done.
  bus.reportConsentPause(null);
  const { reading } = await boxAndCards([{ pause, runMovedOn: true }]);
  assert.deepEqual(reading, { box: null, cards: [{ buttons: [ALLOW, DONT_ALLOW], says: ['change', 'ended', 'stillAnswer', 'afterChoices'], frame: ACCENT_FRAME }] }, 'after the hold: the box asks nothing, and the card reads as today');
});

test('HG criterion 2 (b), a guard: an answer given while the run waits: the card reads the heading, asked, the source\'s lines and the outcome', async () => {
  answers();
  const pause = pauseOf();
  bus.reportConsentPause(pause);
  decisionStatus = 200;
  await bus.decideConsentPause(pause.key, 'allow');
  const { reading, texts } = await boxAndCards([{ pause }]);
  assert.deepEqual(reading, { box: null, cards: [{ buttons: [], says: ['asked', 'allowed'], frame: ACCENT_FRAME }] }, 'answered: the box asks nothing, and the card reads as today');
  const text = texts[0];
  const order = [HEADING, STEP.asked, WHAT, LOGS, STEP.allowed].map((x) => text.indexOf(x));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `the answered card is not heading, asked, the source's lines, then the outcome (${order.join(', ')})`);
});

test('HG criterion 2 (c), a guard: the entry has expired, or the run was cancelled: the card reads gone and has no buttons', async () => {
  answers();
  const expired = pauseOf({ holdMs: -2000, entryMs: -1000 });
  bus.reportConsentPause(expired);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const cancelled = pauseOf();
  bus.reportConsentPause(cancelled);
  bus.cancelConsentPauses();
  const { reading } = await boxAndCards([{ pause: expired, runMovedOn: true }, { pause: cancelled }]);
  assert.deepEqual(reading, { box: null, cards: [
    { buttons: [], says: ['ended', 'gone'], frame: ACCENT_FRAME },
    { buttons: [], says: ['gone'], frame: ACCENT_FRAME },
  ] }, 'expired and cancelled: the box asks nothing, and each card reads as today');
});

test('HG criterion 2 (d), a guard: a pause that does not hold reads cannotAsk and nextQuestion, with no buttons', async () => {
  answers();
  const pause = pauseOf({ holds: false });
  bus.reportConsentPause(pause);
  const { reading } = await boxAndCards([{ pause }]);
  assert.deepEqual(reading, { box: null, cards: [{ buttons: [], says: ['cannotAsk', 'nextQuestion'], frame: ACCENT_FRAME }] }, 'no hold: the box asks nothing, and the card reads as today');
});

test('HG criterion 2 (e), a guard (D4 A): the Sources row\'s card during the hold keeps its three buttons, as today', async () => {
  answers();
  const pause = pauseOf();
  bus.reportConsentPause(pause);
  const { reading } = await boxAndCards([{ pause, place: 'row' }]);
  assert.deepEqual(reading, { box: [ALLOW, DONT_ALLOW, ALLOW_ALL], cards: [{ buttons: [ALLOW, DONT_ALLOW, ALLOW_ALL], says: ['asked', 'wait', 'choices', 'change'], frame: ACCENT_FRAME }] }, 'the row during the hold: the box asks, and the row\'s card reads as today');
});

test('HG criterion 2 (f), a guard: a pause that is not on the bus keeps its three buttons in the card, as today', async () => {
  answers();
  const pause = pauseOf();
  const { reading } = await boxAndCards([{ pause }]);
  assert.deepEqual(reading, { box: null, cards: [{ buttons: [ALLOW, DONT_ALLOW, ALLOW_ALL], says: ['asked', 'wait', 'choices', 'change'], frame: ACCENT_FRAME }] }, 'not on the bus: the box asks nothing, and the card reads as today');
});

// W4 = b (#729 6920960303): in state (g) the card reads as a cancelled card reads: the heading, the source's lines,
// then `gone`; no `asked`, no `wait`, no buttons, in the steps' frame.
const G_CARD: CardReading = { buttons: [], says: ['gone'], frame: STEPS_FRAME };
/** State (g)'s card, in order: the heading, the source's lines, then `gone`. */
function assertGOrder(text: string, where: string): void {
  const order = [HEADING, WHAT, LOGS, STEP.gone].map((x) => text.indexOf(x));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `${where}: the card is not heading, the source's lines, then gone (${order.join(', ')}): ${text.slice(0, 300)}`);
}

test('HG criterion 2 (g), a red (W4 = b): the run has moved past the step while the bus\'s hold is open: the box keeps its three buttons, and the card has none and reads the heading, the source\'s lines, then gone', async () => {
  answers();
  const pause = pauseOf();
  bus.reportConsentPause(pause);
  const { reading, texts } = await boxAndCards([{ pause, runMovedOn: true }]);
  assert.deepEqual(reading, { box: [ALLOW, DONT_ALLOW, ALLOW_ALL], cards: [G_CARD] }, 'state (g): the box asks, and the card does not read as a cancelled card');
  assertGOrder(texts[0], 'state (g)');
});

test('HG criterion 2 (g), a red, reached on the home page (#704; W4 = b): an error on the panel that paused closes the steps and leaves the bus\'s hold open; the box keeps its three buttons, and the card has none and reads gone', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountTracked(h(Home));
  await askOnQueryForm(page);
  assert.equal(streams.length, 1, 'premise: the question was sent');
  const stream = streams[0];
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf() });
  await settle(page);
  stream.push({ type: 'error', panel: 'withMcp', message: 'fixture failure' });
  await settle(page);
  const boxes = prompts(page);
  assert.equal(boxes.length, 1, `premise: the box still asks after the error (#704): ${page.text().slice(0, 300)}`);
  assert.deepEqual(buttonLabels(boxes[0]), [ALLOW, DONT_ALLOW, ALLOW_ALL], 'premise: the box asks');
  const cards = stepCards(page);
  assert.equal(cards.length, 1, `premise: the run's steps still show the card after the error, found ${cards.length}`);
  assert.deepEqual(readCard(cards[0]), G_CARD, 'state (g) on the home page: the card does not read as a cancelled card beside the box');
  assertGOrder(textOf(cards[0]), 'state (g) on the home page');
});
