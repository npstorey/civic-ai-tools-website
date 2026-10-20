// R6 W3 (#632), criterion 7: replay's surface. A replay sends the record's
// question to the model endpoint and dispatches live tool calls, so the
// replay route is gated on the replayer's own consent (C6, design §1.6). When
// it answers `consent_required`, the consistency dialog shows the same consent
// card the query surfaces show, never the bare sentence; Allow stores the
// consent and runs the replay test it was asked for; Not now sends nothing.
//
// WHAT IS DRIVEN. The real `AttestationDialog` on the surface harness
// (`../sources/surface-test-harness.ts`): opened, a key typed, the consistency
// tab chosen, the test run. `/api/records/<slug>/replay` is answered by a
// stand-in that asks the REAL consent gate (`consentInForce`) and answers its
// refusal as the route does (`replay/route.ts`, a JSON 403), or a replay
// result when consent is in force; `/api/flows` and `/api/sources/consent`
// by their real handlers, with a cookie jar between requests.
//
// THE SWITCH IS STUBBED ON (`@/lib/sources/consent-enforced`), as W3 ships
// it: this suite is about the dialog's answer to a refusal, and at the base
// the gate is dormant and refuses nothing.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the dialog shows the refusal's
// `error` text (`AttestationDialog.tsx:178-180`) and no card.
//
// THE TWO PATHS (stage-A ruling (a)). The dialog guards its Run: with no
// consent in force the card asks before any replay is sent. A 403 still
// reaches it when the dialog read the consent as in force and the route did
// not (a re-ask, or the cookie gone): to drive that path, the status read is
// answered "in force" while the request carries no consent, so the REAL gate
// refuses it.
//
// THE RUN COUNT. The dialog offers 3, 5 or 10 runs. "Allow, then one replay
// request" is read as: after Allow, the replay test the reader asked for runs
// (its runs, each one request), beginning with one request; before Allow, the
// one refused request is all that was sent.
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
} from '../sources/surface-test-harness.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  '@/lib/sources/consent-enforced': 'export const CONSENT_GATE_ENFORCED = true;',
});

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';

const ORIGIN = 'https://site.fixture.example';
const SLUG = 'fixture-record';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const AttestationDialog = (await load('components/evidence/AttestationDialog.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { friendlyStreamError } = await load('lib/streaming.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const BARE_REFUSAL: string = friendlyStreamError({ code: 'consent_required' });

const REPLAY_PATH = `/api/records/${SLUG}/replay`;

/** When set, the status read says a consent is in force, whatever the request carries. */
let statusSaysInForce = false;

function answers() {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': async (request: Request) => {
      if (statusSaysInForce && request.method === 'GET') {
        const statement = await buildFlowsStatement();
        const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: '2026-10-19' }]));
        return new Response(JSON.stringify({ inForce: true, store: 'cookie', flowsVersion: statementHash(statement), states }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return (consentRoute[request.method] as (r: Request) => Promise<Response>)(request);
    },
    [REPLAY_PATH]: async (request: Request) => {
      const decision = await consentInForce(request, sessions.server);
      if (!decision.ok) return new Response(JSON.stringify(decision.payload), { status: 403, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ toolCalls: [], output: 'An answer.', tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, durationMs: 1, offeredSet: { from: 'sourcesOffered', sources: ['socrata'], lacking: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
}

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}; the dialog reads: ${surface.text().slice(0, 500)}`);
  return found[0];
}

/** Open the dialog, type a key, choose the consistency tab, and run the test. */
async function runConsistency(readAsInForce = true): Promise<{ dialog: Surface; net: ReturnType<typeof answers> }> {
  statusSaysInForce = readAsInForce;
  sessions.server = { user: { id: 'gh-fixture-replayer' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  const net = answers();
  const dialog = await mount(h(AttestationDialog, { slug: SLUG, analysisModel: 'fixture/other-model', promptVisibility: 'full_text', onAttestationCreated: () => undefined }));
  await dialog.click(dialog.button('+ Add attestation'));
  await dialog.type(one(dialog, 'key field', (el) => el.type === 'input' && el.props.type === 'password'), 'placeholder-replayer-model-key');
  await dialog.click(dialog.button('Consistency Test'));
  await dialog.click(dialog.button('Run Consistency Test'));
  return { dialog, net };
}

const replays = (net: ReturnType<typeof answers>) => net.sent.filter((r) => r.path === REPLAY_PATH);

test('criterion 7: on a 403 consent_required the dialog shows the consent card, never the bare sentence', async () => {
  const { dialog, net } = await runConsistency();
  assert.equal(replays(net).length, 1, 'premise: the dialog sent one replay request, and stopped at its refusal');
  assert.ok(!dialog.text().includes(BARE_REFUSAL), 'the dialog shows the bare refusal sentence');
  assert.ok(dialog.buttons('Allow').length === 1 && dialog.buttons('Not now').length === 1, `the dialog shows no consent card: ${dialog.text().slice(0, 500)}`);
  dialog.unmount();
});

test('criterion 7: Not now sends nothing more', async () => {
  const { dialog, net } = await runConsistency();
  assert.equal(dialog.buttons('Not now').length, 1, `the dialog shows no consent card: ${dialog.text().slice(0, 500)}`);
  await dialog.click(dialog.button('Not now'));
  assert.equal(replays(net).length, 1, 'Not now sent another replay request');
  assert.deepEqual(net.sent.filter((r) => r.method !== 'GET' && r.path !== REPLAY_PATH).map((r) => `${r.method} ${r.path}`), [], 'Not now wrote something');
  dialog.unmount();
});

test('criterion 7: Allow stores the consent, then runs the replay test it was asked for', async () => {
  const { dialog, net } = await runConsistency();
  assert.equal(dialog.buttons('Allow').length, 1, `the dialog shows no consent card: ${dialog.text().slice(0, 500)}`);
  const before = replays(net).length;
  await dialog.click(dialog.button('Allow'));
  const writes = net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'PUT');
  assert.equal(writes.length, 1, 'Allow wrote no consent');
  const after = replays(net).slice(before);
  assert.ok(after.length >= 1, 'after Allow no replay was sent');
  assert.ok(net.sent.indexOf(writes[0]) < net.sent.indexOf(after[0]), 'a replay was sent before the consent was written');
  assert.equal(after.length, 5, `the dialog ran ${after.length} replays after Allow, not the 5 it was asked for`);
  assert.ok(dialog.text().includes('All runs complete'), `the replay test did not finish: ${dialog.text().slice(-700)}`);
  dialog.unmount();
});

test('criterion 7 (the guard): with no consent in force, Run shows the card before any replay is sent', async () => {
  const { dialog, net } = await runConsistency(false);
  assert.equal(replays(net).length, 0, 'the dialog sent a replay before the reader answered the card');
  assert.ok(dialog.buttons('Allow').length === 1 && dialog.buttons('Not now').length === 1, `the dialog shows no consent card: ${dialog.text().slice(0, 500)}`);
  await dialog.click(dialog.button('Allow'));
  assert.equal(replays(net).length, 5, 'after Allow the dialog did not run the five replays it was asked for');
  dialog.unmount();
});
