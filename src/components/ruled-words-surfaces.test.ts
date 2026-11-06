// UX-1 PW (#719, the census as ruled at G0-6), criterion 2: the ruled words,
// rendered. R19 A and its note name the site's saved item "analysis" /
// "analyses": the dashboard's first tab reads "My analyses (n)", the Header's
// avatar and mobile menus read "My analyses" (still linking `/dashboard`), the
// Header's item for the registry reads "Analysis" (still linking `/records`),
// `/records` carries the h1 "Analysis", and the registry's count line counts
// "items" ("1 item", "3 items": today's plural rule, kept).
//
// WHAT IS DRIVEN. The real `DashboardTabs`, the real `Header` (signed in, its
// avatar menu and its mobile drawer each opened by calling the button's
// `onClick`, as the harness clicks), and the real `/records` page
// (`src/app/(app)/records/page.tsx`, which re-exports the `/evidence` page)
// with its list request answered by the test, on the surface harness.
// UX-1 P3a moved two of the Header's items, and the two finders that read
// them were restated so each keeps its property: the section item is now a
// bar item (it was inside Explore's panel), and at the mobile layout the
// account entry is reached through the avatar menu (the drawer holds the
// bar's grouping only).
//
// WHAT MAKES IT ABLE TO FAIL. At the base each surface renders the old word:
// "My Records (0)", "Dashboard", "Records", an h1 "Records", "3 records".
//
// BLIND SPOTS, stated. The harness has no layout: `lg:hidden` and
// `hidden lg:flex` are class names here, so "at the mobile layout" is read as
// "no ancestor of the control carries `hidden`", the class that hides an
// element below the `lg` width (1024 px), not by a viewport. `next/image` is
// stubbed (the fixture account has no avatar image).
//
// UX-2 PW2 (#729) adds the home comparison's heading (X1) at the end of this
// file, under its own header.
//
// Run with: npm test

import { test } from 'node:test';
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
} from './sources/surface-test-harness.ts';
import { byRole, classesOf, parentOf, within } from './ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  'next/image': `export default function Image() { return null; }`,
});

const ORIGIN = 'https://app.fixture.example';
/** `ComparisonDisplay`'s narrow-layout query (`useMediaQuery('(max-width: 640px)')`). */
const NARROW_QUERY = '(max-width: 640px)';
let narrow = false;

const target = { addEventListener() {}, removeEventListener() {} };
// The answer view reads the reader's layout choice from session storage (`useSessionChoice`).
const storage = new Map<string, string>();
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    setTimeout,
    clearTimeout,
    // Every query answers false unless a test sets `narrow` (UX-2 PW2, below):
    // then the comparison's own query, `(max-width: 640px)`, answers true.
    matchMedia: (query: string) => ({ matches: narrow && query === NARROW_QUERY, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as ComponentType<Record<string, unknown>>;
const Header = (await load('components/Header.tsx')).default as ComponentType<Record<string, unknown>>;
const RecordsPage = (await load('app/(app)/records/page.tsx')).default as ComponentType<Record<string, unknown>>;
const ComparisonDisplay = (await load('components/ComparisonDisplay.tsx')).default as ComponentType<Record<string, unknown>>;

function signedIn(): void {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture Reader' } } };
}

const anchorsTo = (surface: Surface, href: string): HostElement[] =>
  surface.elements().filter((el) => el.type === 'a' && el.props.href === href);

const linkWords = (surface: Surface, href: string): string[] => anchorsTo(surface, href).map((el) => textOf(el));

/** The one `<button>` the predicate picks; throws with what the surface reads otherwise. */
function onlyButton(surface: Surface, pick: (el: HostElement) => boolean, what: string): HostElement {
  const found = surface.elements().filter((el) => el.type === 'button' && pick(el));
  assert.equal(found.length, 1, `premise: one ${what} button, found ${found.length}; the surface reads: ${surface.text().slice(0, 400)}`);
  return found[0];
}

test('the dashboard\'s tab bar: its first tab reads "My analyses (n)"', async () => {
  signedIn();
  installFetch(ORIGIN, {});
  const tabs = await mount(h(DashboardTabs, { myEvidence: [], myEvaluations: [], activity: [], tokens: [], signingConfigured: true, sealOnly: false }));
  const labels = tabs.elements().filter((el) => el.type === 'button').map((el) => textOf(el));
  assert.ok(labels.length >= 5, `premise: the tab bar renders, found buttons: ${JSON.stringify(labels)}`);
  assert.ok(labels[0].startsWith('My analyses ('), `the first tab reads ${JSON.stringify(labels[0])}; the tab bar reads ${JSON.stringify(labels.slice(0, 5))}`);
  assert.equal(labels[0], 'My analyses (0)');
  tabs.unmount();
});

test('the Header\'s avatar menu, opened signed in: "My analyses", linking /dashboard', async () => {
  signedIn();
  installFetch(ORIGIN, {});
  const header = await mount(h(Header, { brandName: 'Fixture Site' }));
  assert.deepEqual(anchorsTo(header, '/dashboard'), [], 'premise: no /dashboard link before the avatar menu opens');
  await header.click(onlyButton(header, (el) => textOf(el).includes('Fixture Reader'), 'avatar'));
  assert.deepEqual(linkWords(header, '/dashboard'), ['My analyses'], `the avatar menu's /dashboard link reads ${JSON.stringify(linkWords(header, '/dashboard'))}`);
  header.unmount();
});

test('the Header\'s bar (desktop): the registry\'s item reads "Analysis", linking /records, with every menu closed', async () => {
  signedIn();
  installFetch(ORIGIN, {});
  const header = await mount(h(Header, { brandName: 'Fixture Site' }));
  assert.equal(byRole(header, 'dialog').length, 0, 'premise: the mobile drawer is closed, so every link read is in the bar');
  assert.equal(byRole(header, 'menu').length, 0, 'premise: every menu is closed');
  assert.deepEqual(linkWords(header, '/records'), ['Analysis'], `the bar's /records link reads ${JSON.stringify(linkWords(header, '/records'))}`);
  header.unmount();
});

test('the Header at the mobile layout, signed in: the account entry reads "My analyses", linking /dashboard, through the avatar menu; the drawer\'s section item reads "Analysis"', async () => {
  signedIn();
  installFetch(ORIGIN, {});
  const header = await mount(h(Header, { brandName: 'Fixture Site' }));
  assert.deepEqual(anchorsTo(header, '/dashboard'), [], 'premise: the account entry renders only when the avatar menu opens');
  const avatar = onlyButton(header, (el) => textOf(el).includes('Fixture Reader'), 'avatar');
  const hiders: string[] = [];
  for (let at: HostElement | null = avatar; at; at = parentOf(header, at)) {
    if (classesOf(at).includes('hidden')) hiders.push(`<${at.type} class="${classesOf(at).join(' ')}">`);
  }
  assert.deepEqual(hiders, [], 'premise: no ancestor of the avatar trigger hides it below the lg width');
  await header.click(avatar);
  assert.deepEqual(linkWords(header, '/dashboard'), ['My analyses'], `the avatar menu's /dashboard link reads ${JSON.stringify(linkWords(header, '/dashboard'))}`);
  await header.click(onlyButton(header, (el) => el.props['aria-label'] === 'Toggle menu', 'mobile menu'));
  const drawer = byRole(header, 'dialog');
  assert.equal(drawer.length, 1, 'premise: the toggle opens one drawer');
  const inDrawer = within(drawer[0]).filter((el) => el.type === 'a' && el.props.href === '/records').map((el) => textOf(el));
  assert.deepEqual(inDrawer, ['Analysis'], `the drawer's /records link reads ${JSON.stringify(inDrawer)}`);
  header.unmount();
});

/** `/records` with the registry's list request answered: `total` published items, one row shown. */
async function recordsPage(total: number): Promise<Surface> {
  installFetch(ORIGIN, {
    '/api/records/list': () => new Response(JSON.stringify({
      records: [{
        id: 'fixture-id', slug: 'fixture-slug', title: 'Fixture title', summary: 'Fixture summary.', model: 'fixture/model',
        verificationStatus: 'unverified', withdrawnAt: null, reinstatedAt: null, createdAt: '2026-11-01T00:00:00.000Z', creatorName: 'Fixture Reader',
      }],
      total,
      page: 1,
      totalPages: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  return mount(h(RecordsPage, {}));
}

/** The count line: the one element whose whole text is a number and a noun. */
const countLine = (surface: Surface): string[] =>
  surface.elements().filter((el) => el.type === 'div' && /^\d+ [A-Za-z]+$/.test(textOf(el))).map((el) => textOf(el));

test('/records: the h1 reads "Analysis"', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const page = await recordsPage(3);
  const h1 = page.elements().filter((el) => el.type === 'h1').map((el) => textOf(el));
  assert.deepEqual(h1, ['Analysis'], `/records's h1 reads ${JSON.stringify(h1)}`);
  page.unmount();
});

test('/records: the registry\'s count line counts items ("3 items", "1 item")', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const three = await recordsPage(3);
  assert.ok(three.text().includes('Fixture title'), `premise: the list rendered: ${three.text().slice(0, 400)}`);
  const lines = { 3: countLine(three) } as Record<number, string[]>;
  three.unmount();
  const one = await recordsPage(1);
  lines[1] = countLine(one);
  one.unmount();
  assert.deepEqual(lines, { 3: ['3 items'], 1: ['1 item'] }, `the count lines read ${JSON.stringify(lines)}`);
});

// --- UX-2 PW2, criterion 1 (#729 X1; #728 line 8): the home comparison's heading ---------
//
// X1, RULED (the word memo's D1 / W7 for `/learn`, sentence case by its D2;
// OA-185 A for the home page): the comparison's without-data heading reads
// "Without data tools". `ComparisonDisplay` writes it at three sites, each
// reached here in the state that renders it:
//   - side by side (`answerFirst` false, wide): the without-data panel's title;
//   - narrow (`answerFirst` false, `(max-width: 640px)` matching): the
//     collapsed panel's heading, then, after the collapsed panel is clicked,
//     the expanded panel's title (the same panel as side by side);
//   - answer-first (`answerFirst` true): the run-the-comparison button's heading.
//
// WHAT IS DRIVEN. The real `ComparisonDisplay`, the component the home page's
// `QuerySurface` mounts, with a finished run's two answers as props. The
// harness has no layout: "narrow" is the component's own `matchMedia` query
// answered true by this file's `window` stub, not a viewport.
//
// WHAT MAKES IT ABLE TO FAIL. At the base each site reads "Without Data Tools".
// Each state's premise names a part only that state renders, so a state that
// fell back to another's markup fails its premise, not the words.

const X1_WITHOUT = 'Without data tools';
const COMPARISON_PROPS = {
  withoutMcp: { content: 'WITHOUTANSWER-pw2: about four thousand complaints.', duration_ms: 1200 },
  withMcp: { content: 'WITHANSWER-pw2: **4,812** complaints.', duration_ms: 2400 },
  isLoading: false,
  modelName: 'Fixture model',
  isStreaming: false,
  queryText: 'How many complaints were filed?',
};

/** The comparison's headings that name the without-data arm, as a reader reads each. */
const withoutHeadings = (surface: Surface): string[] =>
  surface.elements().filter((el) => el.type === 'h3' && /^without\b/i.test(textOf(el))).map((el) => textOf(el));

test('PW2 criterion 1 (X1): side by side, the without-data panel\'s title reads "Without data tools"', async () => {
  narrow = false;
  installFetch(ORIGIN, {});
  const view = await mount(h(ComparisonDisplay, { ...COMPARISON_PROPS, answerFirst: false }));
  assert.ok(view.text().includes('Fixture model using only training data') && view.text().includes('WITHOUTANSWER-pw2'), `premise: the without-data panel renders with its answer: ${view.text().slice(0, 400)}`);
  assert.equal(view.elements().filter((el) => (el.type === 'div' && typeof el.props.onClick === 'function') || el.props['aria-label'] === 'Collapse panel').length, 0, 'premise: side by side, no collapsed or expanded narrow panel');
  assert.deepEqual(withoutHeadings(view), [X1_WITHOUT], `the without-data headings read ${JSON.stringify(withoutHeadings(view))}`);
  assert.ok(!view.text().includes('Without Data Tools'), 'no text reads "Without Data Tools"');
  view.unmount();
});

test('PW2 criterion 1 (X1): narrow, the collapsed panel\'s heading and, once expanded, the panel\'s title read "Without data tools"', async () => {
  narrow = true;
  try {
    installFetch(ORIGIN, {});
    const view = await mount(h(ComparisonDisplay, { ...COMPARISON_PROPS, answerFirst: false }));
    const collapsed = view.elements().filter((el) => el.type === 'div' && typeof el.props.onClick === 'function');
    assert.equal(collapsed.length, 1, `premise: narrow, one collapsed panel to click; the surface reads: ${view.text().slice(0, 400)}`);
    assert.ok(textOf(collapsed[0]).includes('WITHOUTANSWER-pw2'), 'premise: the collapsed panel previews the without-data answer');
    assert.deepEqual(withoutHeadings(view), [X1_WITHOUT], `collapsed, the without-data headings read ${JSON.stringify(withoutHeadings(view))}`);
    await view.click(collapsed[0]);
    assert.equal(view.elements().filter((el) => el.type === 'button' && el.props['aria-label'] === 'Collapse panel').length, 1, 'premise: the click expanded the panel');
    assert.deepEqual(withoutHeadings(view), [X1_WITHOUT], `expanded, the without-data headings read ${JSON.stringify(withoutHeadings(view))}`);
    assert.ok(!view.text().includes('Without Data Tools'), 'no text reads "Without Data Tools"');
    view.unmount();
  } finally {
    narrow = false;
  }
});

test('PW2 criterion 1 (X1): answer-first, the run-the-comparison button\'s heading reads "Without data tools"', async () => {
  narrow = false;
  installFetch(ORIGIN, {});
  const view = await mount(h(ComparisonDisplay, { ...COMPARISON_PROPS, answerFirst: true, onRunComparison: () => {} }));
  const run = view.elements().filter((el) => el.type === 'button' && textOf(el).includes('Run the side-by-side comparison'));
  assert.equal(run.length, 1, `premise: answer-first, one run-the-comparison button; the surface reads: ${view.text().slice(0, 400)}`);
  assert.ok(!view.text().includes('using only training data'), 'premise: answer-first renders no without-data panel');
  assert.deepEqual(withoutHeadings(view), [X1_WITHOUT], `the without-data headings read ${JSON.stringify(withoutHeadings(view))}`);
  assert.equal(within(run[0]).filter((el) => el.type === 'h3').map((el) => textOf(el)).join('|'), X1_WITHOUT, 'the heading is the run-the-comparison button\'s own');
  assert.ok(!view.text().includes('Without Data Tools'), 'no text reads "Without Data Tools"');
  view.unmount();
});
