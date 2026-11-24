// S4 W1 (npstorey/civic-ai-tools#335), criterion A2 at the surface (C4 = A): a change the consent endpoint refuses
// because the signed-out reader's cookie is full says so under the refused control, S24, "This change was not saved.
// Your settings are kept in a cookie, and it is full.", and, on a site that keeps consents on accounts, S25 after it,
// "If you sign in, your settings are kept on your account instead."; the control goes back to what it showed, and
// stays live.
//
// WHAT IS DRIVEN. The real Settings overlay on the surface harness, reading and writing through the REAL `/api/flows`,
// `/api/sources/consent` and decision handlers, with the statement's test hook set to 300 sources (the 200-source
// fixture and 100 example packs over Socrata) and the browser's cookie holding 274 stored states, the most the second
// form holds. Whether the site keeps consents on accounts is the consent route's own `accounts` (a database is set).
//
// THE SHAPE THAT CAN FAIL. The clicked source has no stored entry (it is Ask first by absence), and the choice clicked
// (On) differs from it, so a write that went through, a control left at the clicked choice, or a line that is not under
// that source's control is seen. Each test also reads the cookie the browser holds after the click: unchanged.
//
// RED AT THE BASE: the statement has no hook, the write is not refused, and no line names a full cookie.
//
// Run with: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, '@vercel/kv': FAKE_VERCEL_KV_MODULE });

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST',
  'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SOURCE_ROUTING', 'KV_REST_API_URL',
  'KV_REST_API_TOKEN', 'DATABASE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';
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
const flows = await load('lib/flows/statement.ts');
const consent = await load('lib/sources/consent.ts');
const fixture = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sources', 'fixtures', 'manifest-200.json'), 'utf8')) as { addresses: Record<string, string>; entries: Mod[] };

const S24 = 'This change was not saved. Your settings are kept in a cookie, and it is full.';
const S25 = 'If you sign in, your settings are kept on your account instead.';

/** The 200-source fixture and 100 example packs over Socrata, every one configured. */
function inputs(): Mod {
  const socrata = fixture.entries.find((e) => e.sourceId === 'socrata')!;
  const entries = [
    ...fixture.entries,
    ...Array.from({ length: 100 }, (_, i) => ({ kind: 'pack', sourceId: `example-pack-${String(i).padStart(3, '0')}`, alias: `example_pack_${i}`, displayName: `Example pack ${i}`, freshness: 'Example: an example pack.', base: 'socrata', consentDefault: 'on', hostings: socrata.hostings })),
  ];
  return {
    manifest: entries,
    variantInForce: (entry: Mod) => entry.hostings[0],
    addressFor: (id: string) => fixture.addresses[entries.find((e) => e.sourceId === id)?.base ?? id],
  };
}

const within = (node: HostElement): HostElement[] => {
  const found: HostElement[] = [];
  const walk = (child: unknown): void => {
    if (Array.isArray(child)) { for (const c of child) walk(c); return; }
    if (child === null || typeof child !== 'object' || !('props' in (child as object))) return;
    const el = child as HostElement;
    if (typeof el.type === 'string') found.push(el);
    walk((el.props as { children?: unknown }).children);
  };
  walk(node.props.children);
  return found;
};

beforeEach(() => {
  delete process.env.DATABASE_URL;
  flows.setFlowsSourceInputsForTests?.(null);
});

/** The overlay, signed out, the browser carrying a cookie of 274 states (the clicked source not among them). */
async function fullOverlay(): Promise<{ s: Surface; net: ReturnType<typeof installFetch>; clicked: string; before: string }> {
  assert.equal(typeof flows.setFlowsSourceInputsForTests, 'function', 'statement.ts has no test hook');
  flows.setFlowsSourceInputsForTests(inputs());
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const net = installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  const statement = await flows.buildFlowsStatement();
  const ids = (statement.sources as Mod[]).map((s) => s.sourceId as string);
  assert.equal(ids.length, 300, 'premise: 300 sources are configured');
  const clicked = 'socrata';
  const stored = ids.filter((id) => id !== clicked).slice(0, 274);
  const value = consent.encodeConsentCookie({
    v: 2,
    flows: statement.version,
    states: Object.fromEntries(stored.map((id) => [id, { state: 'ask-first', since: '2026-11-01', version: (statement.sources as Mod[]).find((s) => s.sourceId === id)!.version }])),
  });
  assert.equal(consent.CONSENT_COOKIE_NAME.length + 1 + value.length, 4084, 'premise: the cookie holds 274 states');
  net.jar.set(consent.CONSENT_COOKIE_NAME, value);
  const s = await mount(h(SettingsOverlay, {}));
  return { s, net, clicked, before: value };
}

const rowOf = (s: Surface, id: string): HostElement => {
  const rows = s.elements().filter((el) => el.props['data-source'] === id);
  assert.equal(rows.length, 1, `no one row for ${id}`);
  return rows[0];
};
const radiosOf = (row: HostElement) => within(row).filter((el) => el.type === 'input' && el.props.type === 'radio');

for (const accounts of [true, false]) {
  test(`A2 (red): past the bound, the refused control's line is S24${accounts ? ', then S25 on a site with accounts' : ' alone on a site without accounts'}; the control shows its stored state and stays live`, async () => {
    if (accounts) process.env.DATABASE_URL = 'postgres://fixture.example/db';
    try {
      const { s, net, clicked, before } = await fullOverlay();
      const row = rowOf(s, clicked);
      const shown = radiosOf(row).find((el) => el.props.checked === true)?.props.value;
      assert.equal(shown, 'ask-first', 'premise: the clicked source shows Ask first (no stored state)');
      const on = radiosOf(row).find((el) => el.props.value === 'on')!;
      await s.check(on);
      await s.settle();
      const puts = net.sent.filter((r) => r.method === 'PUT' && r.path === '/api/sources/consent');
      assert.equal(puts.length, 1, 'premise: the click wrote once');
      assert.equal(net.jar.get(consent.CONSENT_COOKIE_NAME), before, 'the cookie changed');

      const after = rowOf(s, clicked);
      const status = within(after).filter((el) => el.props.role === 'status');
      assert.equal(status.length, 1, `no status line under the refused control: ${textOf(after).slice(0, 400)}`);
      assert.equal(textOf(status[0]), accounts ? `${S24} ${S25}` : S24);
      assert.deepEqual(radiosOf(after).filter((el) => el.props.checked === true).map((el) => el.props.value), ['ask-first'], 'the control does not show what it showed before');
      assert.deepEqual(radiosOf(after).filter((el) => el.props.disabled === true), [], 'the control is held after the refusal');
      // Only the refused control says so.
      assert.equal(s.elements().filter((el) => el.props.role === 'status' && textOf(el).includes(S24)).length, 1);
      s.unmount();
    } finally {
      flows.setFlowsSourceInputsForTests?.(null);
    }
  });
}
