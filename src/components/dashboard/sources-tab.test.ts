// R6 W3 (#632), criteria 3 and 5: the dashboard's Sources tab.
//
// THE TAB (anchor W3 item 3). For a signed-in account whose consent is kept
// on the account (a session with a `dbId`, D12): every source's state, the
// date it was given, the flows version the consent refers to with its date,
// and a control that withdraws the consent by calling `DELETE
// /api/sources/consent`. After the withdrawal `/ask` shows the card again
// (criterion 3). The tab carries the deployment guide's address, or says the
// site names none (D10, criterion 5).
//
// WHAT IS DRIVEN. The real `DashboardTabs` on the surface harness, with the
// real consent endpoint and `/api/flows` behind it and the account's row held
// in memory; then `/ask`'s surface as `src/app/(app)/ask/page.tsx` mounts it,
// with its question route answered by a stand-in that asks the REAL consent
// gate.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the dashboard has no Sources tab.
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
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://app.fixture.example';
const GUIDE = 'https://guide.fixture.example/deploy';

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
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as ComponentType<Record<string, unknown>>;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

/** The copy W3 adds (a specifier typed `string`, so the red commit type-checks). */
const COPY: string = '@/lib/sources/copy';
const copy = (await import(COPY).catch(() => null)) as Mod | null;

const QUERY_ROUTES = ['/api/compare-stream', '/api/query-notebook', '/api/compare'];

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    ...Object.fromEntries(QUERY_ROUTES.map((p) => [p, async (request: Request) => {
      const decision = await consentInForce(request, sessions.server);
      if (!decision.ok) return new Response(JSON.stringify(decision.payload), { status: 403, headers: { 'Content-Type': 'application/json' } });
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }])),
  });
}

const DB_ID = '99999999-9999-4999-8999-999999999999';
function signedIn(): void {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
}

/** A consent on the account, written through the real endpoint; then the dashboard, on its Sources tab. */
async function sourcesTab(): Promise<{ tab: Surface; net: ReturnType<typeof answers>; statement: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  signedIn();
  sessions.rows.clear();
  const net = answers();
  const statement = await buildFlowsStatement();
  const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }, i: number) => [s.sourceId, i === 0 ? 'on' : 'off']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
  assert.ok(sessions.rows.has(DB_ID), 'premise: the consent is kept on the account');
  net.clear();
  const tab = await mount(h(DashboardTabs, { myEvidence: [], myEvaluations: [], activity: [], tokens: [], signingConfigured: true, sealOnly: false }));
  const buttons = tab.buttons('Sources');
  assert.equal(buttons.length, 1, `the dashboard has no Sources tab: ${tab.text().slice(0, 300)}`);
  await tab.click(buttons[0]);
  return { tab, net, statement };
}

/** T13 (#632 G7): each source's one reader name, written out. */
const READER_NAME: Record<string, string> = { socrata: 'Socrata', 'data-commons': 'Data Commons', 'boston-opencontext': 'Boston OpenContext', 'nyc-charter': 'NYC Charter, Laws and Rules' };


/** An ISO date (or timestamp) as the Sources tab writes it, in words: "2026-10-20" → "20 October 2026" (UX pass row 14). */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inWords = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

test('criterion 3: the Sources tab shows every source\'s state, the date given, and the base version with its statement\'s date', async () => {
  const { tab, statement } = await sourcesTab();
  const text = tab.text();
  for (const [i, source] of (statement.sources as Array<{ sourceId: string; displayName: string }>).entries()) {
    const name = READER_NAME[source.sourceId];
    const rows = tab.elements().filter((el: HostElement) => el.props['data-source'] === source.sourceId);
    assert.equal(rows.length, 1, `the tab has no row for ${source.sourceId}`);
    const row = textOf(rows[0]);
    assert.ok(row.includes(name), `${source.sourceId}'s row does not name it`);
    assert.ok(row.includes(i === 0 ? 'On' : 'Off'), `${source.sourceId}'s row does not show its state: ${row}`);
  }
  // UX pass row 14(a): both dates in words, and the base version's first 8 hex.
  assert.ok(text.includes(`Given on ${inWords(new Date().toISOString())}.`), `the tab does not show the date the consent was given, in words: ${text.slice(0, 400)}`);
  // S3 (#632 G7): the base version the consent refers to, not the statement hash.
  assert.ok(text.includes(`(version ${statement.version.slice(0, 8)})`), 'the tab does not show the base version the consent refers to');
  assert.ok(!text.includes(statementHash(statement).slice(0, 8)), 'the tab shows the statement hash');
  assert.ok(text.includes(`as it stood on ${inWords(statement.date)}`), 'the tab does not show the flows statement\'s date, in words');
  tab.unmount();
});

test('criterion 3: after the tab\'s revoke, /ask shows the card again', async () => {
  const { tab, net } = await sourcesTab();
  const withdraw = tab.elements().filter((el) => el.type === 'button' && /withdraw/i.test(textOf(el)));
  assert.equal(withdraw.length, 1, 'the Sources tab has no withdraw control');
  await tab.click(withdraw[0]);
  assert.equal(net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'DELETE').length, 1, 'the revoke did not call DELETE');
  assert.ok(!sessions.rows.has(DB_ID), 'the account still holds a consent after the revoke');
  tab.unmount();

  net.clear();
  const ask = await mount(h(QuerySurface, { showLocalSetupFootnote: false, presentation: 'answer-first', defaultMode: 'notebook' }));
  const box = ask.elements().filter((el) => el.type === 'textarea');
  assert.equal(box.length, 1, 'premise: /ask has its question box');
  await ask.type(box[0], 'What was the median household income in the Bronx?');
  await ask.submit(ask.elements().filter((el) => el.type === 'form')[0]);
  assert.deepEqual(net.sent.filter((r) => QUERY_ROUTES.includes(r.path)).map((r) => r.path), [], '/ask sent the question after the consent was withdrawn');
  assert.ok(ask.buttons('Allow').length === 1 && ask.buttons('Not now').length === 1, `/ask shows no card after the revoke: ${ask.text().slice(0, 300)}`);
  ask.unmount();
});

test('criterion 5: unset, the tab omits the guide link and says this site names no guide', async () => {
  const { tab } = await sourcesTab();
  assert.ok(copy?.NO_GUIDE_SENTENCE, `${COPY} exports no NO_GUIDE_SENTENCE`);
  assert.ok(tab.text().includes(copy!.NO_GUIDE_SENTENCE), 'with no guide address, the tab does not say so');
  assert.ok(!tab.elements().some((el) => el.type === 'a' && el.props.href === GUIDE));
  tab.unmount();
});

test('criterion 5: set, the tab links to the deployment guide', async () => {
  process.env.SITE_DEPLOYMENT_GUIDE_URL = GUIDE;
  try {
    const { tab } = await sourcesTab();
    assert.equal(tab.elements().filter((el) => el.type === 'a' && el.props.href === GUIDE).length, 1, 'the tab does not link to the configured guide');
    tab.unmount();
  } finally {
    delete process.env.SITE_DEPLOYMENT_GUIDE_URL;
  }
});
