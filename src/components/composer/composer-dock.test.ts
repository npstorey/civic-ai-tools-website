// UX-2 P3b-1 (#729), criteria 1 and 4 (the composer's half): the composer docked below the answer; and leg H (plan
// v3): the box docks at the send, the reader's question in a bubble, the framing giving way, one copy of the question.
//
// THE RULE (P3b contract v3, Part 1, 1A; the seat's rulings on leg A's stop, `p3b-1-legA-rulings.md`; leg H, the
// owner's design change, dock at send, #729 6825049451 and 6835240316).
// - The composer (`data-part="composer"`) docks when a run starts, and stays docked for the life of the surface: it
//   carries `composer--docked`, sits after the results in the page, and its placeholder reads X23. That is mid-stream,
//   Standard and Sandbox; after a first send the route refuses (`consent_required`: the question goes back into the
//   docked box, the card into the docked slot); after a first run that ends in an error; and after the answer. A send
//   the consent guard holds starts no run, so it does not dock.
// - Leg H: the reader's question shows once, in `data-part="question-bubble"`, the first child of the results
//   container, after the page's `h1` (visually hidden from the send, `ui-visually-hidden`) with nothing between them;
//   the italic quote (`McpResponseDisplay`) is left out on these two mounts and kept on `/explore`'s.
// - The first-time line (X24, `data-part="first-time-line"`, one <p>: contract v5 1B.2, O4 = A) renders once under
//   the docked box, in Q5 = B's form for the reader's sign-in state (signed out, its first sentence only), until the second question of the session: the
//   second submit that starts an analysis and so replaces the answer. Three submits do (each resets the shown
//   answer, `useStreamingComparison.ts:109-117`): the box (`QuerySurface.tsx:128-156`), "Continue this analysis"
//   (`:158-166`) and the demoted comparison's run (`:172-180`). A chip only fills the box (`QueryForm.tsx:331-336`),
//   so it reaches a run through the box's submit. A refused send starts no analysis. The count is kept in session
//   storage, so a remount in the same session does not show the line again.
// - Before the dock the parts keep the ruled order: box, chips, where-line, the guard's slot, then the account line
//   (with the sign-in line on the home page signed out) and the gear. Docked (contract v5 1A, 1D; addendum 3, 3.3),
//   the bar (`composer-bar`) holds any open slot and then the box, and the lines follow it; no chips.
// - The results block opens with the bubble, then its heading, then the pause prompt (leg H; the cards' "Stated, not
//   asked": the order in the answer area).
// - The docked rule in `globals.css` is `position: sticky; bottom: 0` with a `z-index` below the header's 50
//   (#728 line 3; `Header.tsx:279-281`), carried by the bar's rule since the re-cut; the docked root is
//   `display: contents` (addendum 3, 3.3). The page gains no bottom padding (the seat's ruling S2); that, and the
//   last line of a finished answer above the docked box, are criterion 5's instrument's reads, not this file's.
//
// WHAT IS DRIVEN. The home page component (`src/app/(marketing)/page.tsx`, signed out, the comparison) and
// `/ask`'s surface as its page mounts it (`QuerySurface`, answer-first, notebook by default; standard where a test
// says), on the surface harness. `/api/flows` and `/api/sources/consent` are their REAL route handlers; each query
// route asks the REAL consent gate and answers its refusal in the route's own shape, or a held stream the test
// completes.
//
// WHAT MAKES IT ABLE TO FAIL. At the base no element carries `data-part="composer"`, the placeholder never
// changes, no first-time line exists, and `globals.css` has no docked rule. The refused-send and remount cases are
// the shapes a `queryCount > 0` dock, or a line counted in component state, would fail. Leg H's base (1827ab8)
// docks only after an answer, renders no bubble, keeps the framing and the italic quote after a send, and keeps the
// sent words in the undocked box while the first run streams: each leg H test below is red there at an assertion,
// except the guards, which say so.
//
// BLIND SPOTS, stated. No layout: "below the answer" is read as document order and the stylesheet's rule, not a
// box; criterion 5's instrument measures the box. No focus. The harness's unmount can leave bus subscriptions
// (#670), so each test mints its own pause keys.
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import ts from 'typescript';
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
import { attr, childrenOf, classesOf, cssRules, cssRulesMentioning, parentOf, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
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
    innerHeight: 852,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  // The pause prompt brings itself into view through the document; nothing here is found, so nothing scrolls.
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const LiveResponsePanel = (await load('components/explore/LiveResponsePanel.tsx')).default as ComponentType<Record<string, unknown>>;
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The words, ruled (literal here: a test that read them from the module would pass on any words) ----------------

const X23 = 'Ask another question';
const X24_SIGNED_IN = 'A new question replaces this answer. To keep this answer, publish it first.';
/** O4 = A: signed out, the first sentence only; "To keep this answer, sign in and publish it." is withheld. */
const X24_SIGNED_OUT = 'A new question replaces this answer.';
const BOX_LABEL = 'Ask a question about open data';
const DOCKED_CLASS = 'composer--docked';
/** X24's shape (the owner, 6753017330; contract v5 1B.2): one plain paragraph, no disclosure inside it. */
function assertX24OneParagraph(line: HostElement, where: string): void {
  assert.equal(line.type, 'p', `${where}: the first-time line is a <${line.type}>, not one <p>`);
  const inner = within(line).filter((el) => el !== line && ['details', 'summary', 'p', 'div'].includes(el.type)).map((el) => el.type);
  assert.deepEqual(inner, [], `${where}: the first-time line holds a block or a disclosure`);
  assert.equal(attr(line, 'open'), null, `${where}: the first-time line carries an open attribute`);
}

// --- The held streams and the answers --------------------------------------------------------------------------

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
    close: () => { if (!closed) { closed = true; try { controller.close(); } catch { /* cancelled by its reader */ } } },
  };
}

const sse = (events: Json[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/** Every query a route received, by path, in order. */
let queries: Array<{ path: string; body: Json }> = [];

/** Answers a test queues for the next query requests, in order, before the gate is asked (relay 57: a run that fails). */
let nextAnswers: Array<(routePath: string, body: Json) => Response> = [];

/** A query route as the real gate makes it: refused in the route's own shape, or a held stream. */
function queryRoute(routePath: string) {
  return async (request: Request): Promise<Response> => {
    const body = JSON.parse(await request.clone().text() || '{}') as Json;
    queries.push({ path: routePath, body });
    const override = nextAnswers.shift();
    if (override) return override(routePath, body);
    const decision = await consentInForce(request, sessions.server);
    if (!decision.ok) {
      if (routePath === '/api/compare-stream') {
        const panels = body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
        return sse(panels.map((panel) => ({ type: 'error', panel, message: decision.payload.error, code: decision.payload.code, flowsVersion: decision.payload.flowsVersion, reask: decision.payload.reask })));
      }
      return new Response(JSON.stringify(decision.payload), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const held = heldStream();
    streams.push(held);
    return held.response;
  };
}

function answers() {
  streams = [];
  queries = [];
  nextAnswers = [];
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    // The count (contract v5 1B.3): answered, so the account line is shown from the first question on.
    '/api/rate-limit': () => new Response(JSON.stringify({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: sessions.server !== null }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': async (request: Request) => {
      if (request.method === 'GET') return new Response(JSON.stringify({ routing: 'in-loop', store: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const body = JSON.parse(await request.text()) as Json;
      return new Response(JSON.stringify({ decision: body.decision, sourceId: 'boston-opencontext' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/compare-stream': queryRoute('/api/compare-stream'),
    '/api/query-notebook': queryRoute('/api/query-notebook'),
  });
}

const statement = await buildFlowsStatement();

/** A consent in force, written as the page writes it (a cookie signed out, a row signed in). */
async function consentWith(states: Record<string, string> = {}, fallback = 'on'): Promise<void> {
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, states[s.sourceId] ?? fallback])), flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};
const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

const mounted: Surface[] = [];
beforeEach(() => {
  storage.clear();
  sessions.rows.clear();
});
afterEach(() => {
  for (const s of streams) s.close();
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
});

const HOME = () => h(Home);
const ASK = (defaultMode: 'notebook' | 'standard' = 'notebook') =>
  h(QuerySurface, { presentation: 'answer-first', defaultMode });

async function mountPage(element: ReturnType<typeof h>): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  await settle(p);
  return p;
}

const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};

// --- Reading the page ------------------------------------------------------------------------------------------

const part = (el: HostElement): unknown => el.props['data-part'];

function composerOf(surface: Surface): HostElement {
  const found = surface.elements().filter((el) => part(el) === 'composer');
  assert.equal(found.length, 1, `expected one data-part="composer", found ${found.length}; the page reads: ${surface.text().slice(0, 300)}`);
  return found[0];
}

const isDocked = (surface: Surface): boolean => classesOf(composerOf(surface)).includes(DOCKED_CLASS);

function boxOf(surface: Surface): HostElement {
  const found = surface.elements().filter((el) => el.type === 'textarea' && el.props['aria-label'] === BOX_LABEL);
  assert.equal(found.length, 1, `expected one question box labelled "${BOX_LABEL}", found ${found.length}`);
  return found[0];
}

const firstTimeLines = (surface: Surface): HostElement[] => surface.elements().filter((el) => part(el) === 'first-time-line');
const surfaceParts = (surface: Surface, name: string): HostElement[] => surface.elements().filter((el) => part(el) === name);

// --- Leg H: the bubble, the framing, the one copy -----------------------------------------------------------------

const BUBBLE = 'question-bubble';
/** The visually-hidden utility the page's `h1` takes from the send (plan v3, Files: `globals.css`). */
const HIDDEN_CLASS = 'ui-visually-hidden';

/** An element's own text: its string children, joined (a `<div>` holding `“{q}”` reads `“q”`). */
function ownText(el: HostElement): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (typeof node === 'string' || typeof node === 'number') out.push(String(node));
  };
  walk(el.props.children);
  return out.join('');
}

/**
 * The elements a reader sees the question in: every element whose own text holds `q`, outside the composer and
 * outside a closed `<details>` (its `<summary>` excepted). The harness has no layout (`:36`), so a closed
 * disclosure's body and the box are in the tree it reads; they are left out by structure, never by a box.
 */
function shownCopies(surface: Surface, q: string): HostElement[] {
  const hidden = new Set<HostElement>();
  for (const el of surface.elements()) {
    if (part(el) === 'composer') for (const x of [el, ...within(el)]) hidden.add(x);
    if (el.type === 'details' && !el.props.open) {
      const summary = childrenOf(el).filter((c) => c.type === 'summary');
      const shown = new Set<HostElement>(summary.flatMap((s) => [s, ...within(s)]));
      for (const x of within(el)) if (!shown.has(x)) hidden.add(x);
    }
  }
  return surface.elements().filter((el) => !hidden.has(el) && ownText(el).includes(q));
}

/** The italic quote of the question (`McpResponseDisplay`): an element reading `“{q}”` and nothing else. */
const quotesOf = (surface: Surface, q: string): HostElement[] => surface.elements().filter((el) => ownText(el) === `“${q}”`);

const ASK_LEDE = 'Ask in plain language. The answer is built from live public data, and you can publish it as a signed analysis anyone can verify independently.';
const HOME_SUBTITLE = 'See how AI answers with and without access to real datasets';

/** `/ask`'s surface as its page mounts it from leg H: its `h1` handed to the surface apart from its framing (plan v3). */
const ASK_FRAMED = (defaultMode: 'notebook' | 'standard' = 'notebook') =>
  h(
    QuerySurface,
    {
      presentation: 'answer-first',
      defaultMode,
      heading: h('h1', { style: { fontSize: '28px', fontWeight: 700, marginBottom: '8px' } }, 'Ask a question'),
      framingStyle: { marginBottom: '24px' },
    },
    h('p', { style: { fontSize: '15px', lineHeight: '160%', color: 'var(--text-secondary)', maxWidth: '650px' } }, ASK_LEDE),
  );

/** The page's one `h1`. */
function pageHeading(surface: Surface): HostElement {
  const found = surface.elements().filter((el) => el.type === 'h1');
  assert.equal(found.length, 1, `expected the page's one h1, found ${found.length}`);
  return found[0];
}

/**
 * Criterion 1's order: the page's `h1`, then the bubble, then the run's `h2`, with nothing between the `h1` and the
 * bubble but the bubble's own containers.
 */
function assertHeadingBubbleOrder(surface: Surface, heading: string, where: string): HostElement {
  const all = surface.elements();
  const h1 = pageHeading(surface);
  const bubbles = surfaceParts(surface, BUBBLE);
  assert.equal(bubbles.length, 1, `${where}: data-part="${BUBBLE}": ${bubbles.length}`);
  const bubble = bubbles[0];
  const block = resultsBlock(surface, heading);
  assert.equal(childrenOf(block)[0], bubble, `${where}: the bubble is not the results container's first child`);
  const h2 = childrenOf(block).find((el) => el.type === 'h2')!;
  assert.ok(all.indexOf(h1) < all.indexOf(bubble) && all.indexOf(bubble) < all.indexOf(h2), `${where}: not h1, then the bubble, then the run's h2`);
  const ancestors = new Set(all.filter((el) => within(el).includes(bubble)));
  const inH1 = new Set(within(h1));
  const between = all.slice(all.indexOf(h1) + 1, all.indexOf(bubble)).filter((el) => !inH1.has(el) && !ancestors.has(el));
  assert.deepEqual(between.map((el) => `${el.type}${part(el) ? `[${String(part(el))}]` : ''}`), [], `${where}: something sits between the h1 and the bubble`);
  return bubble;
}

/** Type a question into the box and submit the one form that holds it. */
async function askFromBox(surface: Surface, question: string): Promise<void> {
  const box = boxOf(surface);
  await surface.type(box, question);
  const forms = surface.elements().filter((el) => el.type === 'form' && within(el).includes(boxOf(surface)));
  assert.equal(forms.length, 1, `expected one form holding the question box, found ${forms.length}`);
  await surface.submit(forms[0]);
  await settle(surface);
}

const ANSWER = { content: 'A fixture answer.', duration_ms: 1, tools_called: [] };

/** Finish the latest comparison run: each panel the request asked for completes with an answer. */
async function finishComparison(surface: Surface, extra: Json = {}): Promise<void> {
  const stream = streams[streams.length - 1];
  assert.ok(stream, 'premise: the page sent a question to a query route');
  const last = queries[queries.length - 1];
  const panels = last.body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
  for (const panel of panels) stream.push({ type: 'complete', panel, data: { ...ANSWER, ...extra } });
  stream.close();
  await settle(surface);
}

const NOTEBOOK = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { extensions: { 'org.civicaitools.execution': { executedAt: '2026-11-09T12:00:00Z', executionDuration_ms: 1000, sandboxId: 'fixture-sandbox-p3b1', environment: { python: '3.13', libraries: {} } }, 'org.civicaitools.notebook': { provenance: 'executed' } } },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n'] },
    { cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(Markdown(answer))\n'], outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/markdown': 'A fixture answer.' } }] },
  ],
};

/** Finish the latest executed run: an answer, the notebook, done. */
async function finishNotebook(surface: Surface): Promise<void> {
  const stream = streams[streams.length - 1];
  assert.ok(stream, 'premise: the page started an executed run');
  stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  stream.push({ type: 'phase_a_answer', content: 'A fixture answer.' });
  stream.push({ type: 'phase', name: 'B', message: 'Synthesizing notebook…' });
  stream.push({ type: 'phase', name: 'C', message: 'Executing in sandbox…' });
  stream.push({ type: 'notebook', notebook: NOTEBOOK, sandboxId: 'fixture-sandbox-p3b1', executionDuration_ms: 1000, validation: { ok: true, issues: [] } });
  stream.push({ type: 'phase', name: 'complete', message: 'Done.' });
  stream.close();
  await settle(surface);
}

/** The results block: the parent of the run's heading. */
function resultsBlock(surface: Surface, heading: string): HostElement {
  const h2 = surface.elements().filter((el) => el.type === 'h2' && textOf(el) === heading);
  assert.equal(h2.length, 1, `premise: one results heading "${heading}", found ${h2.length}`);
  const block = parentOf(surface, h2[0]);
  assert.ok(block, 'premise: the results heading has a parent');
  return block!;
}

/** `a` comes before `b` in the page. */
function before(surface: Surface, a: HostElement, b: HostElement): boolean {
  const all = surface.elements();
  return all.indexOf(a) !== -1 && all.indexOf(a) < all.indexOf(b);
}

/** The ruled order of the composer's parts, then the gear (P3b-1 keeps it, beneath). */
const GOLDEN = ['composer-bar', 'box', 'chip-row', 'where-this-question-goes', 'first-time-line', 'consent-card', 'dont-allow', 'no-source-on', 'account-line', 'sign-in-line', 'gear'];

/** The parts present, in document order, named as `GOLDEN` names them. */
function partOrder(surface: Surface): string[] {
  const out: string[] = [];
  for (const el of surface.elements()) {
    const p = part(el);
    if (el.type === 'textarea' && el.props['aria-label'] === BOX_LABEL) out.push('box');
    else if (typeof p === 'string' && GOLDEN.includes(p)) out.push(p);
    else if (el.type === 'button' && textOf(el).includes('Advanced options')) out.push('gear');
  }
  return out;
}

/** The parts present are the ones `expected` names, in the golden's order. */
function assertOrder(surface: Surface, expected: string[], where: string): void {
  // Exactly `expected`, in that order: docked, a slot comes before the box (1D), so no one global order holds. Undocked,
  // the bar is the shape's own business and is read past.
  const read = partOrder(surface);
  const compared = expected.includes('composer-bar') ? read : read.filter((p) => p !== 'composer-bar');
  assert.deepEqual(compared, expected, `${where}: the composer's parts, in page order: ${JSON.stringify(read)}`);
}

// --- Criterion 1: the home page, signed out ---------------------------------------------------------------------

test('criterion 1, leg H (dock at send; reverses "undocked during the first run"), the home page signed out: undocked before a question; from the send, while the first run streams, the composer is docked below the results, reads "Ask another question" and shows the signed-out first-time line; after the answer it still does, once, one paragraph, its first sentence only', async () => {
  ANON();
  answers();
  await consentWith();
  const page = await mountPage(HOME());
  assert.equal(isDocked(page), false, 'docked before any question');
  assert.notEqual(boxOf(page).props.placeholder, X23, 'the undocked box already reads X23');
  assert.equal(firstTimeLines(page).length, 0, 'a first-time line before the first answer');

  await askFromBox(page, 'What was the median household income in the Bronx?');
  assert.equal(streams.length, 1, 'premise: the first run is under way (a held stream)');
  assert.equal(isDocked(page), true, 'not docked while the first run streams: the box docks at the send');
  assert.ok(before(page, resultsBlock(page, 'Results'), composerOf(page)), 'mid-stream, the docked composer is not after the results');
  assert.equal(boxOf(page).props.placeholder, X23, 'mid-stream, the docked placeholder');
  assert.equal(firstTimeLines(page).length, 1, 'mid-stream, no first-time line under the docked box from the first send');
  await finishComparison(page);

  assert.equal(isDocked(page), true, `the composer is not docked after a finished answer: [${classesOf(composerOf(page)).join(' ')}]`);
  assert.equal(boxOf(page).props.placeholder, X23, 'the docked placeholder');
  assert.equal(boxOf(page).props['aria-label'], BOX_LABEL, 'the box keeps its accessible name');
  assert.ok(before(page, resultsBlock(page, 'Results'), composerOf(page)), 'the docked composer is not after the results');
  const lines = firstTimeLines(page);
  assert.equal(lines.length, 1, `first-time lines after the first answer: ${lines.length}`);
  assertX24OneParagraph(lines[0], 'the home page signed out');
  assert.equal(textOf(lines[0]), X24_SIGNED_OUT, 'the signed-out first-time line, byte for byte (its first sentence only, O4 = A)');
  assert.ok(!page.text().includes('To keep this answer, sign in and publish it.'), 'the withheld sentence is on the page signed out');
  assert.ok(within(composerOf(page)).includes(lines[0]), 'the first-time line is not inside the composer');
  assert.ok(before(page, boxOf(page), lines[0]), 'the first-time line is not under the box');
});

test('criterion 1, the home page: the second question from the docked box takes the first-time line away, during the run and after it; the composer stays docked', async () => {
  ANON();
  answers();
  await consentWith();
  const page = await mountPage(HOME());
  await askFromBox(page, 'What was the median household income in the Bronx?');
  await finishComparison(page);
  assert.equal(firstTimeLines(page).length, 1, 'no first-time line after the first answer, so the second question has nothing to take away');

  await askFromBox(page, 'And in Brooklyn?');
  assert.equal(isDocked(page), true, 'the composer undocked when the second question started');
  assert.equal(firstTimeLines(page).length, 0, 'the first-time line is still shown while the second question runs');
  await finishComparison(page);
  assert.equal(isDocked(page), true, 'the composer is not docked after the second answer');
  assert.equal(firstTimeLines(page).length, 0, 'the first-time line came back after the second answer');
});

test('criterion 1, the home page: after the second question, a remount in the same session shows no first-time line under its first docked answer (the count is the session\'s)', async () => {
  ANON();
  answers();
  await consentWith();
  const first = await mountPage(HOME());
  await askFromBox(first, 'What was the median household income in the Bronx?');
  await finishComparison(first);
  await askFromBox(first, 'And in Brooklyn?');
  await finishComparison(first);
  first.unmount();
  mounted.splice(mounted.indexOf(first), 1);

  const again = await mountPage(HOME());
  await askFromBox(again, 'And in Queens?');
  await finishComparison(again);
  assert.equal(isDocked(again), true, 'premise: the remounted page docks after its answer');
  assert.equal(firstTimeLines(again).length, 0, 'the first-time line shows again in the same session');

  // The converse, in a new session (storage cleared): the line shows again.
  storage.clear();
  const fresh = await mountPage(HOME());
  await askFromBox(fresh, 'And in Staten Island?');
  await finishComparison(fresh);
  assert.equal(firstTimeLines(fresh).length, 1, 'a new session shows no first-time line after its first answer');
});

test('criterion 6, leg H (dock at send; reverses "a refused first send does not dock"): a first send the route refuses (consent_required) docks the composer, the question goes back into the docked box, and the card opens in the docked bar before the box, with the first-time line shown; after Allow the question runs, the composer stays docked, and the resend is not counted as a second question', async () => {
  ANON();
  const net = answers();
  // The race the guard cannot see (consent-surfaces-driven.test.ts, criterion 2): the page reads the consent as in
  // force, the request carries none, and the REAL gate refuses it.
  const real = (globalThis as { fetch: typeof fetch }).fetch;
  const inForce = { inForce: true, store: 'cookie', flowsVersion: statementHash(statement), states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: '2026-11-09' }])) };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const p = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
    if (p === '/api/sources/consent' && (init?.method ?? 'GET').toUpperCase() === 'GET') {
      return new Response(JSON.stringify(inForce), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  }) as typeof fetch;
  try {
    const page = await mountPage(HOME());
    composerOf(page);
    const asked = 'What was the median household income in the Bronx?';
    await askFromBox(page, asked);
    assert.deepEqual(queries.map((q) => q.path), ['/api/compare-stream'], 'premise: the question reached the route');
    assert.equal(streams.length, 0, 'premise: the route refused it');
    assert.equal(page.buttons('Allow').length, 1, 'premise: the refusal shows the consent card');
    assert.equal(isDocked(page), true, 'a refused first send left the composer undocked: the run started, so it docks at the send');
    assert.equal(String(boxOf(page).props.value ?? ''), asked, 'the refused question is not back in the docked box (6783965529 item 1)');
    const bar = surfaceParts(page, 'composer-bar');
    const card = surfaceParts(page, 'consent-card');
    assert.ok(bar.length === 1 && card.length === 1 && within(bar[0]).includes(card[0]), 'the card is not in the docked bar (O7 = A)');
    assert.ok(before(page, card[0], boxOf(page)), 'the card is not before the docked box');
    assert.equal(firstTimeLines(page).length, 1, 'no first-time line under the docked box after a refused first send');

    await page.click(page.button('Allow'));
    await settle(page);
    assert.equal(streams.length, 1, `premise: after Allow the question was sent again and served (${net.sent.length} requests)`);
    assert.equal(isDocked(page), true, 'the run after Allow undocked the composer');
    await finishComparison(page);
    assert.equal(isDocked(page), true, 'the answer after Allow left the composer undocked');
    assert.equal(firstTimeLines(page).length, 1, 'the resend after Allow was counted as a second question: no first-time line after the first answer');
  } finally {
    globalThis.fetch = real;
  }
});

// --- Criterion 1: /ask, signed in ------------------------------------------------------------------------------

test('criterion 1, leg H (dock at send; reverses "/ask docks after the run finishes"), /ask signed in (an executed run): from the send, while the run streams, the composer is docked after the results; after the run it still is, reads "Ask another question", shows the signed-in first-time line once, and keeps the gear ("Advanced options") beneath, in the ruled order', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(ASK('notebook'));
  assert.equal(isDocked(page), false, 'docked before any question');
  await askFromBox(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.deepEqual(queries.map((q) => q.path), ['/api/query-notebook'], 'premise: /ask ran the question in the sandbox');
  assert.equal(streams.length, 1, 'premise: the executed run is under way (a held stream)');
  assert.equal(isDocked(page), true, 'not docked while the executed run streams: the box docks at the send');
  assert.ok(before(page, resultsBlock(page, 'Answer, executed in a signed sandbox'), composerOf(page)), 'mid-stream, the docked composer is not after the results');
  await finishNotebook(page);

  assert.equal(isDocked(page), true, 'the composer is not docked after a finished executed run');
  assert.equal(boxOf(page).props.placeholder, X23, 'the docked placeholder');
  assert.ok(before(page, resultsBlock(page, 'Answer, executed in a signed sandbox'), composerOf(page)), 'the docked composer is not after the results');
  const lines = firstTimeLines(page);
  assert.equal(lines.length, 1, `first-time lines after the first answer: ${lines.length}`);
  assertX24OneParagraph(lines[0], '/ask signed in');
  assert.equal(textOf(lines[0]), X24_SIGNED_IN, 'the signed-in first-time line, byte for byte');
  assert.ok(page.text().includes('Advanced options'), 'the gear is gone: P3b-1 removes nothing of P3b-2\'s');
  assertOrder(page, ['composer-bar', 'box', 'where-this-question-goes', 'first-time-line', 'account-line', 'gear'], '/ask, docked');
});

test('criterion 1, the home page signed in (a single-host instance): the first-time line takes the signed-in form, by sign-in state', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(HOME());
  await askFromBox(page, 'What was the median household income in the Bronx?');
  await finishComparison(page);
  const lines = firstTimeLines(page);
  assert.equal(lines.length, 1, `first-time lines after the first answer: ${lines.length}`);
  assert.equal(textOf(lines[0]), X24_SIGNED_IN, 'signed in on the home page, the first-time line is not the signed-in form');
});

// --- The second question: "Continue this analysis" and the demoted comparison's run ------------------------------

test('the second question, /ask standard: "Continue this analysis" on a cut-short answer replaces the answer, so it takes the first-time line away', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(ASK('standard'));
  await askFromBox(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  await finishComparison(page, { token_limit_exceeded: true });
  assert.equal(firstTimeLines(page).length, 1, 'no first-time line after the first answer, so the second question has nothing to take away');
  await page.click(page.button('Continue this analysis'));
  await settle(page);
  assert.equal(queries.length, 2, 'premise: Continue sent a second request');
  assert.equal(firstTimeLines(page).length, 0, 'the first-time line is still shown after Continue replaced the answer');
  await finishComparison(page);
  assert.equal(isDocked(page), true, 'the composer undocked after Continue');
  assert.equal(firstTimeLines(page).length, 0, 'the first-time line came back after the continued answer');
});

test('the second question, /ask standard: running the demoted comparison replaces the answer, so it takes the first-time line away', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(ASK('standard'));
  await askFromBox(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.equal(queries[0]?.body.mcpOnly, true, 'premise: the first run is the demoted (one-arm) run');
  await finishComparison(page);
  assert.equal(firstTimeLines(page).length, 1, 'no first-time line after the first answer, so the second question has nothing to take away');
  const run = page.elements().filter((el) => el.type === 'button' && textOf(el).includes('Run the side-by-side comparison'));
  assert.equal(run.length, 1, `premise: one control that runs the comparison, found ${run.length}`);
  await page.click(run[0]);
  await settle(page);
  assert.equal(queries.length, 2, 'premise: the comparison was run');
  assert.equal(firstTimeLines(page).length, 0, 'the first-time line is still shown after the comparison replaced the answer');
});

// --- The dock condition, leg H: a first run that ends in an error has started, so it docks -----------------------------

test('criterion 6, leg H (dock at send; reverses relay 57\'s "an errored first run does not dock"), the home page: a first run the route answers with an error docks the composer and shows the first-time line; the second question, from the docked box, takes the line away; the composer stays docked through a run whose panels each error and through the next answer', async () => {
  ANON();
  answers();
  await consentWith();
  // The route fails outright (a 503): the stream hook reports the reader-facing error, and no panel has an answer.
  nextAnswers.push(() => new Response('Service unavailable', { status: 503 }));
  const page = await mountPage(HOME());
  await askFromBox(page, 'What was the median household income in the Bronx?');
  assert.equal(queries.length, 1, 'premise: the question reached the route');
  assert.equal(streams.length, 0, 'premise: the route failed it');
  assert.ok(resultsBlock(page, 'Results'), 'premise: the results block renders the error');
  assert.equal(isDocked(page), true, 'a first run that ended in an error left the composer undocked: it started, so it docks at the send');
  assert.equal(firstTimeLines(page).length, 1, 'no first-time line under the docked box after a first run that ended in an error');

  // Each panel errors in the stream (a model failure): complete, with no answer.
  nextAnswers.push((_path, body) => sse((body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp']).map((panel) => ({ type: 'error', panel, message: 'The model could not answer.', code: 'generic' }))));
  await askFromBox(page, 'And in Brooklyn?');
  assert.equal(queries.length, 2, 'premise: the second question reached the route');
  assert.equal(isDocked(page), true, 'a run whose panels each ended in an error undocked the composer');
  assert.equal(firstTimeLines(page).length, 0, 'the second question, sent from the docked box, did not take the first-time line away');

  await askFromBox(page, 'And in Queens?');
  await finishComparison(page);
  assert.equal(isDocked(page), true, 'an answered run after the errors left the composer undocked');
  assert.equal(firstTimeLines(page).length, 0, 'the first-time line came back after the answer');
});

test('criterion 6, leg H (dock at send; reverses relay 57\'s "an errored first run does not dock"), /ask signed in: a first executed run that ends in an error docks the composer and shows the first-time line', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  nextAnswers.push(() => sse([{ type: 'error', message: 'The notebook could not finish running. Please try again.', code: 'generic' }]));
  const page = await mountPage(ASK('notebook'));
  await askFromBox(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.deepEqual(queries.map((q) => q.path), ['/api/query-notebook'], 'premise: /ask ran the question in the sandbox');
  assert.ok(resultsBlock(page, 'Answer, executed in a signed sandbox'), 'premise: the results block renders the failed run');
  assert.equal(isDocked(page), true, 'a first executed run that ended in an error left the composer undocked: it started, so it docks at the send');
  assert.ok(before(page, resultsBlock(page, 'Answer, executed in a signed sandbox'), composerOf(page)), 'the docked composer is not after the failed run');
  assert.equal(firstTimeLines(page).length, 1, 'no first-time line under the docked box after a first executed run that ended in an error');
});

// --- Criterion 1: the slots' order relative to the box ------------------------------------------------------------

test('criterion 1, the golden order on the home page: the consent card, the decline line and the no-source-on line each sit after the box, the chips and the line', async () => {
  ANON();
  // The card: a fresh session, no consent.
  answers();
  const card = await mountPage(HOME());
  composerOf(card);
  await askFromBox(card, 'What was the median household income in the Bronx?');
  assert.equal(card.buttons('Allow').length, 1, 'premise: the card is shown');
  assertOrder(card, ['box', 'chip-row', 'where-this-question-goes', 'consent-card', 'account-line', 'sign-in-line'], 'the card');

  // The decline line: Don't allow.
  await card.click(card.button("Don't allow"));
  await settle(card);
  assertOrder(card, ['box', 'chip-row', 'where-this-question-goes', 'dont-allow', 'account-line', 'sign-in-line'], 'the decline line');

  // The no-source-on line: a consent in force with every source Off.
  answers();
  await consentWith({}, 'off');
  const none = await mountPage(HOME());
  await askFromBox(none, 'What was the median household income in the Bronx?');
  assert.equal(queries.length, 0, 'premise: with every source Off nothing is sent');
  assertOrder(none, ['box', 'chip-row', 'where-this-question-goes', 'no-source-on', 'account-line', 'sign-in-line'], 'the no-source-on line');
});

// --- Criterion 1, changed by leg H: the results block opens with the bubble, then its heading, then the pause prompt

const BOSTON = statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext');
let pauseRun = 0;
const nextKey = () => `9b3b${String(++pauseRun).padStart(4, '0')}0123456789abcdef01234567`;

test('criterion 1, changed by leg H (the order in the answer area): the results block opens with the question bubble, then its heading, then the pause prompt, with the composer on the page', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountPage(HOME());
  composerOf(page);
  await askFromBox(page, 'How many service requests did Boston record in 2025?');
  const stream = streams[0];
  assert.ok(stream, 'premise: the question was sent');
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Waiting for your answer about Boston OpenContext, which is set to Ask first', phase: 'consent_pause', pause: { key: nextKey(), source: BOSTON, outbound: [], links: statement.links, expiresAt: new Date(Date.now() + 60_000).toISOString(), entryExpiresAt: new Date(Date.now() + 600_000).toISOString(), holds: true } });
  await settle(page);
  const kids = childrenOf(resultsBlock(page, 'Results'));
  assert.deepEqual(kids.slice(0, 3).map((el) => (el.type === 'h2' ? `h2:${textOf(el)}` : String(part(el)))), [BUBBLE, 'h2:Results', 'consent-pause-prompt'], 'the results block\'s first three children');
  stream.close();
});

// --- Criterion 4 (#728 line 3) and the seat's ruling S2: the docked rule ------------------------------------------

test('criterion 4 (#728 line 3), S2; re-pointed to the bar (contract v5 1A; addendum 3, 3.3): the docked root is display: contents and not itself sticky; the rule that docks the bar is position: sticky (not fixed) at bottom 0, with a z-index below the header\'s 50', () => {
  const root = cssRules(`.${DOCKED_CLASS}`).join(';');
  assert.match(root, /display\s*:\s*contents/, `the docked root is not display: contents: ${root}`);
  assert.doesNotMatch(root, /position\s*:\s*(sticky|fixed)/, 'the docked root itself is still positioned: the whole composer sticks');
  const bar = cssRulesMentioning('composer-bar').filter((r) => /position\s*:\s*sticky/.test(r.body));
  assert.equal(bar.length, 1, `rules naming composer-bar that make it sticky: ${JSON.stringify(bar.map((r) => r.selector))}`);
  const declared = bar[0].body;
  assert.doesNotMatch(declared, /position\s*:\s*fixed/, 'the bar is position: fixed');
  assert.match(declared, /(^|;)\s*bottom\s*:\s*0(px)?\s*(;|$)/, 'the bar is not at bottom: 0');
  const z = /z-index\s*:\s*(-?\d+)/.exec(declared);
  assert.ok(z, 'the bar declares no z-index');
  assert.ok(Number(z![1]) < 50, `the bar's z-index ${z![1]} is not below the header's 50`);
});

// === Leg H (plan v3; #729 6825049451, 6835240316) ================================================================

const MOUNTS = [
  { name: 'the home page (signed out, the comparison)', mount: 'home', mode: 'standard', heading: 'Results' },
  { name: '/ask Standard (signed in)', mount: 'ask', mode: 'standard', heading: 'Results' },
  { name: '/ask Sandbox (signed in)', mount: 'ask', mode: 'notebook', heading: 'Answer, executed in a signed sandbox' },
] as const;

async function mountFor(m: (typeof MOUNTS)[number]): Promise<Surface> {
  if (m.mount === 'home') ANON(); else SIGNED_IN();
  answers();
  await consentWith();
  return mountPage(m.mount === 'home' ? HOME() : ASK_FRAMED(m.mode));
}

/** The run's first event, so the stream is under way and has drawn something; the run is not finished. */
async function midStream(surface: Surface, mode: 'standard' | 'notebook'): Promise<void> {
  const stream = streams[streams.length - 1];
  assert.ok(stream, 'premise: the run is under way (a held stream)');
  if (mode === 'notebook') stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  else stream.push({ type: 'progress', panel: 'withMcp', message: 'Searching for datasets', phase: 'search' });
  await settle(surface);
}

const finishRun = (surface: Surface, mode: 'standard' | 'notebook') => (mode === 'notebook' ? finishNotebook(surface) : finishComparison(surface));

// --- Criterion 1: the bubble --------------------------------------------------------------------------------------

for (const m of MOUNTS) {
  test(`leg H criterion 1, ${m.name}: after a send, mid-stream and after the answer, the question shows once, in data-part="${BUBBLE}", the first child of the results container, reading the question as sent, with no screen-reader name; in document order the page's h1, then the bubble, then the run's h2, nothing between the h1 and the bubble`, async () => {
    const page = await mountFor(m);
    const q = `Q-bubble (${m.mount} ${m.mode}): how many 311 noise complaints were there in Brooklyn?`;
    await askFromBox(page, q);
    for (const state of ['mid-stream', 'after the answer'] as const) {
      if (state === 'mid-stream') await midStream(page, m.mode); else await finishRun(page, m.mode);
      const where = `${m.name}, ${state}`;
      const copies = shownCopies(page, q);
      assert.equal(copies.length, 1, `${where}: the question shows ${copies.length} times outside the composer and closed disclosures: ${JSON.stringify(copies.map((el) => `${el.type}${part(el) ? `[${String(part(el))}]` : ''}`))}`);
      assert.equal(part(copies[0]), BUBBLE, `${where}: the one copy is not the bubble: <${copies[0].type}>`);
      const bubble = assertHeadingBubbleOrder(page, m.heading, where);
      assert.equal(textOf(bubble), q, `${where}: the bubble does not read the question as sent`);
      for (const name of ['aria-label', 'aria-labelledby', 'aria-describedby', 'role']) {
        assert.equal(attr(bubble, name), null, `${where}: the bubble carries ${name} (no screen-reader name, the seat 6823959772)`);
      }
    }
  });
}

test('leg H criterion 1, the home page: a chip\'s send puts the chip\'s question in the bubble', async () => {
  const page = await mountFor(MOUNTS[0]);
  const chipRow = surfaceParts(page, 'chip-row');
  assert.equal(chipRow.length, 1, 'premise: the chip row is shown before a question');
  const chip = within(chipRow[0]).find((el) => el.type === 'button');
  assert.ok(chip, 'premise: a chip');
  const q = textOf(chip!);
  await page.click(chip!);
  await settle(page);
  const forms = page.elements().filter((el) => el.type === 'form' && within(el).includes(boxOf(page)));
  await page.submit(forms[0]);
  await settle(page);
  assert.equal(queries[0]?.body.query, q, 'premise: the chip\'s question was sent');
  const bubbles = surfaceParts(page, BUBBLE);
  assert.equal(bubbles.length, 1, `data-part="${BUBBLE}" after a chip's send: ${bubbles.length}`);
  assert.equal(textOf(bubbles[0]), q, 'the bubble does not read the chip\'s question');
});

test('leg H criterion 1 (D2 = yes), /ask Standard: after the demoted comparison\'s re-run, and after "Continue this analysis", the bubble still reads the reader\'s question', async () => {
  const page = await mountFor(MOUNTS[1]);
  const q = 'Q-continue: how many 311 complaints were there in Brooklyn in 2024?';
  await askFromBox(page, q);
  await finishComparison(page, { token_limit_exceeded: true });
  await page.click(page.button('Continue this analysis'));
  await settle(page);
  assert.equal(queries.length, 2, 'premise: Continue sent a second request');
  assert.notEqual(queries[1].body.query, q, 'premise: Continue sends a built prompt, not the question');
  let bubbles = surfaceParts(page, BUBBLE);
  assert.equal(bubbles.length, 1, `data-part="${BUBBLE}" after "Continue this analysis": ${bubbles.length}`);
  assert.equal(textOf(bubbles[0]), q, 'after "Continue this analysis" the bubble does not read the reader\'s question (D2 = yes)');
  await finishComparison(page);
  const run = page.elements().filter((el) => el.type === 'button' && textOf(el).includes('Run the side-by-side comparison'));
  assert.equal(run.length, 1, `premise: one control that runs the comparison, found ${run.length}`);
  await page.click(run[0]);
  await settle(page);
  assert.equal(queries.length, 3, 'premise: the comparison was run');
  bubbles = surfaceParts(page, BUBBLE);
  assert.equal(bubbles.length, 1, `data-part="${BUBBLE}" after the comparison's re-run: ${bubbles.length}`);
  assert.equal(textOf(bubbles[0]), q, 'after the comparison\'s re-run the bubble does not read the reader\'s question');
});

// --- Criterion 2: the framing gives way ----------------------------------------------------------------------------

test('leg H criterion 2, GUARD (green on the base by design), the home page: before a send the framing renders as it does today: the h1, not hidden, and the subtitle', async () => {
  const page = await mountFor(MOUNTS[0]);
  const h1 = pageHeading(page);
  assert.equal(textOf(h1), 'Explore Open Data with AI', 'the home page\'s h1');
  assert.ok(!classesOf(h1).includes(HIDDEN_CLASS), 'the h1 is hidden before a send');
  assert.ok(page.text().includes(HOME_SUBTITLE), 'the subtitle is gone before a send');
});

for (const m of [MOUNTS[0], MOUNTS[2]]) {
  test(`leg H criterion 2, ${m.name}: before a send the h1 shows with its framing; from the first send, mid-stream and after the answer, the framing's visible content is gone and the page keeps its one h1, carrying ${HIDDEN_CLASS}`, async () => {
    const page = await mountFor(m);
    const title = m.mount === 'home' ? 'Explore Open Data with AI' : 'Ask a question';
    const framing = m.mount === 'home' ? HOME_SUBTITLE : ASK_LEDE;
    assert.equal(textOf(pageHeading(page)), title, `before a send: the page's h1`);
    assert.ok(!classesOf(pageHeading(page)).includes(HIDDEN_CLASS), 'before a send: the h1 is hidden');
    assert.ok(page.text().includes(framing), 'before a send: the framing is not shown');
    await askFromBox(page, 'Q-framing: what was the median household income in the Bronx?');
    for (const state of ['mid-stream', 'after the answer'] as const) {
      if (state === 'mid-stream') await midStream(page, m.mode); else await finishRun(page, m.mode);
      const h1 = pageHeading(page);
      assert.equal(textOf(h1), title, `${state}: the page's h1`);
      assert.ok(classesOf(h1).includes(HIDDEN_CLASS), `${state}: the h1 does not carry ${HIDDEN_CLASS}: [${classesOf(h1).join(' ')}]`);
      assert.ok(!page.text().includes(framing), `${state}: the framing still shows after the send`);
    }
  });
}

test(`leg H criterion 2: globals.css carries the visually-hidden rule for .${HIDDEN_CLASS} (clipped to a 1 x 1 px box, out of the flow)`, () => {
  const rules = cssRules(`.${HIDDEN_CLASS}`);
  assert.equal(rules.length, 1, `rules for .${HIDDEN_CLASS} in globals.css: ${rules.length}`);
  const body = rules[0];
  for (const [what, re] of [
    ['position: absolute', /position\s*:\s*absolute/],
    ['width: 1px', /(^|;)\s*width\s*:\s*1px/],
    ['height: 1px', /(^|;)\s*height\s*:\s*1px/],
    ['overflow: hidden', /overflow\s*:\s*hidden/],
    ['a clip', /clip(-path)?\s*:/],
    ['white-space: nowrap', /white-space\s*:\s*nowrap/],
  ] as const) assert.match(body, re, `.${HIDDEN_CLASS} has no ${what}: ${body}`);
});

/** The `<QuerySurface>` elements of a page's source, read with the TypeScript compiler's parser. */
function surfaceElementsIn(rel: string): { sf: ts.SourceFile; found: ts.JsxElement[] } {
  const file = path.join(SRC, rel);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: ts.JsxElement[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'QuerySurface') found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { sf, found };
}
const jsxTagsIn = (node: ts.Node, sf: ts.SourceFile): string[] => {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n)) out.push(n.openingElement.tagName.getText(sf));
    else if (ts.isJsxSelfClosingElement(n)) out.push(n.tagName.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
};

for (const rel of ['app/(app)/ask/page.tsx', 'app/(marketing)/page.tsx']) {
  test(`leg H criterion 2, a source read of ${rel}: the page hands its h1 to the surface (QuerySurface's heading), apart from the rest of its framing`, () => {
    const { sf, found } = surfaceElementsIn(rel);
    assert.ok(found.length >= 1, `premise: ${rel} mounts <QuerySurface>`);
    for (const el of found) {
      const heading = el.openingElement.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'heading') as ts.JsxAttribute | undefined;
      assert.ok(heading?.initializer, `${rel}: <QuerySurface> is not handed its h1 (no heading prop)`);
      assert.ok(jsxTagsIn(heading!.initializer!, sf).includes('h1'), `${rel}: QuerySurface's heading prop holds no <h1>`);
      const inChildren = el.children.flatMap((c) => jsxTagsIn(c, sf));
      assert.ok(!inChildren.includes('h1'), `${rel}: an <h1> is still among QuerySurface's children (the framing)`);
    }
  });
}

/** The ruled note (D3 = A, #729 6835240316; quoted from the dock memo's file in plan v3). Subject to the research check. */
const NOTE_WORDS = 'Getting started. Ask a question below and the answer is assembled from live public data, with every query it ran shown alongside the result. When an answer is worth keeping, publish it. Publishing creates a signed analysis: a permanent record of the answer and how it was produced, which anyone can verify independently. It is listed on your dashboard.';

test('leg H criterion 2 (D3 = A), a source read of app/(app)/ask/page.tsx: the "Getting started" note reads the ruled words', () => {
  const file = path.join(SRC, 'app/(app)/ask/page.tsx');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const notes: string[] = [];
  const textIn = (n: ts.Node): string => {
    if (ts.isJsxText(n)) return n.getText(sf);
    if (ts.isJsxExpression(n)) return n.expression && ts.isStringLiteral(n.expression) ? n.expression.text : '';
    if (ts.isJsxElement(n)) return n.children.map(textIn).join('');
    return '';
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && n.children.some((c) => ts.isJsxElement(c) && c.openingElement.tagName.getText(sf) === 'strong' && textIn(c).trim() === 'Getting started.')) {
      notes.push(textIn(n).replace(/\s+/g, ' ').trim());
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  assert.equal(notes.length, 1, `premise: one "Getting started" note in ask/page.tsx, found ${notes.length}`);
  assert.equal(notes[0], NOTE_WORDS, 'the "Getting started" note does not read the ruled words (D3 = A)');
});

// --- Criterion 5: one copy -----------------------------------------------------------------------------------------

for (const m of [MOUNTS[0], MOUNTS[1]]) {
  test(`leg H criterion 5, ${m.name}: after a send, mid-stream and after the answer, the italic quote of the question is absent`, async () => {
    const page = await mountFor(m);
    const q = `Q-quote (${m.mount}): what was the median household income in the Bronx?`;
    await askFromBox(page, q);
    await midStream(page, m.mode);
    assert.equal(quotesOf(page, q).length, 0, 'mid-stream: the italic quote of the question is shown');
    await finishRun(page, m.mode);
    assert.equal(quotesOf(page, q).length, 0, 'after the answer: the italic quote of the question is shown');
  });

  test(`leg H criterion 5, ${m.name}: the box is empty mid-stream after the first send`, async () => {
    const page = await mountFor(m);
    await askFromBox(page, `Q-box (${m.mount}): what was the median household income in the Bronx?`);
    await midStream(page, m.mode);
    assert.equal(String(boxOf(page).props.value ?? ''), '', `mid-stream after the first send, the box still holds the sent words: "${String(boxOf(page).props.value ?? '')}"`);
  });
}

test('leg H criterion 5, GUARD (green on the base by design), the home page: after a later send, made from the docked box, the box is empty mid-stream', async () => {
  const page = await mountFor(MOUNTS[0]);
  await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
  await finishComparison(page);
  assert.equal(isDocked(page), true, 'premise: docked after the first answer');
  await askFromBox(page, 'Q-second: and in Brooklyn?');
  assert.equal(queries.length, 2, 'premise: the second question was sent');
  assert.equal(String(boxOf(page).props.value ?? ''), '', 'mid-stream after a docked send, the box holds the sent words');
});

test('leg H criterion 5, GUARD (green on the base by design), /explore\'s mount: LiveResponsePanel keeps the italic quote (the shared renderer\'s default)', async () => {
  ANON();
  answers();
  const q = 'Q-explore: how many building permits were issued in Queens?';
  const page = await mountPage(h(LiveResponsePanel, {
    content: 'A fixture answer.', elapsedMs: 1200, iterationCount: 1, isComplete: true, isRunning: false,
    progressLog: [], progressGroups: [], toolsCalled: [], queryText: q,
  }));
  assert.equal(quotesOf(page, q).length, 1, '/explore\'s italic quote of the question is gone');
});

// --- Criterion 6: dock at send --------------------------------------------------------------------------------------

for (const m of [MOUNTS[0], MOUNTS[2]]) {
  test(`leg H criterion 6, ${m.name}: from a send that starts a run, mid-stream, no chip row is rendered`, async () => {
    const page = await mountFor(m);
    assert.equal(surfaceParts(page, 'chip-row').length, 1, 'premise: the chip row before a question');
    await askFromBox(page, 'Q-chips: what was the median household income in the Bronx?');
    await midStream(page, m.mode);
    assert.equal(surfaceParts(page, 'chip-row').length, 0, 'mid-stream, the chip row is still rendered');
  });

  test(`leg H criterion 6, GUARD (green on the base by design: any run disables them, QuerySurface.tsx:216-218), ${m.name}: the box and its arrow are disabled during the first run`, async () => {
    const page = await mountFor(m);
    await askFromBox(page, 'Q-disabled: what was the median household income in the Bronx?');
    await midStream(page, m.mode);
    const arrow = within(composerOf(page)).filter((el) => el.type === 'button' && el.props.type === 'submit');
    assert.equal(arrow.length, 1, 'premise: one arrow');
    assert.equal(boxOf(page).props.disabled, true, 'the box is not disabled during the run');
    assert.equal(arrow[0].props.disabled, true, 'the arrow is not disabled during the run');
  });
}

test('leg H criterion 6, GUARD (green on the base by design), the home page: a send the consent guard holds starts no run and does not dock; the box keeps the question, the card under it', async () => {
  ANON();
  answers();
  const page = await mountPage(HOME());
  const q = 'Q-held: how many permits were issued in Queens?';
  await askFromBox(page, q);
  assert.equal(queries.length, 0, 'premise: the guard sent nothing');
  assert.equal(surfaceParts(page, 'consent-card').length, 1, 'premise: the card is open');
  assert.equal(isDocked(page), false, 'a send the guard holds docked the composer');
  assert.equal(String(boxOf(page).props.value ?? ''), q, 'the box lost the question the guard holds');
  assert.equal(surfaceParts(page, BUBBLE).length, 0, 'a bubble for a question the guard holds');
});
