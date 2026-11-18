// UX-2 P6 + P10 fix round 2, A3 (b) (owner OA-942; seat #729 6949484128): the row "Ask with this source" lands on.
//
// THE RULE. When the Settings overlay opens at a source's row (`?source=<id>`, the list marked `data-target-source`),
// the target row carries the mark the directory gives that source's card (`DirectoryClient.tsx`: a `1px solid
// var(--accent)` border and an `rgba(var(--accent-rgb), 0.03)` tint), applied BEFORE the row is scrolled into view, so
// the scroll counts the mark; and focus moves to the row itself, named by the source's reader name (the words the row
// already shows), not to its radios, so an arrow key cannot change a setting. With no `source`, or an id this instance
// does not offer, nothing changes: no mark, and focus where the Dialog puts it (Close).
//
// WHAT IS DRIVEN. The real `SettingsOverlay` on the surface harness, at `/settings?source=<id>`, over a statement of
// seven sources (every source switched on with fixture values, as production's order has them); the target is the
// statement's LAST row. The harness attaches no refs and has no DOM, so the overlay's row is reached through a
// `document` double: its `querySelector` answers the overlay's list's row with a recording element (attributes,
// `tabIndex`, `scrollIntoView`, `focus`), whose `focus()` sets `document.activeElement`. The mark's look is read from
// `globals.css`, where the attribute the overlay sets is given its declarations.
//
// WHAT MAKES IT ABLE TO FAIL. The target is the last of seven, the row a scroll by the least movement puts at the
// scroller's foot. The order of the calls is recorded, so a mark applied after the scroll reads red. The guard opens
// Settings as the menu does (no `source`) and reads focus still on Close and no row marked.
//
// BLIND SPOTS, stated. A double, not a browser: whether the marked row's foot lies inside the dialog's visible area,
// whether the browser keeps focus on the row, and whether an arrow key then leaves the radios as they were, are
// instrument 8's read (d) in Chrome. The CSS is read as written, not cascaded.
//
// Run with: npm test

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as nodeModule from 'node:module';
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
import { childrenOf, one, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

// Seven sources: every source switched on with fixture values (no real address, no key).
for (const name of ['DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'APP_HOST', 'NEXTAUTH_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV']) delete process.env[name];
Object.assign(process.env, {
  SOCRATA_MCP_URL: 'https://socrata.fixture.example',
  BOSTON_OPENCONTEXT_MCP_URL: 'https://boston.fixture.example',
  NYC_CHARTER_HOSTING: 'sandbox',
  NYC_CHECKBOOK_HOSTING: 'sandbox',
  NYS_LEGISLATION_HOSTING: 'sandbox',
  NYS_LEGISLATION_API_KEY: 'fixture',
});

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
const location = { href: `${ORIGIN}/settings`, origin: ORIGIN, pathname: '/settings', search: '' };
function at(search: string): void {
  location.search = search;
  location.href = `${ORIGIN}/settings${search}`;
}

// --- The document double ------------------------------------------------------------------------------------------

/** What the Dialog focuses when it opens (the harness attaches no ref, so it focuses nothing; this stands for Close). */
const CLOSE: { label: string; focus(): void } = { label: 'Close', focus() { doc.activeElement = CLOSE; } };
/** The dialog's panel, as a row's `closest('[role="dialog"]')` reaches it: its first enabled button is Close. */
const PANEL = { querySelector: (selector: string) => (selector.startsWith('button') ? CLOSE : null) };
// `tabIndex` reflects the `tabindex` attribute, as the DOM's does; with no attribute it reads 0 here (a browser reads -1
// for an `li`), so a test that reads the property can fail, and the reopen reads the attribute, as the Chrome probe does.
interface RowDouble { id: string; tabIndex: number; attrs: Map<string, string>; setAttribute(k: string, v: string): void; getAttribute(k: string): string | null; removeAttribute(k: string): void; scrollIntoView(o?: unknown): void; focus(o?: { preventScroll?: boolean }): void; closest(selector: string): typeof PANEL | null }
const calls: string[] = [];
const selectors: string[] = [];
const rows = new Map<string, RowDouble>();
const doc = {
  ...target,
  activeElement: CLOSE as unknown,
  querySelectorAll: () => [],
  /** Answers only a query for a row inside the overlay's marked list. */
  querySelector(selector: string): RowDouble | null {
    selectors.push(selector);
    const id = /li\[data-source="([^"]+)"\]/.exec(selector)?.[1];
    if (!id || !selector.includes('data-target-source')) return null;
    if (!rows.has(id)) {
      const row: RowDouble = {
        id,
        get tabIndex() { const v = this.attrs.get('tabindex'); return v === undefined ? 0 : Number(v); },
        set tabIndex(v: number) { this.attrs.set('tabindex', String(v)); },
        attrs: new Map(),
        setAttribute(k, v) { calls.push(`${id} set ${k}`); this.attrs.set(k, String(v)); },
        getAttribute(k) { return this.attrs.get(k) ?? null; },
        removeAttribute(k) { calls.push(`${id} remove ${k}`); this.attrs.delete(k); },
        scrollIntoView() { calls.push(`${id} scroll`); },
        focus(o) { calls.push(`${id} focus${o?.preventScroll ? ' (preventScroll)' : ''}`); doc.activeElement = row; },
        closest(selector) { return selector === '[role="dialog"]' ? PANEL : null; },
      };
      rows.set(id, row);
    }
    return rows.get(id)!;
  },
};
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location, history: { replaceState() {}, pushState() {} }, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
  document: doc,
  CSS: { escape: (v: string) => v.replace(/["\\]/g, '\\$&') },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const { readerSourceName } = await load('lib/sources/source-name.ts');
const statement = await buildFlowsStatement();
const SOURCES = statement.sources as Array<{ sourceId: string }>;
const LAST = SOURCES[SOURCES.length - 1];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
installFetch(ORIGIN, {
  '/api/flows': () => flowsRoute.GET(),
  '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
  '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
});

const mounted: Surface[] = [];
beforeEach(() => {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  sessions.rows.clear();
  calls.length = 0;
  selectors.length = 0;
  rows.clear();
  doc.activeElement = CLOSE;
});
afterEach(() => {
  for (const p of mounted.splice(0)) p.unmount();
});
async function overlayAt(search: string): Promise<Surface> {
  at(search);
  const page = await mount(h(SettingsOverlay, { mount: 'page' }));
  mounted.push(page);
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.settle();
  }
  return page;
}
/** The overlay's list (inside its dialog) and its rows, in order. */
function overlayList(page: Surface): { list: HostElement; rows: HostElement[] } {
  const dialogs = page.elements().filter((el) => el.props.role === 'dialog');
  assert.equal(dialogs.length, 1, `role="dialog" elements: ${dialogs.length}`);
  const lists = within(dialogs[0]).filter((el) => el.type === 'ul' && within(el).some((x) => x.type === 'li' && x.props['data-source'] !== undefined));
  assert.equal(lists.length, 1, `the dialog's source lists: ${lists.length}`);
  return { list: lists[0], rows: childrenOf(lists[0]).filter((el) => el.type === 'li') };
}

// --- The mark's look, read from globals.css -------------------------------------------------------------------------

const GLOBALS = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations (name -> value, `!important` dropped) of every innermost block naming `selector` exactly. */
function declarations(selector: string): Record<string, string> {
  const want = selector.replace(/\s+/g, ' ').trim();
  const out: Record<string, string> = {};
  for (const m of GLOBALS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((x) => x.replace(/\s+/g, ' ').trim()).includes(want)) continue;
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).replace(/!important/, '').trim();
    }
  }
  return out;
}
const MARK_BORDER = '1px solid var(--accent)';
const MARK_TINT = 'rgba(var(--accent-rgb), 0.03)';

test('fix round 2, A3 (premise): seven sources, the target is the last, and the directory gives a site source\'s card the mark', () => {
  assert.equal(SOURCES.length, 7, `sources: ${SOURCES.map((s) => s.sourceId).join(', ')}`);
  const card = fs.readFileSync(path.join(SRC, 'components', 'DirectoryClient.tsx'), 'utf8');
  assert.ok(card.includes("`1px solid ${siteSource ? 'var(--accent)' : 'var(--border-color)'}`"), 'premise: the card\'s border');
  assert.ok(card.includes(`siteSource ? '${MARK_TINT}'`), 'premise: the card\'s tint');
});

test(`fix round 2, A3 (b): at ?source=<the last of seven> the row carries the directory card's mark, applied before it is scrolled into view`, async () => {
  const page = await overlayAt(`?source=${LAST.sourceId}`);
  const { list, rows: shown } = overlayList(page);
  assert.equal(list.props['data-target-source'], LAST.sourceId, 'premise: the list marks the target');
  assert.equal(shown.length, 7, `premise: seven rows (${shown.length})`);
  assert.equal(shown[shown.length - 1].props['data-source'], LAST.sourceId, 'premise: the target is the last row');
  const marked = calls.filter((c) => / set data-landing-target$/.test(c));
  assert.deepEqual(marked, [`${LAST.sourceId} set data-landing-target`], `the overlay marked: ${JSON.stringify(calls)}`);
  const mark = calls.indexOf(`${LAST.sourceId} set data-landing-target`);
  const scroll = calls.indexOf(`${LAST.sourceId} scroll`);
  assert.ok(scroll !== -1, `premise: the row was scrolled into view: ${JSON.stringify(calls)}`);
  assert.ok(mark < scroll, `the mark came after the scroll: ${JSON.stringify(calls)}`);
  const look = declarations('ul[data-target-source] > li[data-landing-target]');
  assert.equal(look.border, MARK_BORDER, `the marked row's border: ${JSON.stringify(look)}`);
  assert.equal(look['background-color'], MARK_TINT, `the marked row's tint: ${JSON.stringify(look)}`);
});

test('fix round 2, A3 (b): focus moves to the row itself, named by the source\'s reader name, and not into its radios', async () => {
  const page = await overlayAt(`?source=${LAST.sourceId}`);
  const row = rows.get(LAST.sourceId);
  assert.ok(row, `the overlay never reached the target row: ${JSON.stringify(selectors)}`);
  assert.equal(doc.activeElement, row, `focus is not on the row: ${JSON.stringify(calls)}`);
  assert.equal(row!.tabIndex, -1, 'the row is not focusable by script alone');
  const name = readerSourceName(LAST) as string;
  assert.equal(row!.getAttribute('aria-label'), name, 'the row is not named by the source');
  // The name is the words the row already shows (its first line), so it adds no word.
  const { rows: shown } = overlayList(page);
  const rendered = shown[shown.length - 1];
  assert.equal(textOf(childrenOf(rendered)[0]), name, 'premise: the row shows the reader name first');
  // The radios sit inside the row; focus is on the row element itself, so no radio holds it.
  assert.ok(within(rendered).some((el) => el.props.role === 'radiogroup'), 'premise: the row holds its radios');
  assert.deepEqual(calls.filter((c) => / focus/.test(c)), [`${LAST.sourceId} focus (preventScroll)`], `focus calls: ${JSON.stringify(calls)}`);
});

for (const [shape, search] of [['Settings opened from the menu (no source)', ''], ['an unknown id', '?source=nope']] as const) {
  test(`fix round 2, A3 (guard): ${shape} marks no row and leaves focus on Close`, async () => {
    const page = await overlayAt(search);
    const { list, rows: shown } = overlayList(page);
    assert.equal(shown.length, 7, `premise: the rows rendered (${shown.length})`);
    assert.equal(list.props['data-target-source'], undefined, 'the list marks a target');
    assert.deepEqual(calls, [], `the overlay touched a row: ${JSON.stringify(calls)}`);
    assert.equal(doc.activeElement, CLOSE, 'focus moved off Close');
  });
}

// --- Fix round 4 (#729 6961859983): the landing ends when its target does -------------------------------------------
//
// THE DEFECT. Land at a source, close Settings, open it again with no source: the row still carried the landing's
// attribute, `tabindex="-1"` and `aria-label`, and held focus (planning `temp/ux-2/orch/probes/reopen-mark/`). The list
// had lost `data-target-source`, so the overlay had rendered again at an address with no source, and nothing took back
// what the landing had set on the row.
//
// THE SHAPE DRIVEN. One overlay, landed at `?source=<the last of seven>`, then the SAME overlay rendered again at an
// address with no source. The harness re-renders a mounted surface only on a state change inside it (it has no prop or
// address subscription; `readAddressSource` is read again at every render, as React's `useSyncExternalStore` reads its
// snapshot), so the address is changed and then the overlay's own search is typed: a space, which shows the same seven
// rows, and then nothing, which shows them again. The rendered list's `data-target-source` is read after each change,
// so a re-render that never read the new address reads red as a premise, not green. The row is the same double
// throughout: one overlay, one row element.

/** Change the address, then re-render the same overlay through its own search (`query` keeps all seven rows). */
async function sameOverlayAt(page: Surface, search: string, query: string): Promise<void> {
  at(search);
  const input = one(page.elements().filter((el) => el.type === 'input' && el.props.type === 'search'), 'the search');
  await page.type(input, query);
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.settle();
  }
}

/** What the landing left on the row and on focus; empty when the row reads as on a no-source open. */
function landingLeftovers(row: RowDouble): string[] {
  const left: string[] = [];
  if (row.getAttribute('data-landing-target') !== null) left.push('the row keeps data-landing-target');
  if (row.getAttribute('tabindex') === '-1') left.push('the row keeps tabindex="-1"');
  if (row.getAttribute('aria-label') !== null) left.push(`the row keeps aria-label="${row.getAttribute('aria-label')}"`);
  if (doc.activeElement === row) left.push('focus is on the row');
  else if (doc.activeElement !== CLOSE) left.push('focus is neither on the row nor on Close');
  return left;
}

test('fix round 4 (acceptance 1): landed at <the last of seven>, then the same overlay with no source, the row keeps nothing the landing set and focus is on Close', async () => {
  const page = await overlayAt(`?source=${LAST.sourceId}`);
  const row = rows.get(LAST.sourceId);
  assert.ok(row, `premise: the landing reached the row: ${JSON.stringify(selectors)}`);
  assert.equal(row!.getAttribute('data-landing-target'), '', 'premise: the landing marked the row');
  assert.equal(doc.activeElement, row, 'premise: the landing focused the row');
  await sameOverlayAt(page, '', ' ');
  const { list, rows: shown } = overlayList(page);
  assert.equal(list.props['data-target-source'], undefined, 'premise: the re-render read the address with no source');
  assert.equal(shown.length, 7, `premise: the same seven rows (${shown.length})`);
  assert.equal(rows.get(LAST.sourceId), row, 'premise: one row element throughout');
  assert.deepEqual(landingLeftovers(row!), [], `calls: ${JSON.stringify(calls)}`);
});

test('fix round 4 (acceptance 2): after that reopen, a second landing on the same source marks, scrolls and focuses the row again', async () => {
  const page = await overlayAt(`?source=${LAST.sourceId}`);
  const row = rows.get(LAST.sourceId);
  assert.ok(row, `premise: the landing reached the row: ${JSON.stringify(selectors)}`);
  await sameOverlayAt(page, '', ' ');
  assert.equal(overlayList(page).list.props['data-target-source'], undefined, 'premise: the reopen read no source');
  const from = calls.length;
  await sameOverlayAt(page, `?source=${LAST.sourceId}`, '');
  assert.equal(overlayList(page).list.props['data-target-source'], LAST.sourceId, 'premise: the second landing read the source');
  const again = calls.slice(from);
  const problems: string[] = [];
  for (const want of [`${LAST.sourceId} set data-landing-target`, `${LAST.sourceId} scroll`, `${LAST.sourceId} focus (preventScroll)`]) {
    if (!again.includes(want)) problems.push(`the second landing did not: ${want}`);
  }
  if (row!.getAttribute('data-landing-target') === null) problems.push('the row is not marked');
  if (row!.getAttribute('tabindex') !== '-1') problems.push('the row has no tabindex="-1"');
  if (row!.getAttribute('aria-label') !== readerSourceName(LAST)) problems.push('the row is not named by the source');
  if (doc.activeElement !== row) problems.push('focus is not on the row');
  assert.deepEqual(problems, [], `calls after the reopen: ${JSON.stringify(again)}`);
});

// --- UX-2-FIX P2, item 3 (#790): a reopened Settings does not land again ---------------------------------------------
//
// THE DEFECT. Land at a source, close Settings, open it again from the page's own link (no source): the list scrolled to
// the old row (536 px at 1280, 848 at 390, the cold read's Chrome read) against 0 on a fresh open. Closing goes back to
// the page, whose address still holds `?source=<id>`; the reopened overlay renders first while that is still the
// address, because the router writes `/settings` into the address in an insertion effect of the same commit. So the
// overlay's first render reads the old source, and its landing effect, which runs after the address has changed, lands.
//
// THE SHAPE DRIVEN. The first overlay lands and is unmounted (closed). The reopen is a NEW overlay mounted while the
// address double still holds `?source=<the last of seven>`, beside a stand-in for the router's history write: a component
// rendered before the overlay whose insertion effect sets the address to `/settings` with no source. The harness runs
// effects in render order, so that write lands before the overlay's own effects, as React's insertion effects run before
// any passive effect. Every call on the row is recorded: a reopen that lands records a scroll.
//
// BLIND SPOTS, stated. The router is a stand-in here; the scroll the reader sees is the phase's Chrome read, on a real
// `next start`, on both mounts.

test('#790 item 3: land, close, then reopen with no source while the old address is still showing: no row is marked and no landing runs', async () => {
  // The page beneath the overlay reads the consent store too, so the statement stays loaded when the overlay closes
  // (the store starts from nothing again only when its last reader leaves), as on the site.
  const { useSourceConsent } = await load('components/sources/useSourceConsent.ts');
  function PageBeneath() {
    useSourceConsent();
    return null;
  }
  const beneath = await mount(h(PageBeneath));
  mounted.push(beneath);
  const first = await overlayAt(`?source=${LAST.sourceId}`);
  assert.ok(calls.includes(`${LAST.sourceId} scroll`), `premise: the first landing scrolled the row: ${JSON.stringify(calls)}`);
  first.unmount();
  mounted.splice(mounted.indexOf(first), 1);
  calls.length = 0;
  rows.clear();
  doc.activeElement = CLOSE;

  // The reopen: the page's address still holds the source when the overlay first renders.
  at(`?source=${LAST.sourceId}`);
  // The harness's own hook runtime (a test file's `react` is React itself, whose hooks the harness does not run). Its
  // URL names no file on disk, so it is resolved to itself here and the harness's load hook serves it.
  const RUNTIME = 'file:///civic-w3-surface-stub/react.mjs';
  (nodeModule as unknown as { registerHooks(h: { resolve(s: string, c: unknown, n: (s: string, c?: unknown) => unknown): unknown }): void }).registerHooks({
    resolve: (specifier, context, nextResolve) => (specifier === RUNTIME ? { url: RUNTIME, format: 'module', shortCircuit: true } : nextResolve(specifier, context)),
  });
  const { createElement, Fragment, useInsertionEffect } = (await import(RUNTIME)) as typeof import('react');
  function RouterHistoryWrite({ search }: { search: string }) {
    useInsertionEffect(() => { at(search); }, [search]);
    return null;
  }
  const reopened = await mount(createElement(Fragment, null, createElement(RouterHistoryWrite, { search: '' }), createElement(SettingsOverlay, { mount: 'intercepted' })));
  mounted.push(reopened);
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await reopened.settle();
  }
  assert.equal(location.search, '', 'premise: the router\'s history write ran');
  const { rows: shown } = overlayList(reopened);
  assert.equal(shown.length, 7, `premise: the reopened overlay rendered its rows (${shown.length})`);
  const row = rows.get(LAST.sourceId);
  assert.deepEqual({
    landingCalls: calls.filter((c) => / (set data-landing-target|scroll|focus)/.test(c)),
    marked: row?.getAttribute('data-landing-target') ?? null,
    focusOnClose: doc.activeElement === CLOSE,
  }, { landingCalls: [], marked: null, focusOnClose: true }, `calls on the reopen: ${JSON.stringify(calls)}`);
});
