// The just-in-time line under the question box (UX pass, row 11). While a
// consent is in force, one line says where this question goes, read from the
// same states the guard reads and named by `readerSourceName`, never typed:
// "This question goes to the model service and to <On sources>. Not to <the
// others>, which are set to <Ask first / Off>." With every source On, the first
// sentence alone; with none On, "… and to no data source." (the guard's own
// `no_sources_on` text still answers a submit). With no consent in force there
// is no line: the card says it. A link after the line opens the Sources panel.
//
// WHAT IS DRIVEN. The real home page on the surface harness, with four
// configured sources (Socrata, Data Commons, Boston and NYC Charter in this
// site's sandbox) and a consent written first through the REAL consent route.
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no such line. The mix puts
// a source at each of the three states, so a line that ignored a state, or
// typed the names, would differ.
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
  type Surface,
} from './surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.NYC_CHARTER_HOSTING = 'sandbox';
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
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}


const ANON = () => { sessions.server = null; sessions.client = { status: 'unauthenticated', data: null }; };

/** Write `states` through the real consent route (or nothing for null), then mount the home page. */
async function homeWith(states: Record<string, string> | null): Promise<Surface> {
  ANON();
  answers();
  if (states) {
    const statement = await buildFlowsStatement();
    const response = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
    assert.equal(response.status, 200, 'premise: the consent was written');
  }
  return mount(h(Home));
}

const lineOf = (page: Surface) => page.elements().filter((el) => el.props['data-part'] === 'where-this-question-goes').map((el) => textOf(el));

test('row 11: premise, the four configured sources in manifest order', async () => {
  const statement = await buildFlowsStatement();
  assert.deepEqual(statement.sources.map((s: { sourceId: string }) => s.sourceId), ['socrata', 'data-commons', 'boston-opencontext', 'nyc-charter']);
});

test('row 11: every source On, the line names them all and nothing else', async () => {
  const page = await homeWith({ socrata: 'on', 'data-commons': 'on', 'boston-opencontext': 'on', 'nyc-charter': 'on' });
  assert.deepEqual(lineOf(page), ['This question goes to the model service and to Socrata, Data Commons, Boston OpenContext and NYC Charter, Laws and Rules. Change sources']);
  page.unmount();
});

test('row 11: a mix, the On sources, then each other source with its state', async () => {
  const page = await homeWith({ socrata: 'on', 'data-commons': 'ask-first', 'boston-opencontext': 'ask-first', 'nyc-charter': 'off' });
  assert.deepEqual(lineOf(page), ['This question goes to the model service and to Socrata. Not to Data Commons or Boston OpenContext, which are set to Ask first, or NYC Charter, Laws and Rules, which is set to Off. Change sources']);
  page.unmount();
});

test('row 11: a mix with one state among the others, the template as ruled', async () => {
  const page = await homeWith({ socrata: 'on', 'data-commons': 'on', 'boston-opencontext': 'ask-first', 'nyc-charter': 'ask-first' });
  assert.deepEqual(lineOf(page), ['This question goes to the model service and to Socrata and Data Commons. Not to Boston OpenContext or NYC Charter, Laws and Rules, which are set to Ask first. Change sources']);
  page.unmount();
});

test('row 11: none On, the line says no data source', async () => {
  const page = await homeWith({ socrata: 'off', 'data-commons': 'ask-first', 'boston-opencontext': 'off', 'nyc-charter': 'off' });
  assert.deepEqual(lineOf(page), ['This question goes to the model service and to no data source. Change sources']);
  page.unmount();
});

test('row 11: with no consent in force there is no line', async () => {
  const page = await homeWith(null);
  assert.deepEqual(lineOf(page), []);
  assert.ok(!page.text().includes('This question goes to'), 'a line was shown with no consent in force');
  page.unmount();
});

test('row 11: the link after the line opens the Sources panel', async () => {
  const page = await homeWith({ socrata: 'on', 'data-commons': 'on', 'boston-opencontext': 'on', 'nyc-charter': 'on' });
  const details = () => page.elements().filter((el) => el.type === 'details');
  assert.equal(details().length, 1, 'premise: one Sources details');
  assert.notEqual(details()[0].props.open, true, 'premise: the panel starts closed');
  const link = page.elements().filter((el) => el.type === 'a' && textOf(el) === 'Change sources');
  assert.equal(link.length, 1, 'no link after the line');
  await page.click(link[0]);
  assert.equal(details()[0].props.open, true, 'the link did not open the Sources panel');
  page.unmount();
});
