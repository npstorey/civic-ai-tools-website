// R9 P2 (#661): the Sources panel before a consent — its radios live, a change
// kept on the page and written by Allow, the lead counting what Allow will
// use, and each row collapsed to its name, its what-line and its control.
//
// THE RULE. Before a consent the radios take a choice, and the choice is kept
// on the page's consent store, not written: nothing leaves the page until the
// reader answers the card. Allow then writes the states the panel shows: the
// reader's own where they set one, the defaults (`currentStates`) where they
// did not, so the card's "turns on the sources the panel shows as On" is true
// of the panel. A refresh of the store between the change and Allow (the card
// mounting reads the status again) keeps the reader's choice (the seat's
// note 1). Before Allow no "is now" line is shown (note 2). The drive runs
// signed out, where Allow writes the consent cookie (note 3); a change with a
// consent in force still writes at once (`sources-panel.test.ts`,
// `panel-state-confirmed.test.ts`, and the last step of the first test here).
//
// THE LEAD before a consent counts the states the panel shows, in words, and
// omits a group with none: "These are the settings Allow will use: four
// sources On, two Ask first. Set them now, or change them after you allow."
// After Allow it is the in-force lead.
//
// THE ROW. Name, what-line, control; then "More about this source", a
// `<details>` holding exactly the reach line, "Who holds its logs" and "How
// current its data is". The radio group's role and accessible name and the
// radios' `name` and `value` are as they were.
//
// WHAT IS DRIVEN. The real home page and the real panel on the surface
// harness, with the REAL `/api/flows` and `/api/sources/consent` handlers
// behind them and a cookie jar between requests, under two configurations:
// the reference instance's six sources (four On by default, two Ask first),
// and the three sources the consent-text tests use (all On by default). A
// third configuration answers the status read with one default Off, since no
// manifest entry defaults to Off at this base.
//
// WHAT MAKES IT ABLE TO FAIL. At the base every radio is `disabled` before a
// consent and a change is refused without a write; Allow sends the defaults
// whatever the panel shows; the lead is one fixed sentence; and every row
// prints all five lines with no `<details>`. The drive changes two sources
// with different defaults (an On one to Off, an Ask first one to On), so a
// body of all defaults, or of one state for every source, cannot match.
// Every expected string is written out here, never read from `copy.ts`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  readableText,
  registerSurfaceHooks,
  sessions,
  textOf,
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

// --- The configurations -------------------------------------------------------------------

const READ = [
  'SOCRATA_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING',
  'NYS_LEGISLATION_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'DATABASE_URL',
];
for (const name of READ) delete process.env[name];
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

/** The reference instance's six sources (the change log's 2026-10-21 entry), and the consent-text tests' three. */
const SIX = ['socrata', 'data-commons', 'nyc-charter', 'nyc-checkbook', 'nyc-record', 'nys-legislation'];
const THREE = ['socrata', 'data-commons', 'nyc-charter'];

function configure(sources: 'six' | 'three'): void {
  for (const name of READ) delete process.env[name];
  process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
  process.env.NYC_CHARTER_HOSTING = 'sandbox';
  if (sources === 'six') {
    process.env.NYC_CHECKBOOK_HOSTING = 'sandbox';
    process.env.NYC_RECORD_HOSTING = 'sandbox';
    process.env.NYS_LEGISLATION_HOSTING = 'sandbox';
    process.env.NYS_LEGISLATION_API_KEY = 'fixture';
  }
}

const ORIGIN = 'https://site.fixture.example';

// The browser globals the home page reads.
const storage = new Map<string, string>();
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } },
    location: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/' },
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});

// --- The modules -------------------------------------------------------------------------------

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Home = (await load('app/(marketing)/page.tsx')).default as ComponentType;
const Panel = (await load('components/sources/SourcesPanel.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { consentInForce } = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const { refreshConsent, allowConsent } = await load('components/sources/useSourceConsent.ts');

/**
 * The harness leaves the consent store's subscriptions behind after `unmount()`, so the store
 * carries into the next test: a test that leaves a change pending ends with Allow, which clears it.
 */
async function endPending(page: Surface): Promise<void> {
  page.unmount();
  await allowConsent();
}

// --- The answers ---------------------------------------------------------------------------------

const sse = (events: Array<Record<string, unknown>>) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/** The real routes; `defaults`, when given, replaces the status read's defaults (the configuration with a source Off by default). */
function answers(defaults?: Record<string, string>) {
  return installFetch(ORIGIN, {
    '/api/models': () => new Response(JSON.stringify({ models: [{ id: 'fixture/model', name: 'Fixture model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': async (request: Request) => {
      const response = await (consentRoute[request.method] as (r: Request) => Promise<Response>)(request);
      if (!defaults || request.method !== 'GET') return response;
      const body = (await response.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...body, defaults }), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    },
    '/api/sources/consent/decision': () => new Response(JSON.stringify({ routing: 'all-sources', store: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/compare-stream': async (request: Request) => {
      const decision = await consentInForce(request, sessions.server);
      if (!decision.ok) return sse([{ type: 'error', panel: 'withMcp', message: decision.payload.error, code: decision.payload.code }]);
      return sse(['withoutMcp', 'withMcp'].map((panel) => ({ type: 'complete', panel, data: { content: 'An answer.', duration_ms: 1, tools_called: [] } })));
    },
  });
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};

// --- Reading the panel ---------------------------------------------------------------------------

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const child of node) yield* within(child); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

function section(surface: Surface): HostElement {
  const found = surface.elements().filter((el) => el.type === 'section' && el.props['aria-labelledby'] === 'sources-panel-heading');
  assert.equal(found.length, 1, `expected one Sources panel, found ${found.length}`);
  return found[0];
}

/** The panel's lead: its first paragraph, under the heading. */
const leadOf = (surface: Surface): string => textOf([...within(section(surface))].find((el) => el.type === 'p')!);

function rowOf(surface: Surface, id: string): HostElement {
  const rows = [...within(section(surface))].filter((el) => el.props['data-source'] === id);
  assert.equal(rows.length, 1, `expected one row for ${id}, found ${rows.length}`);
  return rows[0];
}

const radiosOf = (surface: Surface, id: string): HostElement[] =>
  [...within(rowOf(surface, id))].filter((el) => el.type === 'input' && el.props.type === 'radio');

function radio(surface: Surface, id: string, value: string): HostElement {
  const found = radiosOf(surface, id).filter((el) => el.props.value === value);
  assert.equal(found.length, 1, `${id} has no ${value} choice`);
  return found[0];
}

/** The state each row shows checked, by source id. */
function shown(surface: Surface, ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => {
    const checked = radiosOf(surface, id).filter((el) => el.props.checked === true);
    assert.equal(checked.length, 1, `${id} shows ${checked.length} choices checked`);
    return [id, String(checked[0].props.value)];
  }));
}

/** What a reader sees with every row closed: each `<details>` keeps its `<summary>` only. */
const collapsed = (markup: string): string =>
  markup.replace(/<details([^>]*)>(<summary[^>]*>[\s\S]*?<\/summary>)[\s\S]*?<\/details>/g, '<details$1>$2</details>');
const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const consentWrites = <T extends { method: string; path: string }>(sent: T[]): T[] => sent.filter((r) => r.path === '/api/sources/consent' && r.method !== 'GET');

/** The home page's form: type the question, then submit. */
async function ask(page: Surface): Promise<void> {
  const box = page.elements().find((el) => el.type === 'textarea' && el.props['aria-label'] === 'Ask a question about open data');
  assert.ok(box, 'the home page has no question box');
  await page.type(box!, 'How many permits were filed in 2024?');
  const form = page.elements().find((el) => el.type === 'form');
  await page.submit(form!);
}

// --- Criterion 1: the radios live before a consent; Allow writes what the panel shows --------------

test('criterion 1 (home, signed out): before a consent a change is kept, not written; it survives a refresh; Allow writes it, the defaults elsewhere', async () => {
  configure('six');
  ANON();
  const net = answers();
  const statement = await buildFlowsStatement();
  assert.deepEqual(statement.sources.map((s: { sourceId: string }) => s.sourceId), SIX, 'premise: the six sources are configured');
  const status = (await (await fetch('/api/sources/consent')).json()) as { inForce: boolean; defaults: Record<string, string> };
  assert.equal(status.inForce, false, 'premise: no consent is in force');
  assert.deepEqual(status.defaults, { socrata: 'on', 'data-commons': 'on', 'nyc-charter': 'on', 'nyc-checkbook': 'ask-first', 'nyc-record': 'on', 'nys-legislation': 'ask-first' }, 'premise: the defaults differ by source');
  net.clear();
  const page = await mount(h(Home));
  assert.deepEqual(shown(page, SIX), status.defaults, 'premise: before a change the panel shows the defaults');

  // The radios are live.
  for (const id of SIX) {
    for (const r of radiosOf(page, id)) assert.equal(r.props.disabled, false, `${id}'s ${r.props.value} radio is disabled before a consent`);
  }

  // Two changes: an On source to Off, an Ask first source to On. Nothing is written.
  await page.check(radio(page, 'data-commons', 'off'));
  await page.check(radio(page, 'nyc-checkbook', 'on'));
  assert.deepEqual(consentWrites(net.sent).map((r) => `${r.method} ${r.path}`), [], 'a change before a consent wrote something');
  assert.deepEqual(net.sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`), [], 'a change before a consent sent a request that is not a read');
  const expected = { ...status.defaults, 'data-commons': 'off', 'nyc-checkbook': 'on' };
  assert.deepEqual(shown(page, SIX), expected, 'the panel does not show the reader\'s changes');
  // Note 2: nothing was written, so no "is now" line.
  assert.deepEqual([...within(section(page))].filter((el) => el.props.role === 'status').map((el) => textOf(el)), [], 'a pending change shows a status line');
  assert.ok(!textOf(section(page)).includes(' is now '), 'a pending change says "is now"');

  // Note 1: the store is read again (on focus, or when the card mounts); the reader's choices stay.
  const reads = net.sent.filter((r) => r.method === 'GET' && r.path === '/api/sources/consent').length;
  await refreshConsent();
  await page.settle();
  assert.ok(net.sent.filter((r) => r.method === 'GET' && r.path === '/api/sources/consent').length > reads, 'premise: the status was read again');
  assert.deepEqual(shown(page, SIX), expected, 'a refresh of the store lost the reader\'s changes');

  // The question: the card. Allow writes exactly what the panel shows.
  await ask(page);
  assert.equal(page.buttons('Allow').length, 1, `premise: the card is shown: ${page.text().slice(0, 300)}`);
  const panelOn = Object.entries(shown(page, SIX)).filter(([, s]) => s === 'on').map(([id]) => id).sort();
  await page.click(page.button('Allow'));
  const writes = consentWrites(net.sent);
  assert.deepEqual(writes.map((r) => r.method), ['PUT'], 'Allow did not write one consent');
  const body = JSON.parse(writes[0].body) as { states: Record<string, string> };
  assert.deepEqual(body.states, expected, 'Allow did not write the reader\'s states, with the defaults where none was set');
  // The card's effect sentence: the sources Allow turns on are the ones the panel showed as On.
  assert.deepEqual(Object.entries(body.states).filter(([, s]) => s === 'on').map(([id]) => id).sort(), panelOn, 'Allow turned on a set other than the panel\'s On');
  assert.equal(net.sent.filter((r) => r.path === '/api/compare-stream').length, 1, 'premise: after Allow the question was sent once');

  // After the 200 the panel shows the states the server returned.
  const after = (await (await fetch('/api/sources/consent')).json()) as { inForce: boolean; states: Record<string, { state: string }> };
  assert.equal(after.inForce, true, 'premise: the consent is in force');
  assert.deepEqual(shown(page, SIX), Object.fromEntries(SIX.map((id) => [id, after.states[id].state])), 'after Allow the panel does not show the stored states');
  assert.equal(leadOf(page), 'Set each data source to On, Ask first or Off. Your choice applies from your next question.', 'after Allow the lead is not the in-force lead');
  assert.deepEqual([...within(section(page))].filter((el) => el.props.role === 'status').map((el) => textOf(el)), [], 'after Allow a pending change is confirmed as if it had been written on its own');

  // With a consent in force a change writes at once, as before.
  net.clear();
  await page.check(radio(page, 'socrata', 'ask-first'));
  const now = consentWrites(net.sent);
  assert.deepEqual(now.map((r) => r.method), ['PUT'], 'with a consent in force a change did not write at once');
  assert.equal((JSON.parse(now[0].body) as { states: Record<string, string> }).states.socrata, 'ask-first');
  page.unmount();
});

// --- Criterion 2: the lead before a consent counts what Allow will use -------------------------------

const LEAD_END = ' Set them now, or change them after you allow.';

test('criterion 2: the lead before a consent counts the six defaults and follows a change (the in-force lead after Allow is read in criterion 1)', async () => {
  configure('six');
  ANON();
  answers();
  const page = await mount(h(Panel));
  assert.equal(leadOf(page), `These are the settings Allow will use: four sources On, two Ask first.${LEAD_END}`);
  await page.check(radio(page, 'socrata', 'off'));
  assert.equal(leadOf(page), `These are the settings Allow will use: three sources On, two Ask first, one Off.${LEAD_END}`, 'the lead does not follow the panel');
  await page.check(radio(page, 'socrata', 'on'));
  assert.equal(leadOf(page), `These are the settings Allow will use: four sources On, two Ask first.${LEAD_END}`);
  await endPending(page);
});

test('criterion 2: the lead at the three fixture sources, all On by default', async () => {
  configure('three');
  ANON();
  answers();
  const page = await mount(h(Panel));
  assert.deepEqual(shown(page, THREE), { socrata: 'on', 'data-commons': 'on', 'nyc-charter': 'on' }, 'premise: the three default On');
  assert.equal(leadOf(page), `These are the settings Allow will use: three sources On.${LEAD_END}`);
  page.unmount();
});

test('criterion 2: the lead at a configuration with a source Off by default, one in each state', async () => {
  configure('three');
  ANON();
  answers({ socrata: 'on', 'data-commons': 'ask-first', 'nyc-charter': 'off' });
  const page = await mount(h(Panel));
  assert.deepEqual(shown(page, THREE), { socrata: 'on', 'data-commons': 'ask-first', 'nyc-charter': 'off' }, 'premise: the stubbed defaults are shown');
  assert.equal(leadOf(page), `These are the settings Allow will use: one source On, one Ask first, one Off.${LEAD_END}`);
  // With no source On, the first group named carries the noun.
  await page.check(radio(page, 'socrata', 'off'));
  assert.equal(leadOf(page), `These are the settings Allow will use: one source Ask first, two Off.${LEAD_END}`);
  await endPending(page);
});

// --- Criterion 3: each row collapsed; the control as it was ---------------------------------------

/** The base's control, written out: role, accessible name, and each radio's name and value. */
const NAME: Record<string, string> = { socrata: 'Socrata', 'data-commons': 'Data Commons', 'nyc-charter': 'NYC Charter, Laws and Rules', 'nyc-checkbook': 'NYC Checkbook', 'nyc-record': 'NYC City Record', 'nys-legislation': 'NYS Open Legislation' };

for (const config of ['three', 'six'] as const) {
  test(`criterion 3 (${config} sources): each row is name, what-line, control, and "More about this source" holding exactly the reach, logs and currency lines`, async () => {
    configure(config);
    ANON();
    answers();
    const ids = config === 'six' ? SIX : THREE;
    const page = await mount(h(Panel));
    for (const id of ids) {
      const row = rowOf(page, id);
      const children = (Array.isArray(row.props.children) ? row.props.children : [row.props.children]).filter((c: unknown) => c !== null && c !== false && c !== undefined) as HostElement[];
      // The first three: the name, the what-line, the control.
      assert.equal(textOf(children[0]), NAME[id], `${id}'s row does not open with its name`);
      assert.ok(/^[A-Z]/.test(textOf(children[1])) && !/^This site reaches it/.test(textOf(children[1])), `${id}'s second line is not its what-line: ${textOf(children[1])}`);
      assert.equal(children[2].props.role, 'radiogroup', `${id}'s third element is not its control`);
      // The control, byte for byte as at the base.
      assert.equal(children[2].props['aria-label'], `${NAME[id]}: On, Ask first or Off`, `${id}'s control's accessible name moved`);
      assert.deepEqual(radiosOf(page, id).map((r) => [r.props.type, r.props.name, r.props.value]), [['radio', `source-state-${id}`, 'on'], ['radio', `source-state-${id}`, 'ask-first'], ['radio', `source-state-${id}`, 'off']], `${id}'s radios moved`);
      // The drawer.
      const drawers = [...within(row)].filter((el) => el.type === 'details');
      assert.equal(drawers.length, 1, `${id}'s row has ${drawers.length} drawers`);
      const inside = (Array.isArray(drawers[0].props.children) ? drawers[0].props.children : [drawers[0].props.children]).filter((c: unknown) => c !== null && c !== false && c !== undefined) as HostElement[];
      assert.equal(inside[0].type, 'summary', `${id}'s drawer has no summary first`);
      assert.equal(textOf(inside[0]), 'More about this source', `${id}'s drawer's summary reads "${textOf(inside[0])}"`);
      const lines = inside.slice(1).map((el) => textOf(el));
      assert.equal(lines.length, 3, `${id}'s drawer holds ${lines.length} lines: ${lines.join(' | ')}`);
      assert.match(lines[0], /^This site reaches it through an MCP server, a connector /, `${id}'s drawer's first line is not the reach line`);
      assert.match(lines[1], /^Who holds its logs: /, `${id}'s drawer's second line is not the logs line`);
      assert.match(lines[2], /^How current its data is: /, `${id}'s drawer's third line is not the currency line`);
      // None of the three outside the drawer.
      const outside = readableText(collapsed(renderToStaticMarkup(row)));
      for (const start of ['This site reaches it', 'Who holds its logs', 'How current its data is']) {
        assert.ok(!outside.includes(start), `${id}'s row shows "${start}" outside its drawer`);
      }
    }
    assert.ok(!page.text().includes('Published by') && !page.text().includes(', published by'), 'the panel renders "Published by"');
    page.unmount();
  });
}

/**
 * The words, measured at the base (79c9934) with this file's configurations
 * and no consent: 344 at the three sources and 647 at the six, every line of
 * every row shown; one row 91 to 110 words. Closed, a row keeps its name,
 * what-line, control and summary (and the Ask first line on an Ask first
 * row), so the closed panel is held to at most half the base's words; an
 * opened row to the "about 150 words" #661 names, from below and above.
 * Measured at the head: 125 and 241 closed; rows opened 95 to 114.
 */
const BOUNDS = {
  three: { panelClosed: [100, 172], rowOpen: [80, 160] },
  six: { panelClosed: [180, 323], rowOpen: [80, 160] },
} as const;

for (const config of ['three', 'six'] as const) {
  test(`criterion 3 (${config} sources): the panel's words with every row closed, and one row's words opened, within their bounds`, async () => {
    configure(config);
    ANON();
    answers();
    const ids = config === 'six' ? SIX : THREE;
    const page = await mount(h(Panel));
    const markup = renderToStaticMarkup(section(page));
    const closed = words(readableText(collapsed(markup)));
    const all = words(readableText(markup));
    const rows = ids.map((id) => [id, words(textOf(rowOf(page, id)))] as const);
    console.log(`# ${config} sources: panel ${closed} words with every row closed, ${all} with every row open; rows opened: ${rows.map(([id, n]) => `${id} ${n}`).join(', ')}`);
    const [lo, hi] = BOUNDS[config].panelClosed;
    assert.ok(closed >= lo && closed <= hi, `the closed panel reads ${closed} words, outside [${lo}, ${hi}]`);
    for (const [id, n] of rows) {
      const [rlo, rhi] = BOUNDS[config].rowOpen;
      assert.ok(n >= rlo && n <= rhi, `${id}'s row opened reads ${n} words, outside [${rlo}, ${rhi}]`);
    }
    page.unmount();
  });
}
