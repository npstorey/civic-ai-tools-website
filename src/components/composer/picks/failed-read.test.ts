// FIX-1 FX1 (website #807; #798, and #786 items 1 and 4): the question box and Settings after a failed read, on the
// owner's G0 rulings D1 = B, D2 = A, D3 = E0 and D9 = A (OA-1101, OA-1109).
//
// WHAT IS DRIVEN. `/ask`'s real mount (`QuerySurface`, answer-first, Sandbox by default) and the Settings overlay, on the
// surface harness (`registerHooks` + the real `renderToStaticMarkup`), as `picker-surfaces.test.ts` drives them: the
// consent is written through the real consent route, the flows statement is the real route's, the decision route and
// `/api/flows` answer per case, and every other request is recorded and answered here.
//
// WHAT MAKES IT ABLE TO FAIL.
//   - #798: the source is picked and shown in S7 before the decision read fails (the premise), so only the failed read
//     can drop it; the send's body is read, not the line.
//   - #786 item 1: the re-read is counted by the requests the page made, so a send that never read again cannot pass
//     the recovery case; the held case's line is compared word for word, and S9 is looked for in the whole page.
//   - #786 item 4: the same overlay with the read good lists every configured source (the decoy), so a sentence shown
//     whatever the read did fails it.
//   - #798's second symptom: the panel is open before each read (the premise); a later good read is driven after a
//     failed one, and after one that names all-sources.
//
// BLIND SPOTS, stated. No layout, no focus, no browser (the harness's own). #786 item 3 (focus in view after Settings
// closes) is FX0's check 6 in Chrome, not here; acceptance 1 and 2 are also driven in Chrome (the K1 driver).
//
// RED at 8cd8f184 (rollback/pre-fix1-fx1): every test below fails at an assertion except the two marked `pin`.
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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
import { within } from '../../ui/ui-test-helpers.ts';

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
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const { cancelConsentPauses, refreshConsent } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);
const { readerSourceName } = await load('lib/sources/source-name.ts');
const NAME: Record<string, string> = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, readerSourceName(s)]));
const store = await load('components/composer/picks/store.ts');

// --- The ruled words, byte for byte ---------------------------------------------------------------------------------------

const W = {
  ds: 'Data sources',
  pick: 'Only the ones I pick',
  inLoopAuto: 'Auto - find sources for me',
  S7: (names: string) => `Your question can use only these data sources: ${names}.`,
  S8: 'Change',
  S9: 'No data source is picked, so nothing was sent. Pick at least one, or choose Auto.',
  S13: (n: number) => `${n} picked`,
  /** D2 = A, D3 = E0 (OA-1109; Seat ruling 7047874247). */
  E0: 'Your picked data sources could not be loaded just now, so nothing was sent. Try again in a moment, or choose Auto.',
  /** D9 = A (OA-1101). */
  N2: 'Data sources could not be loaded just now, so none are listed. Close Settings and open it again to try again.',
};
const PICKED = 'socrata';

// --- The answers ---------------------------------------------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** What the decision route's GET answers, and whether `/api/flows` answers 503; read at each request. */
let decision: { routing: string; store: boolean } | 'fail' = { routing: 'in-loop', store: true };
let flowsFail = false;
let queries: Array<{ path: string; raw: string; body: Json }> = [];
let sent: Array<{ method: string; path: string; body: string }> = [];

function answers() {
  decision = { routing: 'in-loop', store: true };
  flowsFail = false;
  queries = [];
  const installed = installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => (flowsFail ? json({ error: 'fixture' }, 503) : flowsRoute.GET()),
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

async function consentAllOn(): Promise<void> {
  const all = Object.fromEntries(IDS.map((id) => [id, 'on']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
}

const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

const mounted: Surface[] = [];
beforeEach(() => {
  storage.clear();
  sessions.rows.clear();
  store.resetPicksForTests();
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
async function askPage(): Promise<Surface> {
  SIGNED_IN();
  answers();
  await consentAllOn();
  return mountPage(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
}

// --- Reading the page ---------------------------------------------------------------------------------------------------

const part = (el: HostElement): unknown => el.props['data-part'];
const parts = (page: Surface, name: string): HostElement[] => page.elements().filter((el) => part(el) === name);
const lineText = (page: Surface, name: string): string[] => parts(page, name).map((el) => textOf(el));
const ROLES = ['menuitem', 'menuitemradio'];
const labelOf = (el: HostElement): string => textOf(within(el).find((x) => String(x.props.className ?? '').split(' ').includes('ui-menu-item-label')) ?? el);
const menuOf = (page: Surface): HostElement => page.elements().find((el) => part(el) === 'harness-menu')!;

async function openDataSources(page: Surface): Promise<HostElement> {
  if (!within(menuOf(page)).some((el) => el.props.role === 'menu')) {
    await page.click(within(menuOf(page)).find((el) => el.props['aria-haspopup'] === 'menu')!);
    await settle(page);
  }
  const panel = within(menuOf(page)).find((el) => el.props.role === 'menu')!;
  if (!within(panel).some((el) => el.props.role === 'menuitemradio')) {
    await page.click(within(panel).find((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === W.ds)!);
    await settle(page);
  }
  return within(menuOf(page)).find((el) => el.props.role === 'menu')!;
}
async function dataSourcesValue(page: Surface): Promise<string | null> {
  const panel = await openDataSources(page);
  const row = within(panel).find((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === W.ds)!;
  const value = within(row).find((x) => String(x.props.className ?? '').split(' ').includes('ui-menu-item-value'));
  return value ? textOf(value) : null;
}
async function choosePick(page: Surface): Promise<void> {
  const panel = await openDataSources(page);
  await page.click(within(panel).find((el) => el.props.role === 'menuitemradio' && labelOf(el) === W.pick)!);
  await settle(page);
  for (let i = 0; i < 50 && parts(page, 'pick-panel').length === 0; i += 1) await settle(page, 10);
}
async function pick(page: Surface, id: string): Promise<void> {
  const row = page.elements().find((el) => el.type === 'li' && el.props['data-source'] === id && part(el) !== 'not-set-up');
  assert.ok(row, `premise: the picker's row for ${id}`);
  const box = within(row!).find((el) => el.type === 'input' && el.props.type === 'checkbox');
  assert.ok(box, `premise: ${id}'s row has a pick control`);
  await page.check(box!);
  await settle(page);
}
async function closePanel(page: Surface): Promise<void> {
  const panel = parts(page, 'pick-panel')[0];
  await page.click(within(panel).find((el) => el.props['aria-label'] === 'Close')!);
  await settle(page);
}
async function ask(page: Surface, question: string): Promise<void> {
  const box = page.elements().find((el) => el.type === 'textarea');
  assert.ok(box, 'premise: the question box');
  await page.type(box!, question);
  await page.submit(page.elements().find((el) => el.type === 'form' && within(el).some((x) => x.type === 'textarea'))!);
  for (let i = 0; i < 5; i += 1) await settle(page, 20);
}
async function refreshed(page: Surface): Promise<void> {
  await refreshConsent();
  for (let i = 0; i < 5; i += 1) await settle(page, 10);
}
const flowsReads = () => sent.filter((r) => r.method === 'GET' && r.path === '/api/flows').length;

/** `/ask`, "Only the ones I pick" chosen, Socrata picked, the panel closed: S7 names it (the premise). */
async function pickedPage(): Promise<Surface> {
  const page = await askPage();
  assert.ok(IDS.includes(PICKED), `premise: the statement lists ${PICKED}`);
  await choosePick(page);
  await pick(page, PICKED);
  await closePanel(page);
  assert.deepEqual(lineText(page, 'picks-line'), [`${W.S7(NAME[PICKED])} ${W.S8}`], 'premise: S7 names the pick');
  assert.equal(await dataSourcesValue(page), W.S13(1), 'premise: the menu counts the pick');
  return page;
}

// --- Acceptance 1, #798 (D1 = B) ---------------------------------------------------------------------------------------------

test('#798 (D1 = B): after a pick, the decision read answers 503; S7 and "1 picked" stay, and the send carries the pick', async () => {
  const page = await pickedPage();
  decision = 'fail';
  await refreshed(page);
  assert.deepEqual(lineText(page, 'picks-line'), [`${W.S7(NAME[PICKED])} ${W.S8}`], 'the failed read dropped S7');
  assert.equal(await dataSourcesValue(page), W.S13(1), 'the failed read dropped the menu\'s count');
  await ask(page, 'Picked question');
  assert.equal(queries.length, 1, 'premise: the question was sent');
  assert.ok(queries[0].raw.includes(`"picks":["${PICKED}"]`), `the send's body: ${queries[0].raw}`);
});

test('pin: with every read good, a picked question\'s body carries "picks":["socrata"] (the cold read\'s control)', async () => {
  const page = await pickedPage();
  await ask(page, 'Picked question');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].raw, JSON.stringify({ query: 'Picked question', model: 'fixture/model', portal: '', picks: [PICKED] }));
});

// --- Acceptance 2, #786 item 1 (D2 = A, D3 = E0) ---------------------------------------------------------------------------

test('#786 item 1 (D2 = A): the flows read fails and its re-read on Send fails too: nothing is sent, E0 shows word for word, S9 nowhere', async () => {
  const page = await pickedPage();
  flowsFail = true;
  await refreshed(page);
  const before = flowsReads();
  await ask(page, 'Picked question');
  assert.deepEqual(queries, [], 'a question was sent');
  assert.ok(flowsReads() > before, 'the send did not read /api/flows again');
  assert.deepEqual(lineText(page, 'pick-note'), [W.E0]);
  assert.equal(parts(page, 'pick-note')[0].props.role, 'status');
  assert.ok(!page.text().includes(W.S9), 'S9 shows with a source picked');
});

test('#786 item 1 (D2 = A): the flows read fails and its re-read on Send succeeds: the send goes, with its picks, and no held line', async () => {
  const page = await pickedPage();
  flowsFail = true;
  await refreshed(page);
  flowsFail = false;
  const before = flowsReads();
  await ask(page, 'Picked question');
  assert.ok(flowsReads() > before, 'the send did not read /api/flows again');
  assert.equal(queries.length, 1, 'the question was not sent after the re-read succeeded');
  assert.deepEqual(queries[0].body.picks, [PICKED]);
  assert.deepEqual(lineText(page, 'pick-note'), []);
});

// --- Acceptance 4, #786 item 4 (D9 = A) ----------------------------------------------------------------------------------

async function settingsPage(failing: boolean): Promise<Surface> {
  SIGNED_IN();
  answers();
  await consentAllOn();
  flowsFail = failing;
  return mountPage(h(SettingsOverlay, { mount: 'page' }));
}
/** What the overlay renders in the list's place: the elements between the search field and the local-only offer. */
function listPlace(page: Surface): string[] {
  const all = page.elements();
  const search = all.findIndex((el) => el.type === 'input' && el.props.type === 'search');
  assert.ok(search >= 0, 'premise: the search field');
  const ul = all.find((el, i) => i > search && el.type === 'ul');
  const notLoaded = parts(page, 'sources-not-loaded');
  // S4 W2a: a group's head is an `li` too, holding its rows' list: the count is of the sources' rows.
  return [...(ul ? [`ul:${within(ul).filter((el) => el.type === 'li' && el.props['data-source'] !== undefined).length}`] : []), ...notLoaded.map((el) => textOf(el))];
}

test('#786 item 4 (D9 = A): with /api/flows failing, Settings shows N2 word for word in the list\'s place, and nothing else there', async () => {
  const page = await settingsPage(true);
  assert.deepEqual(listPlace(page), [W.N2]);
  assert.equal(page.text().split(W.N2).length - 1, 1, 'N2 shows other than once');
});

test('pin (decoy): with /api/flows good, the same overlay lists every configured source and shows no N2', async () => {
  const page = await settingsPage(false);
  assert.deepEqual(listPlace(page), [`ul:${IDS.length}`]);
  assert.ok(!page.text().includes(W.N2));
});

// --- #798's second symptom (part 5) --------------------------------------------------------------------------------------

test('#798 second symptom: the panel open, a failed decision read, then a good one: the panel stays as the reader left it, open', async () => {
  const page = await askPage();
  await choosePick(page);
  await pick(page, PICKED);
  assert.equal(parts(page, 'pick-panel').length, 1, 'premise: the panel is open');
  decision = 'fail';
  await refreshed(page);
  const afterFailed = parts(page, 'pick-panel').length;
  decision = { routing: 'in-loop', store: true };
  await refreshed(page);
  assert.deepEqual({ afterFailed, afterGood: parts(page, 'pick-panel').length }, { afterFailed: 1, afterGood: 1 });
});

test('#798 second symptom: the panel open, a read that names all-sources hides it; a later in-loop read does not reopen it unasked', async () => {
  const page = await askPage();
  await choosePick(page);
  await pick(page, PICKED);
  assert.equal(parts(page, 'pick-panel').length, 1, 'premise: the panel is open');
  decision = { routing: 'all-sources', store: true };
  await refreshed(page);
  assert.equal(parts(page, 'pick-panel').length, 0, 'premise: all-sources hides the panel');
  decision = { routing: 'in-loop', store: true };
  await refreshed(page);
  assert.equal(parts(page, 'pick-panel').length, 0, 'a later good read reopened the panel unasked');
  assert.deepEqual(lineText(page, 'picks-line'), [`${W.S7(NAME[PICKED])} ${W.S8}`], 'premise: the picks came back with the read');
});
