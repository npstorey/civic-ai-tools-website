// UX-2-FIX P2, item 2 (#790): a sign-in started on `/ask?source=<id>` returns to `/ask?source=<id>`.
//
// THE RULE. "Ask with this source" lands a signed-out reader on `/ask?source=<id>`, where the page renders the sign-in
// panel. Signed in, the same address mounts `SourceLanding`, which opens Settings at that source's row. So every sign-in
// control on `/ask` signed out keeps the source across the sign-in: the panel's auto path and its buttons pass a
// `callbackUrl` of `/ask?source=<encoded id>`; the Header's in-place button passes none, and next-auth then uses the
// current address, which holds the source; and the Header's sign-in links (to `/ask?signin=1`, on the app host or
// relative) carry the source to the page they open, which hands it to the panel's auto path. With no source, or an
// empty one, the `callbackUrl` is `/ask`, as before. The `callbackUrl` is a same-origin path whatever the source holds.
//
// WHAT IS DRIVEN. The real `/ask` page (its async server component, with the session, the providers and the first-run
// probe stubbed), mounted on the surface harness; the real `AskSignInPanel` it renders; and the real `Header` with the
// props the root layout derives for each topology. `signIn` is recorded with its options. A link is "clicked" by
// calling its `onClick` with an event whose `currentTarget` holds the anchor's absolute `href`, as a browser's does,
// and then followed: its address is read, and the page is rendered at it.
//
// WHAT MAKES IT ABLE TO FAIL. The sources include `/`, `?`, `&`, `#` and a space, and two that read as other origins
// (`//…` and `https://…`), so an unencoded or absolute `callbackUrl` reads red. Each case checks first that a sign-in
// was started at all (or that the link exists), so a page that rendered no control reads red as a premise.
//
// BLIND SPOTS, stated. No browser and no provider: whether the provider's round trip returns to this `callbackUrl`, and
// whether a browser follows an `href` changed in its own click handler, are the owner's staging step (P2-S) and the
// phase's Chrome read. The harness attaches no refs and runs no default action.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  type HostElement,
  type Surface,
} from '../../../components/sources/surface-test-harness.ts';
import { readText } from '../../../components/ui/ui-test-helpers.ts';

interface SignInCall { id: string | null; options: { callbackUrl?: string } | null }
const G = globalThis as unknown as { __p2SignIns: SignInCall[]; __p2Providers: Array<{ id: string; name: string }>; __p2Pathname?: string };
G.__p2SignIns = [];
G.__p2Providers = [];

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  'next-auth/react': CONSENT_SURFACE_STUBS['next-auth/react'].replace(
    'export async function signIn() {}',
    'export async function signIn(id, options) { globalThis.__p2SignIns.push({ id: id ?? null, options: options ?? null }); }',
  ),
  'next/image': 'export default function Image() { return null; }',
  'next/navigation': `
    const S = globalThis.__w3Sessions;
    export function useRouter() { return { push(url) { S.pushed.push(url); }, replace(url) { S.pushed.push(url); }, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return globalThis.__p2Pathname ?? '/ask'; }
    export function useSearchParams() { return new URLSearchParams(''); }
    export function redirect(url) { throw new Error('redirect ' + url); }
    export function notFound() { throw new Error('not found'); }`,
  '@/lib/auth-providers': 'export function buildProviders() { return globalThis.__p2Providers; }',
  '@/lib/db/creator-evidence': 'export async function hasPublishedEvidence() { return true; }',
});

const APP_HOST = 'app.fixture.example';
const MARKETING_HOST = 'fixture.example';
const ORIGIN = `https://${APP_HOST}`;

// The page the controls are on, as the browser globals see it.
const location = { href: `${ORIGIN}/ask`, origin: ORIGIN, pathname: '/ask', search: '', hash: '' };
function at(address: string): void {
  const url = new URL(address, ORIGIN);
  Object.assign(location, { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash });
}
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    location,
    history: { replaceState(_state: unknown, _unused: string, url: string) { at(url); }, pushState() {} },
    scrollTo() {},
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const AskPage = (await load('app/(app)/ask/page.tsx')).default as (props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) => Promise<ReactElement>;
const Header = (await load('components/Header.tsx')).default as ComponentType<Record<string, unknown>>;
const { resolveAskHref, resolveDashboardHref, resolvePublicSiteHref } = await load('lib/host-routing.ts');
const { resolveHostLinks } = await load('lib/host-links.ts');
const { resolveSessionAffordance } = await load('lib/allowed-origins.ts');

const ONE = [{ id: 'github', name: 'GitHub' }];
const TWO = [{ id: 'github', name: 'GitHub' }, { id: 'oidc', name: 'Fixture SSO' }];

/** The sources driven: a plain id, one holding every character that would break an unencoded query, and two that read as other origins. */
const SOURCES = ['nys-legislation', 'a/b?c&d#e f', '//evil.fixture.example/x', 'https://evil.fixture.example/'];
const want = (source: string) => `/ask?source=${encodeURIComponent(source)}`;

function signedOut(): void {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
}

/** The page at `address`, signed out, with `providers` configured, mounted and settled. */
async function pageAt(address: string, providers: Array<{ id: string; name: string }>): Promise<Surface> {
  signedOut();
  at(address);
  G.__p2Providers = providers;
  installFetch(ORIGIN, {});
  const params: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(address, ORIGIN).searchParams) {
    const had = params[k];
    params[k] = had === undefined ? v : Array.isArray(had) ? [...had, v] : [had, v];
  }
  const element = await AskPage({ searchParams: Promise.resolve(params) });
  const s = await mount(element);
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await s.settle();
  }
  return s;
}

/** Every button on the surface whose label starts a sign-in. */
const signInButtons = (s: Surface): HostElement[] => s.elements().filter((el) => el.type === 'button' && /^Sign in/.test(readText(el).trim()));

/** The callback each started sign-in would return to: its `callbackUrl`, or (with none) the address next-auth falls back to. */
const callbacks = (from: number): string[] => G.__p2SignIns.slice(from).map((c) => c.options?.callbackUrl ?? `fallback:${location.href}`);

function sameOrigin(callbackUrl: string): boolean {
  return new URL(callbackUrl, ORIGIN).origin === ORIGIN && callbackUrl.startsWith('/ask') && !callbackUrl.startsWith('//');
}

// --- The panel: its buttons and its auto path ------------------------------------------------------------------------

test('#790 item 2: on /ask?source=<id> signed out, each of the panel\'s buttons signs in with callbackUrl /ask?source=<encoded id>', async () => {
  const read: Record<string, string[]> = {};
  const expected: Record<string, string[]> = {};
  for (const source of SOURCES) {
    const s = await pageAt(`/ask?source=${encodeURIComponent(source)}`, TWO);
    const buttons = signInButtons(s);
    assert.equal(buttons.length, 2, `premise: the panel's two buttons (${source}): ${s.text().slice(0, 300)}`);
    const from = G.__p2SignIns.length;
    for (const b of buttons) await s.click(b);
    read[source] = callbacks(from);
    expected[source] = [want(source), want(source)];
    s.unmount();
  }
  assert.deepEqual(read, expected, `the panel's callbacks: ${JSON.stringify(read, null, 1)}`);
  for (const [source, urls] of Object.entries(read)) {
    for (const url of urls) {
      assert.ok(sameOrigin(url), `${source}: ${url} leaves the origin or /ask`);
      assert.equal(new URL(url, ORIGIN).searchParams.get('source'), source, `${source}: the source does not round-trip through ${url}`);
    }
  }
});

test('#790 item 2: on /ask?signin=1&source=<id> with one provider, the auto path signs in with callbackUrl /ask?source=<encoded id>', async () => {
  const read: Record<string, string[]> = {};
  const expected: Record<string, string[]> = {};
  for (const source of SOURCES) {
    const from = G.__p2SignIns.length;
    const s = await pageAt(`/ask?signin=1&source=${encodeURIComponent(source)}`, ONE);
    read[source] = callbacks(from);
    expected[source] = [want(source)];
    assert.equal(new URL(location.href).searchParams.has('signin'), false, `premise: the auto path stripped signin= (${location.href})`);
    s.unmount();
  }
  assert.deepEqual(read, expected, `the auto path's callbacks: ${JSON.stringify(read, null, 1)}`);
});

test('#790 item 2 (guard): with no source, or an empty one, the panel and the auto path sign in with callbackUrl /ask, as before', async () => {
  const read: Record<string, string[]> = {};
  for (const address of ['/ask', '/ask?source=', '/ask?source=%20%20']) {
    const s = await pageAt(address, TWO);
    const from = G.__p2SignIns.length;
    for (const b of signInButtons(s)) await s.click(b);
    read[`buttons at ${address}`] = callbacks(from);
    s.unmount();
    const auto = G.__p2SignIns.length;
    const a = await pageAt(`${address}${address.includes('?') ? '&' : '?'}signin=1`, ONE);
    read[`auto at ${address}`] = callbacks(auto);
    a.unmount();
  }
  assert.deepEqual(read, {
    'buttons at /ask': ['/ask', '/ask'],
    'auto at /ask': ['/ask'],
    'buttons at /ask?source=': ['/ask', '/ask'],
    'auto at /ask?source=': ['/ask'],
    'buttons at /ask?source=%20%20': ['/ask', '/ask'],
    'auto at /ask?source=%20%20': ['/ask'],
  }, `callbacks with no source: ${JSON.stringify(read, null, 1)}`);
});

// --- The Header's sign-in control on /ask, by topology -----------------------------------------------------------------

type Env = Record<string, string | undefined>;
function headerProps(env: Env, signInOptions: Array<{ id: string; name: string }>): Record<string, unknown> {
  const hostLinks = resolveHostLinks(env);
  const sessionProbe = resolveSessionAffordance(env);
  return {
    dashboardHref: resolveDashboardHref(env),
    askHref: resolveAskHref(env),
    publicSiteHref: resolvePublicSiteHref(env),
    marketingOrigin: hostLinks.marketingOrigin,
    signInHref: hostLinks.signInHref,
    brandName: 'Fixture Site',
    showRoadmap: true,
    signInOptions,
    ...(sessionProbe !== null ? { sessionProbe } : {}),
  };
}

/** The Header's sign-in controls (the primary button or link that is not the avatar menu). */
const headerControls = (s: Surface): HostElement[] =>
  s.elements().filter((el) => (el.type === 'a' || el.type === 'button') && String(el.props.className ?? '').includes('ui-button-primary'));

/**
 * Where one sign-in control on `/ask?source=<source>` sends the reader: for a button, the callback of the sign-in it
 * starts; for a link, the address it opens after its own click handler has run (a browser follows `href` as the
 * handler leaves it), followed to the page, and that page's auto path's callback with one provider.
 */
async function headerControlReturn(env: Env, options: Array<{ id: string; name: string }>, source: string): Promise<{ shape: string; returnsTo: string[] }> {
  signedOut();
  at(`/ask?source=${encodeURIComponent(source)}`);
  installFetch(ORIGIN, {});
  const s = await mount(h(Header, headerProps(env, options)));
  const controls = headerControls(s);
  assert.equal(controls.length, 1, `premise: one sign-in control (${JSON.stringify(env)}, ${options.length} options)`);
  const control = controls[0];
  if (control.type === 'button') {
    const from = G.__p2SignIns.length;
    await s.click(control);
    s.unmount();
    return { shape: 'button', returnsTo: callbacks(from) };
  }
  const anchor = { href: new URL(String(control.props.href), ORIGIN).href };
  const onClick = control.props.onClick as ((event: unknown) => void) | undefined;
  onClick?.({ currentTarget: anchor, target: anchor, preventDefault() {}, stopPropagation() {}, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  s.unmount();
  const opened = new URL(anchor.href);
  if (opened.pathname !== '/ask') return { shape: 'link', returnsTo: [`opens ${anchor.href}`] };
  const from = G.__p2SignIns.length;
  const page = await pageAt(`${opened.pathname}${opened.search}`, ONE);
  page.unmount();
  return { shape: 'link', returnsTo: callbacks(from) };
}

const TOPOLOGIES: Array<[string, Env, Array<{ id: string; name: string }>]> = [
  ['unconfigured, one provider (the in-place button)', {}, ONE],
  ['unconfigured, two providers (a link to the panel)', {}, TWO],
  ['app-only (a link to the panel)', { APP_ONLY: '1' }, ONE],
  ['split (the probed link to the app host)', { APP_HOST, MARKETING_HOST }, ONE],
  ['app host only (a link to the app host)', { APP_HOST }, ONE],
];

test('#790 item 2: on /ask?source=<id> signed out, the Header\'s sign-in control returns to /ask?source=<id>, in every topology', async () => {
  const read: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  for (const [name, env, options] of TOPOLOGIES) {
    for (const source of SOURCES.slice(0, 2)) {
      const got = await headerControlReturn(env, options, source);
      read[`${name} / ${source}`] = got.returnsTo;
      // The in-place button passes no callbackUrl, so next-auth returns to the current address, which holds the source.
      expected[`${name} / ${source}`] = [got.shape === 'button' ? `fallback:${ORIGIN}${want(source)}` : want(source)];
    }
  }
  assert.deepEqual(read, expected, `where each Header control returns: ${JSON.stringify(read, null, 1)}`);
});

test('#790 item 2 (premise): next-auth\'s signIn with no callbackUrl returns to the current address (window.location.href)', () => {
  const file = path.join(SRC, '..', 'node_modules', 'next-auth', 'react', 'index.js');
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(/callbackUrl = _ref5\$callbackUrl === void 0 \? window\.location\.href : _ref5\$callbackUrl/.test(source),
    `next-auth/react's signIn no longer defaults callbackUrl to window.location.href (${file})`);
});

test('#790 item 2 (guard): on /ask with no source, the Header\'s sign-in links open the panel as before (no source added)', async () => {
  const read: Record<string, string> = {};
  for (const [name, env, options] of TOPOLOGIES) {
    signedOut();
    at('/ask');
    installFetch(ORIGIN, {});
    const s = await mount(h(Header, headerProps(env, options)));
    const control = headerControls(s)[0];
    if (control.type !== 'a') { s.unmount(); continue; }
    const anchor = { href: new URL(String(control.props.href), ORIGIN).href };
    (control.props.onClick as ((event: unknown) => void) | undefined)?.({ currentTarget: anchor, target: anchor, preventDefault() {}, button: 0 });
    read[name] = anchor.href;
    s.unmount();
  }
  assert.deepEqual(read, {
    'unconfigured, two providers (a link to the panel)': `${ORIGIN}/ask?signin=1`,
    'app-only (a link to the panel)': `${ORIGIN}/ask?signin=1`,
    'split (the probed link to the app host)': `${ORIGIN}/ask?signin=1`,
    'app host only (a link to the app host)': `${ORIGIN}/ask?signin=1`,
  });
});
