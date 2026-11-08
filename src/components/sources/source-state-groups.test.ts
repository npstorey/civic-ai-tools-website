// UX-2 P4b: each mounted source-state control is its own radio group.
//
// THE DEFECT (a mechanism read from the code, shown in a browser by planning
// `temp/ux-2/p4bf-measure/`). `SourceStateRadios` names every group
// `source-state-<sourceId>`. The Sources panel and the Settings overlay both
// mount it through `SourceRow`, outside any form, and the overlay opens over
// the page that holds the panel. A browser keeps one checked radio per name
// per document (and per form owner), so the two mounts for one source are one
// group: checking a choice in one unchecks the other's.
//
// WHAT IS ASSERTED. The property the browser acts on: the radios' `name`s.
// React's `checked` prop is also read, but it cannot fail here, because the
// harness has no DOM and each mount computes its own prop; those reads are
// labelled as premises.
//   - The class: two `SourceStateRadios` for one source, in different states,
//     mounted together on one surface.
//   - The surfaces: the Sources panel and the Settings overlay mounted
//     together, through the real consent and flows routes.
//
// THE DECOY. Within one mount, a group's three radios still share one name,
// so the arrow keys move within it.
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
const { SourceStateRadios } = await load('components/sources/SourceStateControl.tsx');
const SourcesPanel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType<Record<string, unknown>>;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

const radios = (s: Surface): HostElement[] => s.elements().filter((el) => el.type === 'input' && el.props.type === 'radio');
const groups = (s: Surface): HostElement[] => s.elements().filter((el) => el.props.role === 'radiogroup');
/** The radios inside one radiogroup element, read from its own subtree. */
function radiosIn(group: HostElement): HostElement[] {
  const out: HostElement[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
    const el = node as HostElement;
    if (el.type === 'input' && el.props.type === 'radio') out.push(el);
    walk((el.props as { children?: unknown }).children);
  };
  walk((group.props as { children?: unknown }).children);
  return out;
}

const SOURCE = 'socrata';
const control = (state: string) => ({
  sourceId: SOURCE, name: 'Socrata', state, since: undefined, inForce: true, writing: false,
  setState: async () => true, confirmed: null, setConfirmed: () => undefined,
});

async function twoMounts(): Promise<{ s: Surface; a: HostElement[]; b: HostElement[] }> {
  const s = await mount(h('div', null, h(SourceStateRadios, control('on')), h(SourceStateRadios, control('off'))));
  const [ga, gb] = groups(s);
  assert.equal(groups(s).length, 2, 'premise: two radio groups are mounted');
  return { s, a: radiosIn(ga), b: radiosIn(gb) };
}

test('UX-2 P4b: two mounted controls for one source are two radio groups (their names differ)', async () => {
  const { a, b } = await twoMounts();
  // Premise, React's prop: each mount's checked radio is its own state. It cannot fail in this harness.
  assert.deepEqual(a.filter((r) => r.props.checked).map((r) => r.props.value), ['on'], 'premise: the first mount checks On');
  assert.deepEqual(b.filter((r) => r.props.checked).map((r) => r.props.value), ['off'], 'premise: the second mount checks Off');
  const nameA = a[0].props.name;
  const nameB = b[0].props.name;
  assert.notEqual(nameA, nameB, `both mounts name their radios ${JSON.stringify(nameA)}, so a browser makes them one group`);
});

test('UX-2 P4b: no radio of one mount shares a name with a radio of another mount', async () => {
  const { a, b } = await twoMounts();
  const namesA = new Set(a.map((r) => r.props.name));
  const shared = b.filter((r) => namesA.has(r.props.name)).map((r) => `${r.props.name}=${r.props.value}`);
  assert.deepEqual(shared, [], `radios of the second mount share the first mount's name: ${shared.join(', ')}`);
});

test('UX-2 P4b, decoy: within one mount, the three radios share one name (the arrow keys move within the group)', async () => {
  const { a, b } = await twoMounts();
  for (const [which, group] of [['first', a], ['second', b]] as const) {
    assert.equal(group.length, 3, `premise: the ${which} group has three radios`);
    assert.equal(new Set(group.map((r) => r.props.name)).size, 1, `the ${which} group's radios do not share one name: ${group.map((r) => r.props.name).join(', ')}`);
    assert.ok(String(group[0].props.name).length > 0, `the ${which} group's radios have no name`);
  }
});

test('UX-2 P4b: the Sources panel and the Settings overlay, mounted together, name each source\'s group apart', async () => {
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
  const ids = (statement.sources as Mod[]).map((src) => src.sourceId as string);
  assert.ok(ids.length >= 1, 'premise: a source is configured');
  assert.equal(groups(s).length, ids.length * 2, `premise: each source has a group in the panel and in the overlay: ${groups(s).length} groups for ${ids.length} sources`);
  const byName = new Map<string, number>();
  for (const group of groups(s)) {
    const names = new Set(radiosIn(group).map((r) => r.props.name as string));
    assert.equal(names.size, 1, 'premise: one group, one name');
    const [name] = names;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const shared = [...byName].filter(([, count]) => count > 1).map(([name, count]) => `${name} x${count}`);
  assert.deepEqual(shared, [], `groups in the panel and the overlay share a name: ${shared.join(', ')}`);
  assert.equal(radios(s).length, ids.length * 6, 'premise: three radios per group');
  s.unmount();
});
