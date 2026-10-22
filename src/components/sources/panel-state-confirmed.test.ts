// A state change in the Sources panel is confirmed in words (UX pass, row 5).
// At the base a change printed "Set Off since <date>." in the row's own grey
// and no element with role=status appeared (measured on production). After a
// successful write, the row now carries one role=status line under its
// control: "<Source> is now <State>. This applies from your next question.",
// with "Set <State> since <date>." kept on the same line. Before the write
// resolves there is no such line; a refused write shows none (the hook exposes
// `failed` and no reader-facing failure text, so nothing claims a change that
// did not happen).
//
// WHAT IS DRIVEN. The real panel on the surface harness, reading the REAL
// `/api/flows` and `/api/sources/consent` handlers, with a consent in force
// written first through the real endpoint. The change is made on a source
// whose state differs from the new one, so the line cannot be present by
// coincidence.
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

const ORIGIN = 'https://site.fixture.example';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Panel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

/** While true, every consent write is refused with a 500 before the real handler sees it. */
let refuseWrites = false;
/** While set, a consent write waits for this promise before the real handler answers it. */
let holdWrites: Promise<void> | null = null;

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': async (request: Request) => {
      if (request.method === 'PUT' && holdWrites) await holdWrites;
      if (refuseWrites && request.method === 'PUT') return new Response(JSON.stringify({ error: 'refused' }), { status: 500 });
      return (consentRoute[request.method] as (r: Request) => Promise<Response>)(request);
    },
  });
}

async function panelInForce(): Promise<Surface> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  answers();
  const statement = await buildFlowsStatement();
  const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, 'on']));
  const response = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(response.status, 200, 'premise: the consent was written');
  return mount(h(Panel));
}

const statusLines = (panel: Surface): HostElement[] => panel.elements().filter((el) => el.props.role === 'status');
const offFor = (panel: Surface, sourceId: string): HostElement => {
  const found = panel.elements().filter((el) => el.type === 'input' && el.props.value === 'off' && el.props.name === `source-state-${sourceId}`);
  assert.equal(found.length, 1, `no Off choice for ${sourceId}`);
  return found[0];
};
const today = () => new Date().toISOString().slice(0, 10);

test('row 5: before any change there is no status line; after a successful change the row confirms it in words', async () => {
  refuseWrites = false;
  const panel = await panelInForce();
  assert.deepEqual(statusLines(panel), [], 'premise: before the write there is no status line');
  await panel.check(offFor(panel, 'data-commons'));
  const lines = statusLines(panel);
  assert.equal(lines.length, 1, `after the change there is not one status line: ${panel.text().slice(0, 300)}`);
  assert.equal(textOf(lines[0]), `Data Commons is now Off. This applies from your next question. Set Off since ${today()}.`);
  const row = panel.elements().find((el) => el.props['data-source'] === 'data-commons');
  assert.ok(row && textOf(row).includes(textOf(lines[0])), 'the status line is not under that source\'s control');
  panel.unmount();
});

test('row 5: no status line while the write is in flight', async () => {
  refuseWrites = false;
  const panel = await panelInForce();
  let release = () => {};
  holdWrites = new Promise<void>((resolve) => { release = resolve; });
  try {
    void panel.check(offFor(panel, 'socrata'));
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(statusLines(panel), [], 'a status line appeared before the write resolved');
  } finally {
    holdWrites = null;
    release();
  }
  await panel.settle();
  assert.equal(statusLines(panel).length, 1, 'premise: after the write the line appears');
  panel.unmount();
});

test('row 5: a refused write shows no confirmation', async () => {
  const panel = await panelInForce();
  refuseWrites = true;
  try {
    await panel.check(offFor(panel, 'data-commons'));
  } finally {
    refuseWrites = false;
  }
  assert.ok(!panel.text().includes('is now Off'), `a refused write was confirmed: ${panel.text().slice(0, 300)}`);
  assert.deepEqual(statusLines(panel), []);
  panel.unmount();
});
