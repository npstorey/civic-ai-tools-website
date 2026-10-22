// #644 W2 [B], R6-WEB-D's conditions (A): the consistency dialog names a
// source the original analysis loaded after it was allowed when asked, in
// words of its own, beside `lacking`'s line; and the attestation it signs does
// not move.
//
//   - `lacking` keeps its sentence for a source this site does not offer;
//     the new sentence names a source the record shows loaded and its stated
//     set leaves out (`offeredSet.loadedUnstated`). With one source in each
//     set, neither sentence names the other's source.
//   - The field stays out of the signed body: the attestation copies each
//     run's fields by name, so runs that carry it give a POST body byte for
//     byte the same as the same runs without it.
//
// WHAT IS DRIVEN. The real `AttestationDialog` on R6's surface harness, as
// `attestation-dialog-consent.test.ts` drives it, with a consent in force:
// opened, a key typed, the consistency test run against a stand-in replay
// route, and the attestation saved to a stand-in that records its body.
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
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { displayNameForSource } = await load('lib/evidence/data-sources.ts');

const REPLAY_PATH = `/api/records/${SLUG}/replay`;
const ATTESTATIONS_PATH = `/api/records/${SLUG}/attestations`;

/** The sentence `lacking` has carried since R6 W1, for one source. */
const LACKING = (name: string) => `The original analysis could use ${name}. This site does not offer it, so these replays ran without it.`;
/** The new sentence, for one source. */
const LOADED_UNSTATED = (name: string) => `The original analysis also loaded ${name} after it was allowed when asked. The record does not list it as offered, so these replays ran without it.`;

let offeredSet: Record<string, unknown> = {};
let posted: string[] = [];

function answers() {
  posted = [];
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/sources/consent': async () => {
      const statement = await buildFlowsStatement();
      const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: '2026-10-21' }]));
      return new Response(JSON.stringify({ inForce: true, store: 'cookie', flowsVersion: statementHash(statement), states }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/flows': async () => new Response(JSON.stringify(await buildFlowsStatement()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    [REPLAY_PATH]: () => new Response(JSON.stringify({
      toolCalls: [{ name: 'socrata__get_data', args: { type: 'query', dataset_id: 'aaaa-1111' } }],
      output: 'There were 512 potholes.',
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      durationMs: 10,
      offeredSet,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    [ATTESTATIONS_PATH]: async (request: Request) => {
      posted.push(await request.text());
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    },
  });
}

function one(surface: Surface, what: string, pick: (el: HostElement) => boolean): HostElement {
  const found = surface.elements().filter(pick);
  assert.equal(found.length, 1, `expected one ${what}, found ${found.length}; the dialog reads: ${surface.text().slice(0, 500)}`);
  return found[0];
}

async function runConsistency(set: Record<string, unknown>): Promise<Surface> {
  offeredSet = set;
  sessions.server = { user: { id: 'gh-fixture-replayer' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  answers();
  const dialog = await mount(h(AttestationDialog, { slug: SLUG, analysisModel: 'fixture/other-model', promptVisibility: 'full_text', onAttestationCreated: () => undefined }));
  await dialog.click(dialog.button('+ Add attestation'));
  await dialog.type(one(dialog, 'key field', (el) => el.type === 'input' && el.props.type === 'password'), 'placeholder-replayer-model-key');
  await dialog.click(dialog.button('Consistency Test'));
  await dialog.click(dialog.button('Run Consistency Test'));
  assert.ok(dialog.text().includes('All runs complete'), `premise: the replay test did not finish: ${dialog.text().slice(-500)}`);
  return dialog;
}

const BOTH = { from: 'sourcesOffered', sources: ['socrata'], lacking: ['nyc-charter'], loadedUnstated: ['boston-opencontext'] };
const LACKING_ONLY = { from: 'sourcesOffered', sources: ['socrata'], lacking: ['nyc-charter'] };

test('[B]: a source loaded after it was allowed when asked gets its own sentence; lacking keeps its own; neither names the other\'s source', async () => {
  const dialog = await runConsistency(BOTH);
  const text = dialog.text();
  const charter = displayNameForSource('nyc-charter');
  const boston = displayNameForSource('boston-opencontext');
  assert.ok(text.includes(LACKING(charter)), `lacking's sentence is not shown for ${charter}: ${text.slice(-800)}`);
  assert.ok(text.includes(LOADED_UNSTATED(boston)), `the new sentence is not shown for ${boston}: ${text.slice(-800)}`);
  const lackingLine = text.slice(text.indexOf('The original analysis could use'), text.indexOf('ran without it.', text.indexOf('The original analysis could use')));
  const loadedLine = text.slice(text.indexOf('The original analysis also loaded'), text.indexOf('ran without it.', text.indexOf('The original analysis also loaded')));
  assert.ok(!lackingLine.includes(boston), 'lacking\'s sentence names the allowed source');
  assert.ok(!loadedLine.includes(charter), 'the new sentence names the source this site does not offer');
  dialog.unmount();
});

test('[B]: with lacking alone the dialog reads as before: no new sentence', async () => {
  const dialog = await runConsistency(LACKING_ONLY);
  assert.ok(!dialog.text().includes('The original analysis also loaded'), 'the new sentence appears with no field');
  dialog.unmount();
});

test('[B]: runs that carry the field give an attestation POST body byte-identical to the same runs without it', async () => {
  const withField = await runConsistency(BOTH);
  await withField.click(withField.button('Save Attestation'));
  const a = posted.slice();
  withField.unmount();
  const withoutField = await runConsistency(LACKING_ONLY);
  await withoutField.click(withoutField.button('Save Attestation'));
  const b = posted.slice();
  withoutField.unmount();
  assert.equal(a.length, 1, 'premise: the attestation was not posted');
  assert.equal(b.length, 1, 'premise: the attestation was not posted');
  assert.equal(a[0], b[0], 'the field reached the signed body');
  assert.ok(!a[0].includes('loadedUnstated') && !a[0].includes('boston'), 'the signed body names the field or its source');
});
