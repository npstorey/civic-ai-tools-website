// UX-1 PW (#719, the census as ruled at G0-6), criterion 2: the ruled words,
// rendered. R19 A and its note name the site's saved item "analysis" /
// "analyses": the dashboard's first tab reads "My analyses (n)", the Header's
// avatar and mobile menus read "My analyses" (still linking `/dashboard`), the
// Header's item for the registry reads "Analysis" (still linking `/records`),
// `/records` carries the h1 "Analysis", and the registry's count line counts
// "items" ("1 item", "3 items": today's plural rule, kept).
//
// WHAT IS DRIVEN. The real `DashboardTabs`, the real `Header` (signed in, its
// avatar menu, its Explore menu and its mobile menu each opened by calling the
// button's `onClick`, as the harness clicks), and the real `/records` page
// (`src/app/(app)/records/page.tsx`, which re-exports the `/evidence` page)
// with its list request answered by the test, on the surface harness.
//
// WHAT MAKES IT ABLE TO FAIL. At the base each surface renders the old word:
// "My Records (0)", "Dashboard", "Records", an h1 "Records", "3 records".
//
// BLIND SPOTS, stated. The harness has no layout: `sm:hidden` and
// `hidden sm:flex` are class names here, so the desktop and mobile menus are
// told apart by which button opened them, not by a viewport. `next/image` is
// stubbed (the fixture account has no avatar image).
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

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  'next/image': `export default function Image() { return null; }`,
});

const ORIGIN = 'https://app.fixture.example';

const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as ComponentType<Record<string, unknown>>;
const Header = (await load('components/Header.tsx')).default as ComponentType<Record<string, unknown>>;
const RecordsPage = (await load('app/(app)/records/page.tsx')).default as ComponentType<Record<string, unknown>>;

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

test('the Header\'s Explore menu (desktop): the registry\'s item reads "Analysis", linking /records', async () => {
  signedIn();
  installFetch(ORIGIN, {});
  const header = await mount(h(Header, { brandName: 'Fixture Site' }));
  assert.deepEqual(anchorsTo(header, '/records'), [], 'premise: no /records link before the Explore menu opens');
  await header.click(onlyButton(header, (el) => textOf(el).startsWith('Explore'), 'Explore'));
  assert.deepEqual(linkWords(header, '/records'), ['Analysis'], `the Explore menu's /records link reads ${JSON.stringify(linkWords(header, '/records'))}`);
  header.unmount();
});

test('the Header\'s mobile menu, opened signed in: "Analysis" linking /records, "My analyses" linking /dashboard', async () => {
  signedIn();
  installFetch(ORIGIN, {});
  const header = await mount(h(Header, { brandName: 'Fixture Site' }));
  assert.deepEqual(anchorsTo(header, '/dashboard'), [], 'premise: the mobile menu renders only when opened');
  await header.click(onlyButton(header, (el) => el.props['aria-label'] === 'Toggle menu', 'mobile menu'));
  const read = { '/records': linkWords(header, '/records'), '/dashboard': linkWords(header, '/dashboard') };
  assert.deepEqual(read, { '/records': ['Analysis'], '/dashboard': ['My analyses'] }, `the mobile menu's links read ${JSON.stringify(read)}`);
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
