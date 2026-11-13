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
// UX-2 PW2 (#729) adds the home comparison's two headings (X1, R4) and the
// dashboard's not-reversible sentence (G0-4 B, S8) at the end of this file,
// under their own headers. UX-2 P3b-1 adds the docked composer's words (X23,
// X24's two forms) after them, and its re-cut (criterion 11) the where-line's
// forms, the sign-in line, the count's two forms and the example row's name.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
// R4 (G0-10, #729 comment 6690939748), RULED: the with-data panel's title
// (`ComparisonDisplay.tsx:120`) reads "With data tools"; it renders in all
// three states, and each test reads it too.
//
// WHAT MAKES IT ABLE TO FAIL. At the base each site reads "Without Data Tools"
// and the with-data title "With Data Tools". Each state's premise names a part
// only that state renders, so a state that fell back to another's markup fails
// its premise, not the words.

const X1_WITHOUT = 'Without data tools';
const R4_WITH = 'With data tools';
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
/** The comparison's headings that name the with-data arm ("With …", never "Without …"). */
const withHeadings = (surface: Surface): string[] =>
  surface.elements().filter((el) => el.type === 'h3' && /^with\b/i.test(textOf(el))).map((el) => textOf(el));

test('PW2 criterion 1 (X1, R4): side by side, the without-data panel\'s title reads "Without data tools"', async () => {
  narrow = false;
  installFetch(ORIGIN, {});
  const view = await mount(h(ComparisonDisplay, { ...COMPARISON_PROPS, answerFirst: false }));
  assert.ok(view.text().includes('Fixture model using only training data') && view.text().includes('WITHOUTANSWER-pw2'), `premise: the without-data panel renders with its answer: ${view.text().slice(0, 400)}`);
  assert.equal(view.elements().filter((el) => (el.type === 'div' && typeof el.props.onClick === 'function') || el.props['aria-label'] === 'Collapse panel').length, 0, 'premise: side by side, no collapsed or expanded narrow panel');
  assert.deepEqual(withoutHeadings(view), [X1_WITHOUT], `the without-data headings read ${JSON.stringify(withoutHeadings(view))}`);
  assert.ok(!view.text().includes('Without Data Tools'), 'no text reads "Without Data Tools"');
  assert.deepEqual(withHeadings(view), [R4_WITH], `R4: the with-data headings read ${JSON.stringify(withHeadings(view))}`);
  view.unmount();
});

test('PW2 criterion 1 (X1, R4): narrow, the collapsed panel\'s heading and, once expanded, the panel\'s title read "Without data tools"', async () => {
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
    assert.deepEqual(withHeadings(view), [R4_WITH], `R4, narrow: the with-data headings read ${JSON.stringify(withHeadings(view))}`);
    view.unmount();
  } finally {
    narrow = false;
  }
});

test('PW2 criterion 1 (X1, R4): answer-first, the run-the-comparison button\'s heading reads "Without data tools"', async () => {
  narrow = false;
  installFetch(ORIGIN, {});
  const view = await mount(h(ComparisonDisplay, { ...COMPARISON_PROPS, answerFirst: true, onRunComparison: () => {} }));
  const run = view.elements().filter((el) => el.type === 'button' && textOf(el).includes('Run the side-by-side comparison'));
  assert.equal(run.length, 1, `premise: answer-first, one run-the-comparison button; the surface reads: ${view.text().slice(0, 400)}`);
  assert.ok(!view.text().includes('using only training data'), 'premise: answer-first renders no without-data panel');
  assert.deepEqual(withoutHeadings(view), [X1_WITHOUT], `the without-data headings read ${JSON.stringify(withoutHeadings(view))}`);
  assert.equal(within(run[0]).filter((el) => el.type === 'h3').map((el) => textOf(el)).join('|'), X1_WITHOUT, 'the heading is the run-the-comparison button\'s own');
  assert.ok(!view.text().includes('Without Data Tools'), 'no text reads "Without Data Tools"');
  assert.deepEqual(withHeadings(view), [R4_WITH], `R4, answer-first: the with-data headings read ${JSON.stringify(withHeadings(view))}`);
  view.unmount();
});

// --- UX-2 PW2, criterion 5 (G0-4 B, S8): the dashboard's not-reversible sentence -----------
//
// The research check's S8, ruled by G0-10 R1 (#729 comment 6690939748): in
// the dialog headed "Publish this analysis", the not-reversible sentence says
// a withdrawal flags the analysis, not the record.
//
// WHAT IS DRIVEN. The real `DashboardTabs` with one sealed analysis, its
// Publish action clicked as the harness clicks, and the dialog's paragraph
// read whole. At the base it ends "a later withdrawal flags the record but
// does not erase it."
//
// UX-2 P4a (F3, relay 46): Publish is an item of the row's menu, so the menu
// is opened first; the dialog is the P4 `Dialog`, whose title is an `h2`. Only
// the finders changed; the paragraph's assertion is as it was.

const S8_PARAGRAPH =
  'Publishing makes the content of Fixture sealed analysis publicly accessible, lists it in the registry, and emits ' +
  'signed publication attestations. Publication is not reversible — a later withdrawal flags the analysis but does ' +
  'not erase it.';

test('PW2 criterion 5 (S8): the dashboard\'s Publish dialog says a withdrawal flags the analysis', async () => {
  signedIn();
  installFetch(ORIGIN, {});
  const sealed = {
    id: 'fixture-sealed', slug: 'fixture-sealed', title: 'Fixture sealed analysis', summary: 'Fixture summary.', model: 'fixture/model',
    verificationStatus: 'unverified', consistencyClassification: null, withdrawnAt: null, reinstatedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z', attestationCount: 0, visibility: 'sealed',
  };
  const tabs = await mount(h(DashboardTabs, { myEvidence: [sealed], myEvaluations: [], activity: [], tokens: [], signingConfigured: true, sealOnly: false }));
  await tabs.click(onlyButton(tabs, (el) => el.props['aria-haspopup'] === 'menu', 'row menu'));
  await tabs.click(onlyButton(tabs, (el) => el.props.role === 'menuitem' && textOf(el) === 'Publish', 'Publish'));
  const heading = tabs.elements().filter((el) => el.type === 'h2' && textOf(el) === 'Publish this analysis');
  assert.equal(heading.length, 1, `premise: the click opened the dialog; the surface reads: ${tabs.text().slice(0, 400)}`);
  const paragraph = tabs.elements().filter((el) => el.type === 'p' && textOf(el).startsWith('Publishing makes the content of')).map((el) => textOf(el));
  assert.deepEqual(paragraph, [S8_PARAGRAPH], `the dialog's paragraph reads ${JSON.stringify(paragraph)}`);
  tabs.unmount();
});

// --- UX-2 P3b-1, criterion 7 (X23, X24; R1 = A, Q5 = B): the docked composer's words ----------------
//
// The research check's X23 (the docked box's placeholder) and X24's two forms (the first-time line under the
// docked box: the signed-in form on `/ask`, the signed-out form on the home page), each rendered by the real
// `Composer` and read byte for byte against the ruled words written out here. `composer-dock.test.ts` drives the
// surfaces that choose the form. At the base `Composer` does not exist; at the red commit it renders nothing.

const X23_PLACEHOLDER = 'Ask another question';
const X24_SIGNED_IN = 'A new question replaces this answer. To keep this answer, publish it first.';
/** O4 = A: signed out, the first sentence only; the second is ruled and withheld until sign-in keeps the answer. */
const X24_SIGNED_OUT = 'A new question replaces this answer.';

const Composer = (await load('components/composer/Composer.tsx')).default as ComponentType<Record<string, unknown>>;

/** The composer as a mount renders it, with the guard's slots closed. */
const composerProps = (extra: Record<string, unknown>): Record<string, unknown> => ({
  value: '',
  onChange: () => {},
  onSubmit: () => {},
  canSubmit: false,
  isLoading: false,
  placeholder: 'Fixture undocked placeholder',
  guard: { cardOpen: false, onAllow: () => {}, onNotNow: () => {}, declined: false, statement: null, noneOn: false },
  ...extra,
});

const composerBox = (surface: Surface): HostElement[] => surface.elements().filter((el) => el.type === 'textarea');
/** Each first-time line as read whole, with its element (contract v5 1B.2: one plain <p>, no disclosure). */
const firstTimeLine = (surface: Surface): string[] =>
  surface.elements().filter((el) => el.props['data-part'] === 'first-time-line').flatMap((el) => {
    const inner = within(el).filter((x) => x !== el && ['details', 'summary', 'p', 'div'].includes(x.type)).map((x) => x.type);
    return [textOf(el), `<${el.type}>${inner.length > 0 ? ` holding ${inner.join(', ')}` : ''}`];
  });

test('P3b-1 criterion 7 (X23): the docked box\'s placeholder reads "Ask another question"; undocked, the mount\'s own', async () => {
  installFetch(ORIGIN, {});
  const docked = await mount(h(Composer, composerProps({ docked: true })));
  assert.deepEqual(composerBox(docked).map((el) => el.props.placeholder), [X23_PLACEHOLDER], 'the docked placeholder');
  docked.unmount();
  const undocked = await mount(h(Composer, composerProps({ docked: false })));
  assert.deepEqual(composerBox(undocked).map((el) => el.props.placeholder), ['Fixture undocked placeholder'], 'the undocked placeholder');
  undocked.unmount();
});

test('P3b-1 criterion 11 (X24, Q5 = B; O4 = A): the first-time line in its signed-in and signed-out forms, byte for byte, one <p>, signed out its first sentence only; none when the mount asks for none', async () => {
  installFetch(ORIGIN, {});
  const read: Record<string, string[]> = {};
  for (const [name, form] of [['signed-in', 'signed-in'], ['signed-out', 'signed-out'], ['none', null]] as const) {
    const view = await mount(h(Composer, composerProps({ docked: true, firstTimeLine: form })));
    read[name] = firstTimeLine(view);
    view.unmount();
  }
  assert.deepEqual(read, {
    'signed-in': [X24_SIGNED_IN, '<p>'],
    'signed-out': [X24_SIGNED_OUT, '<p>'],
    none: [],
  }, `the first-time lines read ${JSON.stringify(read)}`);
});

// --- UX-2 P3b-1, criterion 11 (addendum 1, section 1; Q6 = B; W1, W2, W7): the re-cut's ruled words, rendered -------
//
// Each row is read off the real surface that renders it, the home page signed out (Standard) or /ask signed in
// (Sandbox), against the words written out here: the where-line's forms (items 23/47, W3, W4, W5, W6), "Select
// sources", the P3b sign-in line, the count's forms at 7 and at 0 (W1, W2), and the example row's name (W7). The
// consent is written through the REAL consent route. At the base the where-line reads "This question goes to …
// Change sources", there is no sign-in line or account line, and the count reads "N/M requests remaining today".

process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const wordsStatement = await buildFlowsStatement();
const WORDS_IDS: string[] = wordsStatement.sources.map((s: { sourceId: string }) => s.sourceId);

const WHERE = {
  standardOne: 'Where your question goes: the model service and 1 data source · Select sources',
  standardAll: `Where your question goes: the model service and ${WORDS_IDS.length} data sources · Select sources`,
  sandboxOne: 'Where your question goes: the model service, the notebook runner and 1 data source · Select sources',
  standardAsk: 'Where your question goes: the model service; data sources ask first · Select sources',
  sandboxAsk: 'Where your question goes: the model service and the notebook runner; data sources ask first · Select sources',
  everyOff: 'Where your question goes: nowhere; every data source is Off · Select sources',
};
const P3B_SIGN_IN_LINE = 'Sign in for more features and usage.';

const wordsJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
/** The decision route's answer; UX-2 P3b-2's rows below set all-sources. */
let wordsRouting: { routing: string; store: boolean } = { routing: 'in-loop', store: true };
function wordsAnswers(remaining: number, limit: number): void {
  installFetch(ORIGIN, {
    '/api/models': () => wordsJson({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => wordsJson(wordsRouting),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => wordsJson({ remaining, limit, resets_at: '2099-01-01T00:00:00.000Z', authenticated: sessions.server !== null }),
    '/api/compare-stream': () => new Response(['withoutMcp', 'withMcp'].map((panel) => `data: ${JSON.stringify({ type: 'complete', panel, data: { content: 'A fixture answer.', duration_ms: 1, tools_called: [] } })}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
  });
}
async function wordsConsent(states: (id: string, i: number) => string): Promise<void> {
  const response = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: Object.fromEntries(WORDS_IDS.map((id, i) => [id, states(id, i)])), flowsVersion: statementHash(wordsStatement) }) });
  assert.equal(response.status, 200, 'premise: the consent was written');
}
const settled = async (surface: Surface) => { await new Promise((resolve) => setTimeout(resolve, 50)); await surface.settle(); };
const partText = (surface: Surface, name: string): string[] => surface.elements().filter((el) => el.props['data-part'] === name).map((el) => textOf(el));
const signedOut = () => { sessions.server = null; sessions.client = { status: 'unauthenticated', data: null }; };

test('P3b-1 criterion 11 (items 23/47, W3, W4, W5, W6): the where-line\'s forms, byte for byte, on the surfaces that render them', async () => {
  const read: Record<string, string[]> = {};
  const rows: Array<[string, () => void, () => ReturnType<typeof h>, (id: string, i: number) => string]> = [
    ['Standard, N = 1', signedOut, () => h(Home), (_id, i) => (i === 0 ? 'on' : i === 1 ? 'ask-first' : 'off')],
    ['Standard, every source On', signedOut, () => h(Home), () => 'on'],
    ['Standard, no source On, one Ask first', signedOut, () => h(Home), (_id, i) => (i === 0 ? 'ask-first' : 'off')],
    ['Standard, every source Off', signedOut, () => h(Home), () => 'off'],
    ['Sandbox, N = 1', signedIn, () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }), (_id, i) => (i === 0 ? 'on' : 'off')],
    ['Sandbox, no source On, one Ask first', signedIn, () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }), (_id, i) => (i === 0 ? 'ask-first' : 'off')],
    ['Sandbox, every source Off', signedIn, () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }), () => 'off'],
  ];
  for (const [name, who, element, states] of rows) {
    who();
    wordsAnswers(7, 10);
    await wordsConsent(states);
    const page = await mount(element());
    await settled(page);
    read[name] = partText(page, 'where-this-question-goes');
    page.unmount();
  }
  assert.deepEqual(read, {
    'Standard, N = 1': [WHERE.standardOne],
    'Standard, every source On': [WHERE.standardAll],
    'Standard, no source On, one Ask first': [WHERE.standardAsk],
    'Standard, every source Off': [WHERE.everyOff],
    'Sandbox, N = 1': [WHERE.sandboxOne],
    'Sandbox, no source On, one Ask first': [WHERE.sandboxAsk],
    'Sandbox, every source Off': [WHERE.everyOff],
  });
});

test('P3b-1 criterion 11 (Q6 = B; W1, W2; W7): on the home page signed out, the sign-in line from first paint, the count at 7 and at 0 after a question, and the example row named "Example questions"', async () => {
  const read: Record<string, string[]> = {};
  for (const remaining of [7, 0]) {
    signedOut();
    wordsAnswers(remaining, 10);
    await wordsConsent(() => 'on');
    const page = await mount(h(Home));
    await settled(page);
    if (remaining === 7) {
      read['the sign-in line, first paint'] = partText(page, 'sign-in-line');
      read['the example row\'s name'] = page.elements().filter((el) => el.props['data-part'] === 'chip-row').flatMap((el) => within(el)).filter((el) => el.props.role === 'group').map((el) => String(el.props['aria-label']));
    }
    const box = page.elements().find((el) => el.type === 'textarea');
    assert.ok(box, 'premise: the question box');
    await page.type(box!, 'What was the median household income in the Bronx?');
    const form = page.elements().find((el) => el.type === 'form' && within(el).includes(page.elements().find((x) => x.type === 'textarea')!));
    await page.submit(form!);
    await settled(page);
    read[`the account line at ${remaining} of 10`] = partText(page, 'account-line');
    page.unmount();
  }
  assert.deepEqual(read, {
    'the sign-in line, first paint': [P3B_SIGN_IN_LINE],
    'the example row\'s name': ['Example questions'],
    'the account line at 7 of 10': [`7 of 10 questions left today. ${P3B_SIGN_IN_LINE}`],
    'the account line at 0 of 10': [`0 of 10 questions left today. The count resets at midnight UTC. ${P3B_SIGN_IN_LINE}`],
  });
});

test('P3b-1 criterion 11 (W7; addendum 1, section 4): no word in src/components/composer/copy.ts is marked PENDING', () => {
  const copy = fs.readFileSync(path.join(SRC, 'components', 'composer', 'copy.ts'), 'utf8');
  assert.deepEqual(copy.split('\n').filter((line) => /PENDING/.test(line)), [], 'composer/copy.ts still marks a word PENDING');
  assert.ok(copy.includes("'To keep this answer, sign in and publish it.'"), 'the withheld sentence (O4 = A) is not kept as one constant in composer/copy.ts');
});

// --- UX-2 P3b-2, criterion 9 (Words; C1 = A, C3 = A, C6 = A; R1 = A, ASK3 = A, Q11 = A): the harness menu's words and CA-1a --
//
// Each row is read off the real surface that renders it: CA-1a on the home page signed out (Standard) and /ask signed
// in (Sandbox), with no source On and one Ask first on an all-sources instance; the harness menu's words on /ask
// signed in, on each routing, with each group expanded in turn, and on the home page signed out. Every word is written
// out here from the contract's Words table, byte for byte; Compare's "On" / "Off" are pending the words check
// (criterion 13) and are not read here. At P3b-2's base there is no harness menu and no CA-1a line.

const CA_1A = 'Where your question goes: nowhere; no data source is On · Select sources';
const MENU_WORDS = {
  trigger: 'Default harness',
  heading: 'Harness · Civic AI harness v1',
  items: ['Model', 'Data sources', 'Session type', 'Compare with a second harness', 'All settings'],
  values: ['Fixture model', 'Auto', 'Sandbox'],
  inLoop: ['Auto - find sources for me', 'The model chooses which data sources to use, from those you set On or Ask first.', 'Only the ones I pick', 'Not offered on this site yet. The model chooses from the data sources you set On or Ask first.', 'All data sources and your consent'],
  allSources: ['Auto - use every source I set On', 'Every data source you set On is given to the model from the start. Sources set to Ask first are not used.', 'Only the ones I pick', 'Not offered on this site yet. Every data source you set On is given to the model.', 'All data sources and your consent'],
  session: ['Standard', 'Sandbox', 'Generates and executes a Jupyter notebook against live data. Typically 30 to 90 seconds. The notebook and a cryptographic execution record are signed by the platform.'],
  compareReason: 'Not offered in a Sandbox session. Switch Session type to Standard to compare.',
  signedOut: ['Sign in to choose a model.', 'Sign in for more options'],
};
const hasClassName = (el: HostElement, name: string) => String(el.props.className ?? '').split(/\s+/).includes(name);
/** Every piece of text the harness menu shows, open, with `group` expanded (or none). */
async function menuWords(page: Surface, group: string | null): Promise<string[]> {
  const menu = () => page.elements().filter((el) => el.props['data-part'] === 'harness-menu');
  assert.equal(menu().length, 1, `data-part="harness-menu": ${menu().length}`);
  const trigger = within(menu()[0]).find((el) => el.props['aria-haspopup'] === 'menu')!;
  await page.click(trigger);
  await settled(page);
  if (group !== null) {
    const row = within(menu()[0]).find((el) => el.props.role === 'menuitem' && within(el).some((x) => hasClassName(x, 'ui-menu-item-label') && textOf(x) === group));
    assert.ok(row, `the row "${group}"`);
    await page.click(row!);
    await settled(page);
  }
  const panel = within(menu()[0]).find((el) => el.props.role === 'menu');
  assert.ok(panel, 'the menu did not open');
  const classes = ['ui-menu-heading', 'ui-menu-item-label', 'ui-menu-item-value', 'ui-menu-item-description', 'ui-menu-item-reason'];
  const words = within(panel!).filter((el) => classes.some((c) => hasClassName(el, c)) || el.type === 'a' || el.type === 'button').map((el) => textOf(el));
  const text = textOf(within(menu()[0]).find((el) => el.props['aria-haspopup'] === 'menu')!);
  await page.click(within(menu()[0]).find((el) => el.props['aria-haspopup'] === 'menu')!);
  await settled(page);
  return [text, ...words];
}
const missing = (read: string[], want: string[]) => want.filter((w) => !read.includes(w));

test('P3b-2 criterion 9 (CA-1a; C1 = A, v2 ruling 2): no source On and one Ask first on an all-sources instance, the where-line reads CA-1a byte for byte, Standard and Sandbox', async () => {
  const read: Record<string, string[]> = {};
  for (const [name, who, element] of [
    ['Standard', signedOut, () => h(Home)],
    ['Sandbox', signedIn, () => h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' })],
  ] as const) {
    who();
    wordsRouting = { routing: 'all-sources', store: true };
    wordsAnswers(7, 10);
    await wordsConsent((_id, i) => (i === 0 ? 'ask-first' : 'off'));
    const page = await mount(element());
    await settled(page);
    read[name] = partText(page, 'where-this-question-goes');
    page.unmount();
  }
  wordsRouting = { routing: 'in-loop', store: true };
  assert.deepEqual(read, { Standard: [CA_1A], Sandbox: [CA_1A] });
});

test('P3b-2 criterion 9 (Words): the harness menu\'s words on /ask signed in, each routing\'s pair on its routing, and the signed-out menu\'s on the home page, byte for byte', async () => {
  const gaps: Record<string, string[]> = {};
  for (const routing of ['in-loop', 'all-sources'] as const) {
    signedIn();
    wordsRouting = { routing, store: true };
    wordsAnswers(7, 10);
    await wordsConsent(() => 'on');
    const page = await mount(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
    await settled(page);
    const closed = await menuWords(page, null);
    gaps[`${routing}, closed`] = missing(closed, [MENU_WORDS.heading, ...MENU_WORDS.items, ...MENU_WORDS.values, MENU_WORDS.compareReason]);
    if (!closed[0]?.startsWith(MENU_WORDS.trigger)) gaps[`${routing}, closed`].push(`trigger: ${closed[0]}`);
    gaps[`${routing}, Data sources`] = missing(await menuWords(page, 'Data sources'), routing === 'in-loop' ? MENU_WORDS.inLoop : MENU_WORDS.allSources);
    gaps[`${routing}, Session type`] = missing(await menuWords(page, 'Session type'), MENU_WORDS.session);
    page.unmount();
  }
  wordsRouting = { routing: 'in-loop', store: true };
  signedOut();
  wordsAnswers(7, 10);
  await wordsConsent(() => 'on');
  const home = await mount(h(Home));
  await settled(home);
  gaps['home, signed out'] = missing(await menuWords(home, null), MENU_WORDS.signedOut);
  home.unmount();
  assert.deepEqual(gaps, {
    'in-loop, closed': [], 'in-loop, Data sources': [], 'in-loop, Session type': [],
    'all-sources, closed': [], 'all-sources, Data sources': [], 'all-sources, Session type': [],
    'home, signed out': [],
  });
});
