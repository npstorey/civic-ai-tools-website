// The heading over an executed-sandbox answer (UX pass, row 19): "Executed-
// sandbox response" was two engineer's words; it now reads "Answer, executed
// in a signed sandbox", over the running panel and the finished answer alike.
// No test read the heading at the base.
//
// WHAT IS DRIVEN. `/ask`'s mount (`QuerySurface`, answer-first, notebook mode
// by default) on the surface harness, signed in, through the consent card's
// Allow, with the notebook route answering a failed run (the view renders under the
// heading and offers Retry).
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
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

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
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    // The run reports a failure, so the notebook view renders (and offers Retry) without a live stream.
    '/api/query-notebook': () => new Response(`data: ${JSON.stringify({ type: 'error', message: 'The notebook could not finish running. Please try again.', code: 'generic' })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
  });
}


test('row 19: the heading over a notebook-mode answer reads "Answer, executed in a signed sandbox"', async () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  sessions.rows.clear();
  answers();
  const page = await mount(h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' }));
  const box = page.elements().find((el) => el.type === 'textarea');
  assert.ok(box, 'premise: the question box');
  await page.type(box!, 'How many 311 complaints were there in Brooklyn in 2024?');
  await page.submit(page.elements().find((el) => el.type === 'form')!);
  await page.click(page.button('Allow'));
  const headings = page.elements().filter((el) => el.type === 'h2').map((el) => textOf(el));
  assert.ok(headings.includes('Answer, executed in a signed sandbox'), `the notebook answer's heading is not the reader's: ${headings.join(' | ')}`);
  assert.ok(!headings.includes('Executed-sandbox response'), 'the old heading is still shown');
  page.unmount();
});
