// S3-B F, F-3 (npstorey/civic-ai-tools#318; the cold read's F4): a failed load of the picker's code is not kept. The
// next open tries again, and the failure is handled.
//
// WHAT IS DRIVEN. `/ask`'s real mount (`QuerySurface`) on the surface harness, in loop with the decision store (the
// form that offers picking), as `picker-loads-on-open.test.ts` drives it. A module hook, registered after the
// harness's (so it runs first), refuses the first load of `src/components/composer/picks/PickerPanel.tsx`, the module
// the lazy import names, and hands every later load on: the page open across a deploy whose chunk now 404s, or offline
// for a moment. Node's module loader does not keep a load that failed, so a second import is a second load.
//
// WHAT MAKES IT ABLE TO FAIL. The first open is shown failing (no panel, one refused load) before the second open is
// read; the second open is the reader's own next step, choosing the option again. "Change" cannot follow a first load
// that failed: it shows only beside picks, and no pick can be made before the panel has shown once.
//
// RED at 71b43b0f: the rejected promise is kept, so the second open loads nothing and shows no panel; and the
// rejection is unhandled.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';
import { type ComponentType, type ReactElement } from 'react';
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
} from '../../sources/surface-test-harness.ts';
import { hasClass, within } from '../../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  './BpmnViewer': 'export default function BpmnViewer() { return null; }',
});

// The refusal, after the harness's hooks: it runs first. The first load of the panel's module fails; every other load
// is handed on.
type NextLoad = (url: string, context?: unknown) => { format: string; source?: string; shortCircuit?: boolean };
const PANEL_LOADS: Array<'refused' | 'loaded'> = [];
(nodeModule as unknown as { registerHooks(h: { load: (url: string, context: unknown, next: NextLoad) => unknown }): void }).registerHooks({
  load(url, context, next) {
    if (url.includes('/composer/picks/PickerPanel')) {
      if (PANEL_LOADS.length === 0) {
        PANEL_LOADS.push('refused');
        throw new Error('fixture: the picker chunk did not load');
      }
      PANEL_LOADS.push('loaded');
    }
    return next(url, context);
  },
});

// Every rejection no handler took, read by this file's last assertion. The test runner's own listener is set aside
// while the test runs and put back after it, so a rejection the page leaves unhandled fails the test at that assertion
// rather than ending it where the rejection happens, before the second open is read.
const UNHANDLED: unknown[] = [];
const collect = (reason: unknown) => {
  UNHANDLED.push(reason);
};

for (const name of [
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY',
  'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/', search: '' },
    history: { replaceState() {}, pushState() {} },
    scrollTo() {},
    scrollBy() {},
    innerHeight: 852,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const QuerySurface = (await load('components/shared/QuerySurface.tsx')).default as ComponentType<Record<string, unknown>>;
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function answers(): void {
  installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => json({ routing: 'in-loop', store: true }),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/rate-limit': () => json({ remaining: 7, limit: 10, resets_at: '2099-01-01T00:00:00.000Z', authenticated: true }),
  });
}
async function consentAllOn(): Promise<void> {
  const all = Object.fromEntries(IDS.map((id) => [id, 'on']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, 'premise: the consent write');
}
const mounted: Surface[] = [];
afterEach(() => {
  for (const p of mounted.splice(0)) p.unmount();
  cancelConsentPauses();
});
const settle = async (surface: Surface, ms = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await surface.settle();
};
async function page(element: ReactElement): Promise<Surface> {
  sessions.server = { user: { id: 'gh-fixture-account' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  const p = await mount(element);
  mounted.push(p);
  for (let i = 0; i < 6; i += 1) await settle(p, 50);
  return p;
}
const part = (el: HostElement): unknown => el.props['data-part'];
const parts = (p: Surface, name: string): HostElement[] => p.elements().filter((el) => part(el) === name);
const labelOf = (el: HostElement): string => textOf(within(el).find((x) => hasClass(x, 'ui-menu-item-label')) ?? el);
async function choose(p: Surface, label: string): Promise<void> {
  const menu = parts(p, 'harness-menu')[0];
  if (!within(menu).some((el) => el.props.role === 'menu')) {
    await p.click(within(menu).find((el) => el.props['aria-haspopup'] === 'menu')!);
    await settle(p);
  }
  let panel = within(parts(p, 'harness-menu')[0]).find((el) => el.props.role === 'menu')!;
  if (!within(panel).some((el) => el.props.role === 'menuitemradio')) {
    await p.click(within(panel).find((el) => labelOf(el) === 'Data sources')!);
    await settle(p);
    panel = within(parts(p, 'harness-menu')[0]).find((el) => el.props.role === 'menu')!;
  }
  const row = within(panel).find((el) => el.props.role === 'menuitemradio' && labelOf(el) === label);
  assert.ok(row && row.props['aria-disabled'] !== true, `the item "${label}" is choosable`);
  await p.click(row!);
  for (let i = 0; i < 20 && parts(p, 'pick-panel').length === 0; i += 1) await settle(p, 20);
}

test('F-3: a first load of the picker\'s code that fails is tried again on the next open, which shows the panel; no rejection goes unhandled', async (t) => {
  const runners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', collect);
  t.after(() => {
    process.removeListener('unhandledRejection', collect);
    for (const listener of runners) process.on('unhandledRejection', listener);
  });
  answers();
  await consentAllOn();
  const ask = await page(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
  assert.equal(parts(ask, 'harness-menu').length, 1, 'premise: /ask has the harness menu');
  assert.deepEqual(PANEL_LOADS, [], 'premise: nothing loads the picker\'s code before the panel opens');
  // The first open: the load is refused, and no panel shows.
  await choose(ask, 'Only the ones I pick');
  assert.deepEqual(PANEL_LOADS, ['refused'], 'premise: the first open asked for the picker\'s code, and the load was refused');
  assert.equal(parts(ask, 'pick-panel').length, 0, 'premise: a panel showed though its code did not load');
  // The next open, the option chosen again, and one more after the panel is closed. Read whole, so a red names every
  // part that failed: whether each open asked for the code, whether a panel showed, and any rejection left unhandled.
  await choose(ask, 'Only the ones I pick');
  const second = { loads: [...PANEL_LOADS], panels: parts(ask, 'pick-panel').length };
  const close = parts(ask, 'pick-panel')[0] ? within(parts(ask, 'pick-panel')[0]).find((el) => el.props['aria-label'] === 'Close') : undefined;
  if (close) {
    await ask.click(close);
    await settle(ask);
    await choose(ask, 'Only the ones I pick');
  }
  const third = { loads: [...PANEL_LOADS], panels: parts(ask, 'pick-panel').length };
  await settle(ask);
  assert.deepEqual({ second, third, unhandled: UNHANDLED.map((reason) => String((reason as Error)?.message ?? reason)) }, {
    // The second open asks for the code again, and the panel shows.
    second: { loads: ['refused', 'loaded'], panels: 1 },
    // Closed and opened again: the code that loaded is kept, and nothing more is asked for.
    third: { loads: ['refused', 'loaded'], panels: 1 },
    unhandled: [],
  });
});
