// UX-2 P3b-2 (#729), criteria 1, 2, 3 and 5, with the seat's rulings on the first measurements (#729 6865424128):
// the harness menu that replaces the gear, the Advanced-options region and the portal picker.
//
// THE RULE. One `Menu` in the composer (`data-part="harness-menu"`), its trigger in the box after the arrow (fixes 3
// and 4), reading "Default harness", its accessible name carrying the model's full name (fix 3's check). Its panel,
// wide (fix 1), holds, in order: the heading row, Model, Data sources, Session type, Compare with a second harness, a
// rule, All settings (2B). Data sources words itself by the instance's routing through one predicate with the Settings
// row (v2 ruling 1). Signed out where sign-in is offered: the heading, Model disabled, Data sources, a rule, and "Sign in
// for more options" doing what the header's Sign in does (2C). Where sign-in is not offered: 2B's items, Model live,
// Sandbox disabled with today's words for its state (v2 ruling 4; fix 10). `/explore`: Model and Data sources only
// (2E; v3 conflict ruling 2). Both settings items carry `SETTINGS_HREF` (fix 6).
//
// WHAT IS DRIVEN. The real home page, `/ask`'s mount and `/explore`, on the surface harness; the consent written
// through the real consent route; the decision route answered per fixture; every query route recorded.
//
// WHAT MAKES IT ABLE TO FAIL. At P3b-2's base there is no harness menu: every test here fails at its first assertion
// on `data-part="harness-menu"`. The fixtures that can fail once it exists (the contract's): the decision route
// answering in-loop with no store (a menu that reads `routing` alone shows the in-loop form there), all-sources with
// the store (one that reads `store` alone), and a failed read (one that falls back to in-loop); a catalog of two models
// whose second is chosen (a menu that keeps the first sends it); one provider configured beside none (a menu keyed on
// the session alone shows the same items in both).
//
// BLIND SPOTS, stated. No layout, focus or keyboard: the panel's width, the cap at open (fix 2), the trigger's place
// below and above 640 px, Escape and the arrow keys are the instrument's reads (`temp/ux-2/p3b-measure/p3b2/`, criterion
// 10). The model name's visible cut at 900 px and up is CSS; here only the accessible name is read. The words are the
// contract's Words table, written out below; `ruled-words-surfaces.test.ts` reads them as rows too (criterion 9).
// Compare's values are pending the words check (criterion 13) and are kept in one place, `PENDING_COMPARE`.
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Fragment, type ComponentType, type ReactElement } from 'react';
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
import { hasClass, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  // signIn records the provider it starts, so the menu's button can be read doing what the header's does.
  'next-auth/react': `
    const S = globalThis.__w3Sessions;
    export function useSession() { return { status: S.client.status, data: S.client.data, update: async () => S.client.data }; }
    export async function signIn(id) { (globalThis.__p3b2SignIns ??= []).push(id ?? null); }
    export async function signOut() {}
    export function SessionProvider({ children }) { return children; }`,
  // `/explore`'s BPMN canvas: a browser-only library and a stylesheet import.
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
const signIns = (): unknown[] => ((globalThis as unknown as { __p3b2SignIns?: unknown[] }).__p3b2SignIns ??= []);

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const { SignInOptionsProvider } = await load('components/SignInOptionsProvider.tsx');
const { NotebookModeProvider } = await load('components/NotebookModeProvider.tsx');
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const { SIGN_IN_PANEL_HREF } = await load('lib/host-links.ts');
const { NOTEBOOK_MODE_UNAVAILABLE_REASON } = await load('lib/notebook-availability.ts');
const { ASK_FIRST_MEANS, ASK_FIRST_MEANS_WITH_PAUSE, SETTINGS_HREF } = await load('lib/sources/copy.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
/** The sources the statement lists, read from it, never a fixed list (the v4 rider). */
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

// --- The ruled words (contract p3b-2.md v4, Words; the seat's rulings 6865424128), byte for byte ------------------

const W = {
  trigger: 'Default harness',
  heading: 'Harness · Civic AI harness v1',
  model: 'Model',
  ds: 'Data sources',
  auto: 'Auto',
  inLoop: {
    label: 'Auto - find sources for me',
    desc: 'The model chooses which data sources to use, from those you set On or Ask first.',
    reason: 'Not offered on this site yet. The model chooses from the data sources you set On or Ask first.',
  },
  allSources: {
    label: 'Auto - use every source I set On',
    desc: 'Every data source you set On is given to the model from the start. Sources set to Ask first are not used.',
    reason: 'Not offered on this site yet. Every data source you set On is given to the model.',
  },
  pick: 'Only the ones I pick',
  footer: 'All data sources and your consent',
  session: 'Session type',
  sandbox: 'Sandbox',
  standard: 'Standard',
  notebookDesc: 'Generates and executes a Jupyter notebook against live data. Typically 30 to 90 seconds. The notebook and a cryptographic execution record are signed by this site.',
  compare: 'Compare with a second harness',
  compareDesc: 'Adds a second answer from training data alone, side by side. Runs one extra model call per question.',
  compareReason: 'Not offered in a Sandbox session. Switch Session type to Standard to compare.',
  all: 'All settings',
  signOutModel: 'Sign in to choose a model.',
  signInMore: 'Sign in for more options',
  /** Where no sign-in is offered, the Sandbox option's reason (fix 10), as the owner ruled it (D1 = B, #729 6877110969). */
  noSignInSandbox: 'Not offered on this site: a Sandbox session needs you to sign in, and this site has no sign-in.',
};
/** Compare's values: pending the words check (criterion 13; v2 ruling 3), in one place. */
const PENDING_COMPARE = { on: 'On', off: 'Off' };
/** The words the gear and its region carried, which no surface may say any more (criterion 9). */
const RETIRED = ['Advanced options', 'Response mode', 'Data portal', 'panel', 'Not now'];

/** A catalog of two, the first named long enough to be cut at the trigger (fix 3's check reads the full name). */
const CAT = [
  { id: 'fixture/first', name: 'Fixture first model with a name long enough to be cut at the trigger', tag: 'recommended' },
  { id: 'fixture/second', name: 'Second fixture model', tag: 'premium' },
];
const SPLIT_SIGN_IN = 'https://app.fixture.example/ask';

// --- The answers ----------------------------------------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (events: Json[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/** The decision route's answer for a fixture: a routing and store pair, or a failed read. */
type Routing = { routing: string; store: boolean } | 'fail';
let decision: Routing = { routing: 'in-loop', store: true };
let queries: Array<{ path: string; body: Json }> = [];

function answers(routing: Routing = { routing: 'in-loop', store: true }) {
  decision = routing;
  queries = [];
  return installFetch(ORIGIN, {
    '/api/models': () => json({ models: CAT }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => (decision === 'fail' ? json({ error: 'fixture' }, 503) : json(decision)),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: sessions.server !== null }),
    '/api/compare-stream': async (request: Request) => {
      const body = JSON.parse(await request.text() || '{}') as Json;
      queries.push({ path: '/api/compare-stream', body });
      const panels = body.mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
      return sse(panels.map((panel) => ({ type: 'complete', panel, data: { content: 'A fixture answer.', duration_ms: 1, tools_called: [] } })));
    },
    '/api/query-notebook': async (request: Request) => {
      queries.push({ path: '/api/query-notebook', body: JSON.parse(await request.text() || '{}') as Json });
      return json({ error: 'fixture' }, 500);
    },
  });
}

/** A consent in force through the real PUT: each source as `states` says, else `rest`. */
async function consentWith(states: Record<string, string> = {}, rest = 'on'): Promise<void> {
  const all = Object.fromEntries(IDS.map((id) => [id, states[id] ?? rest]));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
}

const ANON = () => { sessions.server = null; sessions.client = { status: 'unauthenticated', data: null }; };
const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

const ASK = () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' });
const HOME = () => h(Home);
const EXPLORE = () => h(McpFlowDiagram);
/** The reference deployment's shape: sign-in lives on the app host. */
const split = (child: ReactElement) => h(HostLinksProvider, { value: { marketingOrigin: '', signInHref: SPLIT_SIGN_IN } }, child);
/** An instance that configured no sign-in at all: no provider, no sign-in address. */
const noSignIn = (child: ReactElement) => h(SignInOptionsProvider, { value: [] }, child);
const twoProviders = (child: ReactElement) => h(SignInOptionsProvider, { value: [{ id: 'github', name: 'GitHub' }, { id: 'fixture-oidc', name: 'Fixture OIDC' }] }, child);

const mounted: Surface[] = [];
beforeEach(() => {
  storage.clear();
  sessions.rows.clear();
  signIns().length = 0;
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

// --- Reading the menu -------------------------------------------------------------------------------------------------

const part = (el: HostElement): unknown => el.props['data-part'];
function composerOf(page: Surface): HostElement {
  const found = page.elements().filter((el) => part(el) === 'composer');
  assert.equal(found.length, 1, `expected one data-part="composer", found ${found.length}`);
  return found[0];
}
/** The one harness menu inside the composer. */
function menuOf(page: Surface): HostElement {
  const found = within(composerOf(page)).filter((el) => part(el) === 'harness-menu');
  assert.equal(found.length, 1, `data-part="harness-menu" inside the composer: ${found.length}; the composer reads: ${textOf(composerOf(page)).slice(0, 300)}`);
  return found[0];
}
function triggerOf(page: Surface): HostElement {
  const found = within(menuOf(page)).filter((el) => el.props['aria-haspopup'] === 'menu');
  assert.equal(found.length, 1, `the harness menu's trigger (aria-haspopup="menu"): ${found.length}`);
  return found[0];
}
function panelOf(page: Surface): HostElement {
  const found = within(menuOf(page)).filter((el) => el.props.role === 'menu');
  assert.equal(found.length, 1, `the harness menu's open panel (role="menu"): ${found.length}`);
  return found[0];
}
async function open(page: Surface): Promise<HostElement> {
  if (within(menuOf(page)).some((el) => el.props.role === 'menu')) return panelOf(page);
  await page.click(triggerOf(page));
  await settle(page);
  return panelOf(page);
}
const ROLES = ['menuitem', 'menuitemradio'];
const byClassIn = (el: HostElement, name: string): HostElement[] => within(el).filter((x) => hasClass(x, name));
function labelOf(el: HostElement): string {
  const label = byClassIn(el, 'ui-menu-item-label')[0];
  return textOf(label ?? el);
}
/** The panel's rows in order: 'heading', each item's label, 'rule', and the sign-in control by its words. */
function sequence(panel: HostElement): string[] {
  const out: string[] = [];
  for (const el of within(panel)) {
    if (el.type === 'hr' && el.props.role === 'separator') out.push('rule');
    else if (hasClass(el, 'ui-menu-heading')) out.push('heading');
    else if (ROLES.includes(String(el.props.role))) out.push(labelOf(el));
    else if ((el.type === 'a' || el.type === 'button') && textOf(el) === W.signInMore) out.push(W.signInMore);
  }
  return out.filter((x, i) => x !== out[i - 1]);
}
function rowIn(panel: HostElement, label: string): HostElement {
  const found = within(panel).filter((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === label);
  assert.equal(found.length, 1, `the row "${label}": ${found.length}; the panel reads ${JSON.stringify(sequence(panel))}`);
  return found[0];
}
const hasRow = (panel: HostElement, label: string): boolean => within(panel).some((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === label);
const valueOf = (row: HostElement): string | null => { const v = byClassIn(row, 'ui-menu-item-value')[0]; return v ? textOf(v) : null; };
const descriptionsOf = (row: HostElement): string[] => byClassIn(row, 'ui-menu-item-description').map((el) => textOf(el));
const reasonsOf = (row: HostElement): string[] => byClassIn(row, 'ui-menu-item-reason').map((el) => textOf(el));
const disabled = (row: HostElement): boolean => row.props['aria-disabled'] === true || row.props['aria-disabled'] === 'true';
const checked = (row: HostElement): boolean => row.props['aria-checked'] === true || row.props['aria-checked'] === 'true';
/** Expand a group by a click on its row (2A: Enter, Space or a click opens it inline), and return the panel. */
async function expand(page: Surface, label: string): Promise<HostElement> {
  await page.click(rowIn(await open(page), label));
  await settle(page);
  return panelOf(page);
}
/** A group's expanded children: the radios after its row, up to the next top-level row. */
function radiosOf(panel: HostElement): HostElement[] {
  return within(panel).filter((el) => el.props.role === 'menuitemradio');
}
/** Every sign-in control: a link or button reading "Sign in…" (the reason's words are text, not a control). */
const signInControls = (el: HostElement): HostElement[] => within(el).filter((x) => (x.type === 'a' || x.type === 'button') && /^sign in/i.test(textOf(x)));

async function ask(page: Surface, question: string): Promise<void> {
  const box = within(composerOf(page)).find((el) => el.type === 'textarea');
  assert.ok(box, 'premise: the question box');
  await page.type(box!, question);
  const form = page.elements().find((el) => el.type === 'form' && within(el).some((x) => x.type === 'textarea'));
  await page.submit(form!);
  await settle(page, 100);
}
const whereLine = (page: Surface): string[] => page.elements().filter((el) => part(el) === 'where-this-question-goes').map((el) => textOf(el));
const WHERE = {
  standardOne: 'Where your question goes: the model service and 1 data source · Select sources',
  sandboxOne: 'Where your question goes: the model service, the notebook runner and 1 data source · Select sources',
};
const oneOn = (): Record<string, string> => Object.fromEntries(IDS.map((id, i) => [id, i === 0 ? 'on' : 'off']));

async function openLive(page: Surface): Promise<void> {
  await page.click(page.button('Try your own'));
  await settle(page);
}

// --- Criterion 1 (2B), /ask signed in ---------------------------------------------------------------------------------

test('P3b-2 criterion 1 (2B; fixes 1, 3, 4, 6): /ask signed in: one harness menu in the composer, its trigger in the box after the arrow, reading "Default harness" and named with the full model; the wide panel holds the heading row, Model, Data sources, Session type, Compare, a rule and All settings, in order, with their values', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(ASK());
  const menu = menuOf(page);
  const form = page.elements().find((el) => el.type === 'form' && within(el).some((x) => x.type === 'textarea'));
  assert.ok(form && within(form).includes(menu), 'the harness menu is not in the box (inside the composer\'s <form>, fix 3)');
  const order = page.elements();
  const arrow = within(form!).find((el) => el.type === 'button' && el.props.type === 'submit');
  assert.ok(arrow && order.indexOf(arrow) < order.indexOf(menu), 'the trigger does not come after the arrow in the document (fix 4)');
  const trigger = triggerOf(page);
  assert.ok(textOf(trigger).startsWith(W.trigger), `the trigger reads ${JSON.stringify(textOf(trigger))}`);
  assert.equal(trigger.props['aria-label'], `${W.trigger} · ${CAT[0].name}`, 'the trigger\'s accessible name does not carry the full model name (fix 3)');

  const panel = await open(page);
  assert.ok(hasClass(panel, 'ui-menu-panel--wide'), 'the panel is not the wide harness panel (fix 1)');
  assert.deepEqual(sequence(panel), ['heading', W.model, W.ds, W.session, W.compare, 'rule', W.all], 'the panel\'s rows, in order');
  assert.equal(textOf(byClassIn(panel, 'ui-menu-heading')[0]), W.heading, 'the heading row');
  assert.deepEqual(
    [valueOf(rowIn(panel, W.model)), valueOf(rowIn(panel, W.ds)), valueOf(rowIn(panel, W.session)), valueOf(rowIn(panel, W.compare))],
    [CAT[0].name, W.auto, W.sandbox, PENDING_COMPARE.off],
    'the values: the model in use, "Auto", "Sandbox" by default on /ask, Compare Off',
  );
  const all = rowIn(panel, W.all);
  assert.deepEqual([all.type, all.props.href], ['a', SETTINGS_HREF], 'All settings is not a link to SETTINGS_HREF (fix 6)');
});

test('P3b-2 criterion 1 (2B item 2): Model lists the catalog as radios, the model in use checked, each with its tag; choosing the second changes the model the next question sends', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(ASK());
  const panel = await expand(page, W.model);
  const radios = radiosOf(panel);
  assert.deepEqual(radios.map((el) => labelOf(el)), CAT.map((m) => m.name), 'the catalog\'s models, in order');
  assert.deepEqual(radios.map((el) => checked(el)), [true, false], 'the model in use is not the one checked');
  for (const [i, el] of radios.entries()) assert.ok(textOf(el).includes(CAT[i].tag), `the row "${CAT[i].name}" lacks its tag`);
  await page.click(radios[1]);
  await settle(page);
  assert.equal(within(menuOf(page)).filter((el) => el.props.role === 'menu').length, 0, 'choosing a model left the menu open');
  assert.equal(triggerOf(page).props['aria-label'], `${W.trigger} · ${CAT[1].name}`, 'the trigger does not name the chosen model');
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  assert.equal(queries.length, 1, `premise: one question sent, ${queries.length}`);
  assert.equal(queries[0].body.model, CAT[1].id, 'the question did not send the chosen model');
});

for (const [name, routing, form] of [
  ['in-loop with the store', { routing: 'in-loop', store: true }, 'in-loop'],
  ['all-sources with the store', { routing: 'all-sources', store: true }, 'all-sources'],
  ['in-loop with no store', { routing: 'in-loop', store: false }, 'all-sources'],
  ['the decision read failed (503)', 'fail', 'all-sources'],
] as const) {
  test(`P3b-2 criterion 1 (2B item 3; v2 ruling 1): ${name}: Data sources reads the ${form} form, byte for byte, and the Settings row's Ask-first words agree`, async () => {
    SIGNED_IN();
    answers(routing as Routing);
    await consentWith({ [IDS[0]]: 'ask-first' });
    const page = await mountPage(h(Fragment, null, ASK(), h(SettingsOverlay, { mount: 'page', initialTab: 'data-sources' })));
    const panel = await expand(page, W.ds);
    const words = form === 'in-loop' ? W.inLoop : W.allSources;
    const radios = radiosOf(panel);
    assert.deepEqual(radios.map((el) => [labelOf(el), checked(el), disabled(el), descriptionsOf(el), reasonsOf(el)]), [
      [words.label, true, false, [words.desc], []],
      [W.pick, false, true, [], [words.reason]],
    ], 'the two options: the first checked with its description; "Only the ones I pick" disabled, its reason its only line');
    const footer = within(panel).filter((el) => el.type === 'a' && textOf(el) === W.footer);
    assert.deepEqual(footer.map((el) => el.props.href), [SETTINGS_HREF], 'the footer is not one link to SETTINGS_HREF (fix 6)');
    const row = page.elements().filter((el) => el.props['data-source'] === IDS[0]).map((el) => textOf(el));
    assert.equal(row.length, 1, 'premise: the Settings row for the Ask-first source');
    const rowSays = row[0].includes(ASK_FIRST_MEANS_WITH_PAUSE) ? 'in-loop' : row[0].includes(ASK_FIRST_MEANS) ? 'all-sources' : 'neither';
    assert.equal(rowSays, form, 'the Settings row and the menu word Ask first differently');
  });
}

test('P3b-2 criterion 1 (2B item 4; 2D): Session type holds Standard and Sandbox, Sandbox checked on /ask with its description; choosing Standard then Sandbox moves the where-line and the route the surface calls', async () => {
  SIGNED_IN();
  answers();
  await consentWith(oneOn());
  const page = await mountPage(ASK());
  assert.deepEqual(whereLine(page), [WHERE.sandboxOne], 'premise: /ask starts in Sandbox');
  let panel = await expand(page, W.session);
  const radios = radiosOf(panel);
  assert.deepEqual(radios.map((el) => [labelOf(el), checked(el), descriptionsOf(el)]), [
    [W.standard, false, []],
    [W.sandbox, true, [W.notebookDesc]],
  ], 'the two session types');
  await page.click(radios[0]);
  await settle(page);
  assert.deepEqual(whereLine(page), [WHERE.standardOne], 'the where-line did not follow Standard');
  await ask(page, 'How many 311 complaints were there in Brooklyn in 2024?');
  panel = await expand(page, W.session);
  await page.click(radiosOf(panel)[1]);
  await settle(page);
  assert.deepEqual(whereLine(page), [WHERE.sandboxOne], 'the where-line did not follow Sandbox');
  await ask(page, 'And in Queens?');
  assert.deepEqual(queries.map((q) => q.path), ['/api/compare-stream', '/api/query-notebook'], 'the routes the two questions went to');
});

test('P3b-2 criterion 1 (2B item 4): on an instance that runs no notebooks, Sandbox is disabled with its reason and Standard is checked', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(h(NotebookModeProvider, { offered: false }, ASK()));
  const panel = await expand(page, W.session);
  assert.deepEqual(radiosOf(panel).map((el) => [labelOf(el), checked(el), disabled(el), reasonsOf(el)]), [
    [W.standard, true, false, []],
    [W.sandbox, false, true, [NOTEBOOK_MODE_UNAVAILABLE_REASON]],
  ]);
});

for (const [surface, who, element, groups] of [
  ['/ask signed in', 'in', () => ASK(), [W.model, W.ds, W.session]],
  ['the home page signed out', 'out', () => HOME(), [W.ds]],
  ['the home page signed in', 'in', () => HOME(), [W.model, W.ds, W.session]],
  ['/explore signed in', 'in', () => EXPLORE(), [W.model, W.ds]],
  ['/explore signed out', 'out', () => EXPLORE(), [W.ds]],
] as const) {
  test(`P3b-2 criteria 1 and 9 (Words, row 27: "on the three surfaces"): ${surface}: with the menu closed, then open with each group expanded in turn, the composer says none of the gear's and region's words`, async () => {
    if (who === 'in') SIGNED_IN(); else ANON();
    answers();
    await consentWith();
    const page = await mountPage(element());
    if (surface.startsWith('/explore')) await openLive(page);
    const read: Record<string, string[]> = {};
    read.closed = RETIRED.filter((w) => textOf(composerOf(page)).includes(w));
    await open(page);
    for (const group of groups) {
      await expand(page, group);
      const text = textOf(composerOf(page));
      read[group] = RETIRED.filter((w) => text.includes(w));
    }
    assert.deepEqual(read, Object.fromEntries([['closed', []], ...groups.map((g) => [g, []])]));
    assert.ok(!page.markup().includes('aria-label="Response mode"'), 'a "Response mode" radiogroup is still rendered');
    assert.ok(hasRow(panelOf(page), groups[groups.length - 1]), 'premise: the menu was read open');
  });
}

// --- Criterion 2 (2B item 5): Compare -------------------------------------------------------------------------------

test('P3b-2 criterion 2 (2B item 5; #735): in Sandbox, Compare is disabled with its reason; in Standard it is enabled and toggles the stored comparison', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(ASK());
  let panel = await open(page);
  let compare = rowIn(panel, W.compare);
  assert.equal(disabled(compare), true, 'in Sandbox, Compare is not disabled');
  assert.ok(reasonsOf(compare).includes(W.compareReason), `in Sandbox, Compare's reason reads ${JSON.stringify(reasonsOf(compare))}`);
  panel = await expand(page, W.session);
  await page.click(radiosOf(panel).find((el) => labelOf(el) === W.standard)!);
  await settle(page);
  panel = await open(page);
  compare = rowIn(panel, W.compare);
  assert.equal(disabled(compare), false, 'in Standard, Compare is disabled');
  assert.deepEqual([valueOf(compare), descriptionsOf(compare)], [PENDING_COMPARE.off, [W.compareDesc]], 'Compare\'s value and description, Off');
  await page.click(compare);
  await settle(page);
  assert.equal(storage.get('civicaitools.showComparison'), 'on', 'Compare On did not store the comparison');
  panel = await open(page);
  assert.equal(valueOf(rowIn(panel, W.compare)), PENDING_COMPARE.on, 'Compare does not read On');
  await page.click(rowIn(panel, W.compare));
  await settle(page);
  assert.equal(storage.get('civicaitools.showComparison'), 'off', 'Compare Off did not store it');
});

test('P3b-2 criterion 2 (#735; W2\'s KEEP condition): with the comparison stored On and Session type Sandbox, Compare is disabled with its reason and its value never reads On; the same stored choice in Standard reads On (the read can fail)', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  storage.set('civicaitools.showComparison', 'on');
  const page = await mountPage(ASK());
  let compare = rowIn(await open(page), W.compare);
  assert.equal(storage.get('civicaitools.notebookMode') ?? 'notebook', 'notebook', 'premise: /ask is in Sandbox');
  assert.equal(disabled(compare), true, 'in Sandbox, Compare is not disabled');
  assert.ok(reasonsOf(compare).includes(W.compareReason), `in Sandbox, Compare's reason reads ${JSON.stringify(reasonsOf(compare))}`);
  assert.notEqual(valueOf(compare), PENDING_COMPARE.on, 'in Sandbox, Compare reads On');
  assert.equal(valueOf(compare), PENDING_COMPARE.off, 'in Sandbox, Compare does not read Off');
  const panel = await expand(page, W.session);
  await page.click(radiosOf(panel).find((el) => labelOf(el) === W.standard)!);
  await settle(page);
  compare = rowIn(await open(page), W.compare);
  assert.deepEqual([disabled(compare), valueOf(compare)], [false, PENDING_COMPARE.on], 'the can-fail fixture: the stored choice in Standard reads On');
});

test('P3b-2 criterion 2 (Q12 = A): on the home page\'s mount, signed in, the menu holds no Compare item', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(HOME());
  assert.deepEqual(sequence(await open(page)), ['heading', W.model, W.ds, W.session, 'rule', W.all]);
});

// --- Criterion 3 (2C): signed out ----------------------------------------------------------------------------------

test('P3b-2 criterion 3 (2C; D2 = A amended, ASK3 = A): the home page signed out, split topology: the heading, Model disabled with its reason and the model in use, Data sources, a rule, and "Sign in for more options" linking to the app host\'s sign-in; closed, one sign-in control', async () => {
  ANON();
  answers();
  await consentWith();
  const page = await mountPage(split(HOME()));
  assert.equal(signInControls(composerOf(page)).length, 1, 'with the menu closed, the composer does not show exactly one sign-in control (P3b-1\'s line)');
  const panel = await open(page);
  assert.deepEqual(sequence(panel), ['heading', W.model, W.ds, 'rule', W.signInMore]);
  const model = rowIn(panel, W.model);
  assert.deepEqual([disabled(model), reasonsOf(model), valueOf(model)], [true, [W.signOutModel], CAT[0].name], 'signed out, Model');
  const control = within(panel).filter((el) => (el.type === 'a' || el.type === 'button') && textOf(el) === W.signInMore);
  assert.deepEqual(control.map((el) => [el.type, el.props.href]), [['a', SPLIT_SIGN_IN]], 'the button does not link to the app host\'s sign-in, as the header does there');
});

test('P3b-2 criterion 3 (2C): signed out with one provider in place, the button starts that provider\'s sign-in; with two, it links to the panel that lists them', async () => {
  ANON();
  answers();
  await consentWith();
  const one = await mountPage(HOME());
  const control = within(await open(one)).filter((el) => (el.type === 'a' || el.type === 'button') && textOf(el) === W.signInMore);
  assert.deepEqual(control.map((el) => el.type), ['button'], 'one provider: the control is not a button');
  await one.click(control[0]);
  await settle(one);
  assert.deepEqual(signIns(), ['github'], 'the button did not start the one provider\'s sign-in');
  const two = await mountPage(twoProviders(HOME()));
  const link = within(await open(two)).filter((el) => (el.type === 'a' || el.type === 'button') && textOf(el) === W.signInMore);
  assert.deepEqual(link.map((el) => [el.type, el.props.href]), [['a', SIGN_IN_PANEL_HREF]], 'two providers: the control is not a link to the panel');
});

test('P3b-2 criterion 3 (v2 ruling 4; fix 10): where sign-in is not offered, signed out on the home page: 2B\'s items with Model live, Sandbox disabled with the provider-neutral sentence, and no control that signs in; the same mount with one provider shows the signed-out menu', async () => {
  ANON();
  answers();
  await consentWith();
  const none = await mountPage(noSignIn(HOME()));
  let panel = await open(none);
  assert.deepEqual(sequence(panel), ['heading', W.model, W.ds, W.session, 'rule', W.all], 'no sign-in offered: the menu\'s rows');
  assert.equal(disabled(rowIn(panel, W.model)), false, 'no sign-in offered: Model is disabled');
  panel = await expand(none, W.session);
  assert.deepEqual(radiosOf(panel).map((el) => [labelOf(el), checked(el), disabled(el), reasonsOf(el)]), [
    [W.standard, true, false, []],
    [W.sandbox, false, true, [W.noSignInSandbox]],
  ], 'no sign-in offered: Session type');
  assert.deepEqual(signInControls(panel).map((el) => textOf(el)), [], 'no sign-in offered: a control in the menu signs in');
  const offered = await mountPage(HOME());
  assert.deepEqual(sequence(await open(offered)), ['heading', W.model, W.ds, 'rule', W.signInMore], 'one provider: the signed-out menu');
});

// --- Criterion 5 (2E): /explore -------------------------------------------------------------------------------------

async function askLive(page: Surface, question: string): Promise<void> {
  await ask(page, question);
  await settle(page, 600);
}

test('P3b-2 criterion 5 (2E; Q9 = B): /explore signed in: Model and Data sources, then All settings; the second model chosen, the live run posts it with mcpOnly', async () => {
  SIGNED_IN();
  answers();
  await consentWith();
  const page = await mountPage(EXPLORE());
  await openLive(page);
  const panel = await open(page);
  assert.deepEqual(sequence(panel), ['heading', W.model, W.ds, 'rule', W.all]);
  const expanded = await expand(page, W.model);
  await page.click(radiosOf(expanded)[1]);
  await settle(page);
  await askLive(page, 'Most common 311 complaints in Brooklyn');
  assert.deepEqual(queries.map((q) => [q.path, q.body.model, q.body.mcpOnly]), [['/api/compare-stream', CAT[1].id, true]], 'the live run');
});

test('P3b-2 criterion 5 (2E): /explore signed out (one provider): Model disabled with ASK3\'s reason, Data sources, and the sign-in button; the live run posts the first model', async () => {
  ANON();
  answers();
  await consentWith();
  const page = await mountPage(EXPLORE());
  await openLive(page);
  const panel = await open(page);
  assert.deepEqual(sequence(panel), ['heading', W.model, W.ds, 'rule', W.signInMore]);
  assert.deepEqual([disabled(rowIn(panel, W.model)), reasonsOf(rowIn(panel, W.model))], [true, [W.signOutModel]]);
  await page.click(triggerOf(page));
  await settle(page);
  await askLive(page, 'Most common 311 complaints in Brooklyn');
  assert.deepEqual(queries.map((q) => [q.path, q.body.model, q.body.mcpOnly]), [['/api/compare-stream', CAT[0].id, true]], 'the live run');
});

test('P3b-2 criterion 5 (v3 conflict ruling 2): /explore with no sign-in offered: Data sources only, no Model and no sign-in control; the live run posts the first model', async () => {
  ANON();
  answers();
  await consentWith();
  const page = await mountPage(noSignIn(EXPLORE()));
  await openLive(page);
  const panel = await open(page);
  assert.deepEqual(sequence(panel).filter((x) => x !== 'heading' && x !== 'rule'), [W.ds], 'no sign-in offered: the menu\'s items');
  assert.deepEqual(signInControls(panel).map((el) => textOf(el)), [], 'no sign-in offered: a control in the menu signs in');
  await page.click(triggerOf(page));
  await settle(page);
  await askLive(page, 'Most common 311 complaints in Brooklyn');
  assert.deepEqual(queries.map((q) => [q.path, q.body.model]), [['/api/compare-stream', CAT[0].id]], 'the live run');
});
