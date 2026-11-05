// UX-1 P3a (#719, part 2, "P3a: the Header and the mobile drawer"; R7 A,
// R13 A): the Header's bar, its three menus, the mobile drawer, and the
// removal of `AppChrome`.
//
// THE HEADER READ HERE. Left to right: the wordmark; Ask; Analysis
// (`/records`); Explore ▾ (Data Flow, Directory); About ▾ (About, Learn,
// Roadmap when shown, Talks); Project; Typed Standards ↗; then the sign-in
// control, or the avatar menu (My analyses, Public site ↗ when
// `resolvePublicSiteHref` is not null, Sign out). The three menus are P0's
// `Menu`; the mobile menu is P0's `Sheet` holding the desktop grouping.
//
// WHAT IS DRIVEN. The real `Header`, on the surface harness, with the props
// the root layout derives from an environment (`headerProps` below mirrors
// the mount in `src/app/layout.tsx`, and one test reads that mount's source
// so the two cannot drift). A menu or the drawer is opened by calling its
// button's `onClick`, as the harness clicks. A host role is a configuration
// and a host name, resolved by `resolveHostRole`; where a link lands is read
// from `decideRoute` on the host the link names, or on the host it is
// rendered on when the link is relative.
//
// WHAT MAKES IT ABLE TO FAIL. On the base (9d4b747) the bar has no Ask link;
// no trigger carries `aria-haspopup` or `aria-expanded`; the mobile toggle
// opens an inline list, not a dialog; `src/app/(app)/layout.tsx` imports
// `AppChrome`; Learn is a top-level bar item; the `/records` item renders only
// inside Explore's open panel; the avatar menu has no "Public site". Each of
// those is an assertion below. The guards that are green on the base
// (Project top-level, "Analysis", "My analyses", the account's name, the
// sign-in control's shapes) were each shown red against a mutated Header
// before their green was trusted (the phase report lists the mutations).
//
// BLIND SPOTS, stated. The harness has no layout, focus or browser events:
// `sm:hidden` and `hidden sm:flex` are class names here, so the desktop bar
// and the drawer are told apart by structure (the `<nav>` outside any dialog,
// and the `role="dialog"` sheet), not by a viewport. Escape, an outside tap,
// focus return and the drawer drawn over the page are the owner's staging
// read (criterion 7). `next/image` is stubbed. Criterion 4 reads the files
// `git ls-files` tracks: a new importer is invisible until it is added.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/header-nav.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  sessions,
  type HostElement,
  type Surface,
} from './sources/surface-test-harness.ts';
import { attr, byRole, byTag, classesOf, one, openingTag, parentOf, readText, within } from './ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  'next/image': `export default function Image() { return null; }`,
});

// The page the Header is rendered on, as the browser globals see it. The
// cross-host session probe (a split topology, signed out) is answered by no
// route here, so it reads as "no session on the app host" and the sign-in
// control keeps its signed-out label.
const PAGE_ORIGIN = 'https://fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    location: { href: `${PAGE_ORIGIN}/`, origin: PAGE_ORIGIN, pathname: '/' },
    scrollTo() {},
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

const { decideRoute, readHostRoutingConfig, resolveAskHref, resolveDashboardHref, resolveHostRole, resolvePublicSiteHref } =
  await import('@/lib/host-routing');
const { resolveHostLinks } = await import('@/lib/host-links');
const { resolveSessionAffordance } = await import('@/lib/allowed-origins');
const { DEFAULT_SIGN_IN_OPTIONS } = await import('@/lib/auth-provider-options');
const { TYPED_STANDARDS_URL } = await import('@/lib/site-config');
type SignInOption = { id: string; name: string };

const Header = (await import(pathToFileURL(path.join(SRC, 'components', 'Header.tsx')).href)).default as ComponentType<Record<string, unknown>>;

const ROOT = path.resolve(SRC, '..');
const BRAND = 'Fixture Site';
const ACCOUNT = 'Fixture Reader';
const APP_HOST = 'app.fixture.example';
const MARKETING_HOST = 'fixture.example';
const UNNAMED_HOST = 'unnamed.fixture.example';

type Env = Record<string, string | undefined>;

/** The topologies the cases drive. Each names the hosts it is read on. */
const CONFIGS: Record<string, { env: Env; hosts: string[] }> = {
  unconfigured: { env: {}, hosts: [UNNAMED_HOST] },
  appOnly: { env: { APP_ONLY: '1' }, hosts: [UNNAMED_HOST] },
  serveMarketing: { env: { SERVE_MARKETING: '1' }, hosts: [UNNAMED_HOST] },
  split: { env: { APP_HOST, MARKETING_HOST }, hosts: [APP_HOST, MARKETING_HOST] },
};

/** The Header's props as the root layout derives them from `env` (`src/app/layout.tsx`, the Header mount). */
function headerProps(env: Env, extra: { showRoadmap?: boolean; signInOptions?: SignInOption[] } = {}): Record<string, unknown> {
  const hostLinks = resolveHostLinks(env);
  const sessionProbe = resolveSessionAffordance(env);
  return {
    dashboardHref: resolveDashboardHref(env),
    askHref: resolveAskHref(env),
    publicSiteHref: resolvePublicSiteHref(env),
    marketingOrigin: hostLinks.marketingOrigin,
    signInHref: hostLinks.signInHref,
    brandName: BRAND,
    showRoadmap: extra.showRoadmap ?? true,
    signInOptions: extra.signInOptions ?? DEFAULT_SIGN_IN_OPTIONS,
    ...(sessionProbe !== null ? { sessionProbe } : {}),
  };
}

type Session = 'in' | 'out' | 'loading';

function setSession(state: Session): void {
  if (state === 'in') {
    sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
    sessions.client = { status: 'authenticated', data: { user: { name: ACCOUNT } } };
  } else {
    sessions.server = null;
    sessions.client = { status: state === 'loading' ? 'loading' : 'unauthenticated', data: null };
  }
}

async function mountHeader(env: Env, state: Session, extra: { showRoadmap?: boolean; signInOptions?: SignInOption[] } = {}): Promise<Surface> {
  setSession(state);
  installFetch(PAGE_ORIGIN, {});
  return mount(h(Header, headerProps(env, extra)));
}

// --- Readers -------------------------------------------------------------------------

/** A label as a reader reads it, without the decorative caret and arrow glyphs. */
const norm = (text: string): string => text.replace(/[▾↗]/g, '').replace(/\s+/g, ' ').trim();

const hrefOf = (el: HostElement): string | null => (el.type === 'a' ? String(el.props.href) : null);

interface Item { label: string; href: string | null }
interface Grouped extends Item { group: string | null }
type TopEntry = { kind: 'link'; label: string; href: string } | { kind: 'menu'; label: string };

const insideAny = (el: HostElement, containers: HostElement[]): boolean => containers.some((c) => within(c).includes(el));

/** The desktop bar: the one `<nav>` that is not inside a dialog. */
function desktopNav(s: Surface): HostElement {
  const dialogs = byRole(s, 'dialog');
  return one(byTag(s, 'nav').filter((nav) => !insideAny(nav, dialogs)), '<nav> outside any dialog (the desktop bar)');
}

/** The bar's entries, left to right, as rendered now: links, and buttons (a menu's trigger). */
function topLevel(s: Surface): TopEntry[] {
  const out: TopEntry[] = [];
  const skip = new Set<HostElement>();
  for (const el of within(desktopNav(s))) {
    if (skip.has(el)) continue;
    if (el.type === 'a') out.push({ kind: 'link', label: norm(readText(el)), href: String(el.props.href) });
    else if (el.type === 'button') out.push({ kind: 'menu', label: norm(readText(el)) });
    else continue;
    for (const inner of within(el)) skip.add(inner);
  }
  return out;
}

/** The bar's top-level entries with every menu closed: the panels a base Header renders on a click are not here. */
const topLabels = (s: Surface): string[] => topLevel(s).map((e) => e.label);

type Finder = (s: Surface) => HostElement;

const navTrigger = (label: string): Finder => (s) =>
  one(within(desktopNav(s)).filter((el) => el.type === 'button' && norm(readText(el)) === label), `"${label}" button in the bar`);

const avatarTrigger: Finder = (s) =>
  one(s.elements().filter((el) => el.type === 'button' && readText(el).includes(ACCOUNT)), `button showing "${ACCOUNT}" (the avatar trigger)`);

const mobileToggle: Finder = (s) =>
  one(s.elements().filter((el) => el.type === 'button' && el.props['aria-label'] === 'Toggle menu'), 'button aria-label="Toggle menu"');

/** Open a menu by its trigger, read its items (the links and buttons beside the trigger), and close it again. */
async function menuItems(s: Surface, find: Finder): Promise<Item[]> {
  await s.click(find(s));
  const trigger = find(s);
  const holder = parentOf(s, trigger);
  assert.ok(holder, 'premise: the trigger has a parent element');
  const inTrigger = new Set(within(trigger));
  const items = within(holder)
    .filter((el) => el !== trigger && !inTrigger.has(el) && (el.type === 'a' || el.type === 'button'))
    .map((el) => ({ label: norm(readText(el)), href: hrefOf(el) }));
  await s.click(find(s));
  return items;
}

/** The bar read as one list: each top-level link, and each menu's items in the menu's place, grouped by its label. */
async function desktopGrouping(s: Surface): Promise<Grouped[]> {
  const out: Grouped[] = [];
  for (const entry of topLevel(s)) {
    if (entry.kind === 'link') out.push({ group: null, label: entry.label, href: entry.href });
    else for (const item of await menuItems(s, navTrigger(entry.label))) out.push({ group: entry.label, ...item });
  }
  return out;
}

/** The label of a `role="group"`: its `aria-label`, or the text its `aria-labelledby` names. */
function groupLabel(s: Surface, group: HostElement): string {
  const own = attr(group, 'aria-label');
  if (own) return norm(own);
  const by = attr(group, 'aria-labelledby');
  assert.ok(by, `a drawer group carries aria-label or aria-labelledby: ${openingTag(group)}`);
  return norm(readText(one(s.elements().filter((el) => attr(el, 'id') === by), `element id="${by}"`)));
}

/** The open drawer's links, in order, each with the `role="group"` it sits in (or none). */
function drawerGrouping(s: Surface): Grouped[] {
  const dialog = one(byRole(s, 'dialog'), 'role="dialog" (the drawer)');
  return within(dialog)
    .filter((el) => el.type === 'a')
    .map((link) => {
      let group: string | null = null;
      for (let at = parentOf(s, link); at && at !== dialog; at = parentOf(s, at)) {
        if (attr(at, 'role') === 'group') {
          group = groupLabel(s, at);
          break;
        }
      }
      return { group, label: norm(readText(link)), href: String(link.props.href) };
    });
}

/** Where a click on `href`, rendered on `host`, lands under `env`: `host/path` served, or `withheld`. */
function landing(env: Env, host: string, href: string): string {
  const config = readHostRoutingConfig(env);
  let at = host;
  let pathname = href;
  if (/^https?:\/\//.test(href)) {
    const url = new URL(href);
    at = url.host;
    pathname = url.pathname;
  }
  for (let hop = 0; hop < 3; hop += 1) {
    const action = decideRoute(at, pathname, config);
    if (action.kind === 'serve') return `${at}${pathname}`;
    if (action.kind === 'withhold') return `withheld (${at}${pathname})`;
    const next = new URL(action.destination, `https://${at}`);
    at = next.host;
    pathname = next.pathname;
  }
  return 'redirect loop';
}

// --- Criterion 1: Ask --------------------------------------------------------------------

test('criterion 1: for each host role, signed in and out, the bar has one Ask link at the address the resolvers give, landing where that role serves it', async () => {
  // The landing reader can read a link that 404s and one that redirects.
  assert.equal(landing(CONFIGS.split.env, MARKETING_HOST, '/ask'), `withheld (${MARKETING_HOST}/ask)`, 'premise: a relative /ask on the marketing host is withheld');
  assert.equal(landing(CONFIGS.split.env, APP_HOST, '/'), `${APP_HOST}/ask`, 'premise: the app host sends / to /ask');
  const actual: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  const roles = new Set<string>();
  for (const [name, { env, hosts }] of Object.entries(CONFIGS)) {
    for (const state of ['out', 'in'] as const) {
      const s = await mountHeader(env, state);
      const asks = topLevel(s).filter((e) => e.kind === 'link' && e.label === 'Ask').map((e) => (e.kind === 'link' ? e.href : ''));
      s.unmount();
      for (const host of hosts) {
        const role = resolveHostRole(host, readHostRoutingConfig(env));
        roles.add(role);
        const key = `${name} / ${role} host / signed ${state}`;
        // The Header takes no host: its markup is the same on both hosts of a
        // split topology. Signed out there it reads `/`: the marketing host
        // serves its own `/`, and the app host sends `/` to `/ask`.
        const signedOutOnSplit = state === 'out' && env.MARKETING_HOST !== undefined;
        const href = signedOutOnSplit ? '/' : resolveAskHref(env);
        const lands = signedOutOnSplit && role === 'marketing' ? `${host}/` : `${new URL(resolveAskHref(env), `https://${host}`).host}/ask`;
        expected[key] = { asks: [href], lands };
        actual[key] = { asks, lands: asks.length === 1 ? landing(env, host, asks[0]) : null };
      }
    }
  }
  assert.deepEqual([...roles].sort(), ['app', 'marketing', 'passthrough'], 'premise: the cases cover every host role');
  assert.deepEqual(actual, expected, `the bar's Ask links, by case: ${JSON.stringify(actual, null, 1)}`);
});

test('criterion 1: the root layout mounts the Header with the resolvers the cases above derive its props from', () => {
  const file = path.join(SRC, 'app', 'layout.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mounts: Record<string, string>[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'Header') {
      const attrs: Record<string, string> = {};
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop)) {
          const init = prop.initializer;
          const text = init === undefined ? 'true' : ts.isJsxExpression(init) ? (init.expression?.getText(source) ?? '') : init.getText(source);
          attrs[prop.name.getText(source)] = text;
        } else {
          attrs['{...}'] = prop.expression.getText(source);
        }
      }
      mounts.push(attrs);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(mounts.length, 1, `premise: one <Header> mount in src/app/layout.tsx, found ${mounts.length}`);
  const read = mounts[0];
  const want = {
    dashboardHref: 'resolveDashboardHref(process.env)',
    askHref: 'resolveAskHref(process.env)',
    publicSiteHref: 'resolvePublicSiteHref(process.env)',
    marketingOrigin: 'hostLinks.marketingOrigin',
    signInHref: 'hostLinks.signInHref',
  };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, read[k] ?? null]));
  assert.deepEqual(got, want, `the Header mount's href props read ${JSON.stringify(read)}`);
});

// --- Criterion 2: the menu triggers ----------------------------------------------------------

test('criterion 2: Explore, About and the avatar each carry aria-haspopup="menu", and aria-expanded false closed, true after a click', async () => {
  const s = await mountHeader(CONFIGS.serveMarketing.env, 'in');
  const triggers: Record<string, Finder> = { Explore: navTrigger('Explore'), About: navTrigger('About'), avatar: avatarTrigger };
  const actual: Record<string, unknown> = {};
  for (const [name, find] of Object.entries(triggers)) {
    const closed = { haspopup: attr(find(s), 'aria-haspopup'), expanded: attr(find(s), 'aria-expanded') };
    await s.click(find(s));
    const open = attr(find(s), 'aria-expanded');
    await s.click(find(s));
    actual[name] = { ...closed, afterClick: open, afterSecondClick: attr(find(s), 'aria-expanded') };
  }
  s.unmount();
  const each = { haspopup: 'menu', expanded: 'false', afterClick: 'true', afterSecondClick: 'false' };
  assert.deepEqual(actual, { Explore: each, About: each, avatar: each }, `the triggers read ${JSON.stringify(actual)}`);
});

// --- Criterion 3: the drawer -------------------------------------------------------------------

test('criterion 3: the mobile toggle carries aria-expanded, opens a role="dialog" sheet, and the sheet closes on its Close control and on a link', async () => {
  const s = await mountHeader(CONFIGS.serveMarketing.env, 'in');
  assert.equal(attr(mobileToggle(s), 'aria-expanded'), 'false', 'closed: the toggle carries aria-expanded="false"');
  assert.equal(byRole(s, 'dialog').length, 0, 'closed: no dialog');
  await s.click(mobileToggle(s));
  assert.equal(attr(mobileToggle(s), 'aria-expanded'), 'true', 'open: the toggle carries aria-expanded="true"');
  const dialog = one(byRole(s, 'dialog'), 'role="dialog" after the toggle is clicked');
  assert.equal(attr(dialog, 'aria-modal'), 'true', 'the drawer is modal');
  assert.ok(classesOf(dialog).includes('ui-sheet'), `the drawer is P0's Sheet (ui-sheet); it has [${classesOf(dialog).join(' ')}]`);

  await s.click(one(within(dialog).filter((el) => el.type === 'button' && el.props['aria-label'] === 'Close'), 'the drawer\'s Close control'));
  assert.equal(byRole(s, 'dialog').length, 0, 'the Close control closes the drawer');
  assert.equal(attr(mobileToggle(s), 'aria-expanded'), 'false', 'closed again: aria-expanded="false"');

  await s.click(mobileToggle(s));
  const link = within(one(byRole(s, 'dialog'), 'the drawer, reopened')).find((el) => el.type === 'a');
  assert.ok(link, 'the reopened drawer has a link');
  await s.click(link);
  assert.equal(byRole(s, 'dialog').length, 0, 'following a drawer link closes the drawer');
  s.unmount();
});

test('criterion 3: for each topology, signed in and out, the drawer\'s items equal the desktop grouping, in order', async () => {
  const actual: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  for (const [name, { env }] of Object.entries(CONFIGS)) {
    for (const state of ['out', 'in'] as const) {
      const key = `${name} / signed ${state}`;
      const s = await mountHeader(env, state);
      const desktop = await desktopGrouping(s);
      await s.click(mobileToggle(s));
      const drawer = byRole(s, 'dialog').length === 1 ? drawerGrouping(s) : 'no role="dialog"';
      s.unmount();
      assert.ok(desktop.length > 0, `premise (${key}): the desktop bar has items`);
      expected[key] = desktop;
      actual[key] = drawer;
    }
  }
  assert.deepEqual(actual, expected, `the drawer, by case: ${JSON.stringify(actual, null, 1)}`);
});

test('criterion 3: the inline mobile list is gone: with the drawer open, every link is the wordmark, in the desktop bar, or in the drawer', async () => {
  const s = await mountHeader(CONFIGS.serveMarketing.env, 'in');
  await s.click(mobileToggle(s));
  const nav = desktopNav(s);
  const dialogs = byRole(s, 'dialog');
  const stray = s.elements()
    .filter((el) => el.type === 'a' && !within(nav).includes(el) && !insideAny(el, dialogs))
    .map((el) => `${norm(readText(el))} -> ${String(el.props.href)}`);
  s.unmount();
  assert.deepEqual(stray, [`${BRAND} -> /`], 'links outside the bar and the drawer, with the drawer open');
});

// --- Criterion 4: AppChrome ---------------------------------------------------------------------

test('criterion 4: no tracked file under src/ imports AppChrome, and AppChrome.tsx is not tracked', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(tracked.length > 100, `premise: git ls-files lists src/ (${tracked.length} files)`);
  const importers: string[] = [];
  for (const rel of tracked.filter((f) => /\.(c|m)?[jt]sx?$/.test(f))) {
    const { importedFiles } = ts.preProcessFile(fs.readFileSync(path.join(ROOT, rel), 'utf8'), true, true);
    for (const imported of importedFiles) {
      if (/(^|\/)AppChrome(\.[jt]sx?)?$/.test(imported.fileName)) importers.push(`${rel} imports ${imported.fileName}`);
    }
  }
  assert.deepEqual(importers, [], 'tracked files importing AppChrome');
  assert.deepEqual(tracked.filter((f) => /(^|\/)AppChrome\.[jt]sx?$/.test(f)), [], 'AppChrome is not tracked');
});

// --- Criterion 5 and the bar's order -----------------------------------------------------------

const MARKETING = CONFIGS.serveMarketing.env;

test('the bar reads, left to right: Ask, Analysis, Explore, About, Project, Typed Standards', async () => {
  const s = await mountHeader(MARKETING, 'out');
  const read = topLevel(s).map((e) => (e.kind === 'link' ? `${e.label} -> ${e.href}` : `${e.label} (menu)`));
  s.unmount();
  assert.deepEqual(read, [
    'Ask -> /ask',
    'Analysis -> /records',
    'Explore (menu)',
    'About (menu)',
    'Project -> /project',
    `Typed Standards -> ${TYPED_STANDARDS_URL}`,
  ], `the bar reads ${JSON.stringify(read)}`);
});

test('criterion 5: Learn is an item of About\'s menu (About, Learn, Roadmap when shown, Talks), not a bar item', async () => {
  const read: Record<string, unknown> = {};
  for (const showRoadmap of [true, false]) {
    setSession('out');
    installFetch(PAGE_ORIGIN, {});
    const s = await mount(h(Header, headerProps(MARKETING, { showRoadmap })));
    read[`showRoadmap ${showRoadmap}`] = { bar: topLabels(s).includes('Learn'), about: await menuItems(s, navTrigger('About')) };
    s.unmount();
  }
  const about = [
    { label: 'About', href: '/about' },
    { label: 'Learn', href: '/learn' },
    { label: 'Roadmap', href: '/roadmap' },
    { label: 'Talks', href: '/talks' },
  ];
  assert.deepEqual(read, {
    'showRoadmap true': { bar: false, about },
    'showRoadmap false': { bar: false, about: about.filter((i) => i.label !== 'Roadmap') },
  }, `Learn in the bar, and About's items: ${JSON.stringify(read)}`);
});

test('criterion 5: the section item linking /records is a bar item with every menu closed, and Explore holds Data Flow and Directory only', async () => {
  const s = await mountHeader(MARKETING, 'out');
  const records = topLevel(s).filter((e) => e.kind === 'link' && e.href === '/records').map((e) => e.label);
  const explore = await menuItems(s, navTrigger('Explore'));
  s.unmount();
  assert.deepEqual({ records, explore }, {
    records: ['Analysis'],
    explore: [{ label: 'Data Flow', href: '/explore' }, { label: 'Directory', href: '/directory' }],
  }, `the bar's /records items and Explore's items: ${JSON.stringify({ records, explore })}`);
});

test('criterion 5 (guard): Project is a top-level bar item and is in no menu', async () => {
  const s = await mountHeader(MARKETING, 'out');
  const top = topLevel(s).filter((e) => e.kind === 'link' && e.href === '/project').map((e) => e.label);
  const inMenus: string[] = [];
  for (const entry of topLevel(s)) {
    if (entry.kind !== 'menu') continue;
    for (const item of await menuItems(s, navTrigger(entry.label))) if (item.href === '/project') inMenus.push(entry.label);
  }
  s.unmount();
  assert.deepEqual({ top, inMenus }, { top: ['Project'], inMenus: [] }, `Project in the bar and in the menus: ${JSON.stringify({ top, inMenus })}`);
});

test('criterion 5 (guard): the section item reads "Analysis" wherever it renders', async () => {
  const s = await mountHeader(MARKETING, 'out');
  const words = (await desktopGrouping(s)).filter((i) => i.href === '/records').map((i) => i.label);
  s.unmount();
  assert.ok(words.length >= 1, 'premise: the bar or a menu links /records');
  assert.deepEqual(words, words.map(() => 'Analysis'), `the /records items read ${JSON.stringify(words)}`);
});

test('criterion 5 (guard): signed in, the avatar trigger shows the account\'s name, and its menu\'s first item reads "My analyses" at the dashboard\'s address', async () => {
  const read: Record<string, unknown> = {};
  const want: Record<string, unknown> = {};
  for (const [name, { env }] of Object.entries(CONFIGS)) {
    const s = await mountHeader(env, 'in');
    const trigger = s.elements().filter((el) => el.type === 'button' && readText(el).includes(ACCOUNT)).length;
    const items = await menuItems(s, avatarTrigger);
    s.unmount();
    read[name] = { trigger, first: items[0] ?? null };
    want[name] = { trigger: 1, first: { label: 'My analyses', href: resolveDashboardHref(env) } };
  }
  assert.deepEqual(read, want, `the avatar, by topology: ${JSON.stringify(read)}`);
});

test('criterion 5: the avatar menu reads My analyses, Public site exactly when resolvePublicSiteHref is not null, then Sign out', async () => {
  const read: Record<string, unknown> = {};
  const want: Record<string, unknown> = {};
  for (const [name, { env }] of Object.entries(CONFIGS)) {
    const s = await mountHeader(env, 'in');
    read[name] = await menuItems(s, avatarTrigger);
    s.unmount();
    const publicSite = resolvePublicSiteHref(env);
    want[name] = [
      { label: 'My analyses', href: resolveDashboardHref(env) },
      ...(publicSite !== null ? [{ label: 'Public site', href: publicSite }] : []),
      { label: 'Sign out', href: null },
    ];
  }
  assert.ok(Object.values(want).some((items) => (items as Item[]).length === 3), 'premise: a case where the resolver is not null');
  assert.ok(Object.values(want).some((items) => (items as Item[]).length === 2), 'premise: a case where the resolver is null');
  assert.deepEqual(read, want, `the avatar menu, by topology: ${JSON.stringify(read, null, 1)}`);
});

// --- Criterion 6: the sign-in control ---------------------------------------------------------

const SIGN_IN_OPTIONS: Record<string, SignInOption[]> = {
  none: [],
  github: [{ id: 'github', name: 'GitHub' }],
  oidc: [{ id: 'oidc', name: 'Fixture SSO' }],
  both: [{ id: 'github', name: 'GitHub' }, { id: 'oidc', name: 'Fixture SSO' }],
};

/**
 * The sign-in control's shapes as the base (9d4b747) renders them, read from
 * that base's Header with this file's readers (`readControl`).
 */
const SKELETON = '<div class="h-10 w-24 rounded animate-pulse" style="background-color:var(--skeleton-color)"></div>';
const providerButton = (name: string) =>
  `<button class="ui-button ui-button-primary" style="padding:8px 16px;font-size:14px">Sign in with ${name}</button>`;
const signInLink = (href: string) =>
  `<a href="${href}" class="ui-button ui-button-primary" style="padding:8px 16px;font-size:14px;text-decoration:none">Sign in</a>`;
const probedLink = (href: string, open: boolean) =>
  `<a href="${href}" class="ui-button ui-button-primary" style="padding:8px 16px;font-size:14px;text-decoration:none;display:inline-grid">`
  + `<span aria-hidden="${open}" style="grid-area:1 / 1;text-align:center;visibility:${open ? 'hidden' : 'visible'}">Sign in</span>`
  + `<span aria-hidden="${!open}" style="grid-area:1 / 1;text-align:center;visibility:${open ? 'visible' : 'hidden'}">Open app →</span></a>`;
const PANEL = signInLink('/ask?signin=1');
const IN_PLACE = { none: [], github: [providerButton('GitHub')], oidc: [providerButton('Fixture SSO')], both: [PANEL] };
const allShapes = (control: string[]) => ({ none: control, github: control, oidc: control, both: control });

/** Signed out, by topology and options shape; loading renders `SKELETON` in every case. */
const SIGN_IN_GOLDEN: Record<string, Record<string, string[]>> = {
  unconfigured: IN_PLACE,
  appOnly: allShapes([PANEL]),
  serveMarketing: IN_PLACE,
  split: allShapes([probedLink(`https://${APP_HOST}/ask?signin=1`, false)]),
  // The app host's probe answers that this browser has a session there.
  splitProbedSignedIn: allShapes([probedLink(`https://${APP_HOST}/ask`, true)]),
  appHostOnly: allShapes([signInLink(`https://${APP_HOST}/ask?signin=1`)]),
};

test('criterion 6 (guard): signed out and loading, the sign-in control renders as on the base, for every topology and options shape', async () => {
  const cases: Record<string, { env: Env; probe?: boolean }> = {
    ...Object.fromEntries(Object.entries(CONFIGS).map(([name, { env }]) => [name, { env }])),
    splitProbedSignedIn: { env: CONFIGS.split.env, probe: true },
    appHostOnly: { env: { APP_HOST } },
  };
  const read: Record<string, Record<string, string[]>> = {};
  const want: Record<string, Record<string, string[]>> = {};
  for (const [name, { env, probe }] of Object.entries(cases)) {
    for (const [shape, signInOptions] of Object.entries(SIGN_IN_OPTIONS)) {
      for (const state of ['out', 'loading'] as const) {
        setSession(state);
        installFetch(PAGE_ORIGIN, probe ? { '/api/session-status': () => Response.json({ signedIn: true }) } : {});
        const s = await mount(h(Header, headerProps(env, { signInOptions })));
        (read[`${name} / ${state}`] ??= {})[shape] = s.elements()
          .filter((el) => classesOf(el).includes('ui-button-primary') || classesOf(el).includes('animate-pulse'))
          .map(readControl);
        (want[`${name} / ${state}`] ??= {})[shape] = state === 'loading' ? [SKELETON] : SIGN_IN_GOLDEN[name][shape];
        s.unmount();
      }
    }
  }
  assert.deepEqual(read, want, `the sign-in control, by case: ${JSON.stringify(read, null, 1)}`);
});

/** One control as the browser receives it: its whole markup, React's text separators removed. */
function readControl(el: HostElement): string {
  return renderToStaticMarkup(el).replace(/<!-- -->/g, '');
}

// --- The ORCH's Leg A rulings (items 7 and 9) ------------------------------------------------

test('the avatar trigger names an account that has only an email by its email (AppChrome\'s identity fallback)', async () => {
  const email = 'reader@fixture.example';
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { email } } };
  installFetch(PAGE_ORIGIN, {});
  const s = await mount(h(Header, headerProps(MARKETING)));
  const triggers = s.elements().filter((el) => el.type === 'button' && readText(el).includes(email));
  const read = triggers.map((el) => attr(el, 'aria-haspopup'));
  s.unmount();
  assert.deepEqual(read, ['menu'], `menu triggers showing the account's email: ${JSON.stringify(read)}`);
});

test('with no marketing surface, the bar holds no Explore menu (it would have no items): Ask, Analysis, Typed Standards', async () => {
  const read: Record<string, string[]> = {};
  for (const name of ['unconfigured', 'appOnly'] as const) {
    const s = await mountHeader(CONFIGS[name].env, 'out');
    read[name] = topLevel(s).map((e) => (e.kind === 'link' ? `${e.label} -> ${e.href}` : `${e.label} (menu)`));
    s.unmount();
  }
  const bar = ['Ask -> /ask', 'Analysis -> /records', `Typed Standards -> ${TYPED_STANDARDS_URL}`];
  assert.deepEqual(read, { unconfigured: bar, appOnly: bar }, `the bar with marketingOrigin null: ${JSON.stringify(read)}`);
});

// --- The breakpoint (the owner's ruling A at G5) ---------------------------------------
//
// The full bar shows from 1024 px and the drawer's toggle below it. The harness
// has no layout, so this pins the class names; the headless-Chrome measurement
// in the phase report is the evidence that the bar fits from 1024 px. `lg` is
// Tailwind's default 64rem (1024 px) only while `globals.css` declares no
// `--breakpoint-*` of its own.

/** Display utilities, bare or behind a variant (`lg:flex`, `max-md:hidden`). */
const DISPLAY = /^(?:.+:)?(?:hidden|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|flow-root|table|list-item)$/;
const displayClasses = (el: HostElement): string[] => classesOf(el).filter((c) => DISPLAY.test(c));

/** The display classes `find` reads, signed out and signed in, on a split topology (as production runs). */
async function displayClassesOf(find: Finder): Promise<Record<string, string[]>> {
  const read: Record<string, string[]> = {};
  for (const state of ['out', 'in'] as const) {
    const s = await mountHeader(CONFIGS.split.env, state);
    read[state] = displayClasses(find(s));
    s.unmount();
  }
  return read;
}

test('the bar\'s <nav> is hidden below the lg width (1024 px) and a flex row from it: `hidden lg:flex`, no other display class', async () => {
  const read = await displayClassesOf(desktopNav);
  const expected = ['hidden', 'lg:flex'];
  assert.deepEqual(read, { out: expected, in: expected }, `the display classes of the bar's <nav>: ${JSON.stringify(read)}`);
});

test('the drawer\'s toggle shows below the lg width (1024 px) and is hidden from it: `lg:hidden`, no other display class', async () => {
  const read = await displayClassesOf(mobileToggle);
  const expected = ['lg:hidden'];
  assert.deepEqual(read, { out: expected, in: expected }, `the display classes of the toggle: ${JSON.stringify(read)}`);
});

test('globals.css declares no --breakpoint-*, so lg stays Tailwind\'s default 1024 px', () => {
  const css = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8');
  const declared = css.split('\n').map((line, i) => [i + 1, line] as const).filter(([, line]) => line.includes('--breakpoint-'));
  assert.deepEqual(declared, [], `globals.css lines naming --breakpoint-: ${JSON.stringify(declared)}`);
});
