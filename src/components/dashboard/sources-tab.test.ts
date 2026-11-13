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
// UX-2 P4b (criterion 2, M7; the v2 check's M1). The tab's states, dates,
// withdrawal and guide link move to the Settings overlay's "Data sources"
// sub-page (`src/components/settings/SettingsOverlay.tsx`), so the assertions
// below are re-pointed at the overlay, unchanged, except:
//   - each row's state is read from its checked radio, since the overlay's rows
//     draw no "Name: State" line (the tab's, `SourcesTab.tsx:77-79`);
//   - the card shown after the withdrawal offers "Don't allow" (item 8), not
//     "Not now".
// The tab itself now renders X22d's sentence and its link (item 41) and
// nothing else (criterion 1, the first test).
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
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
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

/** A consent on the account, written through the real endpoint. */
async function consentOnAccount(): Promise<{ net: ReturnType<typeof answers>; statement: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  signedIn();
  sessions.rows.clear();
  const net = answers();
  const statement = await buildFlowsStatement();
  const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }, i: number) => [s.sourceId, i === 0 ? 'on' : 'off']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
  assert.ok(sessions.rows.has(DB_ID), 'premise: the consent is kept on the account');
  net.clear();
  return { net, statement };
}

/** The consent on the account; then the Settings overlay, on its Data sources sub-page (UX-2 P4b, M7). */
async function sourcesTab(): Promise<{ tab: Surface; net: ReturnType<typeof answers>; statement: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { net, statement } = await consentOnAccount();
  const tab = await mount(h(SettingsOverlay, {}));
  return { tab, net, statement };
}

/** The value of the checked radio in a row, or undefined. */
function checkedIn(row: HostElement): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) { for (const c of node) { const v = walk(c); if (v !== undefined) return v; } return undefined; }
    if (node === null || typeof node !== 'object' || !('props' in (node as object))) return undefined;
    const el = node as HostElement;
    if (el.type === 'input' && el.props.type === 'radio' && el.props.checked === true) return el.props.value;
    return walk((el.props as { children?: unknown }).children);
  };
  return walk(row.props.children);
}

// --- UX-2 P4b, criterion 1: the dashboard's Sources tab is a pointer -----------------------------

test('UX-2 P4b criterion 1: the Sources tab renders X22d\'s sentence and its link to /settings, and no control, no dates, no "Withdraw consent" and no notice', async () => {
  await consentOnAccount();
  const tab = await mount(h(DashboardTabs, { myEvidence: [], myEvaluations: [], activity: [], tokens: [], signingConfigured: true, sealOnly: false }));
  const buttons = tab.buttons('Sources');
  assert.equal(buttons.length, 1, `premise: the dashboard has a Sources tab: ${tab.text().slice(0, 300)}`);
  await tab.click(buttons[0]);
  const text = tab.text();
  assert.ok(text.includes('Your data sources are set in Data source settings.'), `the tab does not read item 41's sentence: ${text.slice(0, 400)}`);
  const links = tab.elements().filter((el) => el.type === 'a' && el.props.href === '/settings');
  assert.equal(links.length, 1, 'the tab has no one link to /settings');
  assert.equal(textOf(links[0]), 'Data source settings', 'the tab\'s link does not read "Data source settings"');
  assert.deepEqual(tab.elements().filter((el) => el.props.role === 'radiogroup' || (el.type === 'input' && el.props.type === 'radio')).map((el) => el.type), [], 'the tab still renders a control');
  assert.ok(!text.includes('Given on') && !text.includes('as it stood on'), 'the tab still renders the dates');
  assert.equal(tab.elements().filter((el) => el.type === 'button' && /withdraw/i.test(textOf(el))).length, 0, 'the tab still offers "Withdraw consent"');
  assert.equal(tab.elements().filter((el) => typeof el.props['data-notice'] === 'string').length, 0, 'the tab still renders a notice');
  tab.unmount();
});

/** T13 (#632 G7): each source's one reader name, written out. */
const READER_NAME: Record<string, string> = { socrata: 'Socrata', 'data-commons': 'Data Commons', 'boston-opencontext': 'Boston OpenContext', 'nyc-charter': 'NYC Charter, Laws and Rules' };


/** An ISO date (or timestamp) as the Sources tab writes it, in words: "2026-10-20" → "20 October 2026" (UX pass row 14). */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inWords = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

test('criterion 3 (the Settings overlay): Data sources shows every source\'s state, the date given, and the base version with its statement\'s date', async () => {
  const { tab, statement } = await sourcesTab();
  const text = tab.text();
  for (const [i, source] of (statement.sources as Array<{ sourceId: string; displayName: string }>).entries()) {
    const name = READER_NAME[source.sourceId];
    const rows = tab.elements().filter((el: HostElement) => el.props['data-source'] === source.sourceId);
    assert.equal(rows.length, 1, `the tab has no row for ${source.sourceId}`);
    const row = textOf(rows[0]);
    assert.ok(row.includes(name), `${source.sourceId}'s row does not name it`);
    // UX-2 P4b (M7): the overlay's row draws no "Name: State" line, so the state is read from its checked radio.
    assert.equal(checkedIn(rows[0]), i === 0 ? 'on' : 'off', `${source.sourceId}'s row does not show its state: ${row}`);
  }
  // UX pass row 14(a): both dates in words, and the base version's first 8 hex.
  assert.ok(text.includes(`Given on ${inWords(new Date().toISOString())}.`), `the tab does not show the date the consent was given, in words: ${text.slice(0, 400)}`);
  // S3 (#632 G7): the base version the consent refers to, not the statement hash.
  assert.ok(text.includes(`(version ${statement.version.slice(0, 8)})`), 'the tab does not show the base version the consent refers to');
  assert.ok(!text.includes(statementHash(statement).slice(0, 8)), 'the tab shows the statement hash');
  assert.ok(text.includes(`as it stood on ${inWords(statement.date)}`), 'the tab does not show the flows statement\'s date, in words');
  tab.unmount();
});

test('criterion 3 (the Settings overlay): after its revoke, /ask shows the card again', async () => {
  const { tab, net } = await sourcesTab();
  const withdraw = tab.elements().filter((el) => el.type === 'button' && /withdraw/i.test(textOf(el)));
  assert.equal(withdraw.length, 1, 'the Settings overlay has no withdraw control');
  await tab.click(withdraw[0]);
  assert.equal(net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'DELETE').length, 1, 'the revoke did not call DELETE');
  assert.ok(!sessions.rows.has(DB_ID), 'the account still holds a consent after the revoke');
  tab.unmount();

  net.clear();
  const ask = await mount(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
  const box = ask.elements().filter((el) => el.type === 'textarea');
  assert.equal(box.length, 1, 'premise: /ask has its question box');
  await ask.type(box[0], 'What was the median household income in the Bronx?');
  await ask.submit(ask.elements().filter((el) => el.type === 'form')[0]);
  assert.deepEqual(net.sent.filter((r) => QUERY_ROUTES.includes(r.path)).map((r) => r.path), [], '/ask sent the question after the consent was withdrawn');
  assert.ok(ask.buttons('Allow').length === 1 && ask.buttons("Don't allow").length === 1, `/ask shows no card after the revoke: ${ask.text().slice(0, 300)}`);
  ask.unmount();
});

test('criterion 5 (the Settings overlay): unset, Data sources omits the guide link and says this site names no guide', async () => {
  const { tab } = await sourcesTab();
  assert.ok(copy?.NO_GUIDE_SENTENCE, `${COPY} exports no NO_GUIDE_SENTENCE`);
  assert.ok(tab.text().includes(copy!.NO_GUIDE_SENTENCE), 'with no guide address, the tab does not say so');
  assert.ok(!tab.elements().some((el) => el.type === 'a' && el.props.href === GUIDE));
  tab.unmount();
});

test('criterion 5 (the Settings overlay): set, Data sources links to the deployment guide', async () => {
  process.env.SITE_DEPLOYMENT_GUIDE_URL = GUIDE;
  try {
    const { tab } = await sourcesTab();
    assert.equal(tab.elements().filter((el) => el.type === 'a' && el.props.href === GUIDE).length, 1, 'the tab does not link to the configured guide');
    tab.unmount();
  } finally {
    delete process.env.SITE_DEPLOYMENT_GUIDE_URL;
  }
});
