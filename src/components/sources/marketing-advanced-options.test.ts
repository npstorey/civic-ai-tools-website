// Advanced options on the public home page, signed out (UX pass, row 7; the
// owner's ruling of 2026-10-22). The marketing mount passes
// `advancedOptions="hidden-signed-out"` and only it: signed out under it, the
// form renders no Advanced options toggle and, in its place, one line saying
// what signing in adds. The line promises no models: the model list does not
// depend on sign-in (`/api/models` reads no session; the form gates only the
// response mode on it).
//
// WHAT IS DRIVEN. The real home page (`src/app/(marketing)/page.tsx`) and
// `/ask`'s mount (`QuerySurface` as `src/app/(app)/ask/page.tsx` mounts it), on
// the surface harness, under the split host topology the reference deployment
// runs (a sign-in address on the app host) and under the in-place default.
//
// WHAT MAKES IT ABLE TO FAIL. At the base every mount renders the toggle for
// every reader, and no mount renders the line.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  textOf,
  type Surface,
} from './surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');

installFetch(ORIGIN, {
  '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  '/api/flows': () => flowsRoute.GET(),
  '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  '/api/rate-limit': () => new Response(JSON.stringify({ remaining: 10, limit: 10, resets_at: '2026-10-23T00:00:00Z', authenticated: false }), { status: 200 }),
});

/** The reference deployment's shape: sign-in lives on the app host. */
const splitTopology = (child: ReactElement) => h(HostLinksProvider, { value: { marketingOrigin: '', signInHref: 'https://app.fixture.example/ask' } }, child);
const askMount = () => h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' });

const LINE_SPLIT = 'Sign in to run the answer as a notebook in a signed sandbox and publish it as a record. Signed in, you can ask 20 questions a day.';
const LINE_IN_PLACE = 'Sign in with GitHub to run the answer as a notebook in a signed sandbox and publish it as a record. Signed in, you can ask 20 questions a day.';

const ANON = () => { sessions.server = null; sessions.client = { status: 'unauthenticated', data: null }; };
const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

const toggles = (page: Surface) => page.elements().filter((el) => el.type === 'button' && textOf(el).includes('Advanced options'));

test('row 7: the home page, signed out, split topology: no Advanced options, and the sign-in line in its place', async () => {
  ANON();
  const page = await mount(splitTopology(h(Home)));
  assert.equal(toggles(page).length, 0, 'the signed-out home page still offers Advanced options');
  assert.ok(page.text().includes(LINE_SPLIT), `the sign-in line is not on the page: ${page.text().slice(0, 400)}`);
  assert.doesNotMatch(page.text(), /more models/i, 'the line promises more models');
  page.unmount();
});

test('row 7: the home page, signed out, in-place sign-in: the line names the one provider', async () => {
  ANON();
  const page = await mount(h(Home));
  assert.equal(toggles(page).length, 0);
  assert.ok(page.text().includes(LINE_IN_PLACE), `the in-place line is not on the page: ${page.text().slice(0, 400)}`);
  page.unmount();
});

test('row 7: the home page, signed in: the toggle as before, and no line', async () => {
  SIGNED_IN();
  const page = await mount(splitTopology(h(Home)));
  assert.equal(toggles(page).length, 1, 'the signed-in home page lost Advanced options');
  assert.ok(!page.text().includes('Signed in, you can ask'), 'the signed-in home page shows the sign-in line');
  page.unmount();
});

for (const [who, session] of [['signed out', ANON], ['signed in', SIGNED_IN]] as const) {
  test(`row 7: /ask's mount, ${who}: the toggle as before, and no line`, async () => {
    session();
    const page = await mount(splitTopology(askMount()));
    assert.equal(toggles(page).length, 1, `/ask (${who}) lost Advanced options`);
    assert.ok(!page.text().includes('Signed in, you can ask'), `/ask (${who}) shows the sign-in line`);
    page.unmount();
  });
}
