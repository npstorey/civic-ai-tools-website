// UX-2 P3b-1 (#729), criterion 5: the account line (O2 = A, O3 = A; W1, W2; Q6 = B with the note; addendum 3).
//
// THE RULE. One paragraph, `data-part="account-line"`: the count, "N of M questions left today." from the first
// question on, with the numbers `/api/rate-limit` answers for the reader, and at 0 "The count resets at midnight UTC."
// after it; then, on the home page signed out only, "Sign in for more features and usage." in
// `data-part="sign-in-line"`, its "Sign in" making the header's decision on the three branches. The count is read
// again when a run ends, however it ends, in Standard and Sandbox (addendum 3, ruling 2), and renders only from an OK
// answer with number fields (3.5). The long sentence, the banner's wording and its prompt go.
//
// WHAT IS DRIVEN. The home page signed out (Standard) and /ask signed in (Sandbox) on the surface harness, the count
// route answered by the fixture in order (`net.rate`), the REAL flows and consent routes.
//
// WHAT MAKES IT ABLE TO FAIL. At `b1d8bfd` the banner reads "N/M requests remaining today · Sign in for a higher daily
// limit", reads the count once at the submit, and stores any parsed body; the long sentence carries the daily count.
// The fixture numbers (7 of 10, 21 of 25, 1, 0) are held by no constant in the source. The refetch fixture answers 10
// and then 9, so a build with no second read shows 10. The 503 body carries numeric fields, so a build that ignores
// `res.ok` shows a count.
//
// BLIND SPOTS, stated. The count's emphasis and colours are criterion 9's (AL), read in a browser.
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

const SELF = 'src/components/composer/account-line.test.ts';
const SIGN_IN_LINE = 'Sign in for more features and usage.';
const RESET = 'The count resets at midnight UTC.';
const count = (remaining: number, limit: number) => `${remaining} of ${limit} questions left today.`;
const rate = (remaining: number, limit: number) => () => json({ remaining, limit, resets_at: '2099-01-01T00:00:00.000Z', authenticated: sessions.server !== null });

const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const { SignInOptionsProvider } = await load('components/SignInOptionsProvider.tsx');
const { SIGN_IN_PANEL_HREF } = await load('lib/host-links.ts');
const SPLIT_HREF = 'https://app.fixture.example/ask';

const accountLine = (page: Surface): string[] => parts(page, 'account-line').map((el) => textOf(el));

/** The mount for a reader: the home page signed out (Standard), or /ask signed in (Sandbox). */
const MOUNTS = [
  { name: 'the home page signed out', sign: ANON, element: () => HOME(), mode: 'standard' as const, tail: ` ${SIGN_IN_LINE}` },
  { name: '/ask signed in', sign: SIGNED_IN, element: () => ASK('notebook'), mode: 'notebook' as const, tail: '' },
];

// --- Criterion 5 (1B.3; O3 = A; W1, W2): the count, from the first question on ---------------------------------------

for (const m of MOUNTS) {
  for (const [remaining, limit] of [[7, 10], [21, 25], [1, 10], [0, 10], [0, 25]] as const) {
    test(`P3b-1 criterion 5 (W1, W2), ${m.name}: with the count route answering ${remaining} of ${limit}, the account line reads the ruled words after the first question and no count before it`, async () => {
      m.sign();
      answers();
      net.rate = [rate(remaining, limit)];
      await consentWith(allStates('on'));
      const page = await mountPage(m.element());
      assert.ok(!textOf(composerOf(page)).includes('questions left today'), `a count before the first question: ${accountLine(page).join(' | ')}`);
      await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
      await finishRun(page, m.mode);
      const words = remaining === 0 ? `${count(0, limit)} ${RESET}` : count(remaining, limit);
      assert.deepEqual(accountLine(page), [`${words}${m.tail}`], 'the account line after the first question');
      if (remaining > 0) assert.ok(!page.text().includes(RESET), 'the reset sentence shows with questions left');
      if (m.tail) assert.equal((textOf(composerOf(page)).match(/sign in/gi) ?? []).length, 1, `"sign in" in the composer: ${textOf(composerOf(page))}`);
    });
  }
}

// --- Criterion 5 (addendum 3, ruling 2): the count is fetched again when the run ends, however it ends -------------

for (const m of MOUNTS) {
  for (const end of ['an answer', 'an error'] as const) {
    test(`P3b-1 criterion 5 (addendum 3, ruling 2), ${m.name} (${m.mode === 'notebook' ? 'Sandbox' : 'Standard'}), a run that ends in ${end}: the count route answers 10 at the submit and 9 after; the account line reads "9 of 10 questions left today." once the run has ended`, async () => {
      m.sign();
      answers();
      net.rate = [rate(10, 10), rate(9, 10)];
      await consentWith(allStates('on'));
      const page = await mountPage(m.element());
      await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
      const atSubmit = net.rateCalls;
      assert.ok(atSubmit >= 1, 'premise: the count was read at the submit');
      if (end === 'an answer') await finishRun(page, m.mode);
      else {
        const stream = streams[streams.length - 1];
        assert.ok(stream, 'premise: the run was served');
        if (m.mode === 'notebook') stream.push({ type: 'error', message: 'The notebook could not finish running. Please try again.', code: 'generic' });
        else for (const panel of queries[queries.length - 1].body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp']) stream.push({ type: 'error', panel, message: 'The model could not answer.', code: 'generic' });
        stream.close();
        await settle(page);
      }
      assert.ok(net.rateCalls > atSubmit, `the count was not read again when the run ended (${net.rateCalls} reads, ${atSubmit} at the submit)`);
      assert.deepEqual(accountLine(page), [`${count(9, 10)}${m.tail}`], 'the account line after the run ended');
      assert.equal(queries.length, 1, 'the second read of the count added a run request');
    });
  }
}

// --- Criterion 5: a failing count route shows no count (addendum 3, 3.5) --------------------------------------------

for (const m of MOUNTS) {
  test(`P3b-1 criterion 5 (addendum 3, 3.5), ${m.name}: the count route answering 503 with a JSON body that carries numeric remaining and limit shows no count, no "undefined", and leaves the sign-in sentence where it was`, async () => {
    m.sign();
    answers();
    net.rate = [() => json({ error: 'unavailable', remaining: 7, limit: 10 }, 503)];
    await consentWith(allStates('on'));
    const page = await mountPage(m.element());
    const before = accountLine(page);
    await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
    await finishRun(page, m.mode);
    assert.ok(net.rateCalls >= 1, 'premise: the count route was asked');
    const text = textOf(composerOf(page));
    assert.ok(!text.includes('questions left today'), `a count from a failed read: ${text}`);
    assert.ok(!/remaining|undefined/i.test(text), `the composer reads "${text}"`);
    assert.deepEqual(accountLine(page), before, 'the account line moved after a failed count read');
    if (m.tail) assert.deepEqual(before, [SIGN_IN_LINE], 'premise: signed out, the account line is the sign-in sentence from first paint');
  });
}

// --- Criterion 5 (Q6 = B with the note): the sign-in sentence, on the header's three branches -----------------------

const BRANCHES: Array<[string, (child: ReactElement) => ReactElement, (el: HostElement) => Promise<void>]> = [
  ['the split topology (a link to the app host\'s sign-in)', (child) => h(HostLinksProvider, { value: { marketingOrigin: '', signInHref: SPLIT_HREF } }, child), async (el) => {
    assert.equal(el.type, 'a', 'the split branch\'s "Sign in" is not a link');
    assert.equal(el.props.href, SPLIT_HREF, 'the split branch\'s "Sign in" does not link the header\'s sign-in address');
  }],
  ['one provider, in place (a button that starts that provider\'s sign-in)', (child) => child, async (el) => {
    assert.equal(el.type, 'button', 'the in-place branch\'s "Sign in" is not a button');
    await (el.props.onClick as () => unknown)();
    assert.deepEqual((globalThis as unknown as { __p3b1SignIns: unknown[] }).__p3b1SignIns, ['github'], 'the in-place "Sign in" does not start the one provider\'s sign-in');
  }],
  ['several providers (a link to the sign-in panel)', (child) => h(SignInOptionsProvider, { value: [{ id: 'github', name: 'GitHub' }, { id: 'oidc', name: 'Fixture sign-in' }] }, child), async (el) => {
    assert.equal(el.type, 'a', 'the panel branch\'s "Sign in" is not a link');
    assert.equal(el.props.href, SIGN_IN_PANEL_HREF, 'the panel branch\'s "Sign in" does not link the sign-in panel');
  }],
];

for (const [branch, wrap, check] of BRANCHES) {
  test(`P3b-1 criterion 5 (Q6 = B), the home page signed out, ${branch}: data-part="sign-in-line" reads "${SIGN_IN_LINE}" from first paint, and its "Sign in" makes the header's decision`, async () => {
    ANON();
    answers();
    const page = await mountPage(wrap(HOME()));
    const lines = parts(page, 'sign-in-line');
    assert.equal(lines.length, 1, `data-part="sign-in-line" at first paint: ${lines.length}`);
    assert.equal(textOf(lines[0]), SIGN_IN_LINE, 'the sign-in sentence, byte for byte');
    const controls = within(lines[0]).filter((el) => (el.type === 'a' || el.type === 'button') && textOf(el) === 'Sign in');
    assert.equal(controls.length, 1, `controls reading "Sign in" in the sign-in sentence: ${controls.length}`);
    await check(controls[0]);
  });
}

for (const [who, sign, element] of [
  ['/ask signed in', SIGNED_IN, () => ASK('notebook')],
  ['the home page signed in (a single-host instance)', SIGNED_IN, () => HOME()],
  ['/explore signed out', ANON, () => EXPLORE()],
] as const) {
  test(`P3b-1 criterion 5, ${who}: no sign-in sentence, before and after a question`, async () => {
    sign();
    answers();
    await consentWith(allStates('on'));
    const page = await mountPage(element());
    if (who.startsWith('/explore')) {
      await page.click(page.button('Try your own'));
      await settle(page);
      assert.equal(parts(page, 'composer').length, 1, 'premise: /explore\'s composer is shown');
    } else {
      assert.equal(parts(page, 'where-this-question-goes').length, 1, 'premise: the composer\'s lines are shown');
    }
    assert.equal(parts(page, 'sign-in-line').length, 0, 'a sign-in sentence before a question');
    assert.ok(!page.text().includes(SIGN_IN_LINE), `the page says "${SIGN_IN_LINE}"`);
  });
}

// --- Criterion 5: what goes ------------------------------------------------------------------------------------------

test('P3b-1 criterion 5: after a question on the home page signed out, the composer says none of the retired wordings', async () => {
  ANON();
  answers();
  await consentWith(allStates('on'));
  const page = await mountPage(HOME());
  await askFromBox(page, 'Q-first: what was the median household income in the Bronx?');
  await finishComparison(page);
  assert.ok(net.rateCalls >= 1, 'premise: the count was read');
  const text = textOf(composerOf(page));
  const found = ['requests remaining today', 'Sign in for a higher daily limit', 'Signed in, you can ask', 'publish it as a signed analysis'].filter((w) => text.includes(w));
  assert.deepEqual(found, [], `the composer reads: ${text}`);
});

test('P3b-1 criterion 5: SIGNED_IN_DAILY_QUESTIONS and SIGN_IN_ADDS_REST are in no tracked file under src/ (this file excepted)', () => {
  const naming = trackedSrc(SELF, false).filter((f) => /SIGNED_IN_DAILY_QUESTIONS|SIGN_IN_ADDS_REST/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(naming, []);
});
