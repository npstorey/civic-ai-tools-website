// UX-2 P4b, as S4 W2a changes the control: each mounted source-state control is its own control.
//
// THE DEFECT (UX-2 P4b, a mechanism read from the code, shown in a browser by planning `temp/ux-2/p4bf-measure/`). The
// control was a radio group named `source-state-<sourceId>`, and the Sources panel and the Settings overlay both mount
// it through `SourceRow`, outside any form, the overlay over the page that holds the panel. A browser keeps one checked
// radio per name per document, so the two mounts for one source were one group: checking a choice in one unchecked the
// other's. UX-2 P4b named each mount's group apart.
//
// S4 W2a (npstorey/civic-ai-tools#335; P-1 = A, C9-L = A) makes the control two buttons with `aria-pressed`. A button
// has no name a browser groups by, so the defect's class is gone with the radios. WHAT IS ASSERTED NOW: no source
// control renders a radio (the class the defect lived in), and two mounts for one source, in different states, each
// draw their own state; the panel and the overlay mounted together hold one control per source each.
//
// THE SHAPE THAT CAN FAIL. The two mounts hold different states, so a control that drew one state for both, or a
// control still rendering radios, is seen.
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
import { attr, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks(CONSENT_SURFACE_STUBS);

for (const name of [
  'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'DATA_COMMONS_MCP_URL', 'BOSTON_OPENCONTEXT_MCP_URL', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE',
  'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
  'NEXT_PUBLIC_CAPTURE_TRACES', 'SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'DATABASE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${ORIGIN}/ask`, origin: ORIGIN, pathname: '/ask' }, scrollTo() {} },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const { SourceStateButtons } = await load('components/sources/SourceStateControl.tsx');
const SourcesPanel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType<Record<string, unknown>>;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { readerSourceName } = await load('lib/sources/source-name.ts');

const radios = (s: Surface): HostElement[] => s.elements().filter((el) => el.type === 'input' && el.props.type === 'radio');
/** Every source control: a `role="group"` named "{name}: Enable or Disable" (S118). */
const controls = (s: Surface, name?: string): HostElement[] =>
  s.elements().filter((el) => attr(el, 'role') === 'group' && (name === undefined ? / Enable or Disable$/.test(attr(el, 'aria-label') ?? '') : attr(el, 'aria-label') === `${name}: Enable or Disable`));
const pressed = (group: HostElement) => within(group).filter((el) => el.type === 'button' && attr(el, 'aria-pressed') === 'true').map((el) => el.props.children);

const SOURCE = 'socrata';
const control = (state: string) => ({
  sourceId: SOURCE, name: 'Socrata', state, since: undefined, inForce: true, writing: false,
  setState: async () => true, confirmed: null, setConfirmed: () => undefined,
});

test('S4 W2a (UX-2 P4b\'s property): two mounted controls for one source, in different states, each draw their own state', async () => {
  const s = await mount(h('div', null, h(SourceStateButtons, control('on')), h(SourceStateButtons, control('off'))));
  const both = controls(s, 'Socrata');
  assert.equal(both.length, 2, 'premise: two controls are mounted');
  assert.deepEqual(pressed(both[0]), ['Enable'], 'the first mount does not draw Enable pressed');
  assert.deepEqual(pressed(both[1]), ['Disable'], 'the second mount does not draw Disable pressed');
});

test('S4 W2a (UX-2 P4b\'s class): a source control renders no radio, so no browser joins two mounts by name', async () => {
  const s = await mount(h('div', null, h(SourceStateButtons, control('on')), h(SourceStateButtons, control('ask-first'))));
  assert.deepEqual(radios(s), [], 'a source control renders a radio');
});

test('UX-2 P4b, as S4 W2a changes it: the Sources panel and the Settings overlay, mounted together, hold one control per source each and no radio', async () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  const statement = await buildFlowsStatement();
  const states = Object.fromEntries((statement.sources as Mod[]).map((src) => [src.sourceId, 'on']));
  const stored = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(stored.status, 200, `premise: the consent was not stored: ${await stored.text()}`);
  const s = await mount(h('div', null, h(SourcesPanel, {}), h(SettingsOverlay, { mount: 'intercepted' })));
  const sources = statement.sources as Mod[];
  assert.ok(sources.length >= 1, 'premise: a source is configured');
  for (const source of sources) {
    const name = readerSourceName(source);
    const mine = controls(s, name);
    assert.equal(mine.length, 2, `${name}: ${mine.length} controls, not one in the panel and one in the overlay`);
    for (const group of mine) assert.deepEqual(pressed(group), ['Enable'], `${name}: a mount does not draw the stored state`);
  }
  assert.deepEqual(radios(s), [], 'a radio is rendered');
  s.unmount();
});
