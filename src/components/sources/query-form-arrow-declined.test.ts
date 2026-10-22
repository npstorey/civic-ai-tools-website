// The submit arrow after Not now (UX pass, row 3): the button is disabled for
// the declined question (Q2), and its colour and cursor say so. At the base the
// background and cursor keyed on "the box has text and nothing is loading", not
// on the condition that disables the button, so a disabled arrow stayed
// accent-blue with a pointer cursor (measured on production after Not now).
//
// WHAT MAKES IT ABLE TO FAIL. The declined state is the one state in which the
// box has text, nothing is loading, and the button is disabled: the two
// conditions part only there. A question typed before the models answer would
// part them too, but this fixture answers the model list first.
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
  type HostElement,
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
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}`);
  return found[0];
}
const submitButton = (page: Surface) => one(page, 'submit button', (el) => el.type === 'button' && el.props.type === 'submit');
const styleOf = (el: HostElement) => el.props.style as Record<string, unknown>;

test('row 3: with a question typed, the arrow is enabled and accent-coloured (premise)', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  answers();
  const page = await mount(h(Home));
  const box = one(page, 'question box', (el) => el.type === 'textarea');
  await page.type(box, 'How many 311 complaints were there in Brooklyn in 2024?');
  const submit = submitButton(page);
  assert.equal(submit.props.disabled, false);
  assert.equal(styleOf(submit).backgroundColor, 'var(--accent)');
  assert.equal(styleOf(submit).cursor, 'pointer');
  page.unmount();
});

test('row 3: after Not now the arrow is disabled, grey, and shows a not-allowed cursor', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  answers();
  const page = await mount(h(Home));
  const box = one(page, 'question box', (el) => el.type === 'textarea');
  await page.type(box, 'How many 311 complaints were there in Brooklyn in 2024?');
  await page.submit(one(page, 'form', (el) => el.type === 'form'));
  await page.click(page.button('Not now'));
  const submit = submitButton(page);
  assert.equal(submit.props.disabled, true, 'premise: after Not now the arrow is disabled');
  assert.equal(styleOf(submit).backgroundColor, 'var(--border-color)', 'after Not now the disabled arrow keeps the accent colour');
  assert.equal(styleOf(submit).cursor, 'not-allowed', 'after Not now the disabled arrow keeps a pointer cursor');
  page.unmount();
});
