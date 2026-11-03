// UX-1 PC (#719, leg 1; G0-7 (a)): the dashboard's Sources tab sets each
// source's state.
//
// THE RULE. Signed in, with a consent in force, the Sources tab carries the
// Sources panel's control: one radio group per configured source, named for
// it ("<Source>: On, Ask first or Off"), of three radios. A choice is written
// through the same hook the panel uses, so it reaches `PUT
// /api/sources/consent` with every configured source's state and the flows
// version, and the row then confirms it with the panel's status line
// (`PANEL_STATE_CHANGED`). With no consent in force the tab shows no control,
// as before: without one a choice would be kept on the page and written by
// nothing the tab shows.
//
// WHAT IS DRIVEN. The real `DashboardTabs` on the surface harness, with the
// real consent endpoint and `/api/flows` behind it and the account's row held
// in memory; the consent written first through the real PUT.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the tab has no control (F23): it
// lists the states and withdraws the consent. The choice is made on a source
// whose stored state is Off, to Ask first, a state no source holds before the
// change, so neither the written body nor the confirmation can match by
// coincidence; and more than one source is configured, so a write of the one
// changed state alone is told apart from a write of every state.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType, ReactNode } from 'react';
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

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://app.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${ORIGIN}/dashboard`, origin: ORIGIN, pathname: '/dashboard' }, scrollTo() {} },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { PANEL_STATE_CHANGED, SOURCES_TAB_NO_CONSENT } = await load('lib/sources/copy.ts');
const { readerSourceName } = await load('lib/sources/source-name.ts');

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

const DB_ID = '77777777-7777-4777-8777-777777777777';
function signedIn(): void {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: DB_ID } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
}

const LABEL: Record<string, string> = { on: 'On', 'ask-first': 'Ask first', off: 'Off' };

/** Every host element under `node`, in document order (the node itself excluded). */
function within(node: HostElement): HostElement[] {
  const found: HostElement[] = [];
  const walk = (child: ReactNode): void => {
    if (Array.isArray(child)) {
      for (const c of child) walk(c);
      return;
    }
    if (child === null || typeof child !== 'object' || !('props' in child)) return;
    const el = child as HostElement;
    if (typeof el.type === 'string') found.push(el);
    walk((el.props as { children?: ReactNode }).children);
  };
  walk((node.props as { children?: ReactNode }).children);
  return found;
}

/** The dashboard, on its Sources tab. */
async function openTab(): Promise<Surface> {
  const tab = await mount(h(DashboardTabs, { myEvidence: [], myEvaluations: [], activity: [], tokens: [], signingConfigured: true, sealOnly: false }));
  const buttons = tab.buttons('Sources');
  assert.equal(buttons.length, 1, `premise: the dashboard has a Sources tab: ${tab.text().slice(0, 300)}`);
  await tab.click(buttons[0]);
  return tab;
}

/** A consent on the account, the first source On and the rest Off, written through the real endpoint; then the tab. */
async function tabInForce(): Promise<{ tab: Surface; net: ReturnType<typeof answers>; statement: Mod; stored: Record<string, string> }> {
  signedIn();
  sessions.rows.clear();
  const net = answers();
  const statement = await buildFlowsStatement();
  const stored = Object.fromEntries((statement.sources as Mod[]).map((s, i) => [s.sourceId as string, i === 0 ? 'on' : 'off']));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: stored, flowsVersion: statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent write was refused: ${await written.text()}`);
  assert.ok(sessions.rows.has(DB_ID), 'premise: the consent is kept on the account');
  net.clear();
  const tab = await openTab();
  assert.ok(!tab.text().includes(SOURCES_TAB_NO_CONSENT), `premise: the tab reads the consent as in force: ${tab.text().slice(0, 300)}`);
  return { tab, net, statement, stored };
}

const rowOf = (tab: Surface, sourceId: string): HostElement => {
  const rows = tab.elements().filter((el) => el.props['data-source'] === sourceId);
  assert.equal(rows.length, 1, `premise: the tab has one row for ${sourceId}`);
  return rows[0];
};

test('PC criterion 1: with a consent in force, the Sources tab renders one radio group per configured source, named for it, showing its stored state', async () => {
  const { tab, statement, stored } = await tabInForce();
  const sources = statement.sources as Mod[];
  assert.ok(sources.length >= 2, `premise: more than one source is configured (${sources.length})`);
  const groups = tab.elements().filter((el) => el.props.role === 'radiogroup');
  assert.equal(groups.length, sources.length, `the tab has ${groups.length} radio group(s) for ${sources.length} configured sources: ${tab.text().slice(0, 400)}`);
  for (const source of sources) {
    const name = readerSourceName(source) as string;
    const inRow = within(rowOf(tab, source.sourceId)).filter((el) => el.props.role === 'radiogroup');
    assert.equal(inRow.length, 1, `${source.sourceId}'s row carries no radio group`);
    assert.equal(inRow[0].props['aria-label'], `${name}: On, Ask first or Off`, `${source.sourceId}'s radio group is not named for it`);
    const radios = within(inRow[0]).filter((el) => el.type === 'input' && el.props.type === 'radio');
    assert.deepEqual(radios.map((r) => r.props.value), ['on', 'ask-first', 'off'], `${source.sourceId}'s radio group does not offer On, Ask first and Off`);
    assert.deepEqual(radios.filter((r) => r.props.checked === true).map((r) => r.props.value), [stored[source.sourceId]], `${source.sourceId}'s control does not show its stored state`);
  }
  tab.unmount();
});

test('PC criterion 1: a choice on the tab writes every configured source\'s state with the flows version, and the row confirms it in the panel\'s words', async () => {
  const { tab, net, statement, stored } = await tabInForce();
  const sources = statement.sources as Mod[];
  assert.ok(sources.length >= 2, `premise: more than one source is configured (${sources.length})`);
  const changed = sources[1];
  const name = readerSourceName(changed) as string;
  assert.equal(stored[changed.sourceId], 'off', 'premise: the changed source is stored Off');
  assert.ok(!Object.values(stored).includes('ask-first'), 'premise: no source is Ask first before the change');

  const choice = within(rowOf(tab, changed.sourceId)).filter((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'ask-first');
  assert.equal(choice.length, 1, `the tab has no Ask first choice for ${changed.sourceId}: ${textOf(rowOf(tab, changed.sourceId))}`);
  await tab.check(choice[0]);
  await tab.settle();

  const puts = net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'PUT');
  assert.equal(puts.length, 1, `the choice did not write one PUT /api/sources/consent (${puts.length})`);
  const body = JSON.parse(puts[0].body) as { states: Record<string, string>; flowsVersion: string };
  assert.deepEqual(body.states, { ...stored, [changed.sourceId]: 'ask-first' }, 'the PUT does not carry every configured source\'s state, with the change');
  assert.equal(body.flowsVersion, statementHash(statement), 'the PUT does not carry the flows version');
  const accountRow = sessions.rows.get(DB_ID) as { states?: Record<string, { state?: string }> } | undefined;
  assert.equal(accountRow?.states?.[changed.sourceId]?.state, 'ask-first', 'the account\'s row does not hold the change');

  const row = rowOf(tab, changed.sourceId);
  const status = within(row).filter((el) => el.props.role === 'status');
  assert.equal(status.length, 1, `the row has no status line after the change: ${textOf(row)}`);
  const sentence = `${name}${PANEL_STATE_CHANGED.middle}${LABEL['ask-first']}${PANEL_STATE_CHANGED.end}`;
  assert.ok(textOf(status[0]).startsWith(sentence), `the row's status line is not the panel's confirmation: ${textOf(status[0])}`);
  assert.equal(tab.elements().filter((el) => el.props.role === 'status' && textOf(el).includes(PANEL_STATE_CHANGED.end)).length, 1, 'more than one row confirms a change');
  tab.unmount();
});

test('PC criterion 2: with no consent in force the tab renders as before, with no control', async () => {
  signedIn();
  sessions.rows.clear();
  answers();
  const tab = await openTab();
  assert.ok(tab.text().includes(SOURCES_TAB_NO_CONSENT), `premise: the tab says no consent is in force: ${tab.text().slice(0, 300)}`);
  assert.deepEqual(tab.elements().filter((el) => el.props.role === 'radiogroup' || (el.type === 'input' && el.props.type === 'radio')).map((el) => el.type), [], 'the tab shows a control with no consent in force');
  assert.equal(tab.buttons('Withdraw consent').length, 0, 'the tab offers a withdrawal with no consent in force');
  tab.unmount();
});
