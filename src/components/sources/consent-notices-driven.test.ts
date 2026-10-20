// R6 W3 (#632), criterion D2 (D2 = A, amendment 1): the notice.
//
// THE RULE. A reader whose consent is kept on the account (a session with a
// `dbId`, which exists only with a database) is told about a change since
// the statement the row holds that asks nothing — a recipient removed, or one
// that says it keeps less — by one line per change in the Sources panel and
// on the dashboard's Sources tab, dated by the row's `updatedAt`, until it is
// dismissed; dismissing saves the statement in force on the row and asks
// nothing. A change that needs the reader's answer again is never a notice:
// it is the card. A reader whose consent is in a cookie is asked again
// (the cookie keeps hashes only, D5 = A). With no database there is no
// notice, and the privacy page says nothing about one.
//
// WHAT IS DRIVEN. The real panel, the real dashboard tabs and the real home
// page on the surface harness, with the REAL consent endpoint and
// `/api/flows` behind them and the account's row held in memory. A row is
// written directly, holding a statement that differs from the one in force
// in one recipient: one MORE recipient than now (it was removed: a notice),
// or one FEWER (one was added: a re-ask).
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no panel, no tab, no
// notice and no dismissal.
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
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING',
  'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';
process.env.DATABASE_URL = 'fixture-database-address';

const ORIGIN = 'https://app.fixture.example';
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
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { encodeConsentCookie, CONSENT_COOKIE_NAME } = await load('lib/sources/consent.ts');
const facts = await load('lib/privacy-facts.ts');

/** The modules W3 adds, by specifiers typed `string`, so the red commit type-checks. */
const PANEL: string = '@/components/sources/SourcesPanel';
const COPY: string = '@/lib/sources/copy';
const panelModule = (await import(PANEL).catch(() => null)) as Mod | null;
const copy = (await import(COPY).catch(() => null)) as Mod | null;

const QUERY_ROUTES = ['/api/compare-stream', '/api/query-notebook', '/api/compare'];

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    ...Object.fromEntries(QUERY_ROUTES.map((p) => [p, async (request: Request) => {
      const decision = await consentInForce(request, sessions.server);
      if (!decision.ok) {
        return new Response(['withoutMcp', 'withMcp'].map((panel) => `data: ${JSON.stringify({ type: 'error', panel, message: decision.payload.error, code: decision.payload.code })}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }])),
  });
}

const DB_ID = '12121212-1212-4121-8121-121212121212';
const UPDATED = new Date('2026-10-20T08:00:00.000Z');
const CONSENTED = new Date('2026-10-01T08:00:00.000Z');

/** The row as a reader who consented against `held` would have it. */
function rowHolding(held: Mod, statement: Mod): void {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  sessions.rows.clear();
  sessions.rows.set(DB_ID, {
    userId: DB_ID,
    states: Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: '2026-10-01' }])),
    flowsHash: statementHash(held),
    flowsStatement: held,
    consentedAt: CONSENTED,
    updatedAt: UPDATED,
  });
}

/** A statement holding one recipient the instance no longer has: the one in force removed it. */
async function withRemovedRecipient(): Promise<{ held: Mod; statement: Mod }> {
  const statement = await buildFlowsStatement();
  const held = JSON.parse(JSON.stringify(statement));
  held.recipients.push({ id: 'sign-in:github', key: 'Sign-in provider (GitHub / OIDC) discovery, token and userinfo calls', role: 'sign-in', host: 'github.com', receives: 'a request for your account key, name and profile, when you sign in', keptBy: [{ holder: 'GitHub', keeps: 'metadata' }] });
  return { held, statement };
}

/** A statement lacking one recipient the instance now has: the one in force added it. */
async function withAddedRecipient(): Promise<{ held: Mod; statement: Mod }> {
  const statement = await buildFlowsStatement();
  const held = JSON.parse(JSON.stringify(statement));
  held.recipients = held.recipients.filter((r: { id: string }) => r.id !== 'function-logs');
  return { held, statement };
}

function noticeLines(surface: Surface): HostElement[] {
  return surface.elements().filter((el) => typeof el.props['data-notice'] === 'string');
}

function panel(): ComponentType {
  assert.ok(panelModule?.default, `no Sources panel: ${PANEL} does not exist`);
  return panelModule!.default as ComponentType;
}

test('criterion D2: a notify change shows its line in the panel, dated by the row\'s updatedAt', async () => {
  const Panel = panel();
  const { held, statement } = await withRemovedRecipient();
  rowHolding(held, statement);
  answers();
  const shown = await mount(h(Panel));
  const lines = noticeLines(shown);
  assert.equal(lines.length, 1, `the panel shows ${lines.length} notice lines: ${shown.text().slice(0, 400)}`);
  assert.match(textOf(lines[0]), /github\.com/, 'the line does not name what changed');
  assert.ok(shown.text().includes('2026-10-20'), 'the notice is not dated by the row\'s updatedAt');
  assert.equal(shown.buttons('Allow').length, 0, 'a notify change asked the reader again');
  shown.unmount();
});

test('criterion D2: the dashboard\'s Sources tab shows the same line', async () => {
  const { held, statement } = await withRemovedRecipient();
  rowHolding(held, statement);
  answers();
  const tabs = await mount(h(DashboardTabs, { myEvidence: [], myEvaluations: [], activity: [], tokens: [] }));
  const buttons = tabs.buttons('Sources');
  assert.equal(buttons.length, 1, 'the dashboard has no Sources tab');
  await tabs.click(buttons[0]);
  assert.equal(noticeLines(tabs).length, 1, `the tab shows no notice: ${tabs.text().slice(0, 400)}`);
  tabs.unmount();
});

test('criterion D2: after dismissal no line remains, and the row holds the statement in force', async () => {
  const Panel = panel();
  const { held, statement } = await withRemovedRecipient();
  rowHolding(held, statement);
  const net = answers();
  const shown = await mount(h(Panel));
  assert.ok(copy?.NOTICE_DISMISS, `${COPY} exports no NOTICE_DISMISS`);
  await shown.click(shown.button(copy!.NOTICE_DISMISS));
  assert.equal(net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'PATCH').length, 1, 'dismissing wrote nothing');
  assert.equal(noticeLines(shown).length, 0, 'the line is still shown after dismissal');
  const row = sessions.rows.get(DB_ID) as { flowsHash: string } | undefined;
  assert.equal(row?.flowsHash, statementHash(statement), 'the row does not hold the statement in force');
  shown.unmount();
  const again = await mount(h(Panel));
  assert.equal(noticeLines(again).length, 0, 'the notice came back after dismissal');
  again.unmount();
});

test('criterion D2: a re-ask change shows the card instead of a line', async () => {
  const Panel = panel();
  const { held, statement } = await withAddedRecipient();
  rowHolding(held, statement);
  const net = answers();
  const page = await mount(h(Home));
  assert.equal(noticeLines(page).length, 0, 'a re-ask change shows a notice line');
  const box = page.elements().filter((el) => el.type === 'textarea');
  await page.type(box[0], 'What was the median household income in the Bronx?');
  await page.submit(page.elements().filter((el) => el.type === 'form')[0]);
  assert.deepEqual(net.sent.filter((r) => QUERY_ROUTES.includes(r.path)).map((r) => r.path), [], 'the question was sent on a consent that needs asking again');
  assert.ok(page.buttons('Allow').length === 1 && page.buttons('Not now').length === 1, `a re-ask change shows no card: ${page.text().slice(0, 300)}`);
  page.unmount();
  const shown = await mount(h(Panel));
  assert.equal(noticeLines(shown).length, 0, 'a re-ask change shows a notice line in the panel');
  shown.unmount();
});

test('criterion D2: a reader whose consent is in a cookie is asked again, and is shown no line', async () => {
  const Panel = panel();
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const statement = await buildFlowsStatement();
  const net = answers();
  // A cookie given against an older base version: the recipient list has changed since.
  net.jar.set(CONSENT_COOKIE_NAME, encodeConsentCookie({
    v: 1,
    flows: 'a'.repeat(64),
    states: Object.fromEntries(statement.sources.map((s: { sourceId: string; version: string }) => [s.sourceId, { state: 'on', since: '2026-10-01', version: s.version }])),
  }));
  const shown = await mount(h(Panel));
  assert.equal(noticeLines(shown).length, 0, 'a cookie reader is shown a notice line');
  shown.unmount();
  const page = await mount(h(Home));
  const box = page.elements().filter((el) => el.type === 'textarea');
  await page.type(box[0], 'What was the median household income in the Bronx?');
  await page.submit(page.elements().filter((el) => el.type === 'form')[0]);
  assert.deepEqual(net.sent.filter((r) => QUERY_ROUTES.includes(r.path)), [], 'a cookie reader was not asked again');
  assert.ok(page.buttons('Allow').length === 1, 'a cookie reader is shown no card');
  page.unmount();
});

/** The privacy page's text, as its statements read. */
function privacyText(): string {
  const sections = facts.buildPrivacySections(null) as Array<{ heading: string; statements: Array<{ parts: Array<string | { text?: string; code?: string }> }> }>;
  return sections.flatMap((s) => [s.heading, ...s.statements.map((st) => st.parts.map((p) => (typeof p === 'string' ? p : p.text ?? p.code ?? '')).join(''))]).join(' ');
}

test('criterion D2: with no database, no line and no notice text; with one, the privacy page says where the notice appears', () => {
  assert.ok(copy?.NOTIFY_WITH_ACCOUNTS, `${COPY} exports no NOTIFY_WITH_ACCOUNTS`);
  const withDb = privacyText();
  assert.ok(withDb.includes(copy!.NOTIFY_WITH_ACCOUNTS), 'with a database, the privacy page does not say the reader is told');
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const without = privacyText();
    assert.ok(!without.includes(copy!.NOTIFY_WITH_ACCOUNTS), 'with no database, the privacy page promises a notice no reader can get');
    assert.ok(!/we tell you/i.test(without), 'with no database, the privacy page says "we tell you"');
  } finally {
    process.env.DATABASE_URL = saved;
  }
});
