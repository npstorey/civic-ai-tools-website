// R9 P4 (#680; #662, D5 = A of the UX pass): a consent given signed out is
// kept on the account at the first signed-in read, and the Sources panel says
// so once.
//
// THE RULE. A reader who answered the card signed out, then signed in, is not
// asked again: the consent route's GET, for a session with a `dbId`, no row
// and a cookie in force, writes the cookie's states into the account's row and
// says it did (`keptFromCookie`). The panel shows one status line under its
// lead, "Your choice is now kept on your account.", on that read only: the
// next read finds the row and carries no flag. A stale cookie writes nothing,
// and the panel asks as it does today.
//
// WHAT IS DRIVEN. The real panel on the surface harness, reading the REAL
// `/api/flows` and `/api/sources/consent` handlers, the account's row held in
// memory, and a cookie jar holding a consent built by the real encoder. The
// line's words are written out here, never read from `copy.ts`.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the read writes no row and answers
// no consent in force, so the panel shows the lead before a consent and no
// line. The cookie's states differ from the defaults (one Off, one Ask first),
// so a panel showing the defaults is seen. The panel's mount reads the
// consent twice (its notices mount once a consent is in force, and read
// again), and the second read carries no flag, so a page that showed the
// line only while the last read carried it would lose it at once: measured
// on the first green attempt, and asserted below.
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
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';
process.env.DATABASE_URL = 'fixture-database-address';

const ORIGIN = 'https://site.fixture.example';
const LINE = 'Your choice is now kept on your account.';
const DB_ID = '46464646-4646-4464-8464-464646464646';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Panel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const { encodeConsentCookie, consentDate, CONSENT_COOKIE_NAME } = await load('lib/sources/consent.ts');
/** By a specifier typed `string`, so the red commit type-checks without the constant. */
const COPY: string = '@/lib/sources/copy';
const copy = (await import(COPY).catch(() => null)) as Mod | null;

type StatementLike = { version: string; sources: Array<{ sourceId: string; version: string }> };

/** A signed-in reader with a database account and no row, whose browser holds a consent cookie (stale where `flows` says). */
async function signedInWithCookie(flows?: string): Promise<{ net: ReturnType<typeof installFetch>; states: Record<string, string> }> {
  sessions.server = { user: { id: 'gh-fixture-p4', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  sessions.rows.clear();
  const net = installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  const statement = (await buildFlowsStatement()) as StatementLike;
  const ids = statement.sources.map((s) => s.sourceId);
  assert.ok(ids.length >= 2, `premise: two configured sources, got ${ids.join(', ')}`);
  const states = Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 'off' : i === 1 ? 'ask-first' : 'on']));
  net.jar.set(CONSENT_COOKIE_NAME, encodeConsentCookie({
    v: 1,
    flows: flows ?? statement.version,
    states: Object.fromEntries(statement.sources.map((s) => [s.sourceId, { state: states[s.sourceId], since: consentDate(), version: s.version }])),
  }));
  return { net, states };
}

const keptLines = (panel: Surface): HostElement[] => panel.elements().filter((el) => el.props.role === 'status' && textOf(el) === LINE);
const checked = (panel: Surface, sourceId: string): string | undefined =>
  panel.elements().find((el) => el.type === 'input' && el.props.name === `source-state-${sourceId}` && el.props.checked === true)?.props.value as string | undefined;

test('R9 P4 criterion 3: the line is the ruled sentence, exactly', () => {
  assert.ok(copy, `${COPY} does not load`);
  assert.equal(copy!.PANEL_KEPT_ON_ACCOUNT, LINE, `${COPY} exports no PANEL_KEPT_ON_ACCOUNT reading the ruled sentence`);
});

test('R9 P4 criterion 1: the first signed-in read keeps the cookie\'s choice on the account, and the panel says so once, under its lead', async () => {
  const { net, states } = await signedInWithCookie();
  const cookieBefore = net.jar.get(CONSENT_COOKIE_NAME);
  const panel = await mount(h(Panel));
  const lines = keptLines(panel);
  assert.equal(lines.length, 1, `the panel does not show the line once: ${panel.text().slice(0, 400)}`);
  assert.equal(textOf(lines[0]), LINE);
  assert.equal(panel.text().split(LINE).length - 1, 1, 'the line\'s words appear more than once');
  // The panel's own mount reads twice: the notices mount once the consent is in force, and read again.
  // The second read finds the row and carries no flag; the page keeps the line until a write.
  assert.deepEqual(net.sent.filter((r) => r.path === '/api/sources/consent').map((r) => r.method), ['GET', 'GET'], 'the mount did not read the consent twice, so the line was not seen surviving a read without the flag');
  const markup = panel.markup();
  const lead = markup.indexOf('Set each data source to On, Ask first or Off. Your choice applies from your next question.');
  assert.ok(lead >= 0, 'premise: the panel shows the lead for a consent in force');
  assert.ok(lead < markup.indexOf(LINE) && markup.indexOf(LINE) < markup.indexOf('<li'), 'the line is not under the lead, above the rows');
  assert.ok(sessions.rows.has(DB_ID), 'the read wrote no row');
  for (const [id, state] of Object.entries(states)) assert.equal(checked(panel, id), state, `${id} does not show the cookie's state`);
  assert.equal(net.jar.get(CONSENT_COOKIE_NAME), cookieBefore, 'the read changed or cleared the cookie');

  // The next read on the same page (after a state change) finds the row: no line.
  const firstId = Object.keys(states)[0];
  const on = panel.elements().find((el) => el.type === 'input' && el.props.name === `source-state-${firstId}` && el.props.value === 'on');
  assert.ok(on, 'premise: an On choice for the first source');
  await panel.check(on!);
  assert.equal(keptLines(panel).length, 0, 'the line is still shown after the next read');
  assert.ok(!panel.text().includes(LINE), 'the line\'s words are still on the panel');
  panel.unmount();

  // A later page load: the row is read, and nothing says it was just kept.
  const again = await mount(h(Panel));
  assert.equal(keptLines(again).length, 0, 'the line came back on a later read');
  assert.ok(!again.text().includes(LINE));
  assert.equal(checked(again, firstId), 'on', 'premise: the later read shows the row');
  again.unmount();
});

test('R9 P4 criterion 1: a stale cookie writes nothing, and the panel asks as it does today, with no line', async () => {
  await signedInWithCookie('a'.repeat(64));
  const panel = await mount(h(Panel));
  assert.equal(keptLines(panel).length, 0, 'a stale cookie shows the line');
  assert.ok(!panel.text().includes(LINE));
  assert.equal(sessions.rows.size, 0, 'a stale cookie wrote a row');
  assert.equal(panel.buttons('Withdraw consent').length, 0, 'a stale cookie is shown as a consent in force');
  panel.unmount();
});
