// #759 (UX-2 HG, criterion 3): on an instance with accounts, About's second line is the accounts line on a direct load
// of `/settings`, signed in and signed out.
//
// THE DEFECT. About reads the consent status with `useSourceConsent({ load: false })` and never loads it. The status
// store empties when its last listener leaves (`useSourceConsent.ts:153-154`). On a direct load the Data sources tab is
// the only listener, so a switch to About empties the store, and `accounts` reads false: About says consent is kept in
// a cookie on an instance that keeps it on accounts. Opened over a page whose composer reads the consent, the store
// outlives the switch and the line is right.
//
// WHAT IS DRIVEN, AND WHY NOT THE SWITCH ITSELF. The surface harness subscribes a new instance while it renders
// (`surface-test-harness.ts:131`) and runs a removed instance's cleanup only afterwards (`:466-471`). React runs a
// commit's passive unmounts before its passive mounts. So in the harness a tab switch never empties the store, and the
// one-mount switch passes on the base (`settings-overlay.test.ts`, "with accounts"). The red is the same store-level
// sequence with the order made explicit: the overlay mounted on Data sources with the real consent route answering
// `accounts: true`, unmounted (the last listener leaves, the store empties), then mounted afresh opening on About. The
// one-mount switch is read in a browser (the ORCH's preview pre-read, then the owner's HG-1 (b)).
//
// THE DECOY. A red that opened About on a store an earlier test had left loaded could pass on the base. So the file
// holds a sibling test that leaves the store loaded (`accounts: true`, no listener) right before the reds, and each red
// opens About only by a fresh mount after its own previous tree unmounted. Each red is shown red on the base alone
// (`--test-name-pattern`) and in this file, after that sibling.
//
// GUARDS. Opened over `/ask` (whose composer reads the consent) from the intercepted mount, the line reads as today;
// on an instance without accounts (`accounts: false`), the line is the no-accounts line.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Fragment, type ComponentType } from 'react';
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
} from '../sources/surface-test-harness.ts';
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  '@vercel/kv': FAKE_VERCEL_KV_MODULE,
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

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
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/settings`, origin: ORIGIN, pathname: '/settings' },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const bus = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { SETTINGS_TEXT } = await load('lib/sources/copy.ts');

const WITH = SETTINGS_TEXT.aboutKeptWithAccounts as string;
const WITHOUT = SETTINGS_TEXT.aboutKeptWithoutAccounts as string;
const TAB_ABOUT = SETTINGS_TEXT.tabs.about as string;
/** An instance with a database keeps consents on accounts (the consent route's `accounts`). */
const WITH_ACCOUNTS = () => { process.env.DATABASE_URL = 'postgres://fixture.invalid/fixture'; };
const WITHOUT_ACCOUNTS = () => { delete process.env.DATABASE_URL; };

let net = answers();
function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
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
const SIGNED_OUT = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};

/** A consent in force through the real PUT: on the account signed in, in the cookie signed out. */
async function consentInForce(): Promise<void> {
  const statement = await buildFlowsStatement();
  const states = Object.fromEntries((statement.sources as Array<{ sourceId: string }>).map((s) => [s.sourceId, 'on']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
}

const mounted: Surface[] = [];
afterEach(() => {
  for (const s of mounted.splice(0)) s.unmount();
  WITHOUT_ACCOUNTS();
});
async function open(element: ReturnType<typeof h>): Promise<Surface> {
  const s = await mount(element);
  mounted.push(s);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await s.settle();
  return s;
}
function close(s: Surface): void {
  mounted.splice(mounted.indexOf(s), 1);
  s.unmount();
}
const statusReads = () => net.sent.filter((r) => r.method === 'GET' && r.path === '/api/sources/consent').length;
/** About's second line, as `WITH`, `WITHOUT` or what the surface reads instead. */
function aboutLine(s: Surface): string {
  const text = s.text();
  if (text.includes(WITH)) return 'WITH';
  if (text.includes(WITHOUT)) return 'WITHOUT';
  return `neither: ${text.slice(0, 300)}`;
}
async function toAbout(s: Surface): Promise<void> {
  const tab = s.elements().find((el) => el.props.role === 'tab' && textOf(el) === TAB_ABOUT);
  assert.ok(tab, `premise: the overlay has no "${TAB_ABOUT}" tab`);
  await s.click(tab!);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await s.settle();
}

/**
 * The red's sequence: a direct load on Data sources, which loads the status; the tree unmounted, so its last listener
 * leaves; then a fresh mount opening on About, as React's order leaves About after the switch.
 */
async function directLoadThenAbout(lede: string): Promise<Surface> {
  const first = await open(h(SettingsOverlay, { mount: 'page' }));
  assert.ok(first.text().includes(lede), `premise: the direct load opens on Data sources with its lede for this store: ${first.text().slice(0, 300)}`);
  assert.ok(statusReads() > 0, 'premise: Data sources read the status');
  close(first);
  return open(h(SettingsOverlay, { mount: 'page', initialTab: 'about' }));
}

// --- Guards ------------------------------------------------------------------------------------------------------------

test('#759 guard: opened over /ask from the intercepted mount, where the composer reads the consent, About\'s line is the accounts line, as today', async () => {
  WITH_ACCOUNTS();
  SIGNED_OUT();
  net = answers();
  await consentInForce();
  const page = await open(h(Fragment, null, h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }), h(SettingsOverlay, { mount: 'intercepted' })));
  await toAbout(page);
  assert.equal(aboutLine(page), 'WITH', 'opened over /ask, About does not read the accounts line');
});

test('#759 guard: on an instance without accounts, About\'s line is the no-accounts line, on a direct load and after the switch', async () => {
  WITHOUT_ACCOUNTS();
  SIGNED_OUT();
  net = answers();
  await consentInForce();
  const s = await directLoadThenAbout(SETTINGS_TEXT.ledeCookie);
  assert.equal(aboutLine(s), 'WITHOUT', 'without accounts, About does not read the no-accounts line');
  close(s);
  const switched = await open(h(SettingsOverlay, { mount: 'page' }));
  await toAbout(switched);
  assert.equal(aboutLine(switched), 'WITHOUT', 'without accounts, About after the switch does not read the no-accounts line');
});

// --- The decoy's setup -------------------------------------------------------------------------------------------------

test('#759 decoy: a sibling test leaves the store loaded (accounts: true) with no listener, before the reds', async () => {
  WITH_ACCOUNTS();
  SIGNED_OUT();
  net = answers();
  await consentInForce();
  await bus.refreshConsent();
  // A loaded store answers the guard without a read; an empty one reads the status first.
  const before = statusReads();
  await bus.guardQuestion(() => {}, () => {});
  assert.equal(statusReads(), before, 'premise: the store is not left loaded');
});

// --- The reds ----------------------------------------------------------------------------------------------------------

test('#759 red, signed out (the cookie): on an instance with accounts, a direct load of /settings, then About: the second line is the accounts line', async () => {
  WITH_ACCOUNTS();
  SIGNED_OUT();
  net = answers();
  await consentInForce();
  const s = await directLoadThenAbout(SETTINGS_TEXT.ledeCookie);
  assert.equal(aboutLine(s), 'WITH', 'signed out, on an instance with accounts, About does not read the accounts line after a direct load');
});

test('#759 red, signed in (the account store): on an instance with accounts, a direct load of /settings, then About: the second line is the accounts line', async () => {
  WITH_ACCOUNTS();
  SIGNED_IN();
  sessions.rows.clear();
  net = answers();
  await consentInForce();
  const s = await directLoadThenAbout(SETTINGS_TEXT.ledeWithAccount);
  assert.equal(aboutLine(s), 'WITH', 'signed in, on an instance with accounts, About does not read the accounts line after a direct load');
});
