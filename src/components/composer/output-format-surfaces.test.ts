// OF2 (Sprint OF-1, website #810; criteria 1 to 4, the page's half; G0-1 = A, G0-2 = A, G0-9 = A; the seat's S8 and
// S9): "Output format" in the menu beside the question box, and the choice riding the question's send.
//
// WHAT IS DRIVEN. The home page's real mount (`src/app/(marketing)/page.tsx`, signed out where sign-in is offered: the
// menu's `signed-out` variant), `/ask`'s (`QuerySurface` as `src/app/(app)/ask/page.tsx` mounts it, signed in: `full`)
// and `/explore`'s (`McpFlowDiagram`), on the surface harness (`registerHooks` + the real `renderToStaticMarkup`), with
// the instance's setting carried as the root layout carries it: off, no provider is mounted (the base's tree); on,
// `OutputFormatProvider` holds what `offeredOutputFormats` resolves. Every request is answered here and recorded raw.
//
// THE FORMAT. OF2 offers readers no format but "Auto" (G0-9 = A); the criteria that need another drive one this file
// registers for itself (`registerOutputFormatForTests`): test doubles live in test files.
//
// THE PINS (criteria 1 and 3): the menu's markup with the setting off, and the bytes each send carries with the setting
// off and with "Auto" chosen, are the base's (`407b68c`), measured by this file there.
//
// WHAT MAKES THE REDS ABLE TO FAIL. At the base there is no item, no provider and no format on any send. The decoys: the
// same menu with the setting off holds no item; `/explore`'s menu is read beside the same component given the prop.
//
// BLIND SPOTS, stated. No layout, no focus, no real browser event: those are the browser drive's (phase report).
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
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
} from '../sources/surface-test-harness.ts';
import { hasClass, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY',
  'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'SITE_OUTPUT_FORMAT',
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
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const HarnessMenu = (await load('components/composer/HarnessMenu.tsx')).default as ComponentType<Record<string, unknown>>;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

// The format module and the provider, when they exist (absent at the base).
const registry: Mod | null = await load('lib/output-format/registry.ts').catch(() => null);
const OutputFormatProvider = ((await load('components/OutputFormatProvider.tsx').catch(() => null))?.OutputFormatProvider ?? null) as ComponentType<Record<string, unknown>> | null;

/** The format this file registers for itself. */
const FORMAT = { id: 'fixture-format', version: '1', label: 'Fixture format', description: 'A format a test registers.' } as const;
registry?.registerOutputFormatForTests?.({ ...FORMAT, offered: true });
/** What the root layout hands the provider with the setting on: `offeredOutputFormats` over the instance's setting. */
const offeredWhenOn = (): unknown => registry?.offeredOutputFormats?.({ SITE_OUTPUT_FORMAT: 'on' }) ?? null;

// --- The words (each a draft for G0b, but the label "Output format", G0-1 = A) -------------------------------------

const W = { item: 'Output format', auto: 'Auto', autoOption: 'Auto - text as the AI writes it', autoDescription: 'The AI\'s answer, with no output format applied.', ds: 'Data sources', session: 'Session type', model: 'Model' };

// --- The answers ---------------------------------------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let queries: Array<{ path: string; raw: string }> = [];
/** The routes' refusal of a format, as each sends it (`output-format-driven.test.ts` drives the real ones). */
const REFUSAL_CODE = 'output_format_not_offered';
let refuseFormat = false;
function answers() {
  queries = [];
  installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true }),
    '/api/compare-stream': async (request: Request) => {
      queries.push({ path: '/api/compare-stream', raw: await request.text() });
      const body = refuseFormat ? `data: ${JSON.stringify({ type: 'error', panel: 'withMcp', message: 'fixture', code: REFUSAL_CODE })}\n\n` : '';
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    },
    '/api/query-notebook': async (request: Request) => {
      queries.push({ path: '/api/query-notebook', raw: await request.text() });
      return refuseFormat ? json({ error: 'fixture', code: REFUSAL_CODE }, 403) : json({ error: 'fixture' }, 500);
    },
  });
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
const SIGNED_OUT = () => { sessions.server = null; sessions.client = { status: 'unauthenticated', data: null }; };

/** The setting, as the root layout carries it: off mounts no provider (the base's tree); on mounts it with the offered formats. */
function withSetting(setting: 'on' | 'off', child: ReactElement): ReactElement {
  if (setting === 'off' || OutputFormatProvider === null) return child;
  return h(OutputFormatProvider, { value: offeredWhenOn() }, child);
}
/** The reference deployment's shape for the home page: sign-in lives on the app host, so signed out the menu is `signed-out`. */
const splitTopology = (child: ReactElement) => h(HostLinksProvider, { value: { marketingOrigin: '', signInHref: 'https://app.fixture.example/ask' } }, child);
const ASK = () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' });

const mounted: Surface[] = [];
beforeEach(() => { storage.clear(); sessions.rows.clear(); refuseFormat = false; });
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
async function askPage(setting: 'on' | 'off'): Promise<Surface> {
  SIGNED_IN();
  answers();
  await consentAllOn();
  return mountPage(withSetting(setting, ASK()));
}
async function homePage(setting: 'on' | 'off'): Promise<Surface> {
  SIGNED_OUT();
  answers();
  await consentAllOn();
  return mountPage(withSetting(setting, splitTopology(h(Home))));
}

// --- Reading the menu ----------------------------------------------------------------------------------------------

const ROLES = ['menuitem', 'menuitemradio'];
const byClassIn = (el: HostElement, name: string): HostElement[] => within(el).filter((x) => hasClass(x, name));
const labelOf = (el: HostElement): string => textOf(byClassIn(el, 'ui-menu-item-label')[0] ?? el);
const valueOf = (el: HostElement): string | null => {
  const value = byClassIn(el, 'ui-menu-item-value')[0];
  return value ? textOf(value) : null;
};
function menuOf(page: Surface): HostElement {
  const found = page.elements().filter((el) => el.props['data-part'] === 'harness-menu');
  assert.equal(found.length, 1, `data-part="harness-menu": ${found.length}; the page reads ${page.text().slice(0, 300)}`);
  return found[0];
}
async function openMenu(page: Surface): Promise<HostElement> {
  if (!within(menuOf(page)).some((el) => el.props.role === 'menu')) {
    await page.click(within(menuOf(page)).find((el) => el.props['aria-haspopup'] === 'menu')!);
    await settle(page);
  }
  const panel = within(menuOf(page)).find((el) => el.props.role === 'menu');
  assert.ok(panel, 'the harness menu did not open');
  return panel!;
}
/** The open panel's top rows, as [label, value]: the heading row and the rule are not items. */
async function topRows(page: Surface): Promise<Array<[string, string | null]>> {
  const panel = await openMenu(page);
  return within(panel).filter((el) => el.props.role === 'menuitem').map((el) => [labelOf(el), valueOf(el)]);
}
async function openItem(page: Surface, label: string): Promise<HostElement> {
  const panel = await openMenu(page);
  if (!within(panel).some((el) => el.props.role === 'menuitemradio')) {
    const row = within(panel).find((el) => ROLES.includes(String(el.props.role)) && labelOf(el) === label);
    assert.ok(row, `the menu has no "${label}" item`);
    await page.click(row!);
    await settle(page);
  }
  return within(menuOf(page)).find((el) => el.props.role === 'menu')!;
}
async function chooseIn(page: Surface, item: string, option: string): Promise<void> {
  const panel = await openItem(page, item);
  const row = within(panel).find((el) => el.props.role === 'menuitemradio' && labelOf(el) === option);
  assert.ok(row, `"${item}" offers no "${option}": ${within(panel).filter((el) => el.props.role === 'menuitemradio').map(labelOf).join(', ')}`);
  await page.click(row!);
  await settle(page);
}
async function ask(page: Surface, question: string): Promise<void> {
  const box = page.elements().find((el) => el.type === 'textarea');
  assert.ok(box, 'premise: the question box');
  await page.type(box!, question);
  await page.submit(page.elements().find((el) => el.type === 'form' && within(el).some((x) => x.type === 'textarea'))!);
  await settle(page, 100);
}
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
/** The open panel's markup, as `react-dom/server` writes it. */
const menuMarkup = async (page: Surface): Promise<string> => renderToStaticMarkup(await openMenu(page));

const QUESTION = 'How many sidewalk repair permits were issued in 2025?';

// --- The pins, measured at the base (`407b68c`) by this file ------------------------------------------------------

/** The open menu's markup, setting off: `/ask` signed in (`full`), the home page signed out (`signed-out`). */
const BASE_MENU_SHA = {
  ask: '8a21c66e7d3455a092345bf510fe043eded0161f0c0f99dbf2d09a933333be5a',
  home: 'b10e932435a82effae685dbfaa285c986a8c1786a3e8968b2fb784757c2615b0',
} as const;
/** Each send's bytes: `/ask` in Sandbox (its default) and in Standard (answer-first, one arm), the home page (Standard). */
const BASE_BODY = {
  askSandbox: '{"query":"How many sidewalk repair permits were issued in 2025?","model":"fixture/model","portal":""}',
  askStandard: '{"query":"How many sidewalk repair permits were issued in 2025?","model":"fixture/model","portal":"","mcpOnly":true}',
  home: '{"query":"How many sidewalk repair permits were issued in 2025?","model":"fixture/model","portal":""}',
} as const;

async function sendFrom(page: Surface): Promise<{ path: string; raw: string }> {
  await ask(page, QUESTION);
  assert.equal(queries.length, 1, `premise: one question was sent: ${JSON.stringify(queries)}`);
  return queries[0];
}

test('criterion 1 (pin): with the setting off, the open menu\'s markup is the base\'s, on /ask and on the home page', async () => {
  assert.equal(sha(await menuMarkup(await askPage('off'))), BASE_MENU_SHA.ask, '/ask');
  assert.equal(sha(await menuMarkup(await homePage('off'))), BASE_MENU_SHA.home, 'the home page');
});

for (const setting of ['off', 'on'] as const) {
  test(`criteria 1 and 3 (pin): setting ${setting}, "Auto": each send's bytes are the base's`, async () => {
    const sandbox = await sendFrom(await askPage(setting));
    assert.deepEqual(sandbox, { path: '/api/query-notebook', raw: BASE_BODY.askSandbox });
    storage.set('civicaitools.notebookMode', 'standard');
    queries = [];
    const standard = await sendFrom(await mountPage(withSetting(setting, ASK())));
    assert.deepEqual(standard, { path: '/api/compare-stream', raw: BASE_BODY.askStandard });
    const home = await sendFrom(await homePage(setting));
    assert.deepEqual(home, { path: '/api/compare-stream', raw: BASE_BODY.home });
  });
}

// --- Criterion 2: the item, where it shows ---------------------------------------------------------------------------

// OF3b fold 7 (the owner's D+C, OA-1283; the seat's 7225696434): the home page offers no format, and the signed-out
// variant carries no Output format item. This moves G0b's S9 choice b for the signed-out variant: criterion 2 holds on
// /ask only.
for (const [name, page] of [['/ask, signed in (full)', () => askPage('on')]] as const) {
  test(`criterion 2 (red): setting on, ${name}: "Output format" reads "Auto", directly after "Data sources"`, async () => {
    const rows = await topRows(await page());
    const labels = rows.map(([label]) => label);
    const at = labels.indexOf(W.item);
    assert.ok(at >= 0, `no "${W.item}" item: ${JSON.stringify(rows)}`);
    assert.equal(labels[at - 1], W.ds, `"${W.item}" does not follow "${W.ds}": ${JSON.stringify(labels)}`);
    assert.equal(rows[at][1], W.auto, `"${W.item}" reads ${JSON.stringify(rows[at][1])}`);
  });
}

test('criterion 2 (decoy): setting off, neither page\'s menu holds the item', async () => {
  for (const page of [await askPage('off'), await homePage('off')]) {
    assert.ok(!(await topRows(page)).some(([label]) => label === W.item), page.text().slice(0, 200));
  }
});

test('criterion 2 (red), as fold 7 moves it: the item is in the full variant, and not in signed-out or sources-only', async () => {
  answers();
  const formats = offeredWhenOn();
  const prop = { formats: formats ?? [], chosen: null, onChoose: () => {} };
  const labelsFor = async (variant: string) => (await topRows(await mountPage(h(HarnessMenu, { variant, models: [], model: '', outputFormat: prop })))).map(([label]) => label);
  assert.ok((await labelsFor('full')).includes(W.item), 'full');
  assert.ok(!(await labelsFor('signed-out')).includes(W.item), 'signed-out: fold 7 (D) leaves the item out');
  assert.ok(!(await labelsFor('sources-only')).includes(W.item), 'sources-only');
});

test('criterion 2: /explore\'s menu holds no "Output format", signed in, with the setting on (its mount owns no format)', async () => {
  SIGNED_IN();
  answers();
  await consentAllOn();
  const explore = await mountPage(withSetting('on', h(McpFlowDiagram)));
  const button = explore.buttons('Try your own')[0];
  if (button) {
    await explore.click(button);
    await settle(explore);
  }
  assert.ok(!(await topRows(explore)).some(([label]) => label === W.item));
});

// --- Criterion 4, the page's half: the chosen format rides the send to both routes -----------------------------------

test('criterion 4 (red): with the test format chosen, /ask\'s send carries its id and version, in Sandbox and in Standard', async () => {
  const page = await askPage('on');
  await chooseIn(page, W.item, FORMAT.label);
  assert.equal((await topRows(page)).find(([label]) => label === W.item)?.[1], FORMAT.label, 'the item does not read the chosen format');
  const sandbox = await sendFrom(page);
  assert.equal(sandbox.path, '/api/query-notebook');
  assert.deepEqual((JSON.parse(sandbox.raw) as Json).outputFormat, { id: FORMAT.id, version: FORMAT.version });

  storage.set('civicaitools.notebookMode', 'standard');
  queries = [];
  const standard = await sendFrom(await mountPage(withSetting('on', ASK())));
  assert.equal(standard.path, '/api/compare-stream');
  assert.deepEqual((JSON.parse(standard.raw) as Json).outputFormat, { id: FORMAT.id, version: FORMAT.version }, 'the choice did not last the browser session');
});

test('criterion 4 (red, choice a): the choice lasts the browser session, in sessionStorage, as Session type does', async () => {
  const page = await askPage('on');
  await chooseIn(page, W.item, FORMAT.label);
  assert.equal(storage.get('civicaitools.outputFormat'), `${FORMAT.id}@${FORMAT.version}`);
  await chooseIn(page, W.item, W.autoOption);
  assert.equal(storage.get('civicaitools.outputFormat'), 'auto');
});

test('criterion 4: a stored choice the instance does not offer, or any choice with the setting off, sends no format', async () => {
  storage.set('civicaitools.outputFormat', 'not-a-format@1');
  const stale = await sendFrom(await askPage('on'));
  assert.ok(!('outputFormat' in (JSON.parse(stale.raw) as Json)), stale.raw);
  storage.set('civicaitools.outputFormat', `${FORMAT.id}@${FORMAT.version}`);
  queries = [];
  const off = await sendFrom(await askPage('off'));
  assert.ok(!('outputFormat' in (JSON.parse(off.raw) as Json)), off.raw);
});

// --- W2 = A, styled (the owner's words ruling, seat 7168515476): the refusal names its controls as the site does ------

/**
 * The refusal sentence as ruled (W2 = A), its words unchanged, with "Auto" and "Output format" set off as control
 * names the way this site's reader prose names a control: in typographic quotation marks (`EvidenceIndex.tsx`'s
 * click “Publish”; `learn/page.tsx`'s expand “How was the AI guided?”). The three blocks that show a stream error
 * (`ResponsePanel`, `QuerySurface`, `NotebookOutput`) render the text as text, so the marks are the styling.
 */
const W2 = 'This site does not offer the output format you chose, so nothing was sent. Choose “Auto” under “Output format”, then ask again.';

test('W2 (red): the refusal reaches the reader with “Auto” and “Output format” named as controls, in Sandbox and in Standard', async () => {
  refuseFormat = true;
  const sandbox = await askPage('on');
  await ask(sandbox, QUESTION);
  assert.equal(queries[0]?.path, '/api/query-notebook', 'premise: the Sandbox send');
  assert.ok(sandbox.text().includes(W2), `Sandbox: the refusal reads ${JSON.stringify(sandbox.text().match(/This site does not offer[^.]*\.[^.]*\./)?.[0] ?? null)}`);

  storage.set('civicaitools.notebookMode', 'standard');
  queries = [];
  const standard = await mountPage(withSetting('on', ASK()));
  await ask(standard, QUESTION);
  assert.equal(queries[0]?.path, '/api/compare-stream', 'premise: the Standard send');
  assert.ok(standard.text().includes(W2), `Standard: the refusal reads ${JSON.stringify(standard.text().match(/This site does not offer[^.]*\.[^.]*\./)?.[0] ?? null)}`);
});

// --- W1 = B, W3 = A (the owner's words rulings, seat 7168515476 and 7172131446): Auto's option line, as ruled --------

test('W1 and W3 (red): Auto\'s option reads the ruled label and line, "the AI", on /ask and on the home page', async () => {
  for (const page of [await askPage('on')]) {
    const panel = await openItem(page, W.item);
    const autos = within(panel).filter((el) => el.props.role === 'menuitemradio').map((el) => [labelOf(el), byClassIn(el, 'ui-menu-item-description').map(textOf)]);
    // The first option is Auto; the test-registered format follows it.
    assert.deepEqual(autos[0], [W.autoOption, [W.autoDescription]]);
  }
});

// --- OF3b (website #810; criterion 7, and the seat's folds): "Map" in the menu, Compare and Sandbox beside it -------
//
// WHAT MAKES THESE ABLE TO FAIL. At OF3a's head the plain map is registered with `offered: false`, so no menu offers
// "Map", Compare is never off for a format, and a Sandbox session offers every format: each red fails at its first read.
// Compare's value is driven On first, so "comes back" can fail; Sandbox is the mount's default, so "offered again" is
// read after a real switch to Standard.

const MAP = {
  label: 'Map',
  line: 'This site maps rows the AI chose from the data. No map service receives anything.',
  cap: 'The map shows at most 1,000 points.',
  compareReason: 'Not offered while a map format is chosen. Switch Output format to Auto to compare.',
  sandboxReason: 'Not offered in a Sandbox session. Switch Session type to Standard to use a map.',
} as const;
const COMPARE = 'Compare with a second harness';
const reasonOf = (el: HostElement): string | null => {
  const r = byClassIn(el, 'ui-menu-item-reason')[0];
  return r ? textOf(r) : null;
};
async function formatOptions(page: Surface): Promise<Array<{ label: string; description: string[]; reason: string | null; disabled: boolean; checked: unknown }>> {
  const panel = await openItem(page, W.item);
  const rows = within(panel).filter((el) => el.props.role === 'menuitemradio').map((el) => ({
    label: labelOf(el),
    description: byClassIn(el, 'ui-menu-item-description').map(textOf),
    reason: reasonOf(el),
    disabled: el.props['aria-disabled'] === true,
    checked: el.props['aria-checked'],
  }));
  await page.click(within(menuOf(page)).find((el) => el.props['aria-haspopup'] === 'menu')!);
  await settle(page);
  return rows;
}
async function compareRow(page: Surface): Promise<{ value: string | null; reason: string | null; disabled: boolean }> {
  const panel = await openMenu(page);
  const row = within(panel).find((el) => el.props.role === 'menuitem' && labelOf(el) === COMPARE);
  assert.ok(row, 'premise: /ask\'s menu has the Compare item');
  const out = { value: valueOf(row!), reason: reasonOf(row!), disabled: row!.props['aria-disabled'] === true };
  await page.click(within(menuOf(page)).find((el) => el.props['aria-haspopup'] === 'menu')!);
  await settle(page);
  return out;
}
async function standardAsk(): Promise<Surface> {
  storage.set('civicaitools.notebookMode', 'standard');
  return askPage('on');
}

for (const [name, page] of [['/ask, signed in (full)', () => standardAsk()]] as const) {
  test(`OF3b criterion 7 (red): ${name}: "Map" follows "Auto" under Output format, with its line and the cap line`, async () => {
    const rows = await formatOptions(await page());
    const at = rows.findIndex((r) => r.label === MAP.label);
    assert.ok(at > 0, `"Map" is not offered: ${JSON.stringify(rows.map((r) => r.label))}`);
    assert.equal(rows[0].label, W.autoOption, 'Auto is not first');
    assert.equal(at, 1, '"Map" does not directly follow "Auto"');
    assert.equal(rows[at].disabled, false);
    assert.deepEqual(rows[at].description, [`${MAP.line} ${MAP.cap}`], 'the line and the cap line');
  });
}

test('OF3b criterion 7 (red): choosing "Map" shows no card, and the item reads "Map"', async () => {
  const page = await standardAsk();
  const before = page.elements().filter((el) => el.props.role === 'dialog' || el.props.role === 'alertdialog' || String(el.props['data-part'] ?? '').includes('card')).length;
  await chooseIn(page, W.item, MAP.label);
  const after = page.elements().filter((el) => el.props.role === 'dialog' || el.props.role === 'alertdialog' || String(el.props['data-part'] ?? '').includes('card')).length;
  assert.equal(after, before, 'choosing "Map" opened a card');
  assert.equal((await topRows(page)).find(([label]) => label === W.item)?.[1], MAP.label);
  assert.equal(storage.get('civicaitools.outputFormat'), 'plain-map@1');
});

test('OF3b criterion 7 (red; fold 1 of the brief): with "Map" chosen Compare is off with its reason; "Auto" offers it again with its earlier value', async () => {
  storage.set('civicaitools.showComparison', 'on');
  const page2 = await standardAsk();
  assert.deepEqual(await compareRow(page2), { value: 'On', reason: null, disabled: false }, 'premise: Compare is On before a map is chosen');
  await chooseIn(page2, W.item, MAP.label);
  assert.deepEqual(await compareRow(page2), { value: 'Off', reason: MAP.compareReason, disabled: true });
  await chooseIn(page2, W.item, W.autoOption);
  assert.deepEqual(await compareRow(page2), { value: 'On', reason: null, disabled: false }, 'Compare did not come back with its earlier value');
});

test('OF3b criterion 7 (red; fold 2 of the brief): in a Sandbox session "Map" is off with its reason; Standard offers it again', async () => {
  const page = await askPage('on');
  assert.equal((await topRows(page)).find(([label]) => label === W.session)?.[1], 'Sandbox', 'premise: /ask starts in Sandbox');
  const inSandbox = (await formatOptions(page)).find((r) => r.label === MAP.label);
  assert.deepEqual(inSandbox && { reason: inSandbox.reason, disabled: inSandbox.disabled }, { reason: MAP.sandboxReason, disabled: true });
  await chooseIn(page, W.session, 'Standard');
  const inStandard = (await formatOptions(page)).find((r) => r.label === MAP.label);
  assert.deepEqual(inStandard && { reason: inStandard.reason, disabled: inStandard.disabled }, { reason: null, disabled: false }, '"Map" is not offered again in Standard');
});

test('OF3b (red): a stored "Map" is not sent from Sandbox, and the item reads "Auto" there; in Standard it is sent with one panel', async () => {
  storage.set('civicaitools.outputFormat', 'plain-map@1');
  const sandbox = await askPage('on');
  assert.equal((await topRows(sandbox)).find(([label]) => label === W.item)?.[1], W.auto, 'the item does not read Auto in Sandbox');
  const sent = await sendFrom(sandbox);
  assert.equal(sent.path, '/api/query-notebook');
  assert.ok(!('outputFormat' in (JSON.parse(sent.raw) as Json)), sent.raw);
  queries = [];
  const standard = await sendFrom(await standardAsk());
  assert.equal(standard.path, '/api/compare-stream');
  const body = JSON.parse(standard.raw) as Json;
  assert.deepEqual(body.outputFormat, { id: 'plain-map', version: '1' });
  assert.equal(body.mcpOnly, true, 'a map question was sent with the comparison\'s second panel');
});

// --- Fold 7 (the owner's D+C, OA-1283; the seat's 7225696434): the home page offers no format to any reader ----------
//
// WHAT MAKES THESE ABLE TO FAIL. At fold 6's head the home page's form offers the formats the instance offers, signed
// in (full) and signed out (signed-out), and sends a stored "Map" with one panel; each red below fails at its read.

async function homeSignedIn(): Promise<Surface> {
  SIGNED_IN();
  answers();
  await consentAllOn();
  return mountPage(withSetting('on', splitTopology(h(Home))));
}

test('fold 7 (red, D and C): the home page shows no "Output format" item, signed out (signed-out) or signed in (full)', async () => {
  const out = await topRows(await homePage('on'));
  assert.ok(!out.some(([label]) => label === W.item), `signed out: ${JSON.stringify(out)}`);
  const inn = await topRows(await homeSignedIn());
  assert.ok(inn.some(([label]) => label === W.session), `premise: signed in, the home page's menu is the full one: ${JSON.stringify(inn)}`);
  assert.ok(!inn.some(([label]) => label === W.item), `signed in: ${JSON.stringify(inn)}`);
});

test('fold 7 (red, C): with "Map" stored (as /ask stores it), the home page sends no format and runs both panels: the base\'s bytes', async () => {
  storage.set('civicaitools.outputFormat', 'plain-map@1');
  const out = await sendFrom(await homePage('on'));
  assert.deepEqual(out, { path: '/api/compare-stream', raw: BASE_BODY.home }, 'signed out');
  queries = [];
  storage.set('civicaitools.notebookMode', 'standard');
  const inn = await sendFrom(await homeSignedIn());
  assert.deepEqual(inn, { path: '/api/compare-stream', raw: BASE_BODY.home }, 'signed in');
});

test('fold 7 (pin): /ask is unchanged: with "Map" stored it still offers it and sends it with one panel', async () => {
  storage.set('civicaitools.outputFormat', 'plain-map@1');
  const sent = await sendFrom(await standardAsk());
  const body = JSON.parse(sent.raw) as Json;
  assert.deepEqual(body.outputFormat, { id: 'plain-map', version: '1' });
  assert.equal(body.mcpOnly, true);
});
