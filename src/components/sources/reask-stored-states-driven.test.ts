// R6 W3 (#632, contract amendment 2, criterion 4; T7): on a re-ask, the
// panel shows the states Allow will write.
//
// THE RULE. The card says "Allow" turns on the sources the panel shows as On.
// So the panel and Allow read one set of states, from one function: with
// nothing stored, the defaults (the manifest's `consentDefault`, D6);
// otherwise each source's stored state, and Ask first for a configured source
// with none. On a re-ask (a consent stored against a statement that has since
// changed in a way it does not cover) the reader's stored states are kept.
//
// WHAT IS DRIVEN. The real Sources panel and the real consent card mounted
// together on the surface harness, so they share the page's one consent
// store, with the REAL `/api/flows` and consent handlers behind them: once for
// a cookie (anonymous) and once for an account's row.
//
// WHAT MAKES IT ABLE TO FAIL. Every source's default is On. The stored states
// hold one source Off and one On, and none for the third configured source:
// shown as the defaults, the Off source and the source with none both read On.
// While a consent is in force the panel already reads the stored states, so
// that case alone is green at the base and is not this test.
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
  'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE',
  'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
  'SITE_OPERATOR_STATES_NO_TRAINING', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';
process.env.DATABASE_URL = 'fixture-database-address';

const ORIGIN = 'https://site.fixture.example';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Panel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const Card = (await load('components/sources/ConsentCard.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { encodeConsentCookie, CONSENT_COOKIE_NAME } = await load('lib/sources/consent.ts');
const { CIVIC_MANIFEST } = (await import('@typedstandards/civic-typed-router')) as unknown as { CIVIC_MANIFEST: Array<{ sourceId: string; consentDefault?: string }> };

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

const DB_ID = '51515151-5151-4151-8151-515151515151';

/** Stored: Socrata Off, Data Commons On; NYC Charter, configured, has none. */
const STORED: Record<string, 'on' | 'off'> = { socrata: 'off', 'data-commons': 'on' };
const NONE = 'nyc-charter';
const EXPECTED = { socrata: 'off', 'data-commons': 'on', 'nyc-charter': 'ask-first' };

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const child of node) yield* within(child); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

/** The state each row's control shows: its one checked radio. */
function shownStates(panel: Surface): Record<string, string> {
  const rows = panel.elements().filter((el) => typeof el.props['data-source'] === 'string');
  return Object.fromEntries(rows.map((row) => {
    const checked = [...within(row)].filter((el) => el.type === 'input' && el.props.type === 'radio' && el.props.checked === true);
    assert.equal(checked.length, 1, `${String(row.props['data-source'])}'s control has ${checked.length} choices checked`);
    return [String(row.props['data-source']), String(checked[0].props.value)];
  }));
}

async function premises(): Promise<Mod> {
  const statement = await buildFlowsStatement();
  assert.deepEqual(statement.sources.map((s: Mod) => s.sourceId), ['socrata', 'data-commons', 'nyc-charter'], 'premise: three sources are configured');
  for (const id of Object.keys(EXPECTED)) {
    assert.equal(CIVIC_MANIFEST.find((e) => e.sourceId === id)?.consentDefault, 'on', `premise: ${id}'s default is On, so a default shown in place of a stored state can be seen`);
  }
  return statement;
}

/** The panel's states, then the card's Allow, read from the PUT it sends. */
async function panelThenAllow(net: ReturnType<typeof answers>): Promise<{ shown: Record<string, string>; written: Record<string, string> }> {
  const consent = await (await fetch('/api/sources/consent', { method: 'GET' })).json() as Mod;
  assert.equal(consent.inForce, false, 'premise: the stored consent is asked again');
  assert.deepEqual(Object.keys(consent.states ?? {}).sort(), Object.keys(STORED).sort(), `premise: the GET returns the stored states, none for ${NONE}`);
  net.clear();
  const panel = await mount(h(Panel));
  const card = await mount(h(Card, {}));
  const shown = shownStates(panel);
  await card.click(card.button('Allow'));
  const writes = net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'PUT');
  assert.equal(writes.length, 1, 'Allow wrote no consent');
  const written = (JSON.parse(writes[0].body) as { states: Record<string, string> }).states;
  card.unmount();
  panel.unmount();
  return { shown, written };
}

test('criterion 4 (T7), a cookie asked again: the panel shows each stored state and Ask first for the source with none, and Allow writes the same', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const statement = await premises();
  const net = answers();
  // Given against an older base version: the base has changed since, so the cookie is asked again.
  net.jar.set(CONSENT_COOKIE_NAME, encodeConsentCookie({
    v: 1,
    flows: 'c'.repeat(64),
    states: Object.fromEntries(Object.entries(STORED).map(([id, state]) => [id, { state, since: '2026-10-01', version: statement.sources.find((s: Mod) => s.sourceId === id).version }])),
  }));
  const { shown, written } = await panelThenAllow(net);
  assert.deepEqual(shown, EXPECTED, 'the panel does not show the stored states, with Ask first for the source with none');
  assert.deepEqual(written, shown, 'Allow wrote states other than the ones the panel showed');
});

test('criterion 4 (T7), an account\'s row asked again: the panel shows each stored state and Ask first for the source with none, and Allow writes the same', async () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  const statement = await premises();
  // Held against a statement that lacked this site's hosting logs: one was added since, so the row is asked again.
  const held = JSON.parse(JSON.stringify(statement)) as Mod;
  held.recipients = held.recipients.filter((r: Mod) => r.role !== 'function-logs');
  sessions.rows.clear();
  sessions.rows.set(DB_ID, {
    userId: DB_ID,
    states: Object.fromEntries(Object.entries(STORED).map(([id, state]) => [id, { state, since: '2026-10-01' }])),
    flowsHash: statementHash(held),
    flowsStatement: held,
    consentedAt: new Date('2026-10-01T08:00:00.000Z'),
    updatedAt: new Date('2026-10-01T08:00:00.000Z'),
  });
  const net = answers();
  const { shown, written } = await panelThenAllow(net);
  assert.deepEqual(shown, EXPECTED, 'the panel does not show the stored states, with Ask first for the source with none');
  assert.deepEqual(written, shown, 'Allow wrote states other than the ones the panel showed');
});
