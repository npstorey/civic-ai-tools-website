// The line under the question box (UX pass, row 11), as UX-2 P3b-1's re-cut rules it (D5 B; contract v5 1B.1; the
// words gate's addenda). One line says where this question goes, as a count, before and after a first consent:
// "Where your question goes: the model service and N data sources · Select sources", N counting the sources On, read
// from the same states the guard reads. In notebook mode the notebook runner is named ("…, the notebook runner and N
// data sources"); with none On and one Ask first, "…; data sources ask first"; it names no source. "Select sources"
// opens the Settings overlay. (Before the re-cut the line named the sources, showed only with a consent in force,
// and linked "Change sources".) `src/components/composer/where-line.test.ts` reads every form and the predicate.
//
// WHAT IS DRIVEN. The real home page on the surface harness, with four configured sources (Socrata, Data Commons,
// Boston and NYC Charter in this site's sandbox) and a consent written first through the REAL consent route. Every
// fixture gives a state to every source the statement lists, read from the statement (the seat's fix 4).
//
// WHAT MAKES IT ABLE TO FAIL. At `b1d8bfd` the line names the sources, says "Change sources", and is absent with no
// consent in force. The mixes put a source at each state, so a line that counted Ask first as On would differ.
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
/** The sources the statement lists, read from it; `statesOf` gives the first ones the named states and the rest `rest`. */
const IDS: string[] = (await buildFlowsStatement()).sources.map((s: { sourceId: string }) => s.sourceId);
const statesOf = (first: string[], rest: string): Record<string, string> => Object.fromEntries(IDS.map((id, i) => [id, first[i] ?? rest]));
const LEAD = 'Where your question goes: ';
const LINK = ' · Select sources';

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

test('row 11 (P3b-1 re-cut, D5 B): every source On, the line counts them and names none', async () => {
  const page = await homeWith(statesOf([], 'on'));
  assert.deepEqual(lineOf(page), [`${LEAD}the model service and ${IDS.length} data sources${LINK}`]);
  page.unmount();
});

test('row 11 (P3b-1 re-cut, D5 B): a mix, one On, two Ask first, the rest Off: N counts the On source only', async () => {
  const page = await homeWith(statesOf(['on', 'ask-first', 'ask-first'], 'off'));
  assert.deepEqual(lineOf(page), [`${LEAD}the model service and 1 data source${LINK}`]);
  page.unmount();
});

test('row 11 (P3b-1 re-cut, D5 B): two On, the rest Ask first: "2 data sources"', async () => {
  const page = await homeWith(statesOf(['on', 'on'], 'ask-first'));
  assert.deepEqual(lineOf(page), [`${LEAD}the model service and 2 data sources${LINK}`]);
  page.unmount();
});

test('row 11 (P3b-1 re-cut, items 23/47): none On and one Ask first, the line says the data sources ask first', async () => {
  const page = await homeWith(statesOf(['off', 'ask-first'], 'off'));
  assert.deepEqual(lineOf(page), [`${LEAD}the model service; data sources ask first${LINK}`]);
  page.unmount();
});

test('row 11 (P3b-1 re-cut, D5 B): with no consent in force the line still shows, before the first consent', async () => {
  const page = await homeWith(null);
  const line = lineOf(page);
  assert.equal(line.length, 1, `where-lines with no consent in force: ${JSON.stringify(line)}`);
  assert.ok(line[0].startsWith(LEAD) && line[0].endsWith(LINK), `the line before a consent reads: ${line[0]}`);
  assert.ok(!page.text().includes('This question goes to'), 'the retired line is shown');
  page.unmount();
});

// UX-2 P4b (#729 comment 6728493444): the Sources panel is removed, so "Change sources" opens the Settings overlay,
// a client-side link to `/settings` (the next/link stub renders it as an <a>). It opened the form's Sources
// <details> before; that drawer no longer exists.
test('row 11: the link after the line, "Select sources" (item 32), opens the Settings overlay', async () => {
  const page = await homeWith(statesOf([], 'on'));
  const link = page.elements().filter((el) => el.type === 'a' && textOf(el) === 'Select sources');
  assert.equal(link.length, 1, 'no "Select sources" link after the line');
  assert.equal(link[0].props.href, '/settings', `"Select sources" links ${String(link[0].props.href)}, not the Settings overlay`);
  assert.equal(typeof link[0].props.onClick, 'undefined', '"Select sources" runs its own click handler');
  page.unmount();
});

// UX-2 P4b, criterion 1 (driven): the question form the home page and `/ask` share renders no Sources panel.
const PANEL_SUMMARY = 'Data sources this site can use';
const panelsIn = (page: Surface): HostElement[] => page.elements().filter((el) => (el.type === 'summary' && textOf(el) === PANEL_SUMMARY) || el.props.id === 'sources-panel-heading');

test('UX-2 P4b: the home page renders no "Data sources this site can use" and no Sources panel', async () => {
  const page = await homeWith(statesOf([], 'on'));
  assert.ok(lineOf(page).length === 1, 'premise: the home page\'s question form is mounted');
  assert.deepEqual(panelsIn(page).map((el) => el.type), [], 'the home page renders the Sources panel');
  assert.ok(!page.text().includes(PANEL_SUMMARY), 'the home page names "Data sources this site can use"');
  page.unmount();
});

// --- The owner's fix (pre-merge): in notebook mode the line names the notebook runner ------------
//
// Under the sandbox driver the notebook sent to run carries the question's
// text (the privacy page's executor statements say so), so when the form's
// mode is the notebook the line names the runner too. Standard mode is as
// above. Driven on `/ask`'s mount, signed in (the mode needs sign-in), with
// the mode set by the mount's default and, for standard, by the stored choice.

const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;

async function askWith(states: Record<string, string>, defaultMode: 'notebook' | 'standard'): Promise<Surface> {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  answers();
  const statement = await buildFlowsStatement();
  const response = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(response.status, 200, 'premise: the consent was written');
  return mount(h(QuerySurface, { presentation: 'answer-first', defaultMode }));
}

const MIX = statesOf(['on', 'on'], 'ask-first');

test('owner fix, re-cut (W3): in notebook mode the line names the notebook runner', async () => {
  const page = await askWith(MIX, 'notebook');
  const mode = page.elements().filter((el) => el.props.role === 'radio' && el.props['aria-checked'] === true).map((el) => textOf(el));
  assert.deepEqual(lineOf(page), [`${LEAD}the model service, the notebook runner and 2 data sources${LINK}`], `mode shown: ${mode.join(',')}`);
  page.unmount();
});

test('owner fix, re-cut (W4): in notebook mode with none On and one Ask first, the runner is still named', async () => {
  const page = await askWith(statesOf(['off', 'off', 'off', 'ask-first'], 'off'), 'notebook');
  assert.deepEqual(lineOf(page), [`${LEAD}the model service and the notebook runner; data sources ask first${LINK}`]);
  page.unmount();
});

test('UX-2 P4b: /ask renders no "Data sources this site can use" and no Sources panel', async () => {
  const page = await askWith(MIX, 'standard');
  assert.ok(lineOf(page).length === 1, 'premise: /ask\'s question form is mounted');
  assert.deepEqual(panelsIn(page).map((el) => el.type), [], '/ask renders the Sources panel');
  assert.ok(!page.text().includes(PANEL_SUMMARY), '/ask names "Data sources this site can use"');
  page.unmount();
});

test('owner fix, re-cut: in standard mode, signed in, the line counts the On sources', async () => {
  const page = await askWith(MIX, 'standard');
  assert.deepEqual(lineOf(page), [`${LEAD}the model service and 2 data sources${LINK}`]);
  page.unmount();
});
