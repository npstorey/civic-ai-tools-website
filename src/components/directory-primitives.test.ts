// UX-2 P6 + P10 (#729), the directory on the site's primitives and its row action: contract p6p10.md v5.2,
// criteria 1, 2 (the directory's tabs), 3, 4 (the two filter toggles), 6 (the row action's presence and target), 24
// (D-14 (i)), and the directory's ruled lines D-12 and D-13 (criterion 11's rows for `/directory`).
//
// THE RULE. One `FilterDropdown`, on `Menu`; the tabs on `Tabs`; no colour literal in the two directory components
// and every platform, transport and Commercial badge at 4.5:1 or better; "Show Filters" a `Disclosure`; on a row whose
// entry maps to a source this instance offers, one in-app link "Ask with this source" (signed out: the home page with
// `?source=`; signed in, by a local session or the cross-host probe: `/ask?source=` on the app origin), and on exactly
// those rows the badge "This site's data source", sorted first and outlined.
//
// WHAT IS DRIVEN. The real `DirectoryWrapper` (both tabs) on the surface harness, with a navigation stub that carries
// `?tab=`, a fixture directory and the offered set read from `buildFlowsStatement()` under this file's environment
// (the P3b-2 rider). The offered set, the probe and `askHref` are the props the directory page passes (0d item 1, 9).
//
// WHAT MAKES IT ABLE TO FAIL. The fixture holds (i) an entry mapped to an offered source, (ii) an entry mapped to a
// source this instance does NOT offer (a build keyed on the mapping alone shows the action there), and (iii) an
// unmapped entry that carries the index's `included` flag and sorts first by name (a build that still reads
// `included` badges, sorts and outlines it). At the base no row has the action or the badge, "Included" shows on (iii),
// there are two `FilterDropdown` definitions, no tab role, 19 colour literals, and no disclosure.
//
// BLIND SPOTS, stated. No layout, focus or keyboard: the menus' flip, the panel inside the viewport, wrapping at 390
// and the portal cards below 640 px are instrument 8's reads. The contrast is computed from the inline style each badge
// carries, resolved against `globals.css`'s light tokens; a colour set by a class is not read here.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import type { ComponentType, ReactElement } from 'react';
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
} from './sources/surface-test-harness.ts';
import { childrenOf, hasClass, parentOf, within } from './ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  // The directory reads `?tab=` and its filters from the address: the stub carries one address per case.
  'next/navigation': `
    const S = globalThis.__w3Sessions;
    export function useRouter() { return { push(u) { S.pushed.push(u); }, replace(u) { S.pushed.push(u); }, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return '/directory'; }
    export function useSearchParams() { return new URLSearchParams(globalThis.__p6Search ?? ''); }
    export function redirect(u) { throw new Error('redirect ' + u); }
    export function notFound() { throw new Error('not found'); }`,
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_MCP_URL',
  'APP_HOST', 'MARKETING_HOST', 'NEXTAUTH_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';

const MARKETING = 'https://marketing.fixture.example';
const APP = 'https://app.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${MARKETING}/directory`, origin: MARKETING, pathname: '/directory', search: '' }, scrollTo() {} },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});
const setSearch = (search: string) => { (globalThis as Record<string, unknown>).__p6Search = search; };

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
// The props the directory page passes after 0d items 1 and 9 (`offeredSourceIds`, `sessionProbe`, `askHref`) are not
// in the base's prop type: the wrapper is read untyped here, and the base ignores them.
const DirectoryWrapper = (await load('components/DirectoryWrapper.tsx')).default as ComponentType<Record<string, unknown>>;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
/** The sources this instance offers, read from its statement, never a fixed list. */
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

// --- The fixture directory ---------------------------------------------------------------------------------------

const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'mcp', 'directory-fallback.json'), 'utf8')) as Array<Record<string, unknown>>;
type Fixture = Record<string, unknown> & { name: string };
const entry = (id: string): Fixture => {
  const found = SNAPSHOT.find((e) => e.id === id);
  assert.ok(found, `premise: the snapshot holds ${id}`);
  return { ...found } as Fixture;
};
/** (i) mapped to an offered source. */
const OFFERED = { ...entry('socrata-mcp-server'), included: undefined } as Fixture;
/** (ii) mapped to a source this instance does not offer. */
const UNOFFERED = { ...entry('nyc-charter-laws-rules'), included: undefined } as Fixture;
/** (iii) mapped to nothing, carrying the index's flag, first by name. */
const UNMAPPED = { ...entry('datagov-mcp-server'), id: 'boston-core-mcp', name: 'boston-core-mcp', repoUrl: 'https://github.com/fixture/boston-core-mcp', included: true } as Fixture;
/** A row carrying every badge criterion 3 reads: Commercial, three transports, three platforms. */
const BADGED = {
  ...entry('govcon-mcp'), id: 'fixture-commercial', name: 'fixture-commercial', transport: ['stdio', 'http', 'sse'],
  dataPlatform: ['socrata', 'ckan', 'data-commons', 'arcgis'], verificationStatus: 'commercial', included: undefined,
} as Fixture;
const SERVERS: Fixture[] = [OFFERED, UNOFFERED, UNMAPPED, BADGED];
const PORTALS = [{
  id: 'portal.fixture.example', name: 'Fixture Portal P6', url: 'https://portal.fixture.example', platform: 'socrata', catalog_type: 'Open data portal',
  government_level: 'city', country: 'US', country_name: 'United States', owner_name: 'Fixture city', owner_type: 'City government',
  api_endpoint: 'https://portal.fixture.example/api', dataset_count: 1, status: 'active',
}];
const COUNTS = { socrata: 364, ckan: 1947, total: 2311 };
const PROBE = { statusUrl: `${APP}/api/session-status`, openAppHref: `${APP}/ask` };

interface Case { marketingOrigin?: string; probe?: typeof PROBE | null; askHref?: string; signedInHere?: boolean; probeSays?: boolean }

const mounted: Surface[] = [];
afterEach(() => {
  for (const s of mounted.splice(0)) s.unmount();
  setSearch('');
});

async function directory(c: Case = {}, search = ''): Promise<Surface> {
  setSearch(search);
  sessions.server = null;
  sessions.client = c.signedInHere ? { status: 'authenticated', data: { user: { name: 'Fixture' } } } : { status: 'unauthenticated', data: null };
  installFetch(MARKETING, {
    '/api/session-status': () => new Response(JSON.stringify({ signedIn: c.probeSays === true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  const element: ReactElement = h(DirectoryWrapper, {
    servers: SERVERS, portals: PORTALS, portalCounts: COUNTS, sourceNote: null,
    offeredSourceIds: IDS, sessionProbe: c.probe ?? null, askHref: c.askHref ?? '/ask',
  });
  const s = await mount(h(HostLinksProvider, { value: { marketingOrigin: c.marketingOrigin ?? '', signInHref: null } }, element));
  mounted.push(s);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await s.settle();
  return s;
}

// --- Readers ----------------------------------------------------------------------------------------------------

const styleOf = (el: HostElement): Record<string, unknown> => (el.props.style ?? {}) as Record<string, unknown>;
/** The link that names a server: its text is the server's name. */
function nameLink(s: Surface, name: string): HostElement {
  const found = s.elements().filter((el) => el.type === 'a' && textOf(el) === name);
  assert.equal(found.length, 1, `the link naming "${name}": ${found.length}`);
  return found[0];
}
/** The deepest element holding every server's name link: the cards' container. */
function cardsContainer(s: Surface): HostElement {
  const names = SERVERS.map((e) => nameLink(s, String(e.name)));
  const holding = s.elements().filter((el) => names.every((n) => within(el).includes(n)));
  assert.ok(holding.length > 0, 'no element holds every server card');
  return holding[holding.length - 1];
}
/** One server's card: the container's direct child that holds its name link. */
function cardOf(s: Surface, name: string): HostElement {
  const link = nameLink(s, name);
  const card = childrenOf(cardsContainer(s)).find((el) => within(el).includes(link));
  assert.ok(card, `no card holds "${name}"`);
  return card!;
}
const linksIn = (el: HostElement): HostElement[] => within(el).filter((x) => x.type === 'a');
const askLinks = (el: HostElement): HostElement[] => linksIn(el).filter((a) => textOf(a) === 'Ask with this source');
const hasText = (el: HostElement, text: string): boolean => [el, ...within(el)].some((x) => textOf(x) === text && childrenOf(x).every((c) => textOf(c) !== text));
const outlined = (card: HostElement): boolean => /var\(--accent\)/.test(String(styleOf(card).border ?? '') + String(styleOf(card).outline ?? ''));

// --- Criterion 6: the row action --------------------------------------------------------------------------------

test('premise: the statement offers socrata and not nyc-charter, so (i) is offered and (ii) is mapped but not offered', () => {
  assert.ok(IDS.includes('socrata'), `the statement's ids: ${JSON.stringify(IDS)}`);
  assert.ok(!IDS.includes('nyc-charter'), `the statement's ids: ${JSON.stringify(IDS)}`);
});

test('criterion 6: only (i), the row mapped to an offered source, carries one in-app link "Ask with this source"; (ii) and (iii) carry none', async () => {
  const s = await directory();
  const counts = Object.fromEntries(SERVERS.map((e) => [e.name, askLinks(cardOf(s, String(e.name))).length]));
  assert.deepEqual(counts, { 'socrata-mcp-server': 1, 'nyc-charter-laws-rules': 0, 'boston-core-mcp': 0, 'fixture-commercial': 0 });
  const link = askLinks(cardOf(s, 'socrata-mcp-server'))[0];
  assert.equal(link.props.target, undefined, 'the action leaves the site (target set)');
});

test('criterion 6: signed out, the action opens the home page with ?source=<sourceId> (no marketing origin, and a split one)', async () => {
  const local = askLinks(cardOf(await directory(), 'socrata-mcp-server'));
  assert.deepEqual(local.map((a) => a.props.href), ['/?source=socrata']);
  const split = askLinks(cardOf(await directory({ marketingOrigin: MARKETING, probe: PROBE, askHref: `${APP}/ask`, probeSays: false }), 'socrata-mcp-server'));
  assert.deepEqual(split.map((a) => a.props.href), [`${MARKETING}/?source=socrata`], 'a probe that says signed out still links the home page');
});

test('criterion 6: signed in by a local session, the action opens /ask?source=<sourceId>', async () => {
  const links = askLinks(cardOf(await directory({ signedInHere: true }), 'socrata-mcp-server'));
  assert.deepEqual(links.map((a) => a.props.href), ['/ask?source=socrata']);
});

test('criterion 6 (PQ4 (a), 0d item 1): on a split host with no local session, a probe that says signed in links /ask on the app origin', async () => {
  const s = await directory({ marketingOrigin: MARKETING, probe: PROBE, askHref: `${APP}/ask`, probeSays: true });
  const links = askLinks(cardOf(s, 'socrata-mcp-server'));
  assert.deepEqual(links.map((a) => a.props.href), [`${APP}/ask?source=socrata`]);
});

// --- Criterion 24: D-14 (i), the badge follows the offered set ---------------------------------------------------

test('criterion 24 (D-14 (i)): "This site\'s data source" on (i) only, (i) sorted first and outlined, and "Included" nowhere', async () => {
  const s = await directory();
  const badged = SERVERS.filter((e) => hasText(cardOf(s, String(e.name)), "This site's data source")).map((e) => e.name);
  assert.deepEqual(badged, ['socrata-mcp-server'], 'the rows carrying the badge');
  const order = childrenOf(cardsContainer(s)).map((card) => SERVERS.find((e) => within(card).includes(nameLink(s, String(e.name))))?.name);
  assert.equal(order[0], 'socrata-mcp-server', `the first card: ${JSON.stringify(order)}`);
  assert.deepEqual(SERVERS.map((e) => [e.name, outlined(cardOf(s, String(e.name)))]), [
    ['socrata-mcp-server', true], ['nyc-charter-laws-rules', false], ['boston-core-mcp', false], ['fixture-commercial', false],
  ], 'the outlined cards');
  assert.ok(!/\bIncluded\b/.test(s.text()), 'the page still says "Included"');
});

// --- D-12 and D-13: the directory's lines (criterion 11's rows) ----------------------------------------------------

test('criterion 11, D-12: the line under the title reads the list\'s own count with no "+"', async () => {
  const text = (await directory()).text();
  assert.ok(text.includes('Browse 4 MCP servers and 2,311 open data portals for civic data.'), 'D-12 is not rendered');
  assert.ok(!text.includes('4+ MCP servers'), 'the "+" is still there');
});

test('criterion 11, D-13: the servers tab\'s banner claims only the lists\' lengths', async () => {
  const text = (await directory()).text();
  assert.ok(text.includes('Some of these MCP servers read data from Socrata or CKAN portals. The Data Portals tab lists 364 Socrata portals and 1,947 CKAN portals worldwide.'), 'D-13 is not rendered');
  assert.ok(!text.includes('These MCP servers connect AI to data from'), 'the old banner is still there');
});

// --- UX-2-FIX P3 (#790): D7, D4 and D6 ------------------------------------------------------------------------------
// D7 (contract p3.md section 2): the servers tab's subtitle drops its count. Read as the whole paragraph, so the base's
// "4 MCP servers for civic…" (which holds the new sentence as a substring) is red. D4 and D6 (no words): the action's
// outline and the platform chip's border, as inline styles; where they sit on a page is the browser instrument's read.

const D7 = 'MCP servers for civic and public data — open data portals, census, legislation, health, geospatial, and more.';

test('UX-2-FIX P3 D7: the servers tab\'s subtitle reads its ruled words, with no count', async () => {
  const s = await directory();
  const subtitles = s.elements().filter((el) => el.type === 'p' && textOf(el).replace(/\s+/g, ' ').trim().endsWith('geospatial, and more.'));
  assert.deepEqual(subtitles.map((el) => textOf(el).replace(/\s+/g, ' ').trim()), [D7]);
});

test('UX-2-FIX P3 D4: "Ask with this source" carries a 1 px accent outline; the new-tab links beside it carry none', async () => {
  const card = cardOf(await directory(), 'socrata-mcp-server');
  const action = askLinks(card);
  assert.equal(action.length, 1, 'premise: one action on the offered row');
  assert.equal(String(styleOf(action[0]).border ?? ''), '1px solid var(--accent)', 'the action\'s border');
  const newTab = linksIn(card).filter((a) => a.props.target === '_blank' && ['GitHub', 'Docs', 'npm', 'Endpoint'].includes(textOf(a)));
  assert.ok(newTab.length >= 2, `premise: the card's new-tab links: ${newTab.map((a) => textOf(a)).join(', ')}`);
  assert.deepEqual(newTab.map((a) => styleOf(a).border ?? null), newTab.map(() => null), 'a new-tab link carries a border');
});

test('UX-2-FIX P3 D6: every platform chip in the portal list carries a 1 px --border-color border', async () => {
  const s = await directory({}, '?tab=portals');
  const chips = s.elements().filter((el) => el.type === 'span' && ['Socrata', 'CKAN'].includes(textOf(el)) && childrenOf(el).length === 0);
  assert.ok(chips.length >= 1, 'premise: the portal list renders a platform chip');
  assert.deepEqual(chips.map((el) => String(styleOf(el).border ?? '')), chips.map(() => '1px solid var(--border-color)'));
});

// --- Criterion 2: the directory's tabs ---------------------------------------------------------------------------

async function tablist(s: Surface): Promise<HostElement[]> {
  const lists = s.elements().filter((el) => el.props.role === 'tablist');
  assert.equal(lists.length, 1, `role="tablist" elements: ${lists.length}`);
  return within(lists[0]).filter((el) => el.props.role === 'tab');
}

test('criterion 2: the directory renders one tablist of two tabs, exactly one selected; ?tab=portals selects portals and renders the portal list', async () => {
  const servers = await tablist(await directory());
  assert.deepEqual(servers.map((t) => [textOf(t), String(t.props['aria-selected'])]), [['MCP Servers (4)', 'true'], ['Data Portals (2,311)', 'false']]);
  const portalsPage = await directory({}, 'tab=portals');
  const portals = await tablist(portalsPage);
  assert.deepEqual(portals.map((t) => String(t.props['aria-selected'])), ['false', 'true']);
  assert.ok(portalsPage.text().includes('Fixture Portal P6'), 'the portal list is not rendered under ?tab=portals');
});

test('criterion 2 (guard): ?tab=portals renders the portal list and no server card', async () => {
  const s = await directory({}, 'tab=portals');
  assert.ok(s.text().includes('Fixture Portal P6'), 'the portal list is not rendered');
  assert.ok(!s.elements().some((el) => el.type === 'a' && textOf(el) === 'socrata-mcp-server'), 'a server card renders on the portals tab');
});

// --- Criterion 1: one FilterDropdown, on Menu --------------------------------------------------------------------

test('criterion 1: one tracked definition named FilterDropdown (tests excluded)', () => {
  const files = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: path.resolve(SRC, '..'), encoding: 'utf8' })
    .split('\0').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const defining = files.filter((f) => /\b(function|const|class)\s+FilterDropdown\b/.test(fs.readFileSync(path.join(SRC, '..', f), 'utf8')));
  assert.equal(defining.length, 1, `files defining FilterDropdown: ${JSON.stringify(defining)}`);
});

const SERVER_FILTERS = ['All Domains', 'All Levels', 'All Transports', 'All Platforms', 'Name A-Z'];
const PORTAL_FILTERS = ['All Platforms', 'All Countries', 'All Levels', 'All Owner Types', 'Name A-Z'];
const triggers = (s: Surface, labels: string[]): HostElement[] =>
  s.elements().filter((el) => el.type === 'button' && labels.some((l) => textOf(el).replace(/[▾\s]+$/u, '') === l));

for (const [tab, search, labels] of [['servers', '', SERVER_FILTERS], ['portals', 'tab=portals', PORTAL_FILTERS]] as const) {
  test(`criterion 1: on the ${tab} tab every filter trigger carries aria-haspopup="menu" and aria-expanded, "true" once opened`, async () => {
    const s = await directory({}, search);
    const found = triggers(s, [...labels]);
    assert.equal(found.length, labels.length, `filter triggers: ${found.map((el) => textOf(el)).join(' | ')}`);
    assert.deepEqual(found.map((el) => [String(el.props['aria-haspopup']), String(el.props['aria-expanded'])]), labels.map(() => ['menu', 'false']));
    await s.click(found[0]);
    await s.settle();
    assert.equal(String(triggers(s, [labels[0]])[0].props['aria-expanded']), 'true', 'the first trigger does not read expanded once opened');
  });
}

// --- Fix round 1, F1 (seat #729 6936790257 item 1): the filters' open panel carries a height cap of 280 px or less ---
//
// THE RULE. The directory's dropdown before this change capped its list at 280 px and always opened downward (`71b43b0`
// `DirectoryClient.tsx:145-158`). `Menu`'s panel is at most 60vh tall (506 px at 844 high), and is capped to the room
// only for a menu with a group, so with a filter's trigger mid-screen its panel ran past the window. The filters' panel
// keeps the old cap: `.directory-filter .ui-menu-panel` in `globals.css`, at most 280 px.
//
// HOW IT IS READ. The first filter on each tab is opened on the harness and its panel found (`.ui-menu-panel`, inside
// the `.directory-filter` wrapper, which is the rule's premise). Its max-height is the panel's inline one if it has one
// (an inline style wins), else the declaration of the last `.directory-filter .ui-menu-panel` block, else the last
// `.ui-menu-panel` block. The cap is the most that value can come to in px: a px length is itself, `min()` the least of
// its terms, `max()` the most, `clamp()` its last; a `vh` or `%` term, or `none`, is unbounded.
//
// BLIND SPOTS, stated. A stylesheet read, not a cascade: a rule reaching the panel through another selector, inside a
// media query that does not apply, or by `!important` elsewhere is read as written or not at all, and where the panel
// lands is not read. Instrument 8's read (c), with the trigger mid-screen as well as at the page's own position, is the
// layout check.

const GLOBALS_CSS_TEXT = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8');
/** The declarations of every innermost block in `css` whose selector list names `selector` exactly. */
function blocksNaming(css: string, selector: string): string[] {
  const want = selector.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.replace(/\s+/g, ' ').trim()).includes(want)) out.push(m[2]);
  }
  return out;
}
/** The last `max-height` declared in a block's body, or null. */
function maxHeightIn(body: string): string | null {
  const all = [...body.matchAll(/(?:^|;)\s*max-height\s*:\s*([^;]+)/g)];
  return all.length ? all[all.length - 1][1].replace(/\s*!important\s*$/, '').trim() : null;
}
/** The terms of a CSS function's argument list, split at its top-level commas. */
function termsOf(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '(') depth += 1;
    else if (args[i] === ')') depth -= 1;
    else if (args[i] === ',' && depth === 0) { out.push(args.slice(at, i)); at = i + 1; }
  }
  out.push(args.slice(at));
  return out.map((t) => t.trim());
}
/** The most a max-height value can come to, in px (Infinity when a term is not bounded in px). */
function heightCapPx(value: string): number {
  const v = value.trim();
  const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
  if (px) return Number(px[1]);
  const fn = /^(min|max|clamp)\((.*)\)$/.exec(v);
  if (fn) {
    const terms = termsOf(fn[2]).map(heightCapPx);
    if (fn[1] === 'min') return Math.min(...terms);
    if (fn[1] === 'max') return Math.max(...terms);
    return terms[terms.length - 1];
  }
  return Infinity;
}
/** The filter panel's declared max-height in a stylesheet, by the order above (inline first). */
function filterPanelMaxHeight(css: string, inline: string): string | null {
  if (inline) return inline;
  const own = blocksNaming(css, '.directory-filter .ui-menu-panel').map(maxHeightIn).filter((x): x is string => x !== null);
  if (own.length) return own[own.length - 1];
  const base = blocksNaming(css, '.ui-menu-panel').map(maxHeightIn).filter((x): x is string => x !== null);
  return base.length ? base[base.length - 1] : null;
}
const FILTER_PANEL_CAP_PX = 280;

test('fix round 1, F1 (its instrument): the cap read tells a rule that caps from one that does not (its decoy pair)', () => {
  const panelOnly = '.ui-menu-panel { position: absolute; max-height: 60vh; overflow-y: auto; }';
  const uncapped = filterPanelMaxHeight(panelOnly, '');
  assert.equal(uncapped, '60vh');
  assert.equal(heightCapPx(uncapped!), Infinity, '60vh alone must read as no cap');
  const capped = filterPanelMaxHeight(`${panelOnly}\n.directory-filter .ui-menu-panel { max-height: min(60vh, 280px); }`, '');
  assert.equal(capped, 'min(60vh, 280px)');
  assert.equal(heightCapPx(capped!), 280);
  assert.equal(heightCapPx('min(60vh, 506px)'), 506, 'a cap above 280 px reads as its own height, so the assertion can fail on it');
  assert.equal(heightCapPx('clamp(120px, 50vh, 280px)'), 280);
  assert.equal(filterPanelMaxHeight(panelOnly, 'min(60vh, 300px)'), 'min(60vh, 300px)', 'an inline max-height is read first');
});

for (const [tab, search, first] of [['servers', '', 'All Domains'], ['portals', 'tab=portals', 'All Platforms']] as const) {
  test(`fix round 1, F1: on the ${tab} tab the open filter panel ("${first}") carries a height cap of at most ${FILTER_PANEL_CAP_PX} px`, async () => {
    const s = await directory({}, search);
    const trigger = triggers(s, [first]);
    assert.equal(trigger.length, 1, `the "${first}" trigger: ${trigger.length}`);
    await s.click(trigger[0]);
    await s.settle();
    const panels = s.elements().filter((el) => hasClass(el, 'ui-menu-panel'));
    assert.equal(panels.length, 1, `open menu panels: ${panels.length}`);
    const holders: HostElement[] = [];
    for (let at = parentOf(s, panels[0]); at; at = parentOf(s, at)) holders.push(at);
    assert.ok(holders.some((el) => hasClass(el, 'directory-filter')), 'premise: the panel sits inside a .directory-filter wrapper');
    const declared = filterPanelMaxHeight(GLOBALS_CSS_TEXT, String(styleOf(panels[0]).maxHeight ?? ''));
    assert.ok(declared !== null, 'no max-height reaches the filter panel');
    const cap = heightCapPx(declared!);
    assert.ok(cap <= FILTER_PANEL_CAP_PX, `the filter panel's max-height is "${declared}", at most ${cap} px; the cap is ${FILTER_PANEL_CAP_PX} px`);
  });
}

// --- Criterion 4: the filter toggle is a Disclosure ---------------------------------------------------------------

for (const [tab, search] of [['servers', ''], ['portals', 'tab=portals']] as const) {
  test(`criterion 4 (R14): on the ${tab} tab the filters sit in a details.ui-disclosure reading "Show Filters" closed and "Hide Filters" open`, async () => {
    const s = await directory({}, search);
    const details = s.elements().filter((el) => el.type === 'details' && hasClass(el, 'ui-disclosure'));
    assert.equal(details.length, 1, `details.ui-disclosure on the ${tab} tab: ${details.length}`);
    const summary = (): string => textOf(within(s.elements().filter((el) => el.type === 'details' && hasClass(el, 'ui-disclosure'))[0]).find((el) => el.type === 'summary')!);
    assert.equal(summary(), 'Show Filters');
    const onToggle = details[0].props.onToggle as ((event: unknown) => void) | undefined;
    assert.ok(onToggle, 'the disclosure reports no toggle');
    onToggle({ currentTarget: { open: true } });
    await s.settle();
    assert.equal(summary(), 'Hide Filters');
  });
}

// --- Criterion 3: colours by token, and the badges' contrast -------------------------------------------------------

const COLOR_LITERAL = /['"`]#[0-9A-Fa-f]{3,8}['"`]|rgba?\(\s*[0-9][^)]*\)/g;
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));

test('criterion 3: the matcher reads 1 on a quoted hex and 0 on a named tint (its decoy pair)', () => {
  assert.equal([..."'#B8860B'".matchAll(COLOR_LITERAL)].length, 1);
  assert.equal([...'rgba(var(--accent-rgb), 0.1)'.matchAll(COLOR_LITERAL)].length, 0);
});

test('criterion 3: no colour literal in DirectoryClient.tsx or PortalDirectoryClient.tsx (comments blanked)', () => {
  const counts = Object.fromEntries(['DirectoryClient.tsx', 'PortalDirectoryClient.tsx'].map((f) => {
    const source = withoutComments(fs.readFileSync(path.join(SRC, 'components', f), 'utf8'));
    return [f, [...source.matchAll(COLOR_LITERAL)].map((m) => m[0])];
  }));
  assert.deepEqual(counts, { 'DirectoryClient.tsx': [], 'PortalDirectoryClient.tsx': [] });
});

const CSS = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8');
const ROOT = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('}', CSS.indexOf(':root')));
function token(name: string, depth = 0): string {
  const m = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`).exec(ROOT);
  assert.ok(m && depth < 5, `globals.css :root does not define ${name}`);
  const value = m![1].trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? token(ref[1], depth + 1) : value;
}
type RGBA = [number, number, number, number];
function colour(value: string): RGBA {
  const v = value.replace(/var\((--[\w-]+)\)/g, (_m, n: string) => token(n)).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = /^rgba?\(([^)]*)\)$/.exec(v);
  assert.ok(rgba, `a colour this check cannot read: ${value}`);
  const parts = rgba![1].split(',').map((p) => Number(p.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const [r, g, b] = c.slice(0, 3).map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (fg: RGBA, bg: RGBA) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

test('criterion 3 (PQ8 = (a)): every platform, transport and Commercial badge reaches 4.5:1 on its background', async () => {
  const s = await directory();
  const card = cardOf(s, 'fixture-commercial');
  const BADGES = ['Commercial', 'stdio', 'http', 'sse', 'Socrata', 'CKAN', 'Data Commons', 'ArcGIS'];
  const white: RGBA = [255, 255, 255, 1];
  const readings: string[] = [];
  for (const label of BADGES) {
    const el = within(card).find((x) => x.type === 'span' && textOf(x) === label);
    assert.ok(el, `no "${label}" badge on the fixture row`);
    const fg = colour(String(styleOf(el!).color));
    const bg = over(colour(String(styleOf(el!).backgroundColor)), white);
    const ratio = contrast(over(fg, bg), bg);
    if (ratio < 4.5) readings.push(`${label} ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(readings, [], 'badges under 4.5:1');
});

// --- Criterion 7: the guards ------------------------------------------------------------------------------------


/** Every JSX element with `target="_blank"` in a file, and its `rel`, read with the TypeScript compiler. */
function blankTargets(file: string, source = fs.readFileSync(file, 'utf8')): Array<{ line: number; rel: string | null }> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Array<{ line: number; rel: string | null }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const value = (name: string) => {
        const a = attrs.find((x) => x.name.getText(sf) === name);
        return a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : a ? a.initializer?.getText(sf) ?? '' : null;
      };
      if (value('target') === '_blank') out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, rel: value('rel') });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test('criterion 7 (guard): every target="_blank" link in the two directory components keeps a rel holding noopener', () => {
  const missing: string[] = [];
  let seen = 0;
  for (const f of ['DirectoryClient.tsx', 'PortalDirectoryClient.tsx']) {
    for (const { line, rel } of blankTargets(path.join(SRC, 'components', f))) {
      seen += 1;
      if (!/\bnoopener\b/.test(rel ?? '')) missing.push(`${f}:${line}`);
    }
  }
  assert.ok(seen >= 8, `premise: the two files hold their outbound links (${seen})`);
  assert.deepEqual(missing, []);
});

test('criterion 7 (guard, its instrument): the scan reads a missing rel as missing', () => {
  const decoy = 'const a = <><a href="x" target="_blank" rel="noopener noreferrer">x</a><a href="y" target="_blank">y</a></>;';
  assert.deepEqual(blankTargets('decoy.tsx', decoy).map((t) => /noopener/.test(t.rel ?? '')), [true, false]);
});

test('criterion 7 (guard): the portal table keeps its overflowX: auto wrapper', async () => {
  const s = await directory({}, 'tab=portals');
  const table = s.elements().filter((el) => el.type === 'table');
  assert.equal(table.length, 1, `tables on the portals tab: ${table.length}`);
  const wrapper = s.elements().find((el) => childrenOf(el).includes(table[0]));
  assert.equal(styleOf(wrapper!).overflowX, 'auto', 'the table\'s wrapper does not scroll sideways');
});
