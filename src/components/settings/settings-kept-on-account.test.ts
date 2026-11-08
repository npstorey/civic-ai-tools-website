// UX-2 P4b: "Your choice is now kept on your account." moves from the removed
// Sources panel into the Settings overlay (#729 comment 6728493444), with no
// new words, under the condition the panel used (R9 P4, #662; D5 = A).
//
// THE CONDITION. The consent route's GET, for a session with a `dbId`, no row
// and a cookie in force, writes the cookie's states into the account's row and
// says it did (`keptFromCookie`). The overlay then shows the line once, as a
// status line under its lede, and the page keeps it until the reader's next
// change (the consent bus keeps the flag across the overlay's own second
// read). A later page's read finds the row and shows none.
//
// THE DECOYS. A stale cookie writes nothing and shows no line; an account that
// already holds its row shows no line; a signed-out reader whose consent is in
// a cookie shows no line.
//
// WHAT IS DRIVEN. The real overlay on the surface harness, reading the REAL
// `/api/flows` and `/api/sources/consent` handlers, the account's row held in
// memory, and a cookie jar holding a consent built by the real encoder. The
// line's words are written out here.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the overlay renders no such line.
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
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';
process.env.DATABASE_URL = 'fixture-database-address';

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${ORIGIN}/settings`, origin: ORIGIN, pathname: '/settings' }, scrollTo() {} },
  document: { ...target },
});

const LINE = 'Your choice is now kept on your account.';
const DB_ID = '47474747-4747-4474-8474-474747474747';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const { encodeConsentCookie, consentDate, CONSENT_COOKIE_NAME } = await load('lib/sources/consent.ts');

type StatementLike = { version: string; sources: Array<{ sourceId: string; version: string }> };

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

/** A cookie in force (stale where `flows` says), for a reader `who` is: signed in with a database account and no row, or signed out. */
async function withCookie(who: 'account-no-row' | 'signed-out', flows?: string): Promise<{ net: ReturnType<typeof installFetch>; ids: string[] }> {
  if (who === 'account-no-row') {
    sessions.server = { user: { id: 'gh-fixture-p4bh', dbId: DB_ID } };
    sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  } else {
    sessions.server = null;
    sessions.client = { status: 'unauthenticated', data: null };
  }
  sessions.rows.clear();
  const net = answers();
  const statement = (await buildFlowsStatement()) as StatementLike;
  const ids = statement.sources.map((s) => s.sourceId);
  net.jar.set(CONSENT_COOKIE_NAME, encodeConsentCookie({
    v: 1,
    flows: flows ?? statement.version,
    states: Object.fromEntries(statement.sources.map((s, i) => [s.sourceId, { state: i === 0 ? 'off' : 'on', since: consentDate(), version: s.version }])),
  }));
  return { net, ids };
}

const dialogOf = (s: Surface): HostElement => {
  const found = s.elements().filter((el) => el.props.role === 'dialog');
  assert.equal(found.length, 1, `premise: one overlay dialog, found ${found.length}`);
  return found[0];
};
const keptLines = (s: Surface): HostElement[] => s.elements().filter((el) => el.props.role === 'status' && textOf(el) === LINE);

test('UX-2 P4b: the first signed-in read keeps the cookie\'s choice on the account, and the overlay says so once, under its lede', async () => {
  const { ids } = await withCookie('account-no-row');
  const overlay = await mount(h(SettingsOverlay, { mount: 'intercepted' }));
  dialogOf(overlay);
  assert.ok(sessions.rows.has(DB_ID), 'premise: the read kept the cookie on the account');
  const lines = keptLines(overlay);
  assert.equal(lines.length, 1, `the overlay does not show the line once: ${overlay.text().slice(0, 500)}`);
  assert.equal(overlay.text().split(LINE).length - 1, 1, 'the line\'s words appear more than once');
  const markup = overlay.markup();
  const lede = markup.indexOf('Your data sources and your consent, kept on your account.');
  assert.ok(lede >= 0, 'premise: the overlay shows its account lede');
  assert.ok(lede < markup.indexOf(LINE) && markup.indexOf(LINE) < markup.indexOf('<li'), 'the line is not under the lede, above the rows');

  // The page keeps it until the reader's next change.
  const on = overlay.elements().find((el) => el.type === 'input' && String(el.props.name).startsWith(`source-state-${ids[0]}-`) && el.props.value === 'on');
  assert.ok(on, 'premise: an On choice for the first source');
  await overlay.check(on!);
  assert.equal(keptLines(overlay).length, 0, 'the line is still shown after the reader\'s next change');
  overlay.unmount();

  // A later page: the row is read, and nothing says it was just kept.
  const again = await mount(h(SettingsOverlay, { mount: 'intercepted' }));
  assert.equal(keptLines(again).length, 0, 'the line came back on a later read');
  again.unmount();
});

test('UX-2 P4b, decoy: a stale cookie writes nothing, and the overlay shows no line', async () => {
  await withCookie('account-no-row', 'a'.repeat(64));
  const overlay = await mount(h(SettingsOverlay, { mount: 'intercepted' }));
  dialogOf(overlay);
  assert.equal(sessions.rows.size, 0, 'premise: a stale cookie wrote no row');
  assert.equal(keptLines(overlay).length, 0, 'a stale cookie shows the line');
  assert.ok(!overlay.text().includes(LINE));
  overlay.unmount();
});

test('UX-2 P4b, decoy: signed out with a cookie in force, the overlay shows no line', async () => {
  await withCookie('signed-out');
  const overlay = await mount(h(SettingsOverlay, { mount: 'intercepted' }));
  dialogOf(overlay);
  assert.ok(overlay.buttons('Withdraw consent').length === 1, `premise: the cookie's consent is in force: ${overlay.text().slice(0, 300)}`);
  assert.equal(keptLines(overlay).length, 0, 'a signed-out reader is told the choice is kept on an account');
  overlay.unmount();
});
