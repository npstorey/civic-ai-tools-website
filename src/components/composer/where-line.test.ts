// UX-2 P3b-1 (#729), criterion 3: the where-line under the box (D5 B; the words gate's rulings W3-W6; addenda 1-3).
//
// THE RULE. One line, `data-part="where-this-question-goes"`, before and after a first consent: before one it counts the
// reader's pending states (what Allow writes), after one the stored states, read with the guard's own lookup. N counts
// the sources On. Its five forms (addendum 1, section 1) end " · Select sources", a next/link to /settings. One
// predicate, `noSourceOnReason` beside `guardQuestion`, decides for the line and the guard: every source Off reads
// W5/W6's words; no source On with one Ask first where the site cannot ask (routing all-sources, or no store) showed
// no line (addendum 2) until UX-2 P3b-2, which reads CA-1a there (C1 = A; v2 ruling 2, below); anything else, a
// routing or store still unread included, the usual form. Nothing renders until
// the statement and the status are both read (`status !== null && statement !== null`, not `loaded`), nor for a
// statement that lists no source. `JUST_IN_TIME_LINE` is retired.
//
// WHAT IS DRIVEN. The home page signed out (Standard) and /ask signed in (Sandbox) on the surface harness, with the
// REAL flows and consent routes; the decision route's GET is the fixture's (`net.routing`); pending states are set
// through the store's own `setSourceState`, as the Settings overlay sets them before a consent. Every fixture gives a
// state to every source the statement lists, read from the statement.
//
// WHAT MAKES IT ABLE TO FAIL. At `b1d8bfd` no line renders before a consent, and after one the line is "This question
// goes to … Change sources", naming sources. The mixed fixture (one On, one Ask first, the rest Off) differs from a
// line that counted Ask first as On or named the sources; the one-Ask-first fixture differs from a line that tested
// "no source On" in place of "every source Off"; the failing reads differ from a line gated on `loaded`. The predicate
// is a typed stub at the red (it answers null).
//
// BLIND SPOTS, stated. The line's styling and wrap are criterion 9's (LN). The scans read tracked files only.
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType, ReactElement } from 'react';
import {
  CONSENT_SURFACE_STUBS,
  NEXT_LINK_STUB,
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
import { within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  // next/link, marked, so a read can tell a client-side link from a plain <a>.
  'next/link': NEXT_LINK_STUB.replace('...rest }, children)', "...rest, 'data-w3-next-link': 'true' }, children)"),
  // signIn, recorded, so a read can tell which control starts a sign-in in place, and with which provider.
  'next-auth/react': CONSENT_SURFACE_STUBS['next-auth/react'].replace('export async function signIn() {}', 'export async function signIn(id) { (globalThis.__p3b1SignIns ??= []).push(id ?? null); }'),
  // /explore's BPMN canvas: a browser-only library and a stylesheet import.
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';
const ROOT = path.resolve(SRC, '..');
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
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const consentStore = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

const statement = await buildFlowsStatement();
/** The sources the statement lists, read from it, never from a fixed list (the seat's fix 4). */
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

// --- The answers ---------------------------------------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (events: Json[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

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

/** What each fixture sets: the decision route's answer, the count's answers in order, and the reads it makes fail. */
const net = {
  routing: { routing: 'in-loop', store: true } as Json,
  rate: [] as Array<() => Response>,
  rateCalls: 0,
  flowsFails: false,
  flowsSources: null as null | unknown[],
  consentGetFails: false,
  /** A query route waits on this before it asks the real gate (a refusal held until the test lets it go). */
  hold: null as Promise<void> | null,
};
let queries: Array<{ path: string; body: Json }> = [];
let nextAnswers: Array<(routePath: string, body: Json) => Response> = [];

function queryRoute(routePath: string) {
  return async (request: Request): Promise<Response> => {
    const body = JSON.parse(await request.clone().text() || '{}') as Json;
    queries.push({ path: routePath, body });
    if (net.hold) await net.hold;
    const override = nextAnswers.shift();
    if (override) return override(routePath, body);
    const decision = await consentInForce(request, sessions.server);
    if (!decision.ok) {
      if (routePath === '/api/compare-stream') {
        const panels = body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
        return sse(panels.map((panel) => ({ type: 'error', panel, message: decision.payload.error, code: decision.payload.code, flowsVersion: decision.payload.flowsVersion, reask: decision.payload.reask })));
      }
      return json(decision.payload, 403);
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
  net.rateCalls = 0;
  return installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }),
    '/api/flows': async () => {
      if (net.flowsFails) return json({ error: 'unavailable' }, 503);
      if (net.flowsSources) return json({ ...statement, sources: net.flowsSources });
      return flowsRoute.GET();
    },
    '/api/sources/consent/decision': async (request: Request) => {
      if (request.method === 'GET') return json(net.routing);
      const body = JSON.parse(await request.text()) as Json;
      return json({ decision: body.decision, sourceId: 'boston-opencontext' });
    },
    '/api/sources/consent': (request: Request) =>
      request.method === 'GET' && net.consentGetFails ? json({ error: 'unavailable' }, 503) : (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => {
      const i = net.rateCalls++;
      const answer = net.rate[Math.min(i, net.rate.length - 1)];
      return answer ? answer() : json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: sessions.server !== null });
    },
    '/api/compare-stream': queryRoute('/api/compare-stream'),
    '/api/query-notebook': queryRoute('/api/query-notebook'),
  });
}

/** Every state given, for every source the statement lists. */
const allStates = (state: string): Record<string, string> => Object.fromEntries(IDS.map((id) => [id, state]));
/** One source at each state the fixture names, in statement order; the rest at `rest`. */
const statesOf = (first: string[], rest: string): Record<string, string> => Object.fromEntries(IDS.map((id, i) => [id, first[i] ?? rest]));

/** A consent in force, written through the real consent route (a cookie signed out, a row signed in). */
async function consentWith(states: Record<string, string>): Promise<void> {
  const written = await fetch('/api/sources/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ states, flowsVersion: statementHash(statement) }),
  });
  assert.equal(written.status, 200, 'premise: the consent was written');
}

/** Before a first consent: the reader's pending states, set as the overlay sets them (kept on the page, not written). */
async function pendingWith(page: Surface, states: Record<string, string>): Promise<void> {
  for (const [id, state] of Object.entries(states)) await consentStore.setSourceState(id, state);
  await settle(page);
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
  net.routing = { routing: 'in-loop', store: true };
  net.rate = [];
  net.flowsFails = false;
  net.flowsSources = null;
  net.consentGetFails = false;
  net.hold = null;
  (globalThis as { __p3b1SignIns?: unknown[] }).__p3b1SignIns = [];
});
afterEach(() => {
  for (const s of streams) s.close();
  for (const p of mounted.splice(0)) p.unmount();
  consentStore.cancelConsentPauses();
});

const HOME = () => h(Home);
const ASK = (defaultMode: 'notebook' | 'standard' = 'notebook') => h(QuerySurface, { presentation: 'answer-first', defaultMode });
const EXPLORE = () => h(McpFlowDiagram);

const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};

async function mountPage(element: ReactElement): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  await settle(p);
  return p;
}

// --- Reading the page ----------------------------------------------------------------------------------------------

const BOX_LABEL = 'Ask a question about open data';
const part = (el: HostElement): unknown => el.props['data-part'];
const parts = (surface: Surface, name: string): HostElement[] => surface.elements().filter((el) => part(el) === name);

function composerOf(surface: Surface): HostElement {
  const found = parts(surface, 'composer');
  assert.equal(found.length, 1, `expected one data-part="composer", found ${found.length}; the page reads: ${surface.text().slice(0, 300)}`);
  return found[0];
}
const isDocked = (surface: Surface): boolean => String(composerOf(surface).props.className ?? '').split(/\s+/).includes('composer--docked');
function boxOf(surface: Surface): HostElement {
  const found = surface.elements().filter((el) => el.type === 'textarea' && el.props['aria-label'] === BOX_LABEL);
  assert.equal(found.length, 1, `expected one question box labelled "${BOX_LABEL}", found ${found.length}`);
  return found[0];
}
function arrowOf(surface: Surface): HostElement {
  const found = within(composerOf(surface)).filter((el) => el.type === 'button' && el.props.type === 'submit');
  assert.equal(found.length, 1, `expected one submit control in the composer, found ${found.length}`);
  return found[0];
}
const formOf = (surface: Surface): HostElement => {
  const forms = surface.elements().filter((el) => el.type === 'form' && within(el).includes(boxOf(surface)));
  assert.equal(forms.length, 1, `expected one form holding the question box, found ${forms.length}`);
  return forms[0];
};
const valueOf = (surface: Surface): string => String(boxOf(surface).props.value ?? '');

/** Type a question into the box and submit the one form that holds it. */
async function askFromBox(surface: Surface, question: string): Promise<void> {
  await surface.type(boxOf(surface), question);
  await surface.submit(formOf(surface));
  await settle(surface);
}

const ANSWER = { content: 'A fixture answer.', duration_ms: 1, tools_called: [] };

/** Finish the latest comparison run: each panel the request asked for completes with an answer. */
async function finishComparison(surface: Surface): Promise<void> {
  const stream = streams[streams.length - 1];
  assert.ok(stream, 'premise: the page sent a question to a query route');
  const last = queries[queries.length - 1];
  const panels = last.body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
  for (const panel of panels) stream.push({ type: 'complete', panel, data: ANSWER });
  stream.close();
  await settle(surface);
}

const NOTEBOOK = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { extensions: { 'org.civicaitools.execution': { executedAt: '2026-11-11T12:00:00Z', executionDuration_ms: 1000, sandboxId: 'fixture-sandbox-p3b1', environment: { python: '3.13', libraries: {} } }, 'org.civicaitools.notebook': { provenance: 'executed' } } },
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
  stream.push({ type: 'phase', name: 'C', message: 'Executing in sandbox…' });
  stream.push({ type: 'notebook', notebook: NOTEBOOK, sandboxId: 'fixture-sandbox-p3b1', executionDuration_ms: 1000, validation: { ok: true, issues: [] } });
  stream.push({ type: 'phase', name: 'complete', message: 'Done.' });
  stream.close();
  await settle(surface);
}

const finishRun = (surface: Surface, mode: 'notebook' | 'standard') => (mode === 'notebook' ? finishNotebook(surface) : finishComparison(surface));

/** A deferred: `promise` resolves when `release` is called. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** Tracked files under src/ (tests included unless `skipTests`), as `git ls-files` lists them, this file excepted. */
function trackedSrc(self: string, skipTests: boolean): string[] {
  return execFileSync('git', ['ls-files', '--', 'src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f) && f !== self && !(skipTests && /\.test\.(ts|tsx|mjs)$/.test(f)));
}

// The fixture block above is shared, whole, by the four P3b-1 re-cut test files; each uses part of it.
void [test, textOf, fs, execFileSync, consentWith, askFromBox, finishComparison, finishNotebook, deferred, pendingWith, arrowOf, statesOf, allStates, SIGNED_IN, ANON, isDocked, valueOf, finishRun, EXPLORE, HOME, ASK, formOf, boxOf, trackedSrc, sse, parts];

const SELF = 'src/components/composer/where-line.test.ts';
const LEAD = 'Where your question goes: ';
const LINK = ' · Select sources';
const n = (count: number) => (count === 1 ? '1 data source' : `${count} data sources`);
const FORM = {
  standardOn: (count: number) => `${LEAD}the model service and ${n(count)}${LINK}`,
  sandboxOn: (count: number) => `${LEAD}the model service, the notebook runner and ${n(count)}${LINK}`,
  standardAsk: `${LEAD}the model service; data sources ask first${LINK}`,
  sandboxAsk: `${LEAD}the model service and the notebook runner; data sources ask first${LINK}`,
  everyOff: `${LEAD}nowhere; every data source is Off${LINK}`,
  /** UX-2 P3b-2, CA-1a (C1 = A; v2 ruling 2): no source On where this site cannot ask, in both session types. */
  cannotAsk: `${LEAD}nowhere; no data source is On${LINK}`,
};

const lineOf = (page: Surface): string[] => parts(page, 'where-this-question-goes').map((el) => textOf(el));

/** The page for a session type: Standard on the home page signed out, Sandbox on /ask signed in. */
async function pageFor(session: 'Standard' | 'Sandbox'): Promise<Surface> {
  return mountPage(session === 'Standard' ? HOME() : ASK('notebook'));
}
function signFor(session: 'Standard' | 'Sandbox'): void {
  if (session === 'Standard') ANON(); else SIGNED_IN();
}

/** The line for `states`, before a first consent (pending) or after it (stored). */
async function lineFor(session: 'Standard' | 'Sandbox', when: 'before' | 'after', states: Record<string, string>): Promise<string[]> {
  signFor(session);
  answers();
  if (when === 'after') await consentWith(states);
  const page = await pageFor(session);
  if (when === 'before') await pendingWith(page, states);
  return lineOf(page);
}

test('premise: the statement lists at least three sources, and every fixture below gives each of them a state', () => {
  assert.ok(IDS.length >= 3, `the statement lists ${IDS.length} sources: ${IDS.join(', ')}`);
});

// --- Criterion 3: each ruled form, before and after a first consent (addendum 1, section 1) --------------------------

const MIX = statesOf(['on', 'ask-first', 'off'], 'off');
const ALL_ON = allStates('on');
const ASK_FIRST = statesOf(['ask-first'], 'off');
const ALL_OFF = allStates('off');

for (const when of ['before', 'after'] as const) {
  const label = when === 'before' ? 'before a first consent (pending states)' : 'after a first consent (stored states)';
  for (const [session, states, expected, what] of [
    ['Standard', MIX, FORM.standardOn(1), 'one On, one Ask first, the rest Off: N = 1 (the fixture that can fail: Ask first counted as On, or names, would differ)'],
    ['Standard', ALL_ON, FORM.standardOn(IDS.length), 'every source On'],
    ['Sandbox', MIX, FORM.sandboxOn(1), 'one On, one Ask first, the rest Off (W3)'],
    ['Sandbox', ALL_ON, FORM.sandboxOn(IDS.length), 'every source On (W3)'],
    ['Standard', ASK_FIRST, FORM.standardAsk, 'no source On, one Ask first (items 23/47)'],
    ['Sandbox', ASK_FIRST, FORM.sandboxAsk, 'no source On, one Ask first (W4)'],
    ['Standard', ALL_OFF, FORM.everyOff, 'every source Off (W5)'],
    ['Sandbox', ALL_OFF, FORM.everyOff, 'every source Off (W6)'],
  ] as const) {
    test(`P3b-1 criterion 3, ${session}, ${label}: ${what}`, async () => {
      assert.deepEqual(await lineFor(session, when, states), [expected]);
    });
  }
}

test('P3b-1 criterion 3: "Select sources" is a next/link to /settings with no click handler of its own', async () => {
  ANON();
  answers();
  const page = await mountPage(HOME());
  await pendingWith(page, MIX);
  const line = parts(page, 'where-this-question-goes');
  assert.equal(line.length, 1, `where-lines before a first consent: ${line.length}`);
  const links = within(line[0]).filter((el) => el.type === 'a');
  assert.deepEqual(links.map((el) => [textOf(el), el.props.href, el.props['data-w3-next-link'] ?? 'plain <a>', typeof el.props.onClick]), [['Select sources', '/settings', 'true', 'undefined']]);
});

for (const session of ['Standard', 'Sandbox'] as const) {
  test(`P3b-1 criterion 3, ${session}: no surface says "Change sources" or "This question goes to"`, async () => {
    signFor(session);
    answers();
    await consentWith(MIX);
    const page = await pageFor(session);
    assert.equal(lineOf(page).length, 1, 'premise: the where-line is shown');
    assert.ok(!page.text().includes('Change sources'), 'the page says "Change sources"');
    assert.ok(!page.text().includes('This question goes to'), 'the page says "This question goes to"');
  });
}

test('P3b-1 criterion 3 (S15): src/lib/sources/copy.ts does not export JUST_IN_TIME_LINE, and no tracked file under src/ names it (this file excepted)', async () => {
  const copy = await load('lib/sources/copy.ts');
  assert.equal('JUST_IN_TIME_LINE' in copy, false, 'src/lib/sources/copy.ts still exports JUST_IN_TIME_LINE');
  const naming = trackedSrc(SELF, false).filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('JUST_IN_TIME_LINE'));
  assert.deepEqual(naming, [], `files naming JUST_IN_TIME_LINE: ${naming.join(', ')}`);
});

// --- Criterion 3: nothing until the statement and the states are both read (the seat's fix 3; addendum 3, 3.4) -------

for (const [failing, set] of [['the flows statement', () => { net.flowsFails = true; }], ['the consent status', () => { net.consentGetFails = true; }]] as const) {
  for (const session of ['Standard', 'Sandbox'] as const) {
    test(`P3b-1 criterion 3, ${session}: with ${failing} answering non-OK (503), no where-line renders, and no form is printed from the data that did arrive`, async () => {
      signFor(session);
      answers();
      set();
      const page = await pageFor(session);
      assert.equal(parts(page, 'where-this-question-goes').length, 0, `a where-line rendered: ${JSON.stringify(lineOf(page))}`);
      assert.ok(!page.text().includes(LEAD), 'the page says "Where your question goes"');
      // The converse, so the fixture can fail: the same page with both reads answered shows the line.
      net.flowsFails = false;
      net.consentGetFails = false;
      await consentStore.refreshConsent();
      await settle(page);
      assert.equal(parts(page, 'where-this-question-goes').length, 1, 'with both reads answered and no consent in force, no where-line is shown (it shows before a first consent)');
    });
  }
}

test('P3b-1 criterion 3 (addendum 3, 3.8): a statement that lists no source renders no where-line', async () => {
  ANON();
  answers();
  net.flowsSources = [];
  const page = await mountPage(HOME());
  assert.equal(parts(page, 'where-this-question-goes').length, 0, `a where-line with no source listed: ${JSON.stringify(lineOf(page))}`);
});

// --- Criterion 3 (a), (c), (d): one predicate for the line and the guard (addenda 1-3) ------------------------------

const ASK_LOOP = { routing: 'in-loop', store: true };
type Reason = (ids: readonly string[], stateOf: (id: string) => string | undefined, ask: { routing: string | null; store: boolean | null }) => string | null;
const noSourceOnReason = consentStore.noSourceOnReason as Reason;

test('P3b-1 criterion 3 (a), (d): noSourceOnReason gives every-off, cannot-ask or nothing, as the guard decides (useSourceConsent.ts:463-464)', () => {
  const ids = ['a', 'b', 'c'];
  const of = (states: Record<string, string>) => (id: string) => states[id];
  const rows: Array<[string, Record<string, string>, { routing: string | null; store: boolean | null }, string | null]> = [
    ['every source Off, in loop', { a: 'off', b: 'off', c: 'off' }, ASK_LOOP, 'every-off'],
    ['every source Off, all sources', { a: 'off', b: 'off', c: 'off' }, { routing: 'all-sources', store: true }, 'every-off'],
    ['one Ask first, the rest Off, all sources', { a: 'ask-first', b: 'off', c: 'off' }, { routing: 'all-sources', store: true }, 'cannot-ask'],
    ['one Ask first, the rest Off, no store', { a: 'ask-first', b: 'off', c: 'off' }, { routing: 'in-loop', store: false }, 'cannot-ask'],
    ['no state stored for any source, all sources', {}, { routing: 'all-sources', store: true }, 'cannot-ask'],
    ['one Ask first, the rest Off, in loop with the store', { a: 'ask-first', b: 'off', c: 'off' }, ASK_LOOP, null],
    ['one Ask first, the rest Off, routing and store unread', { a: 'ask-first', b: 'off', c: 'off' }, { routing: null, store: null }, null],
    ['one source On', { a: 'on', b: 'off', c: 'off' }, { routing: 'all-sources', store: false }, null],
    ['no source listed', {}, { routing: 'all-sources', store: false }, null],
  ];
  const read = rows.map(([what, states, ask]) => [what, noSourceOnReason(what === 'no source listed' ? [] : ids, of(states), ask)]);
  assert.deepEqual(read, rows.map(([what, , , want]) => [what, want]));
});

test('P3b-1 criterion 3 (a), (d): one predicate, read by both — the guard calls noSourceOnReason in place of its own two tests, and the line\'s mount calls it too (a source scan)', () => {
  const consent = fs.readFileSync(path.join(ROOT, 'src/components/sources/useSourceConsent.ts'), 'utf8');
  const guard = consent.slice(consent.indexOf('export async function guardQuestion'), consent.indexOf('/** The snapshot, kept current'));
  assert.ok(guard.length > 0, 'premise: guardQuestion is found');
  assert.match(guard, /noSourceOnReason\(/, 'guardQuestion does not call noSourceOnReason');
  assert.doesNotMatch(guard, /\.every\(\(id\) => status\.states\?\.\[id\]\?\.state === 'off'\)/, 'guardQuestion keeps its own every-Off test');
  const callers = trackedSrc(SELF, true).filter((f) => f !== 'src/components/sources/useSourceConsent.ts' && /noSourceOnReason\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.ok(callers.length >= 1, 'no component that renders the where-line calls noSourceOnReason');
});

for (const session of ['Standard', 'Sandbox'] as const) {
  for (const when of ['before', 'after'] as const) {
    test(`P3b-2 criterion 4 (P3b-1's (d) flipped for CA-1a; v2 ruling 2), ${session}, ${when} a first consent: one Ask first and the rest Off: CA-1a's line where the site cannot ask (all sources; no store), the Ask-first form where it can`, async () => {
      const ask = session === 'Standard' ? FORM.standardAsk : FORM.sandboxAsk;
      const read: Record<string, string[]> = {};
      for (const [name, routing] of [['all-sources', { routing: 'all-sources', store: true }], ['in-loop, store', ASK_LOOP], ['in-loop, no store', { routing: 'in-loop', store: false }]] as const) {
        signFor(session);
        answers();
        net.routing = routing;
        if (when === 'after') await consentWith(ASK_FIRST);
        const page = await pageFor(session);
        if (when === 'before') await pendingWith(page, ASK_FIRST);
        read[name] = lineOf(page);
        for (const p of mounted.splice(0)) p.unmount();
      }
      assert.deepEqual(read, { 'all-sources': [FORM.cannotAsk], 'in-loop, store': [ask], 'in-loop, no store': [FORM.cannotAsk] });
    });
  }
}

test('P3b-1 criterion 3 (c): the retired every-Off form, "the model service and no data source", is in no tracked file under src/ outside the tests', () => {
  const naming = trackedSrc(SELF, true).filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('the model service and no data source'));
  assert.deepEqual(naming, []);
});
