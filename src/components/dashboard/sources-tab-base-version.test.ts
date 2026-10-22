// R6 W3 (#632, contract amendment 2, criterion 3; S3 = A): the version a
// consent refers to is the statement's BASE version, not its hash.
//
// THE RULE. The consent GET (`src/app/api/sources/consent/route.ts`) returns
// the base version of the statement the consent refers to, as
// `consentedBaseVersion`: for a row, the stored statement's; for a cookie in
// force, the current statement's. The dashboard's Sources tab shows that
// version's first 12 characters where it showed the statement hash's. Under
// the change log's configuration (`docs/flows-changelog.md`, the 2026-10-19
// entry) the tab reads `2489d0dda25a` whether `SITE_DEPLOYMENT_GUIDE_URL`
// (S1) and `SITE_OPERATOR_STATES_NO_TRAINING` (S2) are set or unset: they
// move the hash, never the base version. Other configurations have other
// versions (the log's "How to read the versions").
//
// THE FIELD'S NAME, `consentedBaseVersion`, is this test's choice; the
// contract names the value, not the field.
//
// WHAT IS DRIVEN. The real dashboard tabs on the surface harness, with the
// REAL `/api/flows` and consent handlers behind them; the consent written
// through the real PUT; the account's row held in memory.
//
// WHAT MAKES IT ABLE TO FAIL. The hash and the base version differ under
// every one of the four configurations, and the tab is read for both. For a
// row, the stored statement differs from the one in force by notify changes
// only (so it is still in force) and has a base version of its own, so "the
// stored statement's" and "the current statement's" can be told apart.
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
  type Surface,
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, 'next/script': 'export default function Script() { return null; }' });

/** The change log's configuration (`src/lib/flows/changelog.test.ts`'s `FIRST_ENTRY_ENV` and `CLEARED`). */
const FIRST_ENTRY_ENV: Record<string, string> = {
  SOCRATA_MCP_URL: 'https://socrata-mcp.civicaitools.org',
  NYC_CHARTER_HOSTING: 'sandbox',
  VERCEL_ENV: 'production',
  GITHUB_CLIENT_ID: 'placeholder-client-id',
  GITHUB_CLIENT_SECRET: 'placeholder-client-value',
  EXECUTOR_DRIVER: 'vercel-sandbox',
  NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible',
  NEXT_PUBLIC_ANALYTICS_ID: 'placeholder-analytics-id',
};
const CLEARED = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'APP_HOST', 'NEXTAUTH_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
];
/** The entry's base version (the log's 2026-10-19 and 2026-10-20 entries). */
const BASE_VERSION = '2489d0dda25a79b3286c380379c6d2c8202e66a77fe5b4f493f558a7ce190f9c';
const S1_ADDRESS = 'https://github.com/npstorey/civic-ai-tools-website/blob/main/docs/deploy.md';

const CONFIGS: Array<{ name: string; env: Record<string, string> }> = [
  { name: 'S1 and S2 unset', env: {} },
  { name: 'S2 set', env: { SITE_OPERATOR_STATES_NO_TRAINING: '1' } },
  { name: 'S1 set', env: { SITE_DEPLOYMENT_GUIDE_URL: S1_ADDRESS } },
  { name: 'S1 and S2 set', env: { SITE_DEPLOYMENT_GUIDE_URL: S1_ADDRESS, SITE_OPERATOR_STATES_NO_TRAINING: '1' } },
];

async function under<T>(env: Record<string, string>, body: () => Promise<T> | T): Promise<T> {
  const names = [...Object.keys(FIRST_ENTRY_ENV), ...CLEARED, 'DATABASE_URL'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of CLEARED) delete process.env[name];
  Object.assign(process.env, FIRST_ENTRY_ENV, { DATABASE_URL: 'fixture-database-address' }, env);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const ORIGIN = 'https://app.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${ORIGIN}/dashboard`, origin: ORIGIN, pathname: '/dashboard' }, scrollTo() {} },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash, computeBaseVersion } = await load('lib/flows/statement.ts');

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

const DB_ID = '41414141-4141-4141-8141-414141414141';
const SIGNED_IN_DB = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};
const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};

async function put(statement: Mod): Promise<void> {
  const states = Object.fromEntries((statement.sources as Mod[]).map((s) => [s.sourceId, 'on']));
  const response = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(response.status, 200, `premise: the consent write was refused: ${await response.text()}`);
}

async function getConsent(): Promise<Mod> {
  const response = await fetch('/api/sources/consent', { method: 'GET' });
  assert.equal(response.status, 200);
  return (await response.json()) as Mod;
}

async function sourcesTab(): Promise<Surface> {
  const tabs = await mount(h(DashboardTabs, { myEvidence: [], myEvaluations: [], activity: [], tokens: [], signingConfigured: true, sealOnly: false }));
  const buttons = tabs.buttons('Sources');
  assert.equal(buttons.length, 1, `premise: the dashboard has a Sources tab: ${tabs.text().slice(0, 300)}`);
  await tabs.click(buttons[0]);
  return tabs;
}

for (const { name, env } of CONFIGS) {
  test(`criterion 3 (${name}): for a row, the GET returns the base version and the Sources tab reads ${BASE_VERSION.slice(0, 8)}, not the hash`, async () => {
    await under(env, async () => {
      SIGNED_IN_DB();
      sessions.rows.clear();
      answers();
      const statement = await buildFlowsStatement();
      // S1 and S2 move the hash, never the base version.
      assert.equal(statement.version, BASE_VERSION, 'premise: the base version is the change log\'s under this configuration');
      assert.notEqual(statementHash(statement).slice(0, 8), BASE_VERSION.slice(0, 8), 'premise: the hash and the base version differ');
      await put(statement);
      const body = await getConsent();
      assert.equal(body.inForce, true, 'premise: the consent is in force');
      assert.equal(body.consentedBaseVersion, BASE_VERSION, `the GET does not return the base version the row's statement has: ${JSON.stringify(body).slice(0, 300)}`);
      const tab = await sourcesTab();
      const text = tab.text();
      assert.ok(text.includes(BASE_VERSION.slice(0, 8)), `the Sources tab does not show ${BASE_VERSION.slice(0, 8)}: ${text.slice(0, 500)}`);
      assert.ok(!text.includes(statementHash(statement).slice(0, 8)), `the Sources tab still shows the statement hash ${statementHash(statement).slice(0, 8)}`);
      tab.unmount();
    });
  });

  test(`criterion 3 (${name}): for a cookie in force, the GET returns the current statement's base version`, async () => {
    await under(env, async () => {
      ANON();
      answers();
      const statement = await buildFlowsStatement();
      await put(statement);
      const body = await getConsent();
      assert.equal(body.inForce, true, 'premise: the cookie is in force');
      assert.equal(body.store, 'cookie');
      assert.equal(body.consentedBaseVersion, BASE_VERSION, `the GET does not return the base version for a cookie in force: ${JSON.stringify(body).slice(0, 300)}`);
    });
  });
}

test('criterion 3: for a row held against an earlier statement still in force, the GET returns THAT statement\'s base version, and the tab shows it', async () => {
  await under({}, async () => {
    SIGNED_IN_DB();
    sessions.rows.clear();
    answers();
    const statement = await buildFlowsStatement();
    // One notify change (a recipient since removed), so the row is still in force, and its own base version.
    const held = JSON.parse(JSON.stringify(statement)) as Mod;
    held.recipients.push({ id: 'function-logs:former', key: 'Former hosting logs', role: 'function-logs', host: 'former-logs.fixture.example', receives: 'each request', keptBy: [{ holder: 'Former host', keeps: 'metadata' }] });
    held.version = computeBaseVersion(held.recipients);
    assert.notEqual(held.version, statement.version, 'premise: the held statement has a base version of its own');
    sessions.rows.set(DB_ID, {
      userId: DB_ID,
      states: Object.fromEntries((statement.sources as Mod[]).map((s) => [s.sourceId, { state: 'on', since: '2026-10-01' }])),
      flowsHash: statementHash(held),
      flowsStatement: held,
      consentedAt: new Date('2026-10-01T08:00:00.000Z'),
      updatedAt: new Date('2026-10-02T08:00:00.000Z'),
    });
    const body = await getConsent();
    assert.equal(body.inForce, true, 'premise: a removed recipient asks nothing');
    assert.equal(body.consentedBaseVersion, held.version, `the GET does not return the stored statement's base version: ${String(body.consentedBaseVersion)}`);
    const tab = await sourcesTab();
    assert.ok(tab.text().includes(held.version.slice(0, 8)), `the Sources tab does not show the stored statement's base version ${held.version.slice(0, 8)}: ${tab.text().slice(0, 500)}`);
    assert.ok(!tab.text().includes(statement.version.slice(0, 8)), 'the Sources tab shows the current statement\'s base version for a row held against another');
    tab.unmount();
  });
});
