// S3-B W1, fix round 1, item 2 (npstorey/civic-ai-tools#318; contract task 3): the picker's code loads when the
// picker opens, never before. A reader who never picks never fetches it.
//
// WHAT IS DRIVEN. `/ask`'s real mount (`QuerySurface`) on the surface harness, in loop with the decision store (the
// form that offers picking), and `/explore`'s; the picker opened by choosing "Only the ones I pick", closed, opened
// again by choosing it again, and by "Change".
//
// HOW THE LOAD IS SEEN. A module hook, registered after the harness's, records every load of
// `src/components/composer/picks/PickerPanel.tsx`: the module the lazy import names (`load-picker.ts`). In a browser
// that load is the chunk's request; here it is the module's first evaluation, so "loaded once" is the module system's
// own guarantee and the assertion that can fail is the first one: nothing loads it before the panel opens.
//
// RED at 304c72bf: the import starts as soon as the routing read says in loop with the store, before any open.
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

// The observer, after the harness's hooks: it runs first and hands every load on.
type NextLoad = (url: string, context?: unknown) => { format: string; source?: string; shortCircuit?: boolean };
const PANEL_LOADS: string[] = [];
(nodeModule as unknown as { registerHooks(h: { load: (url: string, context: unknown, next: NextLoad) => unknown }): void }).registerHooks({
  load(url, context, next) {
    if (url.includes('/composer/picks/PickerPanel')) PANEL_LOADS.push(url);
    return next(url, context);
  },
});

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
const McpFlowDiagram = (await load('components/explore/McpFlowDiagram.tsx')).default as ComponentType;
const { cancelConsentPauses } = await load('components/sources/useSourceConsent.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const statement = await buildFlowsStatement();
const IDS: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function answers(routing: { routing: string; store: boolean }) {
  installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/model', name: 'Fixture model', tag: 'recommended' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': () => json(routing),
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
  // Long enough for the routing read, the consent read and any effect they start, and an import begun by one.
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
  for (let i = 0; i < 20 && (label !== 'Only the ones I pick' || parts(p, 'pick-panel').length === 0); i += 1) await settle(p, 20);
}

test('fix round 1, item 2: the picker\'s code loads on the panel\'s first open, never before, and once', async () => {
  // /explore, where picking is not offered, loads nothing.
  answers({ routing: 'in-loop', store: true });
  await consentAllOn();
  await page(h(McpFlowDiagram));
  assert.deepEqual(PANEL_LOADS, [], '/explore loaded the picker\'s code');
  // /ask in the form that offers picking: nothing loads until the panel opens.
  answers({ routing: 'in-loop', store: true });
  await consentAllOn();
  const ask = await page(h(QuerySurface, { presentation: 'answer-first', defaultMode: 'notebook' }));
  assert.ok(parts(ask, 'harness-menu').length === 1, 'premise: /ask has the harness menu');
  assert.deepEqual(PANEL_LOADS, [], 'the picker\'s code loaded before the panel opened');
  // The first open loads it, and the panel shows.
  await choose(ask, 'Only the ones I pick');
  assert.equal(parts(ask, 'pick-panel').length, 1, 'the panel did not open');
  assert.equal(PANEL_LOADS.length, 1, `the picker's code loaded ${PANEL_LOADS.length} times on the first open`);
  // Closed and opened again (the option re-chosen): nothing more loads.
  await ask.click(within(parts(ask, 'pick-panel')[0]).find((el) => el.props['aria-label'] === 'Close')!);
  await settle(ask);
  await choose(ask, 'Only the ones I pick');
  assert.equal(parts(ask, 'pick-panel').length, 1);
  assert.equal(PANEL_LOADS.length, 1);
});
