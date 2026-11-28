// FIX-1 FX2 (#802; website #807, G0's rulings D4 to D8): the answer, for a reader who scrolled, and its announcements.
//
// THE RULINGS, as the contract states them.
// - D4 = A: act whenever the answer arrives out of view, on the notebook path (`NotebookOutput`'s swap from progress to
//   the answer) and on the chat path (`McpResponseDisplay`'s swap). "Out of view": the answer's top is not between the
//   sticky header's bottom and the viewport's bottom. An answer that arrives in view moves nothing.
// - D5 = A: bring the answer's top under the header, once per run, with the surface's scroll behaviour
//   (`preferredScrollBehavior`: instant under reduced motion). Keyboard focus does not move.
// - D6 = A, D7 = A: announce every run's answer once, politely, whether or not the view moved, in one live region that
//   stays mounted across the swap from progress to answer. On the chat path the view moves at the answer's first render
//   with content, and the announcement comes when the run is complete (Seat 7047605178).
// - D8 = A: when the prompt closes after an answer, read out the card's own outcome sentence politely, whichever the
//   card shows (no new words; the sentence is read from what the card renders).
// - The trigger needs an answer with content: an answer with none ("No synthesis was produced for this analysis.")
//   moves nothing and announces nothing.
//
// WHAT IS DRIVEN. `/ask`'s surface (`QuerySurface`, answer-first, notebook mode: `useNotebookStream` → `NotebookOutput`)
// and the home page (`src/app/(marketing)/page.tsx`: `useStreamingComparison` → `McpResponseDisplay`) on the surface
// harness, with `/api/flows` and `/api/sources/consent` as their real route handlers and each run a held stream the
// test feeds. The harness attaches no refs and has no layout, so `document.querySelector` is answered here from the
// page's own rendered elements (attribute selectors and `header`), with the answer's and the header's boxes stubbed,
// and the window's scrolls (`scrollBy`) recorded. The assertions read which scroll was made and what each polite live
// region holds.
//
// WHAT MAKES IT ABLE TO FAIL. At the base (`ca5868e`) nothing scrolls at the answer's arrival, no polite live region
// holds "The answer to your question is ready.", and none holds the card's outcome sentence after a reply at the prompt.
// The in-view, empty-answer and second-run cases are the shapes a trigger keyed on the part (not its content), or on
// the page (not the run), would fail.
//
// BLIND SPOTS, stated. No layout, no browser, no screen reader: "announced" is read as "a polite live region's text
// changed to the sentence", and "in view" from stubbed boxes. FX0's check 5 (`scripts/layout-measure/`) measures the
// boxes, the scroll and the focus in Chrome; WebKit is the ORCH's.
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
  textOf,
  type HostElement,
  type Surface,
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

// --- The words, ruled (literal here: a test that read them from the module would pass on any words) ----------------

/** D6 = A, D7 = A: the one new sentence (G0, OA-1101). */
const READY = 'The answer to your question is ready.';
/** D8 = A reads out the card's own sentences (`CONSENT_STEP_TEXT`), as they stand at the base. */
// Moved by S4 W2b (npstorey/civic-ai-tools#335): S112 and S102; `declined` has no taken form and keeps its words.
const ALLOWED = 'You chose Enable. It is enabled now.';
const DECLINED = "You chose Don't allow. Nothing is sent to it, and it is Off now.";
const ALLOWED_ALL = 'You chose Enable all data sources. Every data source is enabled now. A source added later is not enabled until you enable it.';

// --- A document answered from the page's own elements ---------------------------------------------------------------

let page: Surface | null = null;
let reducedMotion = false;
const VIEWPORT = 852;
const HEADER_BOTTOM = 64;
/** Where the answer's top sits in the viewport when the surface measures it (a test sets it); null: no box. */
let answerTop: number | null = 300;
/** The window's own scrolls, recorded. */
const windowScrolls: Array<{ top?: number; behavior?: string }> = [];
/** `scrollIntoView` calls, recorded with the element's part. */
const intoView: Array<{ part: unknown; options: unknown }> = [];
/** Calls to `focus` on any element the document handed out, recorded (focus never moves). */
const focusCalls: unknown[] = [];

/**
 * FX2b: the author lines' layout. FX2's tests model the answer part's box only, and their document hands out no
 * siblings, so the surface measures the answer part as FX2 shipped it. With `authorLayout` on (FX2b's tests), the
 * document also answers `previousElementSibling` from the rendered tree, each author line (`[data-author]`) directly
 * before an answer part is `AUTHOR_LINE_HEIGHT` px tall and sits above it, and an answer part after the first (the
 * closed disclosure's F) sits 3,000 px lower, so a surface that measured the wrong one would scroll by a different amount.
 */
let authorLayout = false;
/** A 12 px author line at the page's line height, plus its 8 px bottom margin (`AnswerView.tsx`, `AUTHOR_LINE_STYLE`). */
const AUTHOR_LINE_HEIGHT = 26;

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const c of node) yield* within(c); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

/** `header`, or `[a="b"][c="d"]`: the rendered elements that match, within `scope` (the page when absent). */
function select(selector: string, scope?: HostElement): HostElement[] {
  const all = scope ? [...within(scope.props.children)] : (page?.elements() ?? []);
  if (/^[a-z]+$/.test(selector.trim())) return all.filter((el) => el.type === selector.trim());
  const pairs = [...selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map((m) => [m[1], m[2]] as const);
  if (pairs.length === 0 || pairs.map(([k, v]) => `[${k}="${v}"]`).join('') !== selector.replace(/\s+/g, '')) return [];
  return all.filter((el) => pairs.every(([k, v]) => el.props[k] === v));
}

/** A host element's host children, in order (arrays flattened; text skipped). */
function hostChildren(element: HostElement): HostElement[] {
  const out: HostElement[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    if (node !== null && typeof node === 'object' && 'props' in (node as object) && typeof (node as HostElement).type === 'string') out.push(node as HostElement);
  };
  walk(element.props.children);
  return out;
}
/** The rendered element's previous element sibling, or null. */
function previousSibling(element: HostElement): HostElement | null {
  for (const parent of page?.elements() ?? []) {
    const kids = hostChildren(parent);
    const at = kids.indexOf(element);
    if (at >= 0) return at > 0 ? kids[at - 1] : null;
  }
  return null;
}
/** The rendered element's next element siblings, in order. */
function nextSiblings(element: HostElement): HostElement[] {
  for (const parent of page?.elements() ?? []) {
    const kids = hostChildren(parent);
    const at = kids.indexOf(element);
    if (at >= 0) return kids.slice(at + 1);
  }
  return [];
}
/** An answer part's top: the first one's is `answerTop`; with `authorLayout`, a later one's is 3,000 px lower. */
function answerPartTop(element: HostElement): number {
  const base = answerTop ?? 0;
  if (!authorLayout) return base;
  const parts = (page?.elements() ?? []).filter((el) => el.props['data-part'] === 'answer');
  return parts.indexOf(element) <= 0 ? base : base + 3000;
}
/** With `authorLayout`: an author line directly before an answer part, stacked above it; else null. */
function authorLineTop(element: HostElement): number | null {
  if (!authorLayout || element.props['data-author'] === undefined) return null;
  let lines = 1;
  for (const next of nextSiblings(element)) {
    if (next.props['data-part'] === 'answer') return answerPartTop(next) - AUTHOR_LINE_HEIGHT * lines;
    if (next.props['data-author'] === undefined) return null;
    lines += 1;
  }
  return null;
}

function nodeFor(element: HostElement): Record<string, unknown> {
  const box = () => {
    const author = authorLineTop(element);
    const top = element.type === 'header' ? 0
      : element.props['data-part'] === 'answer' && answerTop !== null ? answerPartTop(element)
        : author !== null ? author : 0;
    const bottom = element.type === 'header' ? HEADER_BOTTOM : author !== null ? top + AUTHOR_LINE_HEIGHT : top + 200;
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top };
  };
  return {
    getBoundingClientRect: box,
    getAttribute: (name: string) => (element.props[name] === undefined ? null : String(element.props[name])),
    hasAttribute: (name: string) => element.props[name] !== undefined,
    get previousElementSibling() {
      if (!authorLayout) return undefined;
      const prev = previousSibling(element);
      return prev ? nodeFor(prev) : null;
    },
    focus: () => { focusCalls.push(element.props['data-part'] ?? element.type); },
    querySelector: (s: string) => { const [found] = select(s, element); return found ? nodeFor(found) : null; },
    querySelectorAll: (s: string) => select(s, element).map(nodeFor),
    scrollIntoView: (options: unknown) => { intoView.push({ part: element.props['data-part'], options }); },
    get textContent() { return textOf(element); },
  };
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
    scrollBy: (options: { top?: number; behavior?: string }) => { windowScrolls.push(options); },
    innerHeight: VIEWPORT,
    matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: {
    ...target,
    querySelectorAll: (selector: string) => select(selector).map(nodeFor),
    // The site's sticky header is the root layout's, outside the tree mounted here: answered with its stubbed box.
    querySelector: (selector: string) => {
      if (selector.trim() === 'header') return nodeFor(h('header', null) as unknown as HostElement);
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
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The held streams and the answers ------------------------------------------------------------------------------

interface Held { push: (event: Json) => void; close: () => void }
let streams: Held[] = [];
function heldStream(): { response: Response; held: Held } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    held: {
      push: (event) => { if (!closed) { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { closed = true; } } },
      close: () => { if (!closed) { closed = true; try { controller.close(); } catch { /* cancelled by its reader */ } } },
    },
  };
}

let decisions: Json[] = [];
function answers() {
  streams = [];
  decisions = [];
  const held = () => { const s = heldStream(); streams.push(s.held); return s.response; };
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/rate-limit': () => new Response(JSON.stringify({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
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

const statement = await buildFlowsStatement();
const BOSTON = statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext');

async function consentWith(states: Record<string, string> = {}): Promise<void> {
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, states[s.sourceId] ?? 'on'])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
}

const mounted: Surface[] = [];
beforeEach(() => {
  storage.clear();
  sessions.rows.clear();
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
});
afterEach(() => {
  for (const s of streams) s.close();
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
  page = null;
  reducedMotion = false;
  answerTop = 300;
  windowScrolls.length = 0;
  intoView.length = 0;
  focusCalls.length = 0;
  authorLayout = false;
});

const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};
/** Longer than the surface's deferred measure (it waits for the answer to render, as the results scroll does). */
const MEASURE_WAIT = 250;

async function mountPage(element: ReturnType<typeof h>): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  page = p;
  await settle(p);
  return p;
}

async function ask(surface: Surface, question = 'How many service requests did Boston record in 2025?'): Promise<Held> {
  const before = streams.length;
  const box = surface.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  assert.ok(box, 'premise: no question box');
  await surface.type(box!, question);
  await surface.submit(surface.elements().find((el) => el.type === 'form' && surface.elements().some((x) => x.type === 'textarea'))!);
  await settle(surface, MEASURE_WAIT);
  assert.equal(streams.length, before + 1, 'premise: the question started a run');
  return streams[streams.length - 1];
}

// --- Reading the page ------------------------------------------------------------------------------------------------

/** Every polite live region on the page: `aria-live="polite"`, or `role="status"` (polite by its role) with no other `aria-live`. */
const politeRegions = (surface: Surface): HostElement[] => surface.elements().filter((el) =>
  el.props['aria-live'] === 'polite' || (el.props.role === 'status' && el.props['aria-live'] === undefined));
/** The polite live regions whose whole text is `sentence`. */
const holding = (surface: Surface, sentence: string): HostElement[] => politeRegions(surface).filter((el) => textOf(el) === sentence);
/** The answer parts (the view places the answer part twice: first, and again as F). */
const answersOn = (surface: Surface): HostElement[] => surface.elements().filter((el) => el.props['data-part'] === 'answer');

// --- The runs --------------------------------------------------------------------------------------------------------

const RUN_ANSWER = 'RUNANSWER-fx2: **42** requests.';
const notebookOf = (withAnswer: boolean) => ({
  nbformat: 4, nbformat_minor: 5,
  metadata: {
    extensions: {
      'org.civicaitools.execution': { executedAt: '2026-11-21T12:00:00Z', executionDuration_ms: 4200, sandboxId: 'fixture-sandbox-fx2', environment: { python: '3.13', libraries: {} } },
      'org.civicaitools.notebook': { provenance: 'executed' },
    },
  },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n'] },
    ...(withAnswer
      ? [{ cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(Markdown(answer))\n'], outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/markdown': RUN_ANSWER } }] }]
      : []),
  ],
});
const loadLine = (phase: 'tool_start' | 'tool_complete'): Json =>
  ({ type: 'phase_a_progress', message: 'Loading the Boston OpenContext source', phase, iteration: 1, toolName: 'load_source', operationType: 'load_source' });
let run = 0;
const nextKey = () => `f2a0${String(++run).padStart(4, '0')}0123456789abcdef01234567`;
const pauseOf = (key: string) => ({ key, source: BOSTON, outbound: [], links: statement.links, expiresAt: new Date(Date.now() + 60_000).toISOString(), entryExpiresAt: new Date(Date.now() + 600_000).toISOString(), holds: true });

/** The notebook run up to (not including) the notebook. */
async function notebookSteps(surface: Surface, stream: Held): Promise<void> {
  stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  stream.push(loadLine('tool_start'));
  stream.push(loadLine('tool_complete'));
  stream.push({ type: 'phase_a_tool_call', name: 'load_source', operationType: 'load_source', args: { alias: 'boston_opencontext' }, duration_ms: 4000 });
  stream.push({ type: 'phase', name: 'B', message: 'Synthesizing notebook…' });
  stream.push({ type: 'phase', name: 'C', message: 'Executing in sandbox…' });
  await settle(surface);
}
/** The notebook arrives (the swap), then the run's last phases. */
async function notebookArrives(surface: Surface, stream: Held, withAnswer = true): Promise<void> {
  stream.push({ type: 'notebook', notebook: notebookOf(withAnswer), sandboxId: 'fixture-sandbox-fx2', executionDuration_ms: 4200, validation: { ok: true, issues: [] } });
  await settle(surface, MEASURE_WAIT);
}
async function notebookEnds(surface: Surface, stream: Held): Promise<void> {
  stream.push({ type: 'phase', name: 'D', message: 'Finalizing…' });
  stream.push({ type: 'phase', name: 'complete', message: 'Done.' });
  stream.close();
  await settle(surface, MEASURE_WAIT);
}

const ASK_NOTEBOOK = () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' });
/** The notebook path is offered signed in (Sandbox needs an account), as `/ask` mounts it. */
const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

/** D5 = A: one scroll of the window that puts the answer's top under the header, with the surface's behaviour. */
function assertBroughtUnderHeader(from: number, top: number, behavior: 'smooth' | 'auto', where: string): void {
  const made = windowScrolls.slice(from);
  assert.equal(made.length, 1, `${where}: expected one scroll of the window, to the answer: ${JSON.stringify(made)}`);
  const by = made[0].top ?? NaN;
  // The answer's top lands under the header's bottom, inside the viewport's top quarter.
  const landed = top - by;
  assert.ok(landed >= HEADER_BOTTOM && landed <= HEADER_BOTTOM + 32, `${where}: the scroll by ${by} puts the answer's top at ${landed}, not just under the header (${HEADER_BOTTOM})`);
  assert.equal(made[0].behavior, behavior, `${where}: the scroll's behaviour`);
  assert.equal(intoView.length, 0, `${where}: an element was scrolled into view: ${JSON.stringify(intoView)}`);
}

// --- D4, D5, D7: the notebook path -------------------------------------------------------------------------------------

for (const [reduced, top, where] of [
  [false, -400, 'above the viewport (the reader scrolled past it)'],
  [true, -400, 'above the viewport, reduced motion'],
  [false, 1200, 'below the viewport'],
] as const) {
  test(`D4, D5, D7, the notebook path (/ask): an answer that arrives ${where} is brought under the header (${reduced ? 'auto' : 'smooth'}), once, and "${READY}" is announced once, politely, in a region mounted before the swap`, async () => {
    SIGNED_IN();
    answers();
    await consentWith();
    reducedMotion = reduced;
    answerTop = top;
    const p = await mountPage(ASK_NOTEBOOK());
    const stream = await ask(p);
    await notebookSteps(p, stream);
    assert.equal(answersOn(p).length, 0, 'premise: no answer before the notebook');
    assert.equal(holding(p, READY).length, 0, `"${READY}" is announced before the answer arrived`);
    const regionsBefore = politeRegions(p).map((el) => el.props['data-part']).filter((x) => x !== undefined);
    const from = windowScrolls.length;
    await notebookArrives(p, stream);
    assert.ok(answersOn(p).length >= 1, 'premise: the answer arrived');
    assertBroughtUnderHeader(from, top, reduced ? 'auto' : 'smooth', 'the notebook path');
    const regions = holding(p, READY);
    assert.equal(regions.length, 1, `expected one polite live region holding "${READY}"; the polite regions read: ${JSON.stringify(politeRegions(p).map((el) => textOf(el)))}`);
    assert.ok(regions[0].props['data-part'] !== undefined && regionsBefore.includes(regions[0].props['data-part']), `the region holding "${READY}" was not mounted before the swap (before it: ${JSON.stringify(regionsBefore)})`);
    await notebookEnds(p, stream);
    assert.equal(windowScrolls.length - from, 1, `the page moved again after the arrival: ${JSON.stringify(windowScrolls.slice(from))}`);
    assert.equal(holding(p, READY).length, 1, `"${READY}" is not held once after the run ends`);
  });
}

test(`D4, D7, the notebook path: an answer that arrives in view moves nothing, and "${READY}" is still announced once`, async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  answerTop = 300;
  const p = await mountPage(ASK_NOTEBOOK());
  const stream = await ask(p);
  await notebookSteps(p, stream);
  const from = windowScrolls.length;
  await notebookArrives(p, stream);
  await notebookEnds(p, stream);
  assert.deepEqual(windowScrolls.slice(from), [], 'the page moved although the answer arrived in view');
  assert.deepEqual(intoView, [], 'an element was scrolled into view');
  assert.equal(holding(p, READY).length, 1, `"${READY}" is not announced when the answer arrived in view`);
});

test(`the trigger needs content, the notebook path: a run whose answer has none moves nothing and announces nothing "ready", even out of view`, async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  answerTop = -400;
  const p = await mountPage(ASK_NOTEBOOK());
  const stream = await ask(p);
  await notebookSteps(p, stream);
  const from = windowScrolls.length;
  await notebookArrives(p, stream, false);
  await notebookEnds(p, stream);
  assert.ok(answersOn(p).length >= 1, 'premise: the answer part is drawn');
  assert.ok(textOf(answersOn(p)[0]).includes('No synthesis was produced for this analysis.'), 'premise: the answer has no content');
  assert.deepEqual(windowScrolls.slice(from), [], 'the page moved for an answer with no content');
  assert.equal(holding(p, READY).length, 0, `"${READY}" was announced for an answer with no content`);
});

test(`D7, once per run: a second run clears the announcement at its send and announces its own answer once`, async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  answerTop = -400;
  const p = await mountPage(ASK_NOTEBOOK());
  const first = await ask(p);
  await notebookSteps(p, first);
  await notebookArrives(p, first);
  await notebookEnds(p, first);
  assert.equal(holding(p, READY).length, 1, `premise: the first run's answer was announced`);
  const second = await ask(p, 'And in 2024?');
  assert.equal(holding(p, READY).length, 0, `the first run's announcement still stands while the second run works`);
  await notebookSteps(p, second);
  const from = windowScrolls.length;
  await notebookArrives(p, second);
  await notebookEnds(p, second);
  assert.equal(windowScrolls.length - from, 1, `the second run's answer was not brought into view once: ${JSON.stringify(windowScrolls.slice(from))}`);
  assert.equal(holding(p, READY).length, 1, `the second run's answer is not announced once`);
});

// --- D4, D5, D7: the chat path ---------------------------------------------------------------------------------------

async function chatSteps(surface: Surface, stream: Held): Promise<void> {
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, args: { alias: 'boston_opencontext' }, toolName: 'load_source', operationType: 'load_source' });
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Loading the Boston OpenContext source', phase: 'tool_complete', iteration: 1, args: { alias: 'boston_opencontext' }, toolName: 'load_source', operationType: 'load_source', duration_ms: 4000 });
  stream.push({ type: 'complete', panel: 'withoutMcp', data: { content: 'An answer from training data.', duration_ms: 1 } });
  await settle(surface);
}

test(`D4, D5, D7, the chat path (the home page): the view moves once, at the answer's first render with content; "${READY}" comes when the run is complete`, async () => {
  answers();
  await consentWith();
  answerTop = -400;
  const p = await mountPage(h(Home));
  const stream = await ask(p);
  await chatSteps(p, stream);
  assert.equal(answersOn(p).length, 0, 'premise: no answer before the first token');
  const from = windowScrolls.length;
  stream.push({ type: 'token', panel: 'withMcp', content: 'RUNANSWER-fx2: ' });
  await settle(p, MEASURE_WAIT);
  assert.ok(answersOn(p).length >= 1, 'premise: the answer rendered at its first token');
  assertBroughtUnderHeader(from, -400, 'smooth', 'the chat path, at the first token');
  assert.equal(holding(p, READY).length, 0, `"${READY}" is announced while the answer still streams`);
  stream.push({ type: 'token', panel: 'withMcp', content: '**42** requests.' });
  await settle(p, MEASURE_WAIT);
  stream.push({ type: 'complete', panel: 'withMcp', data: { content: RUN_ANSWER, duration_ms: 7, tools_called: [] } });
  stream.close();
  await settle(p, MEASURE_WAIT);
  assert.equal(windowScrolls.length - from, 1, `the page moved more than once in the run: ${JSON.stringify(windowScrolls.slice(from))}`);
  assert.equal(holding(p, READY).length, 1, `"${READY}" is not announced once the run is complete; the polite regions read: ${JSON.stringify(politeRegions(p).map((el) => textOf(el)))}`);
});

test(`D4, D7, the chat path: an answer that arrives in view moves nothing, and "${READY}" is still announced`, async () => {
  answers();
  await consentWith();
  answerTop = 300;
  const p = await mountPage(h(Home));
  const stream = await ask(p);
  await chatSteps(p, stream);
  const from = windowScrolls.length;
  stream.push({ type: 'complete', panel: 'withMcp', data: { content: RUN_ANSWER, duration_ms: 7, tools_called: [] } });
  stream.close();
  await settle(p, MEASURE_WAIT);
  assert.ok(answersOn(p).length >= 1, 'premise: the answer arrived');
  assert.deepEqual(windowScrolls.slice(from), [], 'the page moved although the answer arrived in view');
  assert.equal(holding(p, READY).length, 1, `"${READY}" is not announced when the answer arrived in view`);
});

test(`the trigger needs content, the chat path: a with-data answer with no content moves nothing and announces nothing "ready"`, async () => {
  answers();
  await consentWith();
  answerTop = -400;
  const p = await mountPage(h(Home));
  const stream = await ask(p);
  await chatSteps(p, stream);
  const from = windowScrolls.length;
  stream.push({ type: 'complete', panel: 'withMcp', data: { content: '', duration_ms: 7, tools_called: [] } });
  stream.close();
  await settle(p, MEASURE_WAIT);
  assert.deepEqual(windowScrolls.slice(from), [], 'the page moved for an answer with no content');
  assert.equal(holding(p, READY).length, 0, `"${READY}" was announced for an answer with no content`);
});

// --- D8: the pause reply -----------------------------------------------------------------------------------------------

/** The steps' consent card's outcome sentence, as rendered. */
function cardOutcome(surface: Surface): string | null {
  const cards = surface.elements().filter((el) => el.props['data-part'] === 'consent-step' && el.props['data-consent-place'] === 'steps');
  const outcome = cards.flatMap((c) => [...within(c.props.children)]).find((el) => el.props['data-part'] === 'consent-outcome');
  return outcome ? textOf(outcome) : null;
}

function promptButton(surface: Surface, label: string): HostElement {
  const prompts = surface.elements().filter((el) => el.props['data-part'] === 'consent-pause-prompt');
  assert.equal(prompts.length, 1, `premise: one prompt asks; found ${prompts.length}`);
  const button = [...within(prompts[0].props.children)].find((x) => x.type === 'button' && textOf(x) === label);
  assert.ok(button, `premise: the prompt has no ${label}`);
  return button!;
}

for (const [label, decision, sentence, path] of [
  // Moved by S4 W2b: the answers read S100 and S96.
  ['Enable', 'allow', ALLOWED, 'notebook'],
  ["Don't enable", 'off', DECLINED, 'notebook'],
  ['Enable all data sources', 'allow-all', ALLOWED_ALL, 'notebook'],
  ['Enable', 'allow', ALLOWED, 'chat'],
] as const) {
  test(`D8, the ${path} path: after ${label} at the prompt, a polite live region holds the card's own outcome sentence, word for word`, async () => {
    if (path === 'notebook') SIGNED_IN();
    answers();
    await consentWith({ 'boston-opencontext': 'ask-first' });
    const p = await mountPage(path === 'notebook' ? ASK_NOTEBOOK() : h(Home));
    const stream = await ask(p);
    const key = nextKey();
    if (path === 'notebook') {
      stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
      stream.push(loadLine('tool_start'));
      stream.push({ type: 'phase_a_progress', message: 'Waiting for your answer about Boston OpenContext, which is set to Ask first', phase: 'consent_pause', pause: pauseOf(key) });
    } else {
      stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
      stream.push({ type: 'progress', panel: 'withMcp', message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, args: { alias: 'boston_opencontext' }, toolName: 'load_source', operationType: 'load_source' });
      stream.push({ type: 'progress', panel: 'withMcp', message: 'Waiting for your answer about Boston OpenContext, which is set to Ask first', phase: 'consent_pause', pause: pauseOf(key) });
    }
    await settle(p, MEASURE_WAIT);
    assert.equal(holding(p, sentence).length, 0, 'premise: no region holds the outcome before the reply');
    await p.click(promptButton(p, label));
    await settle(p, MEASURE_WAIT);
    assert.deepEqual(decisions, [{ key, decision }], 'premise: the reply was posted under the pause\'s key');
    assert.equal(p.elements().filter((el) => el.props['data-part'] === 'consent-pause-prompt').length, 0, 'premise: the prompt closed after the reply');
    const shown = cardOutcome(p);
    assert.ok(shown !== null && shown.startsWith(sentence), `premise: the card shows the outcome "${sentence}"; it reads ${JSON.stringify(shown)}`);
    const regions = holding(p, sentence);
    assert.equal(regions.length, 1, `expected one polite live region holding "${sentence}"; the polite regions read: ${JSON.stringify(politeRegions(p).map((el) => textOf(el)))}`);
  });
}

// --- FX2b: the answer arrives with its author line in view (Seat ruling 7080749045) -----------------------------------
//
// THE RULING. The answer is drawn under its author line or lines (`<p data-author>`, "Answer, written by the model …"),
// so "the answer's top under the header" (D5 = A) is the topmost author line's top. The surface measures and moves from
// the first of the `[data-author]` elements directly before the answer part, and from the answer part when there is
// none; "in view" moves with it. There can be zero, one or two author lines (`adapt-notebook.ts:218-226`).
//
// WHAT MAKES IT ABLE TO FAIL. At the base (`b4e5319`) the surface measures the answer part: after its move the author
// line sits 26 px per line above the 16 px gap, behind the header, and an arrival whose part is in view but whose author
// line is behind the header moves nothing. The no-author and in-view cases are the pins, green at both.

/** A notebook whose rendering cell holds `outputs`: the shape that decides how many author lines the answer has. */
const notebookWith = (outputs: Json[]) => ({
  ...notebookOf(false),
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n'] },
    { cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(answer)\n'], outputs },
  ],
});
const ONE_LINE = [{ output_type: 'display_data', metadata: {}, data: { 'text/markdown': RUN_ANSWER } }];
const TWO_LINES = [{ output_type: 'display_data', metadata: {}, data: { 'text/html': '<table><tr><td>RUNANSWER-fx2b</td><td>42</td></tr></table>', 'text/plain': '42' } }];
const NO_LINE = [{ output_type: 'error', ename: 'ValueError', evalue: 'RUNANSWER-fx2b', traceback: ['ValueError: RUNANSWER-fx2b'] }];

/** The author lines directly before the main (first) answer part, in order. */
function authorLinesOfMainAnswer(surface: Surface): HostElement[] {
  const [main] = answersOn(surface);
  assert.ok(main, 'premise: no answer part');
  const lines: HostElement[] = [];
  for (let prev = previousSibling(main); prev && prev.props['data-author'] !== undefined; prev = previousSibling(prev)) lines.unshift(prev);
  return lines;
}

/** A notebook run on /ask whose answer arrives with `outputs`, its part's top at `top`; returns the scrolls since the arrival. */
async function notebookArrival(outputs: Json[], top: number): Promise<{ page: Surface; made: Array<{ top?: number; behavior?: string }> }> {
  SIGNED_IN();
  answers();
  await consentWith();
  authorLayout = true;
  answerTop = top;
  const p = await mountPage(ASK_NOTEBOOK());
  const stream = await ask(p);
  await notebookSteps(p, stream);
  const from = windowScrolls.length;
  stream.push({ type: 'notebook', notebook: notebookWith(outputs), sandboxId: 'fixture-sandbox-fx2', executionDuration_ms: 4200, validation: { ok: true, issues: [] } });
  await settle(p, MEASURE_WAIT);
  await notebookEnds(p, stream);
  return { page: p, made: windowScrolls.slice(from) };
}

/** After the one scroll, the topmost author line's top lands at or below the header's bottom, within the 16 px gap and a pixel. */
function assertAuthorLineUnderHeader(made: Array<{ top?: number }>, authorTop: number, where: string): void {
  assert.equal(made.length, 1, `${where}: expected one scroll of the window: ${JSON.stringify(made)}`);
  const landed = authorTop - (made[0].top ?? NaN);
  assert.ok(landed >= HEADER_BOTTOM && landed <= HEADER_BOTTOM + 17, `${where}: after the move the topmost author line's top is at ${landed}, not under the header's bottom (${HEADER_BOTTOM})`);
  assert.deepEqual(focusCalls, [], `${where}: focus was moved`);
}

test('FX2b criterion 1, one author line, the notebook path: an answer that arrives out of view is moved so its author line is under the header, measured from the main answer, not the disclosure\'s', async () => {
  const { page: p, made } = await notebookArrival(ONE_LINE, -400);
  const lines = authorLinesOfMainAnswer(p);
  assert.deepEqual(lines.map((l) => l.props['data-author']), ['answer'], 'premise: one author line over the answer');
  assert.ok(textOf(lines[0]).startsWith('Answer, written by the model'), `premise: the author line reads ${textOf(lines[0])}`);
  assert.ok(answersOn(p).length >= 2, 'premise: the disclosure places a second answer part later in the document');
  assertAuthorLineUnderHeader(made, -400 - AUTHOR_LINE_HEIGHT, 'one author line');
});

test('FX2b criterion 1, two author lines (answer, then computed), the notebook path: the top one comes under the header', async () => {
  const { page: p, made } = await notebookArrival(TWO_LINES, -400);
  assert.deepEqual(authorLinesOfMainAnswer(p).map((l) => l.props['data-author']), ['answer', 'computed'], 'premise: two author lines over the answer');
  assertAuthorLineUnderHeader(made, -400 - 2 * AUTHOR_LINE_HEIGHT, 'two author lines');
});

test('FX2b criterion 1, one author line, the chat path (the home page): at the first content, the author line comes under the header', async () => {
  answers();
  await consentWith();
  authorLayout = true;
  answerTop = -400;
  const p = await mountPage(h(Home));
  const stream = await ask(p);
  await chatSteps(p, stream);
  const from = windowScrolls.length;
  stream.push({ type: 'token', panel: 'withMcp', content: 'RUNANSWER-fx2b: ' });
  await settle(p, MEASURE_WAIT);
  assert.deepEqual(authorLinesOfMainAnswer(p).map((l) => l.props['data-author']), ['answer'], 'premise: one author line over the answer');
  assertAuthorLineUnderHeader(windowScrolls.slice(from), -400 - AUTHOR_LINE_HEIGHT, 'the chat path');
});

test('FX2b criterion 2: an arrival whose answer part is in view but whose author line is behind the header moves once, and the author line comes under the header', async () => {
  // The part's top, 70, is under the header's bottom (64); its author line's top, 44, is behind the header.
  const { made } = await notebookArrival(ONE_LINE, 70);
  assertAuthorLineUnderHeader(made, 70 - AUTHOR_LINE_HEIGHT, 'part in view, author line behind the header');
});

test('FX2b pin: an answer with no author line (a cell that only raised an error) moves exactly as at the base, from the answer part', async () => {
  const { page: p, made } = await notebookArrival(NO_LINE, -400);
  assert.deepEqual(authorLinesOfMainAnswer(p), [], 'premise: no author line over the answer');
  assert.deepEqual(made, [{ top: -400 - HEADER_BOTTOM - 16, behavior: 'smooth' }], 'the answer with no author line did not move as at the base');
  assert.deepEqual(focusCalls, [], 'focus was moved');
});

test('FX2b pin: an arrival whose author line is already in view moves nothing', async () => {
  const { page: p, made } = await notebookArrival(ONE_LINE, 300);
  assert.equal(authorLinesOfMainAnswer(p).length, 1, 'premise: one author line over the answer');
  assert.deepEqual(made, [], 'the page moved although the author line arrived in view');
  assert.deepEqual(focusCalls, [], 'focus was moved');
});
