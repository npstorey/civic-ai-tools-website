// UX-2 P4b: the Settings overlay's close navigates once per opening.
//
// THE DEFECT. The intercepted overlay closes by `router.back()`
// (`SettingsOverlay.tsx`, `close`), and a soft navigation is asynchronous:
// until it unmounts the overlay, the overlay is still open and still the top
// modal. A second quick Escape, or a second click on the close control, calls
// `close` again, and a second `back()` leaves the page beneath (the record
// page under the review sheet, say). A direct load's overlay closes by
// `push('/')`, the same shape.
//
// WHAT IS DRIVEN. The real overlay on the surface harness, with the real
// consent, flows and decision routes behind it, and a `next/navigation` stub
// that records every `back()` and `push()`. The close control is clicked
// twice with no unmount between: Escape calls the same `onClose` through the
// Dialog (`Dialog.tsx`, `useModalFocus`), which this harness cannot press.
//
// THE DECOY. A reopen is a new mount (the intercepted slot renders the overlay
// only while the address is `/settings`, `InterceptedSettings.tsx`), and its
// close navigates again.
//
// WHAT MAKES IT ABLE TO FAIL. At the base each call of `close` navigates, so
// two clicks make two `back()` calls.
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
  type Surface,
} from '../sources/surface-test-harness.ts';

interface Navigation { calls: string[] }
const nav: Navigation = { calls: [] };
(globalThis as unknown as { __p4beNavigation: Navigation }).__p4beNavigation = nav;

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  'next/navigation': `
    const N = globalThis.__p4beNavigation;
    export function useRouter() {
      return {
        push(url) { N.calls.push('push ' + url); },
        replace(url) { N.calls.push('replace ' + url); },
        back() { N.calls.push('back'); },
        forward() {}, refresh() {}, prefetch() {},
      };
    }
    export function usePathname() { return '/settings'; }
    export function useSearchParams() { return new URLSearchParams(''); }
    export function redirect(url) { throw new Error('redirect ' + url); }
    export function notFound() { throw new Error('not found'); }`,
});

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'DATA_COMMONS_MCP_URL', 'BOSTON_OPENCONTEXT_MCP_URL', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE',
  'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
  'NEXT_PUBLIC_CAPTURE_TRACES', 'SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'DATABASE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${ORIGIN}/settings`, origin: ORIGIN, pathname: '/settings' }, scrollTo() {} },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

/** Open the overlay signed out, as `mount` says it was opened. */
async function openOverlay(mountedAs: 'intercepted' | 'page'): Promise<Surface> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  answers();
  const surface = await mount(h(SettingsOverlay, { mount: mountedAs }));
  const dialogs = surface.elements().filter((el) => el.props.role === 'dialog');
  assert.equal(dialogs.length, 1, `premise: the overlay renders one role="dialog": ${surface.text().slice(0, 300)}`);
  return surface;
}

/** The overlay's close control: the Dialog's, named "Close", which calls the overlay's `close`. */
async function pressClose(surface: Surface): Promise<void> {
  const found = surface.elements().filter((el) => el.type === 'button' && el.props['aria-label'] === 'Close');
  assert.equal(found.length, 1, `premise: one close control, found ${found.length}`);
  await surface.click(found[0]);
}

for (const [mountedAs, navigation] of [['intercepted', 'back'], ['page', 'push /']] as const) {
  test(`UX-2 P4b (${mountedAs}): two close calls before the overlay unmounts navigate once, by ${navigation}`, async () => {
    nav.calls.length = 0;
    const surface = await openOverlay(mountedAs);
    await pressClose(surface);
    assert.deepEqual(nav.calls, [navigation], `premise: the first close navigated ${JSON.stringify(nav.calls)}`);
    await pressClose(surface);
    assert.deepEqual(nav.calls, [navigation], `two close calls navigated ${JSON.stringify(nav.calls)}, not once`);
    surface.unmount();
  });

  test(`UX-2 P4b (${mountedAs}), decoy: after a reopen, close navigates again`, async () => {
    nav.calls.length = 0;
    const first = await openOverlay(mountedAs);
    await pressClose(first);
    first.unmount();
    const reopened = await openOverlay(mountedAs);
    await pressClose(reopened);
    assert.deepEqual(nav.calls, [navigation, navigation], `the reopened overlay's close navigated ${JSON.stringify(nav.calls.slice(1))}`);
    reopened.unmount();
  });
}
