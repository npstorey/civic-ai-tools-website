// UX-2 P4b, criterion 2: `/settings` renders the Settings overlay, signed in and
// signed out (F2 = A as relay 8 amends it).
//
// THE OVERLAY. A modal dialog headed "Settings" (X22a, X22b) with a close
// control and two sub-pages, a tab pair: "Data sources" (item 45), shown first,
// and "About these settings" (items 6-7). The arrow keys, Home and End move
// between the tabs (`v4-notes-read.md:49-67`).
//   - Data sources: the lede (X22b signed in, item 19 signed out); one row per
//     configured source with `SourceStateControl` (one `role="radiogroup"`),
//     "More about this source", and the Ask-first line under the panel's own
//     condition (item 54 only in-loop with the store); the search (item 17)
//     over each row's name and "what" line, with its count (item 24) and empty
//     line (item 22); the local-only offer; the privacy link. Item 33: the
//     Socrata row reads "Socrata", the name `readerSourceName` gives.
//   - A change writes `PUT /api/sources/consent` with every configured source's
//     state and the flows version: on the account signed in, in the cookie
//     signed out, as the panel writes them.
//   - About these settings: `PANEL_LEAD`, item 43's words for this instance, and
//     the privacy link.
// The states, dates, notices and withdrawal that moved from the dashboard's tab
// are read in `src/components/dashboard/sources-tab*.test.ts`.
//
// WHAT IS DRIVEN. The overlay (`SettingsOverlay.tsx`) on the surface harness,
// with the real consent and flows routes behind it and the decision route's
// GET for the routing mode. Three sources are configured, so a search can
// leave one, and a write of one state alone is told apart from all of them.
//
// BLIND SPOTS, stated. No layout, focus or browser events: Escape, the
// backdrop, focus return and the Tab trap are the instrument's and the
// owner's staging read (criteria 8 and 9); the arrow keys are read as the
// tabs' `onKeyDown`. The direct load's close (a soft navigation to the host's
// front door) is unmeasured in this leg.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the overlay is a stub that renders
// nothing.
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
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, '@vercel/kv': FAKE_VERCEL_KV_MODULE });

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST',
  'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SOURCE_ROUTING', 'KV_REST_API_URL',
  'KV_REST_API_TOKEN', 'DATABASE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
process.env.RATE_LIMIT_SECRET = 'fixture';
(globalThis as unknown as { __w2DecisionKv: FakeDecisionKv }).__w2DecisionKv = new FakeDecisionKv();

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
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { readConsentCookie } = await load('lib/sources/consent.ts');
const { readerSourceName } = await load('lib/sources/source-name.ts');
const copy = await load('lib/sources/copy.ts');

// The ruled words this file reads (the research check's text; `p4b-ruled-words.test.ts` pins the constants).
const HEADING = 'Settings';
const LEDE_ACCOUNT = 'Your data sources and your consent, kept on your account. A change applies from your next question.';
const LEDE_COOKIE = 'Your data sources and your consent, kept in a cookie for this browser session. A change applies from your next question.';
const TAB_DATA_SOURCES = 'Data sources';
const TAB_ABOUT = 'About these settings';
const SEARCH_LABEL = 'Search data sources';
const NO_MATCH = 'No data source matches.';
const ABOUT_KEPT_WITH = 'If you are signed in, your consent is kept on your account. If not, it is kept in a cookie until this browser session ends. The privacy page names the cookie.';
const ABOUT_KEPT_WITHOUT = 'Your consent is kept in a cookie until this browser session ends. The privacy page names the cookie.';
const ASK_FIRST_WITH_PAUSE = "Ask first: nothing is sent to this source until you turn it On, here or when the site asks you during a question. If you choose Allow then, it stays On for later questions. If you choose Don't allow, it is turned Off.";

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

const DB_ID = '5e775e77-5e77-4e77-8e77-5e775e775e77';
const SIGNED_IN = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};
const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};

/** Every host element under `node` (the node itself excluded). */
function within(node: HostElement): HostElement[] {
  const found: HostElement[] = [];
  const walk = (child: unknown): void => {
    if (Array.isArray(child)) { for (const c of child) walk(c); return; }
    if (child === null || typeof child !== 'object' || !('props' in (child as object))) return;
    const el = child as HostElement;
    if (typeof el.type === 'string') found.push(el);
    walk((el.props as { children?: unknown }).children);
  };
  walk((node.props as { children?: unknown }).children);
  return found;
}

/** A consent in force through the real PUT: every source as `states` says, else On. */
async function consentWith(states: Record<string, string> = {}): Promise<Mod> {
  const statement = await buildFlowsStatement();
  const all = Object.fromEntries((statement.sources as Mod[]).map((s) => [s.sourceId, states[s.sourceId] ?? 'on']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
  return statement;
}

async function overlay(props: Record<string, unknown> = {}): Promise<Surface> {
  return mount(h(SettingsOverlay, props));
}

const dialogOf = (s: Surface): HostElement => {
  const dialogs = s.elements().filter((el) => el.props.role === 'dialog');
  assert.equal(dialogs.length, 1, `the overlay renders no one role="dialog": ${s.text().slice(0, 300)}`);
  return dialogs[0];
};
const tabsOf = (s: Surface): HostElement[] => s.elements().filter((el) => el.props.role === 'tab');
const rowsOf = (s: Surface): HostElement[] => s.elements().filter((el) => typeof el.props['data-source'] === 'string');
const searchOf = (s: Surface): HostElement => {
  const found = s.elements().filter((el) => el.type === 'input' && (el.props['aria-label'] === SEARCH_LABEL || el.props.type === 'search'));
  assert.equal(found.length, 1, `the overlay has no one search field: ${s.text().slice(0, 300)}`);
  return found[0];
};

// --- The dialog and its tab pair -----------------------------------------------------------------

test('UX-2 P4b criterion 2: signed in, /settings renders a modal dialog headed "Settings", with a close control, the signed-in lede and the tab pair, Data sources first', async () => {
  SIGNED_IN();
  sessions.rows.clear();
  answers();
  await consentWith();
  const s = await overlay();
  const dialog = dialogOf(s);
  assert.equal(dialog.props['aria-modal'], 'true', 'the dialog is not modal');
  const headings = within(dialog).filter((el) => /^h[1-3]$/.test(el.type) && textOf(el) === HEADING);
  assert.equal(headings.length, 1, 'the dialog is not headed "Settings"');
  assert.ok(within(dialog).some((el) => el.type === 'button' && (el.props['aria-label'] === 'Close' || textOf(el) === 'Close')), 'the dialog has no close control');
  assert.ok(s.text().includes(LEDE_ACCOUNT), `signed in, the lede is not X22b's: ${s.text().slice(0, 300)}`);
  assert.ok(!s.text().includes(LEDE_COOKIE), 'signed in, the signed-out lede renders');
  assert.equal(s.elements().filter((el) => el.props.role === 'tablist').length, 1, 'the sub-pages are not one tablist');
  assert.deepEqual(tabsOf(s).map((t) => [textOf(t), t.props['aria-selected']]), [[TAB_DATA_SOURCES, true], [TAB_ABOUT, false]], 'the tab pair is not Data sources (selected), then About these settings');
  s.unmount();
});

test('UX-2 P4b criterion 2: signed out, the overlay renders, with item 19\'s lede', async () => {
  ANON();
  answers();
  await consentWith();
  const s = await overlay();
  dialogOf(s);
  assert.ok(s.text().includes(LEDE_COOKIE), `signed out, the lede is not item 19's: ${s.text().slice(0, 300)}`);
  assert.ok(!s.text().includes(LEDE_ACCOUNT), 'signed out, the signed-in lede renders');
  s.unmount();
});

test('UX-2 P4b criterion 2: the arrow keys, Home and End move between the two tabs', async () => {
  ANON();
  answers();
  const s = await overlay();
  const selected = () => tabsOf(s).filter((t) => t.props['aria-selected'] === true).map((t) => textOf(t));
  assert.deepEqual(selected(), [TAB_DATA_SOURCES], 'premise: Data sources is selected first');
  // P8 Tabs handles the keys on its tablist (`Tabs.tsx`), where a key pressed on a focused tab arrives.
  const list = () => s.elements().find((el) => el.props.role === 'tablist')!;
  await s.key(list(), 'ArrowRight');
  assert.deepEqual(selected(), [TAB_ABOUT], 'ArrowRight did not move to About these settings');
  await s.key(list(), 'ArrowRight');
  assert.deepEqual(selected(), [TAB_DATA_SOURCES], 'ArrowRight from the last tab did not wrap to the first');
  await s.key(list(), 'End');
  assert.deepEqual(selected(), [TAB_ABOUT], 'End did not move to the last tab');
  await s.key(list(), 'Home');
  assert.deepEqual(selected(), [TAB_DATA_SOURCES], 'Home did not move to the first tab');
  await s.key(list(), 'ArrowLeft');
  assert.deepEqual(selected(), [TAB_ABOUT], 'ArrowLeft from the first tab did not wrap to the last');
  s.unmount();
});

// --- Data sources --------------------------------------------------------------------------------

test('UX-2 P4b criterion 2: Data sources holds one row per configured source, each with one radio group, "More about this source", and the Socrata row reads "Socrata" (item 33)', async () => {
  ANON();
  answers();
  const statement = await consentWith();
  const s = await overlay();
  const sources = statement.sources as Mod[];
  assert.equal(sources.length, 4, 'premise: four sources are configured');
  const rows = rowsOf(s);
  assert.deepEqual(rows.map((r) => r.props['data-source']), sources.map((x) => x.sourceId), 'the rows are not the configured sources, in order');
  for (const row of rows) {
    const source = sources.find((x) => x.sourceId === row.props['data-source'])!;
    const groups = within(row).filter((el) => el.props.role === 'radiogroup');
    assert.equal(groups.length, 1, `${source.sourceId}'s row has ${groups.length} radio groups`);
    assert.equal(groups[0].props['aria-label'], `${readerSourceName(source)}: On, Ask first or Off`);
    assert.ok(textOf(row).includes(copy.PANEL_ROW_MORE), `${source.sourceId}'s row has no "More about this source"`);
  }
  const socrata = textOf(rows.find((r) => r.props['data-source'] === 'socrata')!);
  assert.ok(socrata.startsWith('Socrata'), `the Socrata row does not read "Socrata": ${socrata.slice(0, 80)}`);
  assert.ok(!socrata.includes('(a Socrata portal)'), 'item 33\'s condition fails: the row must not read "(a Socrata portal)"');
  s.unmount();
});

test('UX-2 P4b criterion 2: signed out, a change writes PUT /api/sources/consent with every configured source\'s state and the flows version, kept in the cookie', async () => {
  ANON();
  const net = answers();
  const statement = await consentWith();
  const s = await overlay();
  const row = rowsOf(s).find((r) => r.props['data-source'] === 'boston-opencontext');
  assert.ok(row, `the overlay has no Boston row: ${s.text().slice(0, 300)}`);
  const off = within(row!).filter((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'off');
  assert.equal(off.length, 1, 'the Boston row has no Off choice');
  net.clear();
  await s.check(off[0]);
  await s.settle();
  const puts = net.sent.filter((r) => r.method === 'PUT' && r.path === '/api/sources/consent');
  assert.equal(puts.length, 1, `the change did not write one PUT (${puts.length})`);
  const body = JSON.parse(puts[0].body) as { states: Record<string, string>; flowsVersion: string };
  assert.deepEqual(body.states, { socrata: 'on', 'data-commons': 'on', 'boston-opencontext': 'off', 'nyc-record': 'on' }, 'the PUT does not carry every configured source\'s state');
  assert.equal(body.flowsVersion, statementHash(statement));
  const cookie = readConsentCookie(new Request(`${ORIGIN}/`, { headers: { cookie: [...net.jar].map(([k, v]) => `${k}=${v}`).join('; ') } }));
  assert.equal(cookie?.states?.['boston-opencontext']?.state, 'off', 'the cookie does not hold the change');
  s.unmount();
});

test('UX-2 P4b criterion 2: signed out, with a consent in the cookie, Data sources offers "Withdraw consent", as the panel does (item 40\'s withdraw sentence points every reader here)', async () => {
  ANON();
  const net = answers();
  await consentWith();
  const s = await overlay();
  assert.equal(s.buttons('Withdraw consent').length, 1, 'signed out, the overlay offers no withdrawal');
  await s.click(s.buttons('Withdraw consent')[0]);
  assert.equal(net.sent.filter((r) => r.method === 'DELETE' && r.path === '/api/sources/consent').length, 1, 'the withdrawal did not call DELETE');
  s.unmount();
});

test('UX-2 P4b criterion 2: the Ask-first line follows the panel\'s condition: item 54 in-loop with the store, ASK_FIRST_MEANS otherwise', async () => {
  const read: Record<string, string> = {};
  for (const [name, env] of [['in-loop with the store', { SOURCE_ROUTING: 'in-loop', KV_REST_API_URL: 'https://kv.fixture.example', KV_REST_API_TOKEN: 'fixture-kv-token' }], ['all-sources', {}]] as Array<[string, Record<string, string>]>) {
    Object.assign(process.env, env);
    try {
      ANON();
      answers();
      await consentWith({ 'boston-opencontext': 'ask-first' });
      const s = await overlay();
      const row = rowsOf(s).find((r) => r.props['data-source'] === 'boston-opencontext');
      const text = row ? textOf(row) : '';
      read[name] = text.includes(ASK_FIRST_WITH_PAUSE) ? 'item 54' : text.includes(copy.ASK_FIRST_MEANS) ? 'ASK_FIRST_MEANS' : 'none';
      s.unmount();
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  }
  assert.deepEqual(read, { 'in-loop with the store': 'item 54', 'all-sources': 'ASK_FIRST_MEANS' }, `the Ask-first line, by instance: ${JSON.stringify(read)}`);
});

test('UX-2 P4b criterion 2: the search narrows the rows by name, says how many are shown (item 24), and says when none matches (item 22)', async () => {
  ANON();
  answers();
  await consentWith();
  const s = await overlay();
  assert.equal(rowsOf(s).length, 4, 'premise: four rows before a search');
  await s.type(searchOf(s), 'boston');
  assert.deepEqual(rowsOf(s).map((r) => r.props['data-source']), ['boston-opencontext'], 'the search did not narrow the rows to Boston');
  assert.ok(s.text().includes('1 of 4 sources shown'), `the count line is not item 24's: ${s.text().slice(0, 400)}`);
  await s.type(searchOf(s), 'no-source-is-called-this');
  assert.equal(rowsOf(s).length, 0, 'a query matching nothing left rows');
  assert.ok(s.text().includes(NO_MATCH), 'the empty line is not item 22\'s');
  s.unmount();
});

test('UX-2 P4b criterion 2: Data sources carries the local-only offer and the privacy link', async () => {
  ANON();
  answers();
  await consentWith();
  const s = await overlay();
  assert.ok(s.text().includes(copy.LOCAL_ONLY_OFFER), 'Data sources has no local-only offer');
  assert.ok(s.text().includes(copy.NO_GUIDE_SENTENCE), 'with no guide address, Data sources does not say so');
  assert.ok(s.elements().some((el) => el.type === 'a' && el.props.href === '/privacy'), 'Data sources has no privacy link');
  s.unmount();
});

// --- About these settings ------------------------------------------------------------------------

for (const [name, database] of [['without accounts', false], ['with accounts', true]] as const) {
  test(`UX-2 P4b criterion 2 (${name}): About these settings renders PANEL_LEAD, item 43's words and the privacy link`, async () => {
    if (database) process.env.DATABASE_URL = 'postgres://fixture.invalid/fixture';
    try {
      ANON();
      answers();
      await consentWith();
      const s = await overlay();
      const about = tabsOf(s).find((t) => textOf(t) === TAB_ABOUT);
      assert.ok(about, `the overlay has no "${TAB_ABOUT}" tab`);
      await s.click(about!);
      const text = s.text();
      assert.ok(text.includes(copy.PANEL_LEAD), 'About these settings has no PANEL_LEAD');
      assert.ok(text.includes(database ? ABOUT_KEPT_WITH : ABOUT_KEPT_WITHOUT), `About these settings does not carry item 43's words ${name}: ${text.slice(0, 400)}`);
      assert.ok(!text.includes(database ? ABOUT_KEPT_WITHOUT : ABOUT_KEPT_WITH), 'About these settings carries the other instance\'s sentence');
      assert.ok(!text.includes(copy.KEPT_WITH_ACCOUNTS) && !text.includes(copy.KEPT_WITHOUT_ACCOUNTS), 'About these settings carries KEPT_*, whose "named below" names nothing here');
      assert.ok(!text.includes(ASK_FIRST_WITH_PAUSE), 'M4: item 54 renders on About, where its "here" points at nothing');
      assert.ok(s.elements().some((el) => el.type === 'a' && el.props.href === '/privacy'), 'About these settings has no privacy link');
      s.unmount();
    } finally {
      delete process.env.DATABASE_URL;
    }
  });
}

// --- The row-mounted pause card ------------------------------------------------------------------

test('UX-2 P4b criterion 2 (Task B, D): while a question waits on a source, its Data sources row mounts the pause card, with the three buttons', async () => {
  ANON();
  answers();
  const statement = await consentWith({ 'boston-opencontext': 'ask-first' });
  const bus = await load('components/sources/useSourceConsent.ts');
  const kv = (globalThis as unknown as { __w2DecisionKv: FakeDecisionKv }).__w2DecisionKv;
  // A decision key's shape (32 hex), built the way the pause suites build theirs.
  const pauseKey = `c0de${'0001'}0123456789abcdef01234567`;
  await kv.set(`consent-decision:${pauseKey}`, { sourceId: 'boston-opencontext' }, { ex: 600, nx: true });
  const now = Date.now();
  const boston = (statement.sources as Mod[]).find((x) => x.sourceId === 'boston-opencontext');
  bus.reportConsentPause({ key: pauseKey, source: boston, outbound: [], links: statement.links, expiresAt: new Date(now + 60_000).toISOString(), entryExpiresAt: new Date(now + 600_000).toISOString(), holds: true });
  const s = await overlay();
  const row = rowsOf(s).find((r) => r.props['data-source'] === 'boston-opencontext');
  assert.ok(row, `the overlay has no Boston row: ${s.text().slice(0, 300)}`);
  const cards = within(row!).filter((el) => el.props['data-part'] === 'consent-step');
  assert.equal(cards.length, 1, 'the Boston row mounts no pause card');
  assert.deepEqual(within(cards[0]).filter((el) => el.type === 'button').map((b) => textOf(b)), ['Allow', "Don't allow", 'Allow all data sources'], 'the row card\'s buttons');
  s.unmount();
  bus.cancelConsentPauses();
});
