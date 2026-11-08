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
// UX-2 P4b, item 42 in the review dialog. A replay cannot pause, so a
// consent in force with no source On is refused `no_sources_on`
// (`consent-gate.ts:156`). That reaches the dialog when the guard runs the
// replay: here every source Ask first, stored through the real consent route,
// with the instance's mode unread (the guard runs it, `useSourceConsent.ts`).
// The dialog answers it as home and `/explore` do: item 42's sentence through
// `NoSourcesOnLine`, its "Data source settings" a link to the Settings
// overlay, and no error. The route's payload carries the same sentence as its
// `error` (`consent-gate.ts:123`), so one case swaps that text for a marker:
// the dialog renders the refusal from its code, not from the route's text.
// THE DECOY: a 403 with any other code still takes the error path, unchanged.
// The same refusal answered in the browser (3b): with every source Off the
// guard returns 'none-on' (`useSourceConsent.ts:463-464`) and sends no replay;
// the dialog shows `NoSourcesOnLine` as home does. Its decoy: with a source
// On, Run sends the replay.
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
const NO_SOURCES_ON: string = friendlyStreamError({ code: 'no_sources_on' });
const { SETTINGS_HREF, SETTINGS_TEXT } = await load('lib/sources/copy.ts');

const REPLAY_PATH = `/api/records/${SLUG}/replay`;

/** When set, the status read says a consent is in force, whatever the request carries. */
let statusSaysInForce = false;

/** When set, the replay stand-in answers through this, given the real gate's decision. */
let replayAnswer: ((decision: { ok: boolean; payload?: Record<string, unknown> }) => Response) | null = null;
/** The real gate's last refusal payload, as the stand-in answered it. */
let lastRefusal: Record<string, unknown> | null = null;

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
      if (!decision.ok) lastRefusal = decision.payload;
      if (replayAnswer) return replayAnswer(decision);
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
/**
 * UX-2 P2: the dialog is the page's add-review sheet. It is mounted open (its
 * open state belongs to the page's review store), on the review path, and the
 * automated checks sit behind X17's disclosure, "Run an automated check
 * instead"; the key field renders once that is chosen. This opens it and
 * chooses the consistency test.
 */
async function chooseConsistency(dialog: Surface): Promise<void> {
  const details = dialog.elements().filter((el) => el.type === 'details' && textOf(el).startsWith('Run an automated check instead'));
  assert.equal(details.length, 1, `X17's disclosure; the sheet reads: ${dialog.text().slice(0, 300)}`);
  (details[0].props.onToggle as (e: unknown) => void)({ currentTarget: { open: true }, target: { open: true } });
  await dialog.settle();
  const radio = dialog.elements().filter((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'consistency');
  assert.equal(radio.length, 1, 'the consistency choice');
  await dialog.check(radio[0]);
}

async function runConsistency(readAsInForce = true): Promise<{ dialog: Surface; net: ReturnType<typeof answers> }> {
  statusSaysInForce = readAsInForce;
  sessions.server = { user: { id: 'gh-fixture-replayer' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  const net = answers();
  const dialog = await mount(h(AttestationDialog, { slug: SLUG, analysisModel: 'fixture/other-model', promptVisibility: 'full_text', open: true, onClose: () => undefined, onAttestationCreated: () => undefined }));
  await chooseConsistency(dialog);
  await dialog.type(one(dialog, 'key field', (el) => el.type === 'input' && el.props.type === 'password'), 'placeholder-replayer-model-key');
  await dialog.click(dialog.button('Run Consistency Test'));
  return { dialog, net };
}

const replays = (net: ReturnType<typeof answers>) => net.sent.filter((r) => r.path === REPLAY_PATH);

test('criterion 7: on a 403 consent_required the dialog shows the consent card, never the bare sentence', async () => {
  const { dialog, net } = await runConsistency();
  assert.equal(replays(net).length, 1, 'premise: the dialog sent one replay request, and stopped at its refusal');
  assert.ok(!dialog.text().includes(BARE_REFUSAL), 'the dialog shows the bare refusal sentence');
  assert.ok(dialog.buttons('Allow').length === 1 && dialog.buttons("Don't allow").length === 1, `the dialog shows no consent card: ${dialog.text().slice(0, 500)}`);
  dialog.unmount();
});

test('criterion 7: Don\'t allow (UX-2 P4b, item 8) sends nothing more', async () => {
  const { dialog, net } = await runConsistency();
  assert.equal(dialog.buttons("Don't allow").length, 1, `the dialog shows no consent card: ${dialog.text().slice(0, 500)}`);
  await dialog.click(dialog.button("Don't allow"));
  assert.equal(replays(net).length, 1, 'Don\'t allow sent another replay request');
  assert.deepEqual(net.sent.filter((r) => r.method !== 'GET' && r.path !== REPLAY_PATH).map((r) => `${r.method} ${r.path}`), [], 'Don\'t allow wrote something');
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
  assert.ok(dialog.buttons('Allow').length === 1 && dialog.buttons("Don't allow").length === 1, `the dialog shows no consent card: ${dialog.text().slice(0, 500)}`);
  await dialog.click(dialog.button('Allow'));
  assert.equal(replays(net).length, 5, 'after Allow the dialog did not run the five replays it was asked for');
  dialog.unmount();
});

// --- UX-2 P4b, item 42: the no_sources_on refusal in the review dialog -------------

const json403 = (body: unknown) => new Response(JSON.stringify(body), { status: 403, headers: { 'Content-Type': 'application/json' } });

/** The consistency tab's error box: where the dialog's error status shows its message (`status === 'error'`). */
const errorBoxes = (dialog: Surface) => dialog.elements().filter((el) => (el.props.style as { color?: string } | undefined)?.color === 'var(--error)');

/**
 * Store a consent in force, through the real consent route (the cookie path),
 * each configured source in the state `stateOf` gives it, then open the dialog
 * and run the consistency test.
 */
async function runAfterConsent(stateOf: (sourceId: string, index: number) => string, answer: typeof replayAnswer = null): Promise<{ dialog: Surface; net: ReturnType<typeof answers> }> {
  statusSaysInForce = false;
  replayAnswer = answer;
  lastRefusal = null;
  sessions.server = { user: { id: 'gh-fixture-replayer' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
  const net = answers();
  const statement = await buildFlowsStatement();
  const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }, i: number) => [s.sourceId, stateOf(s.sourceId, i)]));
  const stored = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
  assert.equal(stored.status, 200, `premise: the consent was not stored: ${await stored.text()}`);
  const dialog = await mount(h(AttestationDialog, { slug: SLUG, analysisModel: 'fixture/other-model', promptVisibility: 'full_text', open: true, onClose: () => undefined, onAttestationCreated: () => undefined }));
  await chooseConsistency(dialog);
  await dialog.type(one(dialog, 'key field', (el) => el.type === 'input' && el.props.type === 'password'), 'placeholder-replayer-model-key');
  await dialog.click(dialog.button('Run Consistency Test'));
  replayAnswer = null;
  return { dialog, net };
}

/**
 * Every source Ask first: the guard runs the replay (no source Off, the mode
 * unread), and the real gate refuses it `no_sources_on`, since a replay cannot ask.
 */
const runAfterAskFirstConsent = (answer: typeof replayAnswer = null) => runAfterConsent(() => 'ask-first', answer);

/** The premise every case below rests on: one replay was sent, and the real gate refused it `no_sources_on` with item 42's sentence. */
function assertRefusedNoneOn(net: ReturnType<typeof answers>): void {
  assert.equal(replays(net).length, 1, 'premise: the dialog sent one replay request, and stopped at its refusal');
  assert.equal(lastRefusal?.code, 'no_sources_on', `premise: the real gate did not refuse no_sources_on: ${JSON.stringify(lastRefusal)}`);
  assert.equal(lastRefusal?.error, NO_SOURCES_ON, 'premise: the route\'s error text is item 42\'s sentence');
}

test('UX-2 P4b item 42: a replay refused no_sources_on shows item 42\'s sentence, byte for byte, and no error', async () => {
  const { dialog, net } = await runAfterAskFirstConsent();
  assertRefusedNoneOn(net);
  assert.equal(dialog.buttons('Allow').length, 0, 'premise: the consent card is not shown');
  const lines = dialog.elements().filter((el) => textOf(el) === NO_SOURCES_ON);
  assert.ok(lines.length >= 1, `the dialog does not render item 42's sentence on its own: ${dialog.text().slice(-700)}`);
  assert.equal(errorBoxes(dialog).length, 0, `the dialog shows the refusal as an error (status 'error'): ${errorBoxes(dialog).map((el) => textOf(el)).join(' | ')}`);
  dialog.unmount();
});

test('UX-2 P4b item 42: the dialog\'s refusal links "Data source settings" to the Settings overlay', async () => {
  const { dialog, net } = await runAfterAskFirstConsent();
  assertRefusedNoneOn(net);
  assert.equal(dialog.buttons('Allow').length, 0, 'premise: the consent card (which has its own link) is not shown');
  const links = dialog.elements().filter((el) => el.type === 'a' && el.props.href === SETTINGS_HREF && textOf(el) === SETTINGS_TEXT.link);
  assert.equal(links.length, 1, `the dialog's refusal does not link ${SETTINGS_TEXT.link} to ${SETTINGS_HREF}: ${dialog.text().slice(-700)}`);
  dialog.unmount();
});

test('UX-2 P4b item 42: the dialog renders the refusal from its code, not the route\'s error text', async () => {
  const ROUTE_TEXT = 'Fixture route text for a no_sources_on refusal.';
  const { dialog, net } = await runAfterAskFirstConsent((decision) => {
    assert.ok(!decision.ok, 'premise: the real gate refused the replay');
    return json403({ ...decision.payload, error: ROUTE_TEXT });
  });
  assertRefusedNoneOn(net);
  assert.ok(!dialog.text().includes(ROUTE_TEXT), `the dialog renders the route's error text: ${dialog.text().slice(-700)}`);
  assert.ok(dialog.text().includes(NO_SOURCES_ON), `the dialog does not render item 42's sentence: ${dialog.text().slice(-700)}`);
  assert.equal(errorBoxes(dialog).length, 0, 'the dialog shows the refusal as an error');
  dialog.unmount();
});

test('UX-2 P4b item 42, decoy: a 403 with any other code still takes the error path, unchanged', async () => {
  const DECOY_TEXT = 'Fixture refusal with another code.';
  const { dialog, net } = await runAfterAskFirstConsent(() => json403({ error: DECOY_TEXT, code: 'fixture_other_refusal' }));
  assert.equal(replays(net).length, 1, 'premise: the dialog sent one replay request');
  const boxes = errorBoxes(dialog);
  assert.equal(boxes.length, 1, `the decoy does not reach the error path: ${dialog.text().slice(-700)}`);
  assert.equal(textOf(boxes[0]), DECOY_TEXT, 'the error path does not show the route\'s error text');
  assert.ok(!dialog.text().includes(NO_SOURCES_ON), 'the decoy shows item 42\'s sentence');
  assert.equal(dialog.elements().filter((el) => el.type === 'a' && el.props.href === SETTINGS_HREF).length, 0, 'the decoy shows a Settings link');
  dialog.unmount();
});

test('UX-2 P4b item 42 (3b): with every source Off, Run sends no replay and the dialog shows NoSourcesOnLine', async () => {
  const { dialog, net } = await runAfterConsent(() => 'off');
  assert.equal(replays(net).length, 0, 'premise: the guard sent a replay with every source Off');
  assert.equal(dialog.buttons('Allow').length, 0, 'premise: the consent card (which has its own link) is not shown');
  const lines = dialog.elements().filter((el) => textOf(el) === NO_SOURCES_ON);
  assert.ok(lines.length >= 1, `the dialog does not render item 42's sentence: ${dialog.text().slice(-700)}`);
  const links = dialog.elements().filter((el) => el.type === 'a' && el.props.href === SETTINGS_HREF && textOf(el) === SETTINGS_TEXT.link);
  assert.equal(links.length, 1, `the dialog's refusal does not link ${SETTINGS_TEXT.link} to ${SETTINGS_HREF}: ${dialog.text().slice(-700)}`);
  assert.equal(errorBoxes(dialog).length, 0, 'the dialog shows the refusal as an error');
  dialog.unmount();
});

test('UX-2 P4b item 42 (3b), decoy: with a source On, Run sends the replay', async () => {
  const { dialog, net } = await runAfterConsent((_id, i) => (i === 0 ? 'on' : 'off'));
  assert.ok(replays(net).length >= 1, `with a source On the dialog sent no replay: ${dialog.text().slice(-700)}`);
  assert.equal(lastRefusal, null, `the real gate refused a replay with a source On: ${JSON.stringify(lastRefusal)}`);
  assert.ok(!dialog.text().includes(NO_SOURCES_ON), 'the dialog shows item 42\'s sentence with a source On');
  dialog.unmount();
});
