// #644 W2 criterion 3 (d) and criterion 7's `/explore` leg: a `consent_pause`
// event reaches the card through each surface's real feed, and stays out of
// `/explore`'s captured trace.
//
// THE THREE FEEDS, each driven through the real page component on R6's
// surface harness (`src/components/sources/surface-test-harness.ts`), the
// way `consent-surfaces-driven.test.ts` drives them:
//   - a comparison surface, the home page: `useStreamingComparison` →
//     `applyProgressEvent` → the answer view's steps part → `ProgressLog`;
//   - the executed run, `/ask` in notebook mode: `useNotebookStream` →
//     `notebookSteps` → `StepsPartView`'s step view;
//   - `/explore` [E]: `McpFlowDiagram` → `useLiveTrace` → `LiveResponsePanel`
//     → `McpResponseDisplay` → `ProgressLog`. `/explore` hides its Sources
//     panel while a run is going, so this feed is its only card.
// Each stream is a `ReadableStream` the test holds open until it has read
// the card, so the card is asserted while the run is held; then it ends.
//
// CRITERION 7 [E]. `useLiveTrace` keeps a captured trace of the progress
// events (`capture-trace.ts`), exported when the run completes. A probe
// component calls the hook, starts a run whose stream carries a pause with a
// distinctive key and one ordinary progress event, then `complete`, and
// renders `capturedTrace`. The census reads it: it holds the ordinary event,
// and none of the key, the reader code or the decision token. The census is
// shown catching the key first, on a stream that plants it in an ordinary
// event's message.
//
// The test files sit outside `src/components/sources/`; the harness is not
// edited. `BpmnViewer` is stubbed: it loads a browser-only library.
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
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
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
const { useLiveTrace } = await load('hooks/useLiveTrace.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The held stream ---------------------------------------------------------------------

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

// Whatever a failing test left open is closed, so no timer outlives it.
const mounted: Surface[] = [];
afterEach(() => {
  for (const stream of streams) stream.close();
  for (const page of mounted.splice(0)) page.unmount();
});
async function mountTracked(element: ReturnType<typeof h>): Promise<Surface> {
  const page = await mount(element);
  mounted.push(page);
  return page;
}

const KEY = 'feedface0123456789abcdef4b1d2c3e';
const statement = await buildFlowsStatement();
const BOSTON = statement.sources.find((s: { sourceId: string }) => s.sourceId === 'boston-opencontext');
const PAUSE = { key: KEY, source: BOSTON, outbound: [], links: statement.links, expiresAt: new Date(Date.now() + 60_000).toISOString(), holds: true };
const LOAD_START = { message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, args: { alias: 'boston' }, toolName: 'load_source', operationType: 'load_source' };
const PAUSE_LINE = 'Waiting for your answer about Boston OpenContext, which is set to Ask first';

let streams: Held[] = [];
function answers() {
  streams = [];
  const held = (request: Request) => {
    void request;
    const stream = heldStream();
    streams.push(stream);
    return stream.response;
  };
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
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
  const box = one(surface, 'live question input', (el) => el.type === 'input' && el.props.className === 'live-query-input');
  await surface.type(box, QUESTION);
  await surface.submit(one(surface, 'live question form', (el) => el.type === 'form'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  await surface.settle();
}

/** Every consent step on the page, with whether it sits in a Sources panel row. */
function cards(surface: Surface): Array<{ element: HostElement; inPanelRow: boolean }> {
  const out: Array<{ element: HostElement; inPanelRow: boolean }> = [];
  const walk = (node: unknown, inRow: boolean): void => {
    if (Array.isArray(node)) { for (const child of node) walk(child, inRow); return; }
    if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
    const el = node as HostElement;
    const row = inRow || (typeof el.type === 'string' && el.props['data-source'] !== undefined);
    if (typeof el.type === 'string' && el.props['data-part'] === 'consent-step') out.push({ element: el, inPanelRow: row });
    walk((el.props as { children?: unknown }).children, row);
  };
  // From the roots only: every other element is reached through its parent.
  walk(rootsOf(surface), false);
  return out;
}

function rootsOf(surface: Surface): HostElement[] {
  const all = surface.elements();
  const children = new Set<unknown>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) { for (const c of node) collect(c); return; }
    if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
    children.add(node);
    collect(((node as HostElement).props as { children?: unknown }).children);
  };
  for (const el of all) collect((el.props as { children?: unknown }).children);
  return all.filter((el) => !children.has(el));
}

function stepCard(surface: Surface, where: string): HostElement {
  const found = cards(surface).filter((c) => !c.inPanelRow);
  assert.equal(found.length, 1, `${where}: expected one consent step in the run's steps, found ${found.length}; the page reads: ${surface.text().slice(0, 600)}`);
  return found[0].element;
}

function assertCard(card: HostElement, where: string): void {
  const text = textOf(card);
  assert.ok(text.startsWith('Boston OpenContext is set to Ask first.'), `${where}: the card reads: ${text.slice(0, 200)}`);
  const buttons = (function* walk(node: unknown): Generator<HostElement> {
    if (Array.isArray(node)) { for (const c of node) yield* walk(c); return; }
    if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
    const el = node as HostElement;
    if (el.type === 'button') yield el;
    yield* walk((el.props as { children?: unknown }).children);
  })(card.props.children);
  assert.deepEqual([...buttons].map((b) => textOf(b)), ['Allow', 'Not now'], `${where}: the card's buttons`);
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};
const SIGNED_IN_DB = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

// --- (d) the comparison surface ------------------------------------------------------------

test('criterion 3 (d), a comparison surface (home): the pause reaches the card in the steps, while the run is held', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountTracked(h(Home));
  await askOnQueryForm(page);
  assert.equal(streams.length, 1, 'premise: the question was sent');
  const stream = streams[0];
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: PAUSE });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.settle();
    assertCard(stepCard(page, 'the home page'), 'the home page');
  } finally {
    stream.push({ type: 'complete', panel: 'withMcp', data: { content: 'An answer.', duration_ms: 1, tools_called: [] } });
    stream.push({ type: 'complete', panel: 'withoutMcp', data: { content: 'An answer.', duration_ms: 1 } });
    stream.close();
    await page.settle();
    page.unmount();
  }
});

// --- (d) the executed run ----------------------------------------------------------------------

test('criterion 3 (d), the executed run (/ask, notebook mode): the pause reaches the card in the step view, while the run is held', async () => {
  SIGNED_IN_DB();
  sessions.rows.clear();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountTracked(h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' }));
  await askOnQueryForm(page);
  assert.equal(streams.length, 1, 'premise: the question was sent');
  const stream = streams[0];
  stream.push({ type: 'phase', name: 'A', message: 'Discovering datasets…' });
  stream.push({ type: 'phase_a_progress', ...LOAD_START });
  stream.push({ type: 'phase_a_progress', message: PAUSE_LINE, phase: 'consent_pause', pause: PAUSE });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.settle();
    assertCard(stepCard(page, '/ask'), '/ask');
  } finally {
    stream.close();
    await page.settle();
    page.unmount();
  }
});

// --- (d) /explore [E] -----------------------------------------------------------------------------

test('criterion 3 (d), /explore [E]: the pause reaches the card through useLiveTrace\'s feed, while the run is held', async () => {
  ANON();
  answers();
  await consentWith({ 'boston-opencontext': 'ask-first' });
  const page = await mountTracked(h(McpFlowDiagram));
  await askOnExplore(page);
  assert.equal(streams.length, 1, 'premise: the question was sent');
  const stream = streams[0];
  stream.push({ type: 'progress', panel: 'withMcp', message: 'Reading your question...', phase: 'analyze' });
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START });
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: PAUSE });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.settle();
    assertCard(stepCard(page, '/explore'), '/explore');
  } finally {
    stream.push({ type: 'complete', panel: 'withMcp', data: { content: 'An answer.', duration_ms: 1, tools_called: [] } });
    stream.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.settle();
    page.unmount();
  }
});

// --- Criterion 7 [E]: /explore's captured trace, through the hook ------------------------------

const CENSUS = { key: KEY, readerCode: 'c0de'.repeat(16), token: '"decision":"allow"' };
const hits = (text: string) => Object.entries(CENSUS).filter(([, v]) => text.includes(v)).map(([k]) => k);

/** Calls the hook, starts a run on click, and renders what it captured. */
function Probe() {
  const trace = useLiveTrace();
  return h('div', null,
    h('button', { type: 'button', onClick: () => trace.start(QUESTION, 'fixture/model', 'data.example.org') }, 'Start'),
    h('pre', { 'data-part': 'captured' }, JSON.stringify(trace.capturedTrace)),
    h('pre', { 'data-part': 'log' }, JSON.stringify(trace.progressLog)),
  );
}

async function captured(planted: boolean): Promise<{ trace: string; log: string }> {
  ANON();
  answers();
  const page = await mountTracked(h(Probe));
  await page.click(page.button('Start'));
  assert.equal(streams.length, 1, 'premise: the run started');
  const stream = streams[0];
  stream.push({ type: 'progress', panel: 'withMcp', message: PAUSE_LINE, phase: 'consent_pause', pause: PAUSE });
  stream.push({ type: 'progress', panel: 'withMcp', ...LOAD_START, message: planted ? `Loading ${KEY}` : LOAD_START.message });
  stream.push({ type: 'complete', panel: 'withMcp', data: { content: 'An answer.', duration_ms: 1, tools_called: [] } });
  stream.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await page.settle();
  const read = (part: string) => textOf(page.elements().find((el) => el.props['data-part'] === part)!);
  const out = { trace: read('captured'), log: read('log') };
  page.unmount();
  return out;
}

test('criterion 7 [E]: the census catches a key planted in /explore\'s captured trace', async () => {
  const { trace } = await captured(true);
  assert.ok(trace.includes(LOAD_START.toolName), `premise: the captured trace is empty: ${trace.slice(0, 200)}`);
  assert.deepEqual(hits(trace), ['key']);
});

test('criterion 7 [E]: /explore\'s captured trace holds the ordinary event and none of the census values; the pause reached the steps', async () => {
  const { trace, log } = await captured(false);
  assert.ok(trace.includes(LOAD_START.message), `the captured trace does not hold the ordinary event: ${trace.slice(0, 300)}`);
  assert.deepEqual(hits(trace), [], 'the captured trace holds a census value');
  assert.ok(!trace.includes('consent_pause'), 'the pause was recorded into the captured trace');
  assert.ok(log.includes('consent_pause') && log.includes(KEY), 'premise: the pause did not reach the run\'s steps (no case for it in useLiveTrace)');
});
