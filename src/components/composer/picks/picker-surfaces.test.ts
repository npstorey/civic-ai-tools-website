// S3-B W1 (npstorey/civic-ai-tools#318; W1-4's reds, W1-5's browser half and W1-6; the owner's W0 rulings D1 to D9;
// the ORCH's R1 to R6 and A5, A13, A16, A17): "Only the ones I pick" on the page.
//
// WHAT IS DRIVEN. `/ask`'s real mount (`QuerySurface`, answer-first, Sandbox by default), the home page's and
// `/explore`'s, on the surface harness (`registerHooks` + the real `renderToStaticMarkup`): the harness menu, the picker
// panel, its rows (the Settings row with a pick control), the lines under the box, and the request a question sends.
// The consent is written through the real consent route; the flows statement is the real route's; the decision route
// answers per case; every other request is recorded and answered here.
//
// WHAT MAKES IT ABLE TO FAIL. Every source is configured On but one, so the where-line over every source and over the
// picks differ; a not-set-up source is a hit of real words (NYC Charter, whose switch is off); the fetch spy is first
// shown catching a request; the resend's picks are changed before the resend, so a resend that read the page's
// current picks fails; `/explore`'s menu is read beside the same menu given a picks prop, which shows the item.
//
// BLIND SPOTS, stated. No layout, no focus, no browser event dispatch: where the panel sits, that the × stays in view in
// the docked panel, and that focus goes back to the opener are W1-8's images and its accessibility-tree read.
//
// RED at 15a52942: "Only the ones I pick" is disabled with the old reason, there is no panel, and no question carries
// picks. Every test below fails at an assertion, except the two that hold on the base and say so (`pin`).
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { type ComponentType, type ReactElement } from 'react';
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
} from '../../sources/surface-test-harness.ts';
import { hasClass, within } from '../../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY',
  'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL',
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
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/', search: '' },
    history: { replaceState() {}, pushState() {} },
    scrollTo() {},
    scrollBy() {},
    innerHeight: 852,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const HarnessMenu = (await load('components/composer/HarnessMenu.tsx')).default as ComponentType<Record<string, unknown>>;
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash, serializeFlowsStatement } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);
const { readerSourceName } = await load('lib/sources/source-name.ts');
/** Each source's reader name, as the rows and S7 show it. */
const NAME: Record<string, string> = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, readerSourceName(s)]));

// The picks' page store, when it exists (absent at 15a52942).
const store = await load('components/composer/picks/store.ts').catch(() => null);

// --- The ruled words (W1's contract r3, the table), byte for byte ---------------------------------------------------

const W = {
  ds: 'Data sources',
  pick: 'Only the ones I pick',
  S1: 'You search for data sources and pick the ones this question can use. The model uses no others.',
  S2: 'Search data sources',
  S3: 'No data source matches.',
  S4: 'Pick for this question',
  S4name: (name: string) => `Pick ${name} for this question`,
  S5: 'Off. Set it to On or Ask first to pick it.',
  S6a: 'Not set up on this site.',
  S7: (names: string) => `Your question can use only these data sources: ${names}.`,
  S8: 'Change',
  S9: 'No data source is picked, so nothing was sent. Pick at least one, or choose Auto.',
  S12: 'Pick the data sources for this question',
  S13: (n: number) => `${n} picked`,
  D8: 'Not offered on this site. Every data source you set On is given to the model.',
  inLoopAuto: 'Auto - find sources for me',
  allSourcesAuto: 'Auto - use every source I set On',
  footer: 'All data sources and your consent',
  settingsLink: 'Select sources',
  /** The menu's reasons before W1, which leave with the commit that enables the option (B13). */
  oldInLoopReason: 'Not offered on this site yet. The model chooses from the data sources you set On or Ask first.',
  oldAllSourcesReason: 'Not offered on this site yet. Every data source you set On is given to the model.',
};

// --- The answers ---------------------------------------------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Routing = { routing: string; store: boolean } | 'fail';
let decision: Routing = { routing: 'in-loop', store: true };
let queries: Array<{ path: string; raw: string; body: Json }> = [];
let sent: Array<{ method: string; path: string; body: string }> = [];

function answers(routing: Routing = { routing: 'in-loop', store: true }) {
  decision = routing;
  queries = [];
  const installed = installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => (decision === 'fail' ? json({ error: 'fixture' }, 503) : json(decision)),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true }),
    '/api/compare-stream': async (request: Request) => {
      const raw = await request.text();
      queries.push({ path: '/api/compare-stream', raw, body: JSON.parse(raw || '{}') as Json });
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    },
    '/api/query-notebook': async (request: Request) => {
      const raw = await request.text();
      queries.push({ path: '/api/query-notebook', raw, body: JSON.parse(raw || '{}') as Json });
      return json({ error: 'fixture' }, 500);
    },
  });
  sent = installed.sent;
}

/** A consent in force through the real PUT: each source as `states` says, else On. */
async function consentWith(states: Record<string, string> = {}): Promise<void> {
  const all = Object.fromEntries(IDS.map((id) => [id, states[id] ?? 'on']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
}

const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};
const ASK = () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' });

const mounted: Surface[] = [];
beforeEach(() => {
  storage.clear();
  sessions.rows.clear();
  store?.resetPicksForTests?.();
});
afterEach(() => {
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
});
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
/** The picker's code loads on the panel's first open (fix round 1, item 2): wait for the panel, as a reader would. */
async function waitForPanel(page: Surface): Promise<void> {
  for (let i = 0; i < 50 && parts(page, 'pick-panel').length === 0; i += 1) await settle(page, 10);
}
/** A signed-in `/ask` with a consent in force, every source On but the ones `states` names. */
async function askPage(states: Record<string, string> = {}, routing: Routing = { routing: 'in-loop', store: true }): Promise<Surface> {
  SIGNED_IN();
  answers(routing);
  await consentWith(states);
  return mountPage(ASK());
}

// --- Reading the page ---------------------------------------------------------------------------------------------------

const part = (el: HostElement): unknown => el.props['data-part'];
const parts = (page: Surface, name: string): HostElement[] => page.elements().filter((el) => part(el) === name);
const ROLES = ['menuitem', 'menuitemradio'];
const byClassIn = (el: HostElement, name: string): HostElement[] => within(el).filter((x) => hasClass(x, name));
const labelOf = (el: HostElement): string => textOf(byClassIn(el, 'ui-menu-item-label')[0] ?? el);
const disabled = (row: HostElement): boolean => row.props['aria-disabled'] === true || row.props['aria-disabled'] === 'true';
const checkedRow = (row: HostElement): boolean => row.props['aria-checked'] === true || row.props['aria-checked'] === 'true';

function menuOf(page: Surface): HostElement {
  const found = page.elements().filter((el) => part(el) === 'harness-menu');
  assert.equal(found.length, 1, `data-part="harness-menu": ${found.length}`);
  return found[0];
}
async function openDataSources(page: Surface): Promise<HostElement> {
  const menu = menuOf(page);
  if (!within(menu).some((el) => el.props.role === 'menu')) {
    await page.click(within(menu).find((el) => el.props['aria-haspopup'] === 'menu')!);
    await settle(page);
  }
  const panel = within(menuOf(page)).find((el) => el.props.role === 'menu')!;
  if (!within(panel).some((el) => el.props.role === 'menuitemradio')) {
    await page.click(within(panel).find((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === W.ds)!);
    await settle(page);
  }
  return within(menuOf(page)).find((el) => el.props.role === 'menu')!;
}
/** The Data sources item's children, as [label, checked, disabled, descriptions, reasons]. */
async function dataSourcesRows(page: Surface): Promise<Array<[string, boolean, boolean, string[], string[]]>> {
  const panel = await openDataSources(page);
  return within(panel).filter((el) => el.props.role === 'menuitemradio').map((el) => [
    labelOf(el), checkedRow(el), disabled(el),
    byClassIn(el, 'ui-menu-item-description').map(textOf), byClassIn(el, 'ui-menu-item-reason').map(textOf),
  ]);
}
async function dataSourcesValue(page: Surface): Promise<string | null> {
  const menu = menuOf(page);
  if (!within(menu).some((el) => el.props.role === 'menu')) {
    await page.click(within(menu).find((el) => el.props['aria-haspopup'] === 'menu')!);
    await settle(page);
  }
  const panel = within(menuOf(page)).find((el) => el.props.role === 'menu')!;
  const row = within(panel).find((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === W.ds)!;
  const value = byClassIn(row, 'ui-menu-item-value')[0];
  return value ? textOf(value) : null;
}
async function choose(page: Surface, label: string): Promise<void> {
  const panel = await openDataSources(page);
  const row = within(panel).find((el) => el.props.role === 'menuitemradio' && labelOf(el) === label);
  assert.ok(row, `the Data sources item "${label}"`);
  assert.equal(disabled(row!), false, `the Data sources item "${label}" is disabled`);
  await page.click(row!);
  await settle(page);
  if (label === W.pick) await waitForPanel(page);
}
function panelOf(page: Surface): HostElement {
  const found = parts(page, 'pick-panel');
  assert.equal(found.length, 1, `data-part="pick-panel": ${found.length}; the page reads ${page.text().slice(0, 400)}`);
  return found[0];
}
const searchOf = (page: Surface): HostElement => within(panelOf(page)).find((el) => el.type === 'input' && el.props.type === 'search')!;
const rowsOf = (page: Surface): HostElement[] => within(panelOf(page)).filter((el) => el.type === 'li' && el.props['data-source'] !== undefined);
const rowIds = (page: Surface): string[] => rowsOf(page).map((el) => String(el.props['data-source']));
const pickBoxOf = (row: HostElement): HostElement | undefined => within(row).find((el) => el.type === 'input' && el.props.type === 'checkbox');
const rowFor = (page: Surface, id: string): HostElement => {
  const row = rowsOf(page).find((el) => el.props['data-source'] === id);
  assert.ok(row, `the picker's row for ${id}; rows: ${rowIds(page).join(', ')}`);
  return row!;
};
async function pick(page: Surface, id: string): Promise<void> {
  const box = pickBoxOf(rowFor(page, id));
  assert.ok(box, `${id}: the row has a pick control`);
  await page.check(box!);
  await settle(page);
}
async function search(page: Surface, query: string): Promise<void> {
  await page.type(searchOf(page), query);
  await settle(page);
}
async function ask(page: Surface, question: string): Promise<void> {
  const box = page.elements().find((el) => el.type === 'textarea');
  assert.ok(box, 'premise: the question box');
  await page.type(box!, question);
  await page.submit(page.elements().find((el) => el.type === 'form' && within(el).some((x) => x.type === 'textarea'))!);
  await settle(page, 100);
}
const lineText = (page: Surface, name: string): string[] => parts(page, name).map((el) => textOf(el));

// --- W1-6: the option, in each form ---------------------------------------------------------------------------------------

for (const [name, routing, expected] of [
  ['in loop with the store', { routing: 'in-loop', store: true }, [W.pick, false, false, [W.S1], []]],
  ['all-sources', { routing: 'all-sources', store: true }, [W.pick, false, true, [], [W.D8]]],
  ['in loop with no store', { routing: 'in-loop', store: false }, [W.pick, false, true, [], [W.D8]]],
  ['the read failed (R2)', 'fail', [W.pick, false, true, [], []]],
] as const) {
  test(`W1-6 (D5, D8, R2): ${name}: "Only the ones I pick" reads as ruled`, async () => {
    const page = await askPage({}, routing as Routing);
    const rows = await dataSourcesRows(page);
    assert.deepEqual(rows[1], expected);
    const text = page.text();
    assert.ok(!text.includes(W.oldInLoopReason) && !text.includes(W.oldAllSourcesReason), 'a reason from before W1 shows (B13)');
  });
}

test('W1-6 (R2): while the routing pair is unread, the option is disabled and shows no reason', async () => {
  SIGNED_IN();
  // The decision route never answers within the read: the pair stays unread.
  answers();
  await consentWith();
  const never = new Promise<Response>(() => {});
  const installed = installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => never,
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true }),
  });
  void installed;
  const page = await mount(ASK());
  mounted.push(page);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const panelRows = await (async () => {
    const menu = menuOf(page);
    await page.click(within(menu).find((el) => el.props['aria-haspopup'] === 'menu')!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const panel = within(menuOf(page)).find((el) => el.props.role === 'menu')!;
    await page.click(within(panel).find((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === W.ds)!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const open = within(menuOf(page)).find((el) => el.props.role === 'menu')!;
    return within(open).filter((el) => el.props.role === 'menuitemradio');
  })();
  const pickRow = panelRows.find((el) => labelOf(el) === W.pick);
  assert.ok(pickRow, 'premise: the option is listed on /ask');
  assert.equal(disabled(pickRow!), true);
  assert.deepEqual(byClassIn(pickRow!, 'ui-menu-item-reason').map(textOf), []);
  assert.deepEqual(byClassIn(pickRow!, 'ui-menu-item-description').map(textOf), []);
});

// S3-B F, F-2 (the cold read's F3): `/api/flows` answering non-OK leaves the store's `statement` null while the
// decision read can say in loop with the store. RED at 71b43b0f: the option is enabled, and choosing it opens the
// panel over an empty list. What makes it able to fail: the routing pair is read and says in loop with the store (the
// premise below), the one form in which the option is enabled; only the statement is unread.
test('F-2: in loop with the store and the flows statement unread, the option is disabled, shows no reason, and opens no panel', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => json({ error: 'fixture' }, 503),
    '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true }),
  });
  const page = await mountPage(ASK());
  const rows = await dataSourcesRows(page);
  assert.equal(rows[0][0], W.inLoopAuto, 'premise: the routing pair is read, in loop with the store');
  assert.deepEqual(rows[1], [W.pick, false, true, [], []]);
  // Choosing it opens no panel.
  const panel = await openDataSources(page);
  await page.click(within(panel).find((el) => el.props.role === 'menuitemradio' && labelOf(el) === W.pick)!);
  for (let i = 0; i < 10; i += 1) await settle(page, 10);
  assert.equal(parts(page, 'pick-panel').length, 0, 'the panel opened over an empty list');
});

test('W1-6 (A5 = hide): /explore\'s Data sources lists Auto and the Settings link only; the same menu given a picks prop shows the option (decoy)', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const explore = await mountPage(h(McpFlowDiagram));
  await page_click_live(explore);
  const rows = await dataSourcesRows(explore);
  assert.deepEqual(rows.map((r) => r[0]), [W.inLoopAuto], `/explore's Data sources lists ${JSON.stringify(rows.map((r) => r[0]))}`);
  assert.ok(!explore.text().includes(W.pick), '/explore names the option');
  // Decoy: the same component, the same consent bus, with the prop QueryForm passes.
  const decoy = await mountPage(h(HarnessMenu, { variant: 'sources-only', models: [], model: '', picking: true }));
  const decoyRows = await dataSourcesRows(decoy);
  assert.deepEqual(decoyRows.map((r) => r[0]), [W.inLoopAuto, W.pick]);
});

/** `/explore`'s live panel opens behind "Try your own". */
async function page_click_live(page: Surface): Promise<void> {
  const button = page.buttons('Try your own')[0];
  if (button) {
    await page.click(button);
    await settle(page);
  }
}

// --- W1-6: the panel ------------------------------------------------------------------------------------------------------

test('W1-6 (D1 = B, R6): choosing the option closes the menu and opens a named region: S12, its × "Close" in the header, the search field', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  assert.ok(!within(menuOf(page)).some((el) => el.props.role === 'menu'), 'the menu stayed open');
  const panel = panelOf(page);
  assert.equal(panel.type, 'section');
  assert.equal(panel.props.role, 'region');
  const heading = within(panel).find((el) => el.props.id === panel.props['aria-labelledby']);
  assert.ok(heading, 'aria-labelledby names no element in the panel');
  assert.equal(textOf(heading!), W.S12);
  const header = within(panel).find((el) => part(el) === 'pick-panel-header');
  assert.ok(header, 'the panel has no header row');
  const close = within(header!).find((el) => el.type === 'button' && el.props['aria-label'] === 'Close');
  assert.ok(close, 'the × "Close" is not in the header row');
  assert.ok(hasClass(close!, 'ui-close'), 'the close control is not the site\'s ui-close');
  assert.equal(textOf(close!), '×');
  const body = within(panel).find((el) => part(el) === 'pick-panel-body');
  assert.ok(body && !within(body).includes(close!), 'the × is inside the panel\'s scrolling body');
  const field = searchOf(page);
  assert.equal(field.props['aria-label'], W.S2);
  assert.equal(field.props.placeholder, W.S2);
});

test('W1-6 (R6): the × closes the panel, Escape closes it, and choosing the option again, already chosen, opens it again', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  await page.click(within(panelOf(page)).find((el) => el.props['aria-label'] === 'Close')!);
  await settle(page);
  assert.equal(parts(page, 'pick-panel').length, 0, 'the × did not close the panel');
  await choose(page, W.pick);
  assert.equal(parts(page, 'pick-panel').length, 1, 'choosing the option again did not open the panel');
  await page.key(panelOf(page), 'Escape');
  await settle(page);
  assert.equal(parts(page, 'pick-panel').length, 0, 'Escape did not close the panel');
});

test('W1-6 (R1): before any words, the panel lists the site\'s set-up sources only, in Settings\' order', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  assert.deepEqual(rowIds(page), IDS);
  assert.ok(!page.text().includes(W.S6a), 'a not-set-up source is listed before any words');
  // A query with no searchable word reads as no words: the same list, and no S3.
  await search(page, 'the of and');
  assert.deepEqual(rowIds(page), IDS);
  assert.ok(!page.text().includes(W.S3), 'S3 shows for a query with no searchable word');
});

test('W1-6 (S3; D2 = A, S6a): S3 only for a searchable query with no hit; a hit the site has not set up shows S6a, no control and no pick', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  await search(page, 'zzqx');
  assert.ok(page.text().includes(W.S3), 'S3 does not show for a searchable query with no hit');
  assert.deepEqual(rowIds(page), []);
  await search(page, 'charter administrative code rules');
  const charter = rowFor(page, 'nyc-charter');
  assert.equal(charter.props['data-row-kind'], 'not-set-up');
  assert.ok(textOf(charter).includes(W.S6a));
  assert.equal(pickBoxOf(charter), undefined, 'a not-set-up row has a pick control');
  assert.ok(!within(charter).some((el) => el.props.role === 'radiogroup'), 'a not-set-up row has a state control');
  assert.ok(!page.text().includes(W.S3));
});

test('W1-6 (D2 = A): a set-up hit is the Settings row, with its control and S4, the box named for its source', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  const row = rowFor(page, IDS[0]);
  assert.ok(within(row).some((el) => el.props.role === 'radiogroup' && el.props['aria-label'] === `${NAME[IDS[0]]}: On, Ask first or Off`), 'the row lacks the Settings control');
  const box = pickBoxOf(row)!;
  assert.equal(box.props['aria-label'], W.S4name(NAME[IDS[0]]));
  assert.ok(textOf(within(row).find((el) => part(el) === 'pick-control')!).includes(W.S4));
});

// --- W1-4: the Off row ------------------------------------------------------------------------------------------------------

test('W1-4 (B10): an Off row cannot be picked, and shows S5, until its control reads On or Ask first', async () => {
  const off = IDS[1];
  const page = await askPage({ [off]: 'off' });
  await choose(page, W.pick);
  const box = pickBoxOf(rowFor(page, off))!;
  assert.equal(box.props.disabled, true, 'an Off row\'s pick control is enabled');
  assert.ok(textOf(rowFor(page, off)).includes(W.S5));
  // Its own control set to Ask first: now it can be picked.
  const askFirst = within(rowFor(page, off)).find((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'ask-first')!;
  await page.check(askFirst);
  await settle(page, 100);
  assert.equal(pickBoxOf(rowFor(page, off))!.props.disabled, false);
  assert.ok(!textOf(rowFor(page, off)).includes(W.S5));
  await pick(page, off);
  assert.equal(pickBoxOf(rowFor(page, off))!.props.checked, true);
});

test('W1-4 (fix round 1, item 1): the Off row\'s disabled pick control is described by S5, so its reason reaches every reader', async () => {
  const off = IDS[1];
  const page = await askPage({ [off]: 'off' });
  await choose(page, W.pick);
  const row = rowFor(page, off);
  const box = pickBoxOf(row)!;
  assert.equal(box.props.disabled, true, 'premise: the Off row\'s pick control is disabled');
  const describedBy = box.props['aria-describedby'];
  assert.ok(typeof describedBy === 'string' && describedBy !== '', 'the Off row\'s pick control has no aria-describedby');
  const reason = within(row).find((el) => el.props.id === describedBy);
  assert.ok(reason, `aria-describedby names no element in the row: ${String(describedBy)}`);
  assert.equal(textOf(reason!), W.S5);
  // Decoy: an On row's pick control is described by nothing.
  assert.equal(pickBoxOf(rowFor(page, IDS[0]))!.props['aria-describedby'], undefined);
});

test('W1-4 (B10): a picked row set to Off loses its pick, and does not get it back when set On again', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  await pick(page, IDS[0]);
  assert.equal(await dataSourcesValue(page), W.S13(1));
  await choose(page, W.pick);
  const offRadio = within(rowFor(page, IDS[0])).find((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'off')!;
  await page.check(offRadio);
  await settle(page, 100);
  assert.equal(pickBoxOf(rowFor(page, IDS[0]))!.props.checked, false);
  assert.equal(await dataSourcesValue(page), W.S13(0));
  await choose(page, W.pick);
  const onRadio = within(rowFor(page, IDS[0])).find((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'on')!;
  await page.check(onRadio);
  await settle(page, 100);
  assert.equal(pickBoxOf(rowFor(page, IDS[0]))!.props.checked, false, 'the pick came back');
});

test('W1-4 pin (B10, G0-3 = A): a pick and an unpick write no consent state', async () => {
  const page = await askPage();
  if (store) {
    await choose(page, W.pick);
    const writes = () => sent.filter((r) => r.path === '/api/sources/consent' && r.method !== 'GET').length;
    const before = writes();
    await pick(page, IDS[0]);
    await pick(page, IDS[0]);
    assert.equal(writes(), before);
  }
  // At 15a52942 there is no pick: nothing to write, and the pin holds trivially; it is here for the head.
  assert.ok(true);
});

test('A13: the picker row\'s control writes what the Settings row writes, and confirms in the same words', async () => {
  const target = IDS[0];
  const page = await askPage();
  await choose(page, W.pick);
  const from = sent.length;
  await page.check(within(rowFor(page, target)).find((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'ask-first')!);
  await settle(page, 100);
  const pickerWrites = sent.slice(from).filter((r) => r.path === '/api/sources/consent' && r.method !== 'GET').map((r) => ({ method: r.method, body: r.body }));
  const pickerConfirmation = within(rowFor(page, target)).filter((el) => el.props.role === 'status').map(textOf);
  page.unmount();
  mounted.splice(mounted.indexOf(page), 1);
  sessions.rows.clear();
  answers();
  await consentWith();
  const settings = await mountPage(h(SettingsOverlay, { mount: 'page', initialTab: 'data-sources' }));
  const settingsRow = settings.elements().find((el) => el.type === 'li' && el.props['data-source'] === target)!;
  const from2 = sent.length;
  await settings.check(within(settingsRow).find((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'ask-first')!);
  await settle(settings, 100);
  const settingsWrites = sent.slice(from2).filter((r) => r.path === '/api/sources/consent' && r.method !== 'GET').map((r) => ({ method: r.method, body: r.body }));
  const after = settings.elements().find((el) => el.type === 'li' && el.props['data-source'] === target)!;
  const settingsConfirmation = within(after).filter((el) => el.props.role === 'status').map(textOf);
  assert.ok(settingsWrites.length > 0, 'premise: the Settings row wrote the change');
  assert.deepEqual(pickerWrites, settingsWrites);
  assert.ok(settingsConfirmation.length > 0, 'premise: the Settings row confirmed the change');
  assert.deepEqual(pickerConfirmation, settingsConfirmation);
});

// --- W1-6: under the box ------------------------------------------------------------------------------------------------

test('W1-6 (S13): the menu\'s value reads "0 picked" once the option is chosen, never "Auto", and counts the picks', async () => {
  const page = await askPage();
  assert.equal(await dataSourcesValue(page), 'Auto');
  await choose(page, W.pick);
  assert.equal(await dataSourcesValue(page), W.S13(0));
  await choose(page, W.pick);
  await pick(page, IDS[0]);
  await pick(page, IDS[2]);
  assert.equal(await dataSourcesValue(page), W.S13(2));
  // A16: Auto keeps the picks in memory; choosing the option again brings them back.
  await choose(page, W.inLoopAuto);
  assert.equal(await dataSourcesValue(page), 'Auto');
  await choose(page, W.pick);
  assert.equal(await dataSourcesValue(page), W.S13(2));
});

test('W1-6 (D3 = A, D6 = A): with picks, S7 names them and "Change" opens the panel; the where-line counts the picks; both links show', async () => {
  const page = await askPage();
  const autoLine = lineText(page, 'where-this-question-goes');
  await choose(page, W.pick);
  await pick(page, IDS[2]);
  await pick(page, IDS[0]);
  await page.click(within(panelOf(page)).find((el) => el.props['aria-label'] === 'Close')!);
  await settle(page);
  assert.deepEqual(lineText(page, 'picks-line'), [`${W.S7(`${NAME[IDS[0]]} and ${NAME[IDS[2]]}`)} ${W.S8}`]);
  const where = lineText(page, 'where-this-question-goes');
  assert.deepEqual(where, ['Where your question goes: the model service, the notebook runner and 2 data sources · Select sources']);
  assert.notDeepEqual(where, autoLine, 'premise: the where-line over every source differs');
  // Both links under the box: "Change" (the picker) and "Select sources" (Settings).
  assert.ok(page.elements().some((el) => el.type === 'a' && textOf(el) === W.settingsLink));
  const change = parts(page, 'picks-change')[0];
  assert.equal(textOf(change), W.S8);
  await page.click(change);
  await settle(page);
  await waitForPanel(page);
  assert.equal(parts(page, 'pick-panel').length, 1, '"Change" did not open the panel');
});

test('W1-6 (D3 = A, D4 = B): with the option chosen and nothing picked, the where-line is hidden; a send sends nothing and S9 shows', async () => {
  const page = await askPage();
  assert.equal(lineText(page, 'where-this-question-goes').length, 1, 'premise: the where-line shows under Auto');
  await choose(page, W.pick);
  assert.deepEqual(lineText(page, 'where-this-question-goes'), []);
  assert.deepEqual(lineText(page, 'pick-note'), [], 'S9 shows before a send');
  await ask(page, 'How many permits were issued?');
  assert.deepEqual(queries, [], 'a question was sent with nothing picked');
  assert.deepEqual(lineText(page, 'pick-note'), [W.S9]);
  assert.equal(page.elements().find((el) => el.type === 'button' && el.props['aria-label'] === 'Submit query')!.props.disabled, false, 'send was disabled (D4 = B keeps it enabled)');
});

test('fix round 2 (D4 = B): with the panel open, a send with nothing picked keeps the panel open and puts S9 right above it: box, trigger, S9, panel; closed, S9 stays under the chips (decoy)', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  assert.equal(parts(page, 'pick-panel').length, 1, 'premise: the panel is open');
  await ask(page, 'How many permits were issued?');
  assert.deepEqual(queries, [], 'a question was sent with nothing picked');
  assert.equal(parts(page, 'pick-panel').length, 1, 'the press that sent nothing closed the panel');
  const order = (els: HostElement[]) => {
    const all = page.elements();
    return els.map((el) => all.indexOf(el));
  };
  const box = page.elements().find((el) => el.type === 'textarea')!;
  const trigger = within(menuOf(page)).find((el) => el.props['aria-haspopup'] === 'menu')!;
  const note = parts(page, 'pick-note');
  assert.equal(note.length, 1, 'S9 does not show');
  assert.equal(textOf(note[0]), W.S9);
  assert.equal(note[0].props.role, 'status');
  const [b, t, n, p] = order([box, trigger, note[0], panelOf(page)]);
  assert.ok(b < t && t < n && n < p, `the order is not box, trigger, S9, panel: ${JSON.stringify({ box: b, trigger: t, s9: n, panel: p })}`);
  // Decoy: the panel closed, S9 sits where it always has, under the example chips.
  await page.click(within(panelOf(page)).find((el) => el.props['aria-label'] === 'Close')!);
  await settle(page);
  await ask(page, 'How many permits were issued?');
  const closedNote = parts(page, 'pick-note');
  assert.equal(closedNote.length, 1, 'premise: S9 shows with the panel closed');
  const [chips, n2] = order([parts(page, 'chip-row')[0], closedNote[0]]);
  assert.ok(chips >= 0 && chips < n2, 'with the panel closed, S9 is not under the example chips');
});

// --- The request, and the resend (A17) ------------------------------------------------------------------------------------

test('task 7: a picked question carries its picks in the statement\'s order; an Auto question\'s body is as it was, byte for byte', async () => {
  const page = await askPage();
  await ask(page, 'Auto question');
  assert.equal(queries.length, 1, 'premise: the Auto question was sent');
  assert.equal(queries[0].raw, JSON.stringify({ query: 'Auto question', model: 'fixture/model', portal: '' }));
  await choose(page, W.pick);
  await pick(page, IDS[2]);
  await pick(page, IDS[0]);
  await ask(page, 'Picked question');
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].body, { query: 'Picked question', model: 'fixture/model', portal: '', picks: [IDS[0], IDS[2]] });
  assert.equal(parts(page, 'pick-panel').length, 0, 'R4: the send did not close the panel');
});

test('A17: a resend carries the picks the question was sent with, not the page\'s current picks; an Auto resend carries none', async () => {
  const page = await askPage();
  await choose(page, W.pick);
  await pick(page, IDS[0]);
  await ask(page, 'Picked question');
  assert.equal(queries.length, 1);
  // The picks change after the send.
  await choose(page, W.pick);
  await pick(page, IDS[0]);
  await pick(page, IDS[2]);
  await page.click(page.button('Retry'));
  await settle(page, 100);
  assert.equal(queries.length, 2, 'premise: Retry resent the question');
  assert.deepEqual(queries[1].body.picks, [IDS[0]], `the resend carried ${JSON.stringify(queries[1].body.picks)}`);
  // Auto: the resend's body carries no picks.
  await choose(page, W.inLoopAuto);
  await ask(page, 'Auto question');
  await page.click(page.button('Retry'));
  await settle(page, 100);
  assert.equal(queries.length, 4);
  assert.ok(!('picks' in queries[3].body), 'an Auto resend carried picks');
});

// --- W1-5, the browser half (B11) --------------------------------------------------------------------------------------------

test('W1-5: the page sends no request while the reader opens the picker, types, picks and unpicks (the spy is shown catching one first)', async () => {
  const page = await askPage();
  // The spy catches a request: the page's own fetch.
  const before = sent.length;
  await fetch('/api/rate-limit');
  assert.equal(sent.length, before + 1, 'the spy did not see a request');
  const from = sent.length;
  await choose(page, W.pick);
  await search(page, 'restaurant inspections grades');
  await search(page, 'city spending contracts');
  await pick(page, IDS[0]);
  await pick(page, IDS[0]);
  assert.deepEqual(sent.slice(from).map((r) => `${r.method} ${r.path}`), [], 'a request left the page');
  assert.ok(parts(page, 'pick-panel').length === 1, 'premise: the picker was open');
});

test('W1-5 pin: the flows statement\'s bytes and hash are the base\'s', () => {
  // Measured at 15a52942 with this file's environment.
  assert.equal(statementHash(statement), STATEMENT_HASH_AT_BASE);
  assert.equal(statementHash(statement), (createHashOf(serializeFlowsStatement(statement))));
});

const createHashOf = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const STATEMENT_HASH_AT_BASE = '1b2fb5a80abbe26ecc7a9f72ec750db26cf1537b6cd6487499efb4992644bdba';
