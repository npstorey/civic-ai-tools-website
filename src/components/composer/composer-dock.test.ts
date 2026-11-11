// UX-2 P3b-1 (#729), criteria 1 and 4 (the composer's half): the composer docked below a finished answer.
//
// THE RULE (P3b contract v3, Part 1, 1A; the seat's rulings on leg A's stop, `p3b-1-legA-rulings.md`).
// - The composer (`data-part="composer"`) docks once a run has finished with an answer: it carries
//   `composer--docked`, sits after the results in the page, and its placeholder reads X23. A refused first send
//   (the route answers `consent_required`) finishes with no answer, so it does not dock; nor does a first run
//   still under way (its pause prompt stays below the box, as `consent-pause-in-view.test.ts` reads it). Once
//   docked, the composer stays docked for the life of the surface.
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
// - The results block still opens with its heading, then the pause prompt (`QuerySurface.tsx:233`, `:235`):
//   P3b-1 does not move it.
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
// the shapes a `queryCount > 0` dock, or a line counted in component state, would fail.
//
// BLIND SPOTS, stated. No layout: "below the answer" is read as document order and the stylesheet's rule, not a
// box; criterion 5's instrument measures the box. No focus. The harness's unmount can leave bus subscriptions
// (#670), so each test mints its own pause keys.
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

test('criterion 1, the home page signed out: undocked before the first answer; after the run finishes the composer is docked below the results, reads "Ask another question", and shows the signed-out first-time line once, one paragraph, its first sentence only', async () => {
  ANON();
  answers();
  await consentWith();
  const page = await mountPage(HOME());
  assert.equal(isDocked(page), false, 'docked before any question');
  assert.notEqual(boxOf(page).props.placeholder, X23, 'the undocked box already reads X23');
  assert.equal(firstTimeLines(page).length, 0, 'a first-time line before the first answer');

  await askFromBox(page, 'What was the median household income in the Bronx?');
  assert.equal(isDocked(page), false, 'docked while the first run is still under way');
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

test('criterion 1, the dock condition: a first send the route refuses (consent_required) does not dock; after Allow the question runs, and its answer docks the composer and shows the first-time line', async () => {
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
    await askFromBox(page, 'What was the median household income in the Bronx?');
    assert.deepEqual(queries.map((q) => q.path), ['/api/compare-stream'], 'premise: the question reached the route');
    assert.equal(streams.length, 0, 'premise: the route refused it');
    assert.equal(page.buttons('Allow').length, 1, 'premise: the refusal shows the consent card');
    assert.equal(isDocked(page), false, 'a refused first send docked the composer');
    assert.equal(firstTimeLines(page).length, 0, 'a refused first send shows the first-time line');

    await page.click(page.button('Allow'));
    await settle(page);
    assert.equal(streams.length, 1, `premise: after Allow the question was sent again and served (${net.sent.length} requests)`);
    await finishComparison(page);
    assert.equal(isDocked(page), true, 'the answer after Allow did not dock the composer');
    assert.equal(firstTimeLines(page).length, 1, 'the refused send was counted as a question: no first-time line after the first answer');
  } finally {
    globalThis.fetch = real;
  }
});

// --- Criterion 1: /ask, signed in ------------------------------------------------------------------------------

test('criterion 1, /ask signed in (an executed run): after the run finishes the composer is docked, reads "Ask another question", shows the signed-in first-time line once, and keeps the gear ("Advanced options") beneath, in the ruled order', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(ASK('notebook'));
  assert.equal(isDocked(page), false, 'docked before any question');
  await askFromBox(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.deepEqual(queries.map((q) => q.path), ['/api/query-notebook'], 'premise: /ask ran the question in the sandbox');
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

// --- The dock condition (relay 57): a first run that ends in an error does not dock ----------------------------------

test('the dock condition (relay 57), the home page: a first run the route answers with an error does not dock and shows no first-time line; the next answered run docks', async () => {
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
  assert.equal(isDocked(page), false, 'a first run that ended in an error docked the composer');
  assert.equal(firstTimeLines(page).length, 0, 'a first run that ended in an error shows the first-time line');

  // Each panel errors in the stream (a model failure): complete, with no answer.
  nextAnswers.push((_path, body) => sse((body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp']).map((panel) => ({ type: 'error', panel, message: 'The model could not answer.', code: 'generic' }))));
  await askFromBox(page, 'And in Brooklyn?');
  assert.equal(queries.length, 2, 'premise: the second question reached the route');
  assert.equal(isDocked(page), false, 'a run whose panels each ended in an error docked the composer');
  assert.equal(firstTimeLines(page).length, 0, 'a run whose panels each ended in an error shows the first-time line');

  // The converse: the next run that finishes with an answer docks it.
  await askFromBox(page, 'And in Queens?');
  await finishComparison(page);
  assert.equal(isDocked(page), true, 'an answered run after the errors did not dock the composer');
  assert.equal(firstTimeLines(page).length, 1, 'the errored runs were counted as questions: no first-time line after the first answer');
});

test('the dock condition (relay 57), /ask signed in: a first executed run that ends in an error does not dock and shows no first-time line', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  nextAnswers.push(() => sse([{ type: 'error', message: 'The notebook could not finish running. Please try again.', code: 'generic' }]));
  const page = await mountPage(ASK('notebook'));
  await askFromBox(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.deepEqual(queries.map((q) => q.path), ['/api/query-notebook'], 'premise: /ask ran the question in the sandbox');
  assert.ok(resultsBlock(page, 'Answer, executed in a signed sandbox'), 'premise: the results block renders the failed run');
  assert.equal(isDocked(page), false, 'a first executed run that ended in an error docked the composer');
  assert.equal(firstTimeLines(page).length, 0, 'a first executed run that ended in an error shows the first-time line');
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

// --- Criterion 1: the results block still opens with its heading, then the pause prompt ---------------------------

const BOSTON = statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext');
let pauseRun = 0;
const nextKey = () => `9b3b${String(++pauseRun).padStart(4, '0')}0123456789abcdef01234567`;

test('criterion 1, unchanged: the results block opens with its heading, then the pause prompt (QuerySurface.tsx:233, :235), with the composer on the page', async () => {
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
  assert.deepEqual(kids.slice(0, 2).map((el) => (el.type === 'h2' ? `h2:${textOf(el)}` : String(part(el)))), ['h2:Results', 'consent-pause-prompt'], 'the results block\'s first two children');
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
