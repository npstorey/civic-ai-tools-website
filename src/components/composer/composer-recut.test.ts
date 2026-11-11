// UX-2 P3b-1 (#729), the re-cut: criteria 1, 2, 4, 6 and 7, and criterion 5's one sign-in ask in each state.
//
// THE RULE (contract v5 Part 1, 1A-1E; addendum 1; addendum 2; addendum 3, sections 1 and 3).
// - 1A: once docked, only the bar (`data-part="composer-bar"`, inside the composer) holds the box and its arrow; the
//   where-line, the first-time line and the account line follow it in the composer, outside it. The box empties at
//   the dock and once a docked send's run has started; a question the page's guard holds keeps its text. During any
//   run, docked or not, Standard or Sandbox, the box and its arrow are disabled (addendum 3, 3.1). A docked send the
//   route refuses puts the refused question back into the box if it is still empty, and "Don't allow" records the
//   refused question (addendum 3, ruling 1).
// - 1B/1C: the golden order of the composer's parts in each state; the chips before the first answer only; no
//   <details> or <summary>; on the home page signed out "sign in" once and one control that signs in, in the sign-in
//   line; on /ask none.
// - 1B.2: the first-time line is one <p>; signed out, its first sentence only (O4 = A).
// - 1D: docked, the guard's three slots sit inside the bar, before the box (O7 = A).
// - 1E: the "run it locally" footnote and its prop are gone (O6).
//
// WHAT IS DRIVEN. The home page component and /ask's surface (`QuerySurface`, answer-first), on the surface harness.
// `/api/flows` and `/api/sources/consent` are their REAL route handlers; each query route asks the REAL consent gate
// (after an optional hold the test releases) and answers its refusal in the route's own shape, or a held stream the
// test completes.
//
// WHAT MAKES IT ABLE TO FAIL. At `b1d8bfd` the whole composer is the docked element and no bar exists; the box keeps
// every question; a Sandbox run leaves the box enabled (the form reads `streaming.isLoading` only); the first-time line
// is a <details> carrying both sentences; the where-line needs a consent in force; the long sign-in sentence and the
// banner's prompt both say "sign in"; the slots follow the box; the footnote renders. The two refusal fixtures differ
// from a build that empties the box and never refills it (fixture 1's box reads '') and from one that records the
// box's text on "Don't allow" (fixture 3's arrow reads disabled).
//
// BLIND SPOTS, stated. No layout: "follows the bar" is document order; the bar's stickiness is criterion 8's rule read
// and criterion 9's instrument. The harness types into and clicks a control whatever its `disabled`, so "typed between
// the send and the refusal" is driven although a reader's box is disabled then; the fixture reads the rule, not a
// reader's path. The sign-in controls are found by the address they link or by clicking a "sign in" button and
// reading the recorded `signIn` call.
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

const SELF = 'src/components/composer/composer-recut.test.ts';
const X23 = 'Ask another question';
const X24_SIGNED_IN = 'A new question replaces this answer. To keep this answer, publish it first.';
const X24_SIGNED_OUT = 'A new question replaces this answer.';
const WITHHELD = 'To keep this answer, sign in and publish it.';
const LINES = ['where-this-question-goes', 'first-time-line', 'account-line'];

/** The composer's parts in document order: the bar, the box, the chips, the lines, the guard's slots, the gear. */
const KNOWN = ['composer-bar', 'chip-row', 'where-this-question-goes', 'first-time-line', 'consent-card', 'dont-allow', 'no-source-on', 'account-line', 'sign-in-line'];
function partOrder(surface: Surface): string[] {
  const out: string[] = [];
  for (const el of within(composerOf(surface))) {
    const p = part(el);
    if (el.type === 'textarea' && el.props['aria-label'] === BOX_LABEL) out.push('box');
    else if (typeof p === 'string' && KNOWN.includes(p)) out.push(p);
    else if (el.type === 'button' && textOf(el).includes('Advanced options')) out.push('gear');
  }
  return out;
}
/** Undocked, the bar is the shape's own business: the order is read without it. */
function assertGolden(surface: Surface, expected: string[], where: string): void {
  const read = partOrder(surface);
  const compared = expected.includes('composer-bar') ? read : read.filter((p) => p !== 'composer-bar');
  assert.deepEqual(compared, expected, `${where}: the composer's parts, in page order: ${JSON.stringify(read)}`);
}

/** Every control inside the composer that starts a sign-in: a link to a sign-in address, or a button whose click calls signIn. */
async function signInControls(surface: Surface, hrefs: string[]): Promise<HostElement[]> {
  const inside = within(composerOf(surface));
  const links = inside.filter((el) => el.type === 'a' && hrefs.includes(String(el.props.href)));
  const buttons: HostElement[] = [];
  for (const el of inside.filter((x) => x.type === 'button' && x.props.type !== 'submit' && /sign in/i.test(textOf(x)))) {
    const calls = (globalThis as unknown as { __p3b1SignIns: unknown[] }).__p3b1SignIns;
    const before = calls.length;
    await (el.props.onClick as (() => unknown) | undefined)?.();
    if (calls.length > before) buttons.push(el);
  }
  return [...links, ...buttons];
}
const signInWords = (surface: Surface): number => (textOf(composerOf(surface)).match(/sign in/gi) ?? []).length;

// --- Criterion 1 (1A): the bar, the emptying, the disabling ----------------------------------------------------------

for (const [mount, mode] of [['home', 'standard'], ['ask', 'notebook']] as const) {
  test(`P3b-1 criterion 1 (1A), ${mount === 'home' ? 'the home page' : '/ask'}: after the first answer one composer-bar inside the composer holds the box and no line; the where-line, the first-time line and the account line follow it, outside it`, async () => {
    if (mount === 'home') ANON(); else SIGNED_IN();
    answers();
    await consentWith(allStates('on'));
    const page = await mountPage(mount === 'home' ? HOME() : ASK(mode));
    await askFromBox(page, 'What was the median household income in the Bronx?');
    await finishRun(page, mode);
    assert.equal(isDocked(page), true, 'premise: the composer docked after the first answer');
    const bars = parts(page, 'composer-bar');
    assert.equal(bars.length, 1, `data-part="composer-bar" after the dock: ${bars.length}`);
    const bar = bars[0];
    assert.ok(within(composerOf(page)).includes(bar), 'the bar is not inside the composer');
    assert.ok(within(bar).includes(boxOf(page)), 'the bar does not hold the box');
    assert.ok(within(bar).includes(arrowOf(page)), 'the bar does not hold the arrow');
    const inBar = within(bar).map(part).filter((p) => typeof p === 'string' && [...LINES, 'chip-row', 'sign-in-line'].includes(p as string));
    assert.deepEqual(inBar, [], 'a line is inside the bar');
    const all = page.elements();
    for (const name of LINES) {
      const found = parts(page, name);
      assert.equal(found.length, 1, `${name}: ${found.length} after the first answer`);
      assert.ok(within(composerOf(page)).includes(found[0]), `${name} is not inside the composer`);
      assert.ok(all.indexOf(found[0]) > all.indexOf(bar) && !within(bar).includes(found[0]), `${name} is not after the bar, outside it`);
    }
  });
}

for (const [mount, mode] of [['home', 'standard'], ['ask', 'standard'], ['ask', 'notebook']] as const) {
  test(`P3b-1 criterion 1 (1A; addendum 3, 3.1-3.2), ${mount === 'home' ? 'the home page' : '/ask'} ${mode === 'notebook' ? 'Sandbox' : 'Standard'}: the box empties at the dock and once a docked send's run has started; it and its arrow are disabled during the first run and the docked run, and enabled when each ends`, async () => {
    if (mount === 'home') ANON(); else SIGNED_IN();
    answers();
    await consentWith(allStates('on'));
    const page = await mountPage(mount === 'home' ? HOME() : ASK(mode));
    const first = 'Q-first: what was the median household income in the Bronx?';
    const second = 'Q-second: and how many 311 complaints in Brooklyn?';
    await askFromBox(page, first);
    assert.equal(queries.length, 1, 'premise: the first question was sent');
    assert.equal(isDocked(page), false, 'premise: not docked during the first run');
    assert.equal(boxOf(page).props.disabled, true, 'the first, undocked box is not disabled during its run');
    assert.equal(arrowOf(page).props.disabled, true, 'the first, undocked box\'s arrow is not disabled during its run');
    await finishRun(page, mode);
    assert.equal(isDocked(page), true, 'premise: docked after the first answer');
    assert.equal(valueOf(page), '', `the box still holds the first question after the dock: "${valueOf(page)}"`);
    assert.equal(boxOf(page).props.placeholder, X23, 'the docked placeholder');
    assert.notEqual(boxOf(page).props.disabled, true, 'the docked box is disabled after the first run ended');

    await askFromBox(page, second);
    assert.equal(queries.length, 2, 'premise: the second question was sent');
    assert.equal(queries[1].body.query, second, 'premise: the second question went out as typed');
    assert.equal(valueOf(page), '', `the docked box still holds the second question once its run started: "${valueOf(page)}"`);
    assert.equal(boxOf(page).props.disabled, true, 'the docked box is not disabled during the docked run');
    assert.equal(arrowOf(page).props.disabled, true, 'the docked arrow is not disabled during the docked run');
    await finishRun(page, mode);
    assert.notEqual(boxOf(page).props.disabled, true, 'the docked box is still disabled after the docked run ended');
  });
}

test('P3b-1 criterion 1 (1A), the guard holds a docked send: with the consent withdrawn before it, the card opens and the box keeps the question; after "Don\'t allow" it still does', async () => {
  ANON();
  answers();
  await consentWith(allStates('on'));
  const page = await mountPage(HOME());
  await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
  await finishComparison(page);
  assert.equal(valueOf(page), '', 'the box still holds the first question after the dock');
  await fetch('/api/sources/consent', { method: 'DELETE' });
  await consentStore.refreshConsent();
  await settle(page);
  const held = 'Q-held: how many permits were issued in Queens?';
  await askFromBox(page, held);
  assert.equal(queries.length, 1, 'premise: the guard sent nothing');
  assert.equal(parts(page, 'consent-card').length, 1, 'premise: the card is open');
  assert.equal(valueOf(page), held, 'the box lost the question the guard holds while the card is open');
  await page.click(page.button("Don't allow"));
  await settle(page);
  assert.equal(valueOf(page), held, 'the box lost the question after "Don\'t allow"');
  assert.equal(parts(page, 'dont-allow').length, 1, 'premise: the decline line is shown');
});

/** Dock, then withdraw the consent on the server only: the page still reads it as in force, so the next send goes out and the route refuses it. */
async function dockedThenRefused(page: Surface): Promise<{ release: () => void; refused: string }> {
  await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
  await finishComparison(page);
  await fetch('/api/sources/consent', { method: 'DELETE' });
  const gate = deferred();
  net.hold = gate.promise;
  const refused = 'Q-refused: how many permits were issued in Queens?';
  await askFromBox(page, refused);
  assert.equal(queries.length, 2, 'premise: the docked send went out');
  return { release: () => { net.hold = null; gate.release(); }, refused };
}

test('P3b-1 criterion 1 (addendum 3, ruling 1, fixture 1): a docked send the route refuses: the box empties when its run starts, the refused question comes back into the empty box, and after "Don\'t allow" the box holds it and the arrow is disabled for it', async () => {
  ANON();
  answers();
  await consentWith(allStates('on'));
  const page = await mountPage(HOME());
  const { release, refused } = await dockedThenRefused(page);
  assert.equal(valueOf(page), '', `the box still holds the question once its run started: "${valueOf(page)}"`);
  release();
  await settle(page, 200);
  assert.equal(parts(page, 'consent-card').length, 1, 'premise: the route\'s refusal opened the card');
  assert.equal(valueOf(page), refused, `the refused question did not come back into the empty box: "${valueOf(page)}"`);
  await page.click(page.button("Don't allow"));
  await settle(page);
  assert.equal(valueOf(page), refused, `after "Don't allow" the box does not hold the refused question: "${valueOf(page)}"`);
  assert.equal(arrowOf(page).props.disabled, true, 'the arrow is not disabled for the refused question');
  assert.equal(parts(page, 'dont-allow').length, 1, 'the decline line is not shown for the refused question');
});

test('P3b-1 criterion 1 (addendum 3, ruling 1, fixture 3): text typed between the send and the refusal stays in the box; "Don\'t allow" still records the refused question, so the arrow is enabled for the typed text and disabled for the refused one', async () => {
  ANON();
  answers();
  await consentWith(allStates('on'));
  const page = await mountPage(HOME());
  const { release, refused } = await dockedThenRefused(page);
  assert.equal(valueOf(page), '', `the box still holds the question once its run started: "${valueOf(page)}"`);
  const typed = 'Q-typed: and in Staten Island?';
  await page.type(boxOf(page), typed);
  release();
  await settle(page, 200);
  assert.equal(parts(page, 'consent-card').length, 1, 'premise: the route\'s refusal opened the card');
  assert.equal(valueOf(page), typed, `the refusal replaced the reader's typed text: "${valueOf(page)}"`);
  await page.click(page.button("Don't allow"));
  await settle(page);
  assert.equal(valueOf(page), typed, 'the typed text left the box after "Don\'t allow"');
  assert.equal(arrowOf(page).props.disabled, false, 'the arrow is disabled for the typed text: "Don\'t allow" recorded the box\'s text, not the refused question');
  await page.type(boxOf(page), refused);
  assert.equal(arrowOf(page).props.disabled, true, 'the arrow is enabled for the refused question: "Don\'t allow" did not record it');
});

// --- Criterion 2 (1B, 1C) and criterion 5's one sign-in ask: the golden order, state by state ------------------------

test('P3b-1 criterion 2 (1B, 1C) and criterion 5, the home page signed out: the golden order in each state; the chips before the first answer only; no <details> or <summary>; "sign in" once and one control that signs in, inside the sign-in line', async () => {
  ANON();
  answers();
  const page = await mountPage(HOME());
  const states: Array<[string, string[]]> = [];
  const check = async (where: string, expected: string[]) => {
    assertGolden(page, expected, where);
    const tags = within(composerOf(page)).filter((el) => el.type === 'details' || el.type === 'summary').map((el) => el.type);
    assert.deepEqual(tags, [], `${where}: a <details> or <summary> in the composer`);
    assert.equal(signInWords(page), 1, `${where}: the composer says "sign in" ${signInWords(page)} times: ${textOf(composerOf(page))}`);
    const controls = await signInControls(page, []);
    assert.equal(controls.length, 1, `${where}: controls in the composer that sign in: ${controls.length}`);
    const line = parts(page, 'sign-in-line');
    assert.equal(line.length, 1, `${where}: data-part="sign-in-line": ${line.length}`);
    assert.ok(within(line[0]).includes(controls[0]), `${where}: the control that signs in is not inside data-part="sign-in-line"`);
    states.push([where, expected]);
  };
  await check('before a question', ['box', 'chip-row', 'where-this-question-goes', 'account-line', 'sign-in-line']);
  await page.type(boxOf(page), 'Q-first: what was the median household income in the Bronx?');
  await page.submit(formOf(page));
  await settle(page);
  assert.equal(parts(page, 'consent-card').length, 1, 'premise: the first send opened the card');
  await check('the card open on a first send', ['box', 'chip-row', 'where-this-question-goes', 'consent-card', 'account-line', 'sign-in-line']);
  await page.click(page.button('Allow'));
  await settle(page, 200);
  assert.equal(queries.length, 1, 'premise: after Allow the question was sent');
  await check('during the first run', ['box', 'chip-row', 'where-this-question-goes', 'account-line', 'sign-in-line']);
  await finishComparison(page);
  await check('docked after the first answer', ['composer-bar', 'box', 'where-this-question-goes', 'first-time-line', 'account-line', 'sign-in-line']);
  await askFromBox(page, 'Q-second: and in Brooklyn?');
  await finishComparison(page);
  await check('docked after the second answer', ['composer-bar', 'box', 'where-this-question-goes', 'account-line', 'sign-in-line']);
  assert.equal(states.length, 5);
});

test('P3b-1 criterion 2 (1B, 1C) and criterion 5, /ask signed in (Sandbox): the golden order in each state, the gear after the lines; the chips before the first answer only; no <details> or <summary>; no "sign in" and no control that signs in', async () => {
  SIGNED_IN();
  answers();
  const page = await mountPage(ASK('notebook'));
  const check = async (where: string, expected: string[]) => {
    assertGolden(page, expected, where);
    const tags = within(composerOf(page)).filter((el) => el.type === 'details' || el.type === 'summary').map((el) => el.type);
    assert.deepEqual(tags, [], `${where}: a <details> or <summary> in the composer`);
    assert.equal(signInWords(page), 0, `${where}: the composer says "sign in": ${textOf(composerOf(page))}`);
    assert.equal((await signInControls(page, [])).length, 0, `${where}: a control in the composer signs in`);
    assert.equal(parts(page, 'sign-in-line').length, 0, `${where}: a sign-in line on /ask`);
  };
  await check('before a question', ['box', 'chip-row', 'where-this-question-goes', 'gear']);
  await page.type(boxOf(page), 'Q-first: how many 311 complaints in Brooklyn in 2024?');
  await page.submit(formOf(page));
  await settle(page);
  assert.equal(parts(page, 'consent-card').length, 1, 'premise: the first send opened the card');
  await check('the card open on a first send', ['box', 'chip-row', 'where-this-question-goes', 'consent-card', 'gear']);
  await page.click(page.button('Allow'));
  await settle(page, 200);
  assert.deepEqual(queries.map((q) => q.path), ['/api/query-notebook'], 'premise: after Allow the question ran in the sandbox');
  await check('during the first run', ['box', 'chip-row', 'where-this-question-goes', 'account-line', 'gear']);
  await finishNotebook(page);
  await check('docked after the first answer', ['composer-bar', 'box', 'where-this-question-goes', 'first-time-line', 'account-line', 'gear']);
  await askFromBox(page, 'Q-second: and in Queens?');
  await finishNotebook(page);
  await check('docked after the second answer', ['composer-bar', 'box', 'where-this-question-goes', 'account-line', 'gear']);
});

// --- Criterion 4 (1B.2): the first-time line ------------------------------------------------------------------------

for (const [who, mountName, mode, expected] of [
  ['/ask signed in', 'ask', 'notebook', X24_SIGNED_IN],
  ['the home page signed in (a single-host instance)', 'home', 'standard', X24_SIGNED_IN],
  ['the home page signed out', 'home', 'standard', X24_SIGNED_OUT],
] as const) {
  test(`P3b-1 criterion 4 (1B.2; O4 = A), ${who}: the first-time line is one <p> reading X24's form for the reader, byte for byte`, async () => {
    if (expected === X24_SIGNED_OUT) ANON(); else SIGNED_IN();
    answers();
    await consentWith(allStates('on'));
    const page = await mountPage(mountName === 'home' ? HOME() : ASK(mode));
    assert.equal(parts(page, 'first-time-line').length, 0, 'a first-time line before the first answer');
    await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
    await finishRun(page, mode);
    const lines = parts(page, 'first-time-line');
    assert.equal(lines.length, 1, `first-time lines after the first answer: ${lines.length}`);
    assert.equal(lines[0].type, 'p', `the first-time line is a <${lines[0].type}>, not one <p>`);
    assert.equal(within(lines[0]).filter((el) => el !== lines[0] && ['p', 'details', 'summary', 'div'].includes(el.type)).length, 0, 'the first-time line holds a block inside it');
    assert.equal(textOf(lines[0]), expected, 'the first-time line, byte for byte');
    if (expected === X24_SIGNED_OUT) assert.ok(!page.text().includes(WITHHELD), `the page says "${WITHHELD}" signed out`);
  });
}

// --- Criterion 6 (1D; O7 = A): the guard's slots above the docked box, in the bar -----------------------------------

test('P3b-1 criterion 6 (1D; O7 = A): docked, the consent card and then the decline line sit inside the bar, before the box; with a consent in force and every source Off, the no-source-on line does too; no chips while docked', async () => {
  ANON();
  answers();
  await consentWith(allStates('on'));
  const page = await mountPage(HOME());
  await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
  await finishComparison(page);
  assert.equal(isDocked(page), true, 'premise: docked');
  await fetch('/api/sources/consent', { method: 'DELETE' });
  await consentStore.refreshConsent();
  await settle(page);
  await askFromBox(page, 'Q-held: how many permits were issued in Queens?');
  const inBarBeforeBox = (name: string) => {
    const bar = parts(page, 'composer-bar');
    assert.equal(bar.length, 1, `${name}: data-part="composer-bar": ${bar.length}`);
    const slot = parts(page, name);
    assert.equal(slot.length, 1, `premise: ${name} is shown`);
    assert.ok(within(bar[0]).includes(slot[0]), `${name} is not inside the bar`);
    const all = page.elements();
    assert.ok(all.indexOf(slot[0]) < all.indexOf(boxOf(page)), `${name} is not before the box`);
  };
  inBarBeforeBox('consent-card');
  assert.equal(parts(page, 'chip-row').length, 0, 'the chip row is shown while docked');
  await page.click(page.button("Don't allow"));
  await settle(page);
  inBarBeforeBox('dont-allow');

  // Every source Off, with a consent in force (written at once, as the overlay writes it).
  await consentWith(allStates('off'));
  await consentStore.refreshConsent();
  await settle(page);
  await askFromBox(page, 'Q-off: and in the Bronx?');
  assert.equal(queries.length, 1, 'premise: with every source Off nothing was sent');
  inBarBeforeBox('no-source-on');
});

// --- Criterion 7 (1E; O6): the footnote goes -----------------------------------------------------------------------

test('P3b-1 criterion 7 (1E; O6): after a finished comparison on the home page the page does not say "For complex multi-step analysis"', async () => {
  ANON();
  answers();
  await consentWith(allStates('on'));
  const page = await mountPage(HOME());
  await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
  await finishComparison(page);
  assert.equal(isDocked(page), true, 'premise: the comparison finished');
  assert.ok(!page.text().includes('For complex multi-step analysis'), 'the "run it locally" footnote is still on the page');
});

test('P3b-1 criterion 7 (1E; O6): no tracked file under src/ names showLocalSetupFootnote (a source scan; this file excepted)', () => {
  const files = trackedSrc(SELF, false);
  assert.ok(files.includes('src/components/shared/QuerySurface.tsx') && files.includes('src/app/(app)/ask/page.tsx'), 'premise: the scan sees the surface and /ask');
  const naming = files.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('showLocalSetupFootnote'));
  assert.deepEqual(naming, [], `files naming showLocalSetupFootnote: ${naming.join(', ')}`);
});
