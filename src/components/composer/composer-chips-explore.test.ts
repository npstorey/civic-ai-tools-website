// UX-2 P3b-1 (#729), criteria 2 and 3: the composer's example row, and `/explore` on the shared box.
//
// CRITERION 2 (1B). The example row is P9's `ChipRow` (`src/components/ui/Page.tsx:88-90`): a `ui-chip-row` group,
// named by the pending word `CHIP_ROW_LABEL` (`composer/copy.ts`; read from the module, since it is not ruled),
// holding one `<button>` per offered example, in order, with no "·" between them (`QueryForm.tsx:437` drew one).
// `globals.css` resolves the class to `flex-wrap: nowrap` and `overflow-x: auto` (`Page.test.ts`'s read, reused).
// A chip fills the box and sends nothing (`QueryForm.tsx:331-336`), so a chip reaches a run only through the box's
// submit: the reading behind "the second question" (`composer-dock.test.ts`).
//
// CRITERION 3 (1C). `/explore`'s "Try your own" renders the shared composer in place of its own `<input
// class="live-query-input">` and "Run" (`TraceControls.tsx:318-346`): the box and the arrow, no chips. The consent
// card renders once; after Allow the live run posts `/api/compare-stream` with `mcpOnly: true` and the first offered
// model, as today (`useLiveTrace.ts:350-351`); no first-time line renders there (relay 55, item c: a finished run
// shows "New query", not a box an answer sits beside), and the composer never docks.
//
// WHAT IS DRIVEN. The home page component and `/explore`'s diagram (`McpFlowDiagram`, its BPMN canvas stubbed), on
// the surface harness; the routes as `composer-dock.test.ts` answers them.
//
// WHAT MAKES IT ABLE TO FAIL. At the base no element carries `data-part="composer"`, the example row is a wrapping
// flex of `<span>`s with a "·" between chips, and `/explore` renders its own input and "Run".
//
// BLIND SPOTS, stated. No layout: one line at every width and the sideways scroll at 390 px are criterion 5's
// instrument's reads (CR), not this file's.
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
import { attr, childrenOf, classesOf, cssRules, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  // `/explore`'s BPMN canvas: a browser-only library and a stylesheet import.
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
  'BOSTON_OPENCONTEXT_MCP_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
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
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;

const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const { CHIP_ROW_LABEL } = await load('components/composer/copy.ts');
const { offeredExampleQueries } = await load('lib/query-presentation.ts');
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');

const BOX_LABEL = 'Ask a question about open data';
const FIXTURE_MODEL = 'fixture/model';

// --- The answers (as composer-dock.test.ts gives them) -----------------------------------------------------------

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

let queries: Array<{ path: string; body: Json }> = [];
function queryRoute(routePath: string) {
  return async (request: Request): Promise<Response> => {
    const body = JSON.parse(await request.clone().text() || '{}') as Json;
    queries.push({ path: routePath, body });
    const decision = await consentInForce(request, sessions.server);
    if (!decision.ok) return new Response(JSON.stringify(decision.payload), { status: 403, headers: { 'Content-Type': 'application/json' } });
    const held = heldStream();
    streams.push(held);
    return held.response;
  };
}

function answers() {
  streams = [];
  queries = [];
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: FIXTURE_MODEL, name: 'Fixture model' }, { id: 'fixture/second', name: 'Second fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/compare-stream': queryRoute('/api/compare-stream'),
    '/api/query-notebook': queryRoute('/api/query-notebook'),
  });
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
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

const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};

async function mountPage(element: ReturnType<typeof h>): Promise<Surface> {
  const p = await mount(element);
  mounted.push(p);
  await settle(p);
  return p;
}

// --- Reading the page ------------------------------------------------------------------------------------------

const part = (el: HostElement): unknown => el.props['data-part'];

function composerOf(surface: Surface): HostElement {
  const found = surface.elements().filter((el) => part(el) === 'composer');
  assert.equal(found.length, 1, `expected one data-part="composer", found ${found.length}; the page reads: ${surface.text().slice(0, 300)}`);
  return found[0];
}

function boxIn(composer: HostElement): HostElement {
  const found = within(composer).filter((el) => el.type === 'textarea');
  assert.equal(found.length, 1, `expected one question box inside the composer, found ${found.length}`);
  return found[0];
}

// --- Criterion 2: the chip row ---------------------------------------------------------------------------------

test('criterion 2, the home page: the example row is a ui-chip-row named by the pending label, one <button> per offered example, in order, with no "·"', async () => {
  ANON();
  answers();
  const page = await mountPage(h(Home));
  const composer = composerOf(page);
  const rows = within(composer).filter((el) => classesOf(el).includes('ui-chip-row'));
  assert.equal(rows.length, 1, `ui-chip-row elements inside the composer: ${rows.length}`);
  const row = rows[0];
  assert.equal(attr(row, 'role'), 'group', 'the row is not a named group');
  assert.equal(attr(row, 'aria-label'), CHIP_ROW_LABEL, 'the row is not named by CHIP_ROW_LABEL');
  const expected = (offeredExampleQueries(false) as Array<{ text: string }>).map((e) => e.text);
  assert.ok(expected.length >= 2, 'premise: at least two offered examples, so a separator could appear');
  const kids = childrenOf(row);
  assert.deepEqual(kids.map((el) => el.type), expected.map(() => 'button'), `the row's children are not one <button> per example: ${JSON.stringify(kids.map((el) => el.type))}`);
  assert.deepEqual(kids.map((el) => textOf(el)), expected, 'the chips\' words, in order');
  for (const chip of kids) assert.equal(attr(chip, 'type'), 'button', `a chip is not type="button": ${textOf(chip)}`);
  assert.ok(!textOf(row).includes('·'), `the row carries a "·": ${textOf(row)}`);
  // Nothing else of the composer draws a separator between the chips either.
  const outside = page.elements().filter((el) => !within(row).includes(el) && el.type === 'span' && textOf(el) === '·');
  assert.equal(outside.length, 0, `"·" separators on the page outside the row: ${outside.length}`);
});

test('criterion 2: globals.css resolves ui-chip-row to flex-wrap: nowrap and overflow-x: auto', () => {
  const declared = cssRules('.ui-chip-row').join(';');
  assert.match(declared, /flex-wrap\s*:\s*nowrap/, 'globals.css: .ui-chip-row wraps');
  assert.match(declared, /overflow-x\s*:\s*auto/, 'globals.css: .ui-chip-row does not scroll sideways');
});

test('criterion 2, the reading of "the second question": a chip fills the box and sends nothing', async () => {
  ANON();
  answers();
  const page = await mountPage(h(Home));
  const row = within(composerOf(page)).find((el) => classesOf(el).includes('ui-chip-row'));
  assert.ok(row, 'no ui-chip-row inside the composer');
  const first = childrenOf(row!)[0];
  const words = textOf(first);
  await page.click(first);
  await settle(page);
  assert.equal(boxIn(composerOf(page)).props.value, words, 'the chip did not fill the box with its words');
  assert.equal(queries.length, 0, 'a chip sent a question');
});

// --- Criterion 3: /explore -------------------------------------------------------------------------------------

async function openLive(page: Surface): Promise<void> {
  await page.click(page.button('Try your own'));
  await settle(page);
}

test('criterion 3, /explore: "Try your own" renders the shared composer (the box and the arrow, no chips), and no input.live-query-input and no "Run"', async () => {
  ANON();
  answers();
  const page = await mountPage(h(McpFlowDiagram));
  await openLive(page);
  const composer = composerOf(page);
  const box = boxIn(composer);
  assert.equal(box.props['aria-label'], BOX_LABEL, 'the shared box\'s accessible name');
  assert.equal(within(composer).filter((el) => el.type === 'button' && el.props.type === 'submit').length, 1, 'the composer has no one submit control (the arrow)');
  assert.equal(within(composer).filter((el) => classesOf(el).includes('ui-chip-row') || part(el) === 'chip-row').length, 0, '/explore\'s composer carries chips');
  assert.equal(page.elements().filter((el) => el.type === 'input' && classesOf(el).includes('live-query-input')).length, 0, 'the old live input is still rendered');
  assert.equal(page.buttons('Run').length, 0, 'the old "Run" button is still rendered');
});

test('criterion 3, /explore: a submit shows the consent card once; after Allow the live run posts /api/compare-stream with mcpOnly and the first offered model; no first-time line, and no dock, after the run finishes', async () => {
  ANON();
  answers();
  const page = await mountPage(h(McpFlowDiagram));
  await openLive(page);
  const composer = composerOf(page);
  await page.type(boxIn(composer), 'Most common 311 complaints in Brooklyn');
  const forms = page.elements().filter((el) => el.type === 'form' && within(el).includes(boxIn(composerOf(page))));
  assert.equal(forms.length, 1, `forms holding the box: ${forms.length}`);
  assert.equal(page.elements().filter((el) => el.type === 'form').length, 1, 'the page has more than one <form>');
  await page.submit(forms[0]);
  await settle(page);
  assert.equal(queries.length, 0, 'the question was sent before the card was answered');
  assert.equal(page.buttons('Allow').length, 1, `the consent card is not shown once: ${page.buttons('Allow').length} Allow buttons`);
  assert.equal(page.elements().filter((el) => part(el) === 'consent-card').length, 1, 'data-part="consent-card" is not rendered once');

  await page.click(page.button('Allow'));
  await settle(page, 600);
  assert.equal(queries.length, 1, `requests to a query route after Allow: ${queries.length}`);
  assert.equal(queries[0].path, '/api/compare-stream', 'the live run went elsewhere');
  assert.equal(queries[0].body.mcpOnly, true, 'the live run is not mcpOnly');
  assert.equal(queries[0].body.model, FIXTURE_MODEL, 'the live run did not send the first offered model');

  const stream = streams[0];
  assert.ok(stream, 'premise: the run was served');
  stream.push({ type: 'complete', panel: 'withMcp', data: { content: 'A fixture answer.', duration_ms: 1, tools_called: [] } });
  stream.close();
  await settle(page);
  assert.equal(page.elements().filter((el) => part(el) === 'first-time-line').length, 0, 'a first-time line on /explore');
  assert.ok(!page.text().includes('A new question replaces this answer'), 'X24\'s words on /explore');
  for (const el of page.elements().filter((x) => part(x) === 'composer')) {
    assert.ok(!classesOf(el).includes('composer--docked'), 'the composer docked on /explore');
  }
});
