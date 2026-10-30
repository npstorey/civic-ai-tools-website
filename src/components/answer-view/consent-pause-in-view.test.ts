// R9 P1, criteria 1 and 3 (#672, #668): a reader who is asked sees the
// question; Cancel on /explore ends it.
//
// CRITERION 1 (#672). When a holding pause arrives, the surface that owns the
// question box brings the run's step card into view (`scrollIntoView`, with
// `behavior: 'auto'` when the reader asked for reduced motion) and renders a
// compact prompt with the two equal buttons while the pause is open and
// unanswered: gone after a decision, after the hold ends, and when no pause
// is open. The Sources panel row's own copy does not change.
//
// WHERE THE PROMPT SITS, measured (local dev server, headless Chrome, a held
// stream, at main ce77dcf): on the home page the submit scroll
// (`QuerySurface`, the results area to the viewport's top) leaves the question
// box above the viewport when a pause arrives (its top at -397 px at 390 px
// wide, -289 px at 1280 px), so a prompt under the question box would be out
// of view; the prompt sits at the top of the answer area, the part of the page
// the reader is looking at, right after the question box in the page's order.
// On /explore the question row stays in view, and the prompt sits under it.
//
// AMENDMENT 3 (the owner's preview read, the seat's ruling). At 393 x 852 the
// page's own scroll to the step card took the prompt 237 px above the
// viewport. Now nothing scrolls when the prompt is already in the viewport
// (below the sticky header) when the pause arrives; when it is not, the
// PROMPT is scrolled into view (`block: 'nearest'`), never the card. The
// harness has no layout, so the prompt's box and the viewport's height are
// stubbed here, and the assertion reads the scroll target and the no-scroll
// condition.
//
// CRITERION 3 (#668), the client half: on /explore, Cancel during a hold ends
// the step card and the panel row's card (the server half, a hold that ends
// when its reader's stream is gone, is `src/app/api/consent-pause-driven.test.ts`).
//
// WHAT IS DRIVEN. The three real feeds, each through the real page component
// on R6's surface harness, as `consent-step-surfaces-driven.test.ts` drives
// them: the home page (`useStreamingComparison` → `ProgressLog`), `/ask` in
// notebook mode (`useNotebookStream` → the step view), `/explore`
// (`McpFlowDiagram` → `useLiveTrace` → `ProgressLog`). The harness attaches no
// refs and has no DOM, so `document.querySelectorAll` is answered here from
// the page's own rendered elements (attribute selectors only), and each
// element it returns records the `scrollIntoView` call made on it: the
// assertion reads which rendered element was scrolled, not that a call was
// made.
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

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, './BpmnViewer': 'export default function BpmnViewer() { return null; }' });

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

// --- A document answered from the page's own elements ---------------------------------------

interface Scroll { element: HostElement; options: unknown }
const scrolls: Scroll[] = [];
let page: Surface | null = null;
let reducedMotion = false;
const mediaQueries: string[] = [];
/** The viewport's height, and where the prompt sits in it (Amendment 3): in view unless a test says otherwise. */
let viewportHeight = 852;
const IN_VIEW = { top: 120, bottom: 160 };
let promptBox: { top: number; bottom: number } = IN_VIEW;
/** What `document` hands back for a rendered element: its scroll, recorded, and its box (the prompt's as stubbed). */
const nodeFor = (element: HostElement) => ({
  scrollIntoView: (options: unknown) => { scrolls.push({ element, options }); },
  getBoundingClientRect: () => {
    const box = element.props['data-part'] === 'consent-pause-prompt' ? promptBox : { top: 0, bottom: 0 };
    return { ...box, left: 0, right: 0, width: 0, height: box.bottom - box.top, x: 0, y: box.top };
  },
});

/** `[a="b"][c="d"]` → the rendered elements whose props carry every pair. Anything else matches nothing. */
function select(selector: string): HostElement[] {
  const pairs = [...selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map((m) => [m[1], m[2]] as const);
  if (pairs.length === 0 || pairs.map(([k, v]) => `[${k}="${v}"]`).join('') !== selector.replace(/\s+/g, '')) return [];
  return (page?.elements() ?? []).filter((el) => pairs.every(([k, v]) => el.props[k] === v));
}

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    get innerHeight() { return viewportHeight; },
    matchMedia: (query: string) => {
      mediaQueries.push(query);
      return { matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
    },
  },
  document: {
    ...target,
    querySelectorAll: (selector: string) => select(selector).map(nodeFor),
    querySelector: (selector: string) => {
      const [element] = select(selector);
      return element ? nodeFor(element) : null;
    },
  },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The held stream and the answers ------------------------------------------------------------

interface Held { response: Response; push: (event: Json) => void; close: () => void }
let streams: Held[] = [];
function heldStream(): Held {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (event) => { if (!closed) { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { closed = true; } } },
    // A stream the reader cancelled (the browser's abort path, below) is closed already.
    close: () => { if (!closed) { closed = true; try { controller.close(); } catch { /* cancelled by its reader */ } } },
  };
}

let decisions: Json[] = [];
function answers() {
  streams = [];
  decisions = [];
  const held = () => { const s = heldStream(); streams.push(s); return s.response; };
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': async (request: Request) => {
      if (request.method === 'GET') return new Response(JSON.stringify({ routing: 'in-loop', store: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const body = JSON.parse(await request.text()) as Json;
      decisions.push(body);
      return new Response(JSON.stringify({ decision: body.decision, sourceId: 'boston-opencontext' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/compare-stream': held,
    '/api/query-notebook': held,
  });
}

const mounted: Surface[] = [];
afterEach(() => {
  for (const s of streams) s.close();
  for (const p of mounted.splice(0)) p.unmount();
  page = null;
  reducedMotion = false;
  scrolls.length = 0;
  promptBox = IN_VIEW;
  viewportHeight = 852;
});
async function mountPage(element: ReturnType<typeof h>): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  page = p;
  return p;
}

const statement = await buildFlowsStatement();
const BOSTON = statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext');
let run = 0;
const nextKey = () => `1e55${String(++run).padStart(4, '0')}0123456789abcdef01234567`;
const pauseOf = (key: string, holdMs = 60_000) => ({ key, source: BOSTON, outbound: [], links: statement.links, expiresAt: new Date(Date.now() + holdMs).toISOString(), entryExpiresAt: new Date(Date.now() + 600_000).toISOString(), holds: true });
const PAUSE_LINE = 'Waiting for your answer about Boston OpenContext, which is set to Ask first';
const LOAD_START = { message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, args: { alias: 'boston' }, toolName: 'load_source', operationType: 'load_source' };
const LOAD_DONE = { message: 'Loaded the Boston OpenContext source', phase: 'tool_complete', iteration: 1, duration_ms: 3000, toolName: 'load_source', operationType: 'load_source' };
const QUESTION = 'How many service requests did Boston record in 2025?';

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
const SIGNED_IN_DB = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  sessions.rows.clear();
};

// --- Reading the page ------------------------------------------------------------------------------

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const c of node) yield* within(c); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}
const buttonsIn = (el: HostElement) => [...within(el.props.children)].filter((x) => x.type === 'button');
const labels = (el: HostElement) => buttonsIn(el).map((b) => textOf(b));

function rowElements(surface: Surface): Set<unknown> {
  const inRow = new Set<unknown>();
  for (const row of surface.elements().filter((el) => el.props['data-source'] !== undefined)) for (const el of within(row)) inRow.add(el);
  return inRow;
}
/** The consent cards in the run's steps (never one in a Sources panel row). */
function stepCards(surface: Surface): HostElement[] {
  const inRow = rowElements(surface);
  return surface.elements().filter((el) => el.props['data-part'] === 'consent-step' && !inRow.has(el));
}
function rowCards(surface: Surface): HostElement[] {
  const inRow = rowElements(surface);
  return surface.elements().filter((el) => el.props['data-part'] === 'consent-step' && inRow.has(el));
}
const prompts = (surface: Surface) => surface.elements().filter((el) => el.props['data-part'] === 'consent-pause-prompt');
const summary = (surface: Surface) => JSON.stringify({ prompts: prompts(surface).map((p) => textOf(p)), steps: stepCards(surface).map((c) => labels(c)), rows: rowCards(surface).map((c) => labels(c)) });

const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};
/** Long enough for the surface's deferred scroll (it waits for the card to render, as the results scroll does). */
const SCROLL_WAIT = 250;

function onePrompt(surface: Surface, where: string): HostElement {
  const found = prompts(surface);
  assert.equal(found.length, 1, `${where}: expected one compact prompt, found ${found.length}: ${summary(surface)}`);
  return found[0];
}

/** The prompt names the source and offers exactly Allow and Not now, equal in style, with the card's own words. */
function assertPrompt(prompt: HostElement, where: string): void {
  const text = textOf(prompt);
  assert.ok(text.startsWith('Boston OpenContext is set to Ask first.'), `${where}: the prompt reads: ${text}`);
  const buttons = buttonsIn(prompt);
  assert.deepEqual(buttons.map((b) => textOf(b)), ['Allow', 'Not now'], `${where}: the prompt's buttons`);
  assert.deepEqual(buttons[0].props.style, buttons[1].props.style, `${where}: the prompt's two buttons are styled differently`);
}

/** Document order: `a` comes before `b` in the page's elements (each read from the last render). */
function before(surface: Surface, a: HostElement, b: HostElement): boolean {
  const all = surface.elements();
  return all.indexOf(a) >= 0 && all.indexOf(a) < all.indexOf(b);
}
/** The question box as the last render has it (an element read before a re-render is not in it). */
const questionBox = (surface: Surface) => surface.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data')!;

const describeScrolls = (made: Scroll[]) => JSON.stringify(made.map((m) => ({ part: m.element.props['data-part'], options: m.options })));

/** Amendment 3: the prompt was already in the viewport when the pause arrived, so the page did not move at all. */
function assertNoScroll(from: number, where: string): void {
  const made = scrolls.slice(from);
  assert.equal(made.length, 0, `${where}: the page scrolled while the prompt was in view: ${describeScrolls(made)}`);
}

/** Amendment 3: the prompt was out of view, so the one scroll made since `from` brought the PROMPT in (never the card). */
function assertScrolledToPrompt(from: number, behavior: 'smooth' | 'auto', where: string): void {
  const made = scrolls.slice(from);
  assert.equal(made.length, 1, `${where}: expected one scroll, to the prompt: ${describeScrolls(made)}`);
  assert.equal(made[0].element.props['data-part'], 'consent-pause-prompt', `${where}: the scroll went to ${describeScrolls(made)}`);
  assert.equal((made[0].options as { block?: string }).block, 'nearest', `${where}: the scroll's block`);
  assert.equal((made[0].options as { behavior?: string }).behavior, behavior, `${where}: the scroll's behavior`);
}

async function askOnQueryForm(surface: Surface): Promise<HostElement> {
  const box = surface.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  assert.ok(box, 'premise: no question box');
  await surface.type(box!, QUESTION);
  await surface.submit(surface.elements().find((el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea'))!);
  return box!;
}

async function askOnExplore(surface: Surface): Promise<void> {
  await surface.click(surface.button('Try your own'));
  const box = surface.elements().find((el) => el.type === 'input' && el.props.className === 'live-query-input');
  assert.ok(box, 'premise: no live question input');
  await surface.type(box!, QUESTION);
  await surface.submit(surface.elements().find((el) => el.type === 'form')!);
  await settle(surface, 600);
}

/** The Boston row's text with its card's text taken out: the row's own copy. */
function rowCopy(surface: Surface): string {
  const row = surface.elements().find((el) => el.props['data-source'] === 'boston-opencontext');
  assert.ok(row, 'premise: no Boston row');
  let text = textOf(row!);
  for (const card of [...within(row!.props.children)].filter((el) => el.props['data-part'] === 'consent-step')) text = text.replace(textOf(card), '');
  // The space the harness's text puts between the row's last line and the card goes with the card.
  return text.trimEnd();
}

// --- Criterion 1: the home page ----------------------------------------------------------------------

for (const [reduced, out] of [[false, false], [false, true], [true, true]] as const) {
  test(`criterion 1, the home page (a comparison surface)${reduced ? ', reduced motion' : ''}: ${out ? `the prompt above the viewport (-237 px at 393 x 852, the owner's read) is scrolled into view (${reduced ? 'auto' : 'smooth'}), never the card` : 'the prompt in the viewport: nothing scrolls'}; the compact prompt offers both buttons until a decision`, async () => {
    ANON();
    answers();
    reducedMotion = reduced;
    if (out) { viewportHeight = 852; promptBox = { top: -237, bottom: -203 }; }
    await consentWith({ 'boston-opencontext': 'ask-first' });
    const p = await mountPage(h(Home));
    await askOnQueryForm(p);
    const stream = streams[0];
    assert.ok(stream, 'premise: the question was sent');
    await settle(p, SCROLL_WAIT);
    const rowBefore = rowCopy(p);
    stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
    stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
    await settle(p);
    assert.equal(prompts(p).length, 0, `a prompt before any pause: ${summary(p)}`);
    const from = scrolls.length;
    const key = nextKey();
    stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf(key) });
    await settle(p, SCROLL_WAIT);
    if (out) assertScrolledToPrompt(from, reduced ? 'auto' : 'smooth', 'the home page');
    else assertNoScroll(from, 'the home page');
    if (reduced) assert.ok(mediaQueries.includes('(prefers-reduced-motion: reduce)'), 'the reduced-motion query was never read');
    const prompt = onePrompt(p, 'the home page');
    assertPrompt(prompt, 'the home page');
    // Near the question box: after it in the page, and before the run's steps.
    assert.ok(before(p, questionBox(p), prompt), 'the prompt comes before the question box');
    assert.ok(before(p, prompt, stepCards(p)[0]), 'the prompt comes after the run\'s step card');
    // The Sources panel row's own copy is byte-identical (the card is the only addition).
    assert.equal(rowCopy(p), rowBefore, 'the row\'s copy changed when the pause arrived');
    // A decision from the prompt posts the pause's own key; then the prompt goes and the card shows the outcome.
    await p.click(buttonsIn(prompt)[0]);
    await settle(p);
    assert.deepEqual(decisions, [{ key, decision: 'allow' }], 'the prompt did not post the pause\'s own key');
    assert.equal(prompts(p).length, 0, `the prompt stays after a decision: ${summary(p)}`);
    assert.deepEqual(labels(stepCards(p)[0]), [], 'the step card keeps its buttons after the prompt\'s decision');
    assert.equal(scrolls.length - from, out ? 1 : 0, 'a second scroll for the same pause');
    stream.close();
  });
}

// --- Criterion 1: /ask, notebook mode -------------------------------------------------------------------

test('criterion 1, /ask (the executed run): a holding pause shows the prompt, in view, with no scroll; a later line of the run (the hold over) takes the prompt away', async () => {
  SIGNED_IN_DB();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const p = await mountPage(h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' }));
  await askOnQueryForm(p);
  const stream = streams[0];
  assert.ok(stream, 'premise: the question was sent');
  await settle(p, SCROLL_WAIT);
  stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  stream.push({ type: 'phase_a_progress', ...LOAD_START });
  await settle(p);
  assert.equal(prompts(p).length, 0, `a prompt before any pause: ${summary(p)}`);
  const from = scrolls.length;
  stream.push({ type: 'phase_a_progress', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf(nextKey()) });
  await settle(p, SCROLL_WAIT);
  assertNoScroll(from, '/ask');
  const prompt = onePrompt(p, '/ask');
  assertPrompt(prompt, '/ask');
  assert.ok(before(p, questionBox(p), prompt) && before(p, prompt, stepCards(p)[0]), '/ask: the prompt is not between the question box and the run\'s steps');
  stream.push({ type: 'phase_a_progress', ...LOAD_DONE });
  await settle(p);
  assert.equal(prompts(p).length, 0, `the prompt stays after the run moved past the pause: ${summary(p)}`);
  stream.close();
});

// --- Criterion 1: the hold's end on the clock --------------------------------------------------------------

test('criterion 1, the home page: the prompt goes when the hold\'s time is up, with no further line of the run', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const p = await mountPage(h(Home));
  await askOnQueryForm(p);
  const stream = streams[0];
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf(nextKey(), 400) });
  await settle(p);
  assert.equal(prompts(p).length, 1, `no prompt while the hold is open: ${summary(p)}`);
  await settle(p, 600);
  assert.equal(prompts(p).length, 0, `the prompt outlived the hold: ${summary(p)}`);
  stream.close();
});

// --- Criterion 1 and 3: /explore -------------------------------------------------------------------------------

test('criterion 1, /explore: a holding pause shows the prompt under the running question, in view, with no scroll; criterion 3: Cancel ends the step card, the row\'s card and the prompt', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const p = await mountPage(h(McpFlowDiagram));
  await askOnExplore(p);
  const stream = streams[0];
  assert.ok(stream, 'premise: the question was sent');
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  await settle(p);
  assert.equal(prompts(p).length, 0, `a prompt before any pause: ${summary(p)}`);
  const from = scrolls.length;
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf(nextKey()) });
  await settle(p, SCROLL_WAIT);
  assertNoScroll(from, '/explore');
  const prompt = onePrompt(p, '/explore');
  assertPrompt(prompt, '/explore');
  const cancel = p.button('Cancel');
  assert.ok(before(p, cancel, prompt) && before(p, prompt, stepCards(p)[0]), '/explore: the prompt is not between the running question and the run\'s steps');
  assert.deepEqual(labels(stepCards(p)[0]), ['Allow', 'Not now'], 'premise: the step card offers both during the hold');

  // Criterion 3: Cancel during the hold.
  await p.click(cancel);
  await settle(p);
  assert.equal(prompts(p).length, 0, `the prompt stays after Cancel: ${summary(p)}`);
  for (const card of stepCards(p)) assert.deepEqual(labels(card), [], `a step card keeps its buttons after Cancel: ${summary(p)}`);
  // /explore shows its Sources panel again once cancelled: the row carries no card that can still be answered.
  assert.ok(p.elements().some((el) => el.props['data-source'] === 'boston-opencontext'), 'premise: the Sources panel is not shown after Cancel');
  for (const card of rowCards(p)) assert.deepEqual(labels(card), [], `the row's card keeps its buttons after Cancel: ${summary(p)}`);
  assert.equal(decisions.length, 0, 'Cancel posted a decision');
  stream.close();
});

// --- Amendment 3, criterion 3: Cancel on the browser's abort path ---------------------------------------

/**
 * The harness's `fetch` drops the request's signal, so its streams never see
 * an abort. A browser's does not: aborting the request errors the response
 * body with an AbortError, and the SSE client's read loop then ends through
 * its `finally` (`onComplete`) before the promise's rejection is caught. This
 * wraps the streaming routes' answers so an abort does the same here.
 */
function abortLikeABrowser(): void {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
    if (!signal || !/^\/api\/(compare-stream|query-notebook)$/.test(path)) return inner(input, init);
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const response = await inner(input, init);
    const reader = response.body!.getReader();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener('abort', () => {
          try { controller.error(new DOMException('The operation was aborted.', 'AbortError')); } catch { /* already closed */ }
          void reader.cancel().catch(() => {});
        }, { once: true });
      },
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  }) as typeof fetch;
}

test('criterion 3, /explore on the browser\'s abort path (Amendment 3, the owner\'s preview read): Cancel during a hold reads cancelled, not "Connection lost"; the step card and the row lose their buttons; the bus entry has ended', async () => {
  ANON();
  answers();
  abortLikeABrowser();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const p = await mountPage(h(McpFlowDiagram));
  await askOnExplore(p);
  const stream = streams[0];
  assert.ok(stream, 'premise: the question was sent');
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: pauseOf(nextKey()) });
  await settle(p, SCROLL_WAIT);
  assert.deepEqual(labels(stepCards(p)[0]), ['Allow', 'Not now'], `premise: the step card offers both during the hold: ${summary(p)}`);
  await p.click(p.button('Cancel'));
  await settle(p, 200);
  const text = p.text();
  assert.ok(!text.includes('Connection lost before the query finished'), `Cancel reads as a lost connection: ${text.slice(0, 600)}`);
  assert.ok(text.includes('Query was cancelled.'), `the page does not say the query was cancelled: ${text.slice(0, 600)}`);
  for (const card of stepCards(p)) {
    assert.deepEqual(labels(card), [], `a step card keeps its buttons after Cancel: ${summary(p)}`);
    assert.ok(textOf(card).includes('This question is no longer waiting for an answer.'), `the step card after Cancel: ${textOf(card)}`);
  }
  assert.ok(p.elements().some((el) => el.props['data-source'] === 'boston-opencontext'), 'premise: the Sources panel is not shown after Cancel');
  assert.deepEqual(rowCards(p).map((c) => labels(c)).flat(), [], `the row's card offers an answer after Cancel: ${summary(p)}`);
  assert.equal(decisions.length, 0, 'Cancel posted a decision');
});
