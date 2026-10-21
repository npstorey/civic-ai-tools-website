// R6 W3 (#632), criteria 1, 5, 11 and 15 (Q1, Q7): the Sources panel,
// rendered.
//
// THE PANEL (anchor W3 item 1). One row per configured source, in manifest
// order: its name, its publisher (the manifest entry's `publisher`, else "not
// stated"; D11), where it runs, who holds its logs and what they say they
// keep, how current its data is, and the three-state control (On, Ask first,
// Off). An Ask first row says what Ask first means in R6, in literal words:
// nothing is sent to the source until it is turned On (Q1, T6). A footer carries the
// privacy page and the deployment guide's address (D10), or says the site
// names no guide. For a session without a `dbId` the panel shows the date the
// consent was given and a control that withdraws it in place; for a session
// with one, the footer links to the dashboard's Sources tab instead (Q7).
//
// WHAT IS DRIVEN. The real panel on the surface harness, reading the REAL
// `/api/flows` and `/api/sources/consent` handlers (a cookie jar between
// requests), under a configuration with every hosting kind the manifest has:
// Socrata at an address (`remote`, run by the server's operator), Data
// Commons at its publisher's endpoint, Boston at a government endpoint, and
// NYC Charter in this site's sandbox (`npm-package`), whose sandbox platform
// states nothing about what it keeps. The states are written first through
// the real consent endpoint, as the panel itself would write them.
//
// NAMES (criterion 11, T13). Each name is the source's one reader name, the
// record page's (`src/lib/sources/source-name.test.ts` pins the two equal);
// here, the rendered panel carries no "MCP Server".
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no panel.
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
  readableText,
  registerSurfaceHooks,
  sessions,
  textOf,
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';
import { renderToStaticMarkup } from 'react-dom/server';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

for (const name of [
  'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.EXECUTOR_DRIVER = 'vercel-sandbox';

const ORIGIN = 'https://site.fixture.example';
const GUIDE = 'https://guide.fixture.example/deploy';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { CIVIC_MANIFEST } = (await import('@typedstandards/civic-typed-router')) as unknown as { CIVIC_MANIFEST: Array<{ sourceId: string; displayName: string; publisher?: string; freshness: string }> };

/** The modules W3 adds, by specifiers typed `string`, so the red commit type-checks. */
const PANEL: string = '@/components/sources/SourcesPanel';
const COPY: string = '@/lib/sources/copy';
const panelModule = (await import(PANEL).catch(() => null)) as Mod | null;
const copy = (await import(COPY).catch(() => null)) as Mod | null;

function Panel(): ComponentType {
  assert.ok(panelModule?.default, `no Sources panel: ${PANEL} does not exist`);
  return panelModule!.default as ComponentType;
}

function answers() {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

/** Write `states` through the real consent endpoint, as the panel would, then mount the panel. */
async function panelWith(states: Record<string, string> | null): Promise<{ panel: Surface; net: ReturnType<typeof answers> }> {
  const component = Panel();
  const net = answers();
  if (states) {
    const statement = await buildFlowsStatement();
    const response = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, flowsVersion: statementHash(statement) }) });
    assert.equal(response.status, 200, `premise: the consent write was refused: ${await response.text()}`);
  }
  net.clear();
  const panel = await mount(h(component));
  return { panel, net };
}

const ANON = () => {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
};
const SIGNED_IN_DB = () => {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '88888888-8888-4888-8888-888888888888' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture' } } };
};

const STATE_LABEL: Record<string, string> = { on: 'On', 'ask-first': 'Ask first', off: 'Off' };
const CONFIGURED = ['socrata', 'data-commons', 'boston-opencontext', 'nyc-charter'];
/** T13 (#632 G7): each source's one reader name, written out. */
const READER_NAME: Record<string, string> = { socrata: 'Socrata', 'data-commons': 'Data Commons', 'boston-opencontext': 'Boston OpenContext', 'nyc-charter': 'NYC Charter, Laws and Rules' };
const readerName = (sourceId: string) => READER_NAME[sourceId];

/** Each source's row: the one element carrying `data-source="<id>"`. */
function rowOf(panel: Surface, sourceId: string): HostElement {
  const rows = panel.elements().filter((el) => el.props['data-source'] === sourceId);
  assert.equal(rows.length, 1, `expected one row for ${sourceId}, found ${rows.length}: ${panel.text().slice(0, 400)}`);
  return rows[0];
}

function* within(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) { for (const child of node) yield* within(child); return; }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
  const el = node as HostElement;
  if (typeof el.type === 'string') yield el;
  yield* within((el.props as { children?: unknown }).children);
}

// --- Criterion 1: one row per source, per state and per hosting kind ------------------------

for (const state of ['on', 'ask-first', 'off']) {
  test(`criterion 1 (${state}): one row per configured source, in manifest order, each with its facts and its state`, async () => {
    ANON();
    const { panel } = await panelWith(Object.fromEntries(CONFIGURED.map((id) => [id, state])));
    const statement = await buildFlowsStatement();
    assert.deepEqual(statement.sources.map((s: { sourceId: string }) => s.sourceId), CONFIGURED, 'premise: the four sources are configured');
    const order = panel.elements().filter((el) => typeof el.props['data-source'] === 'string').map((el) => el.props['data-source']);
    assert.deepEqual(order, CIVIC_MANIFEST.map((e) => e.sourceId).filter((id) => CONFIGURED.includes(id)), 'the rows are not one per configured source in manifest order');
    for (const entry of CIVIC_MANIFEST.filter((e) => CONFIGURED.includes(e.sourceId))) {
      const row = rowOf(panel, entry.sourceId);
      const text = textOf(row);
      assert.ok(text.includes(readerName(entry.sourceId)), `${entry.sourceId}'s row does not name it: ${text}`);
      assert.ok(text.includes(entry.publisher ?? 'not stated'), `${entry.sourceId}'s row does not name its publisher: ${text}`);
      assert.ok(/, running at [^.]/.test(text), `${entry.sourceId}'s row does not say where it runs (", running at"): ${text}`);
      assert.ok(text.includes(entry.freshness), `${entry.sourceId}'s row does not say how current its data is: ${text}`);
      const source = statement.sources.find((s: { sourceId: string }) => s.sourceId === entry.sourceId);
      for (const keptBy of source.recipients.flatMap((r: { keptBy: Array<{ holder: string }> }) => r.keptBy)) {
        assert.ok(text.includes(keptBy.holder), `${entry.sourceId}'s row does not say who holds its logs (${keptBy.holder}): ${text}`);
      }
      // The control: a radio group named for the source, its three choices native radios, the stored one checked.
      const groups = [...within(row)].filter((el) => el.props.role === 'radiogroup');
      assert.equal(groups.length, 1, `${entry.sourceId}'s row has no radio group`);
      assert.ok(String(groups[0].props['aria-label'] ?? '').includes(readerName(entry.sourceId)), `${entry.sourceId}'s control is not named for it`);
      const radios = [...within(groups[0])].filter((el) => el.type === 'input' && el.props.type === 'radio');
      assert.equal(radios.length, 3, `${entry.sourceId}'s control does not offer three native radio choices`);
      assert.equal(new Set(radios.map((r) => r.props.name)).size, 1, `${entry.sourceId}'s radios are not one group (arrow keys move within a group of one name)`);
      const checked = radios.filter((r) => r.props.checked === true);
      assert.equal(checked.length, 1, `${entry.sourceId}'s control has ${checked.length} choices checked`);
      assert.equal(checked[0].props.value, state, `${entry.sourceId}'s control shows ${checked[0].props.value}, not ${state}`);
      const labelled = readableText(renderToStaticMarkup(groups[0]));
      for (const label of Object.values(STATE_LABEL)) assert.ok(labelled.includes(label), `${entry.sourceId}'s control does not read "${label}"`);
    }
    panel.unmount();
  });
}

test('criterion 1: Charter\'s sandbox row says it runs in this site\'s sandbox, and its platform\'s posture reads "not stated"', async () => {
  ANON();
  const { panel } = await panelWith(Object.fromEntries(CONFIGURED.map((id) => [id, 'on'])));
  const text = textOf(rowOf(panel, 'nyc-charter'));
  assert.ok(text.includes(", running at this site's sandbox."), `Charter's row does not say it runs in this site's sandbox: ${text}`);
  assert.ok(text.includes('not stated'), `Charter's sandbox platform does not read "not stated": ${text}`);
  panel.unmount();
});

test('criterion 1: choosing a state writes it through the consent endpoint, keyboard-operable as a native radio', async () => {
  ANON();
  const { panel, net } = await panelWith(Object.fromEntries(CONFIGURED.map((id) => [id, 'on'])));
  const off = [...within(rowOf(panel, 'data-commons'))].filter((el) => el.type === 'input' && el.props.type === 'radio' && el.props.value === 'off');
  assert.equal(off.length, 1, 'Data Commons\' row has no Off choice');
  await panel.check(off[0]);
  const writes = net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'PUT');
  assert.equal(writes.length, 1, 'choosing Off wrote nothing');
  assert.equal((JSON.parse(writes[0].body) as { states: Record<string, string> }).states['data-commons'], 'off');
  const checked = [...within(rowOf(panel, 'data-commons'))].filter((el) => el.type === 'input' && el.props.checked === true);
  assert.deepEqual(checked.map((el) => el.props.value), ['off'], 'the row does not show the state written');
  panel.unmount();
});

// --- Criterion 15 (Q1): what Ask first means, in literal words -----------------------------------

test('criterion 15 (Q1, T6): an Ask first row says, in literal words, that nothing is sent to the source until it is turned On', async () => {
  ANON();
  const { panel } = await panelWith({ socrata: 'on', 'data-commons': 'ask-first', 'boston-opencontext': 'on', 'nyc-charter': 'on' });
  assert.ok(copy && typeof copy.ASK_FIRST_MEANS === 'string', `${COPY} exports no ASK_FIRST_MEANS`);
  assert.match(copy!.ASK_FIRST_MEANS, /nothing is sent to this source/i);
  assert.match(copy!.ASK_FIRST_MEANS, /until[^.]*\bOn\b/);
  assert.ok(textOf(rowOf(panel, 'data-commons')).includes(copy!.ASK_FIRST_MEANS), 'the Ask first row does not say what Ask first means');
  assert.ok(!textOf(rowOf(panel, 'socrata')).includes(copy!.ASK_FIRST_MEANS), 'an On row says what Ask first means');
  panel.unmount();
});

// --- Without a dbId: the date given and the revoke in place; with one, the dashboard (Q7) ----------

test('criterion 1: for a session without a dbId, the panel shows the date given and a withdraw control that calls DELETE', async () => {
  ANON();
  const { panel, net } = await panelWith(Object.fromEntries(CONFIGURED.map((id) => [id, 'on'])));
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(panel.text().includes(today), `the panel does not show the date the consent was given (${today})`);
  const withdraw = panel.elements().filter((el) => el.type === 'button' && /withdraw/i.test(textOf(el)));
  assert.equal(withdraw.length, 1, 'the panel has no withdraw control');
  await panel.click(withdraw[0]);
  assert.equal(net.sent.filter((r) => r.path === '/api/sources/consent' && r.method === 'DELETE').length, 1, 'withdraw did not call DELETE');
  assert.equal(net.jar.size, 0, 'the consent cookie is still held after withdrawing');
  panel.unmount();
});

// Amendment 1, correction 3 (Q7, chosen): the panel withdraws in place for
// every session, and a session whose consent is on its account also gets the
// link to the dashboard's Sources tab, which withdraws too. Stage A asserted
// no in-place withdraw for such a session; the ruling replaced that.
test('criterion 15 (Q7): for a session with a dbId, the footer links to the dashboard\'s Sources tab, and the panel withdraws in place too', async () => {
  SIGNED_IN_DB();
  sessions.rows.clear();
  const { panel } = await panelWith(Object.fromEntries(CONFIGURED.map((id) => [id, 'on'])));
  const links = panel.elements().filter((el) => el.type === 'a' && typeof el.props.href === 'string' && /^\/dashboard\b/.test(el.props.href as string) && /sources/i.test(el.props.href as string));
  assert.equal(links.length, 1, `the panel does not link to the dashboard's Sources tab: ${panel.text().slice(0, 400)}`);
  assert.equal(panel.elements().filter((el) => el.type === 'button' && /withdraw/i.test(textOf(el))).length, 1, 'the panel does not withdraw in place for a session whose consent is on its account');
  panel.unmount();
  ANON();
});

// --- Criterion 5: the footer's two links -------------------------------------------------------

test('criterion 5: unset, the panel footer omits the guide link and says this site names no guide; the privacy link is there', async () => {
  ANON();
  delete process.env.SITE_DEPLOYMENT_GUIDE_URL;
  const { panel } = await panelWith(null);
  assert.ok(panel.elements().some((el) => el.type === 'a' && el.props.href === '/privacy'), 'the footer has no privacy link');
  assert.ok(copy?.NO_GUIDE_SENTENCE, `${COPY} exports no NO_GUIDE_SENTENCE`);
  assert.ok(panel.text().includes(copy!.NO_GUIDE_SENTENCE), 'with no guide address, the footer does not say so');
  assert.ok(!panel.elements().some((el) => el.type === 'a' && el.props.href === GUIDE), 'the footer links to a guide no one configured');
  panel.unmount();
});

test('criterion 5: set, the panel footer links to the deployment guide', async () => {
  ANON();
  process.env.SITE_DEPLOYMENT_GUIDE_URL = GUIDE;
  try {
    const { panel } = await panelWith(null);
    assert.equal(panel.elements().filter((el) => el.type === 'a' && el.props.href === GUIDE).length, 1, 'the footer does not link to the configured guide');
    assert.ok(!copy?.NO_GUIDE_SENTENCE || !panel.text().includes(copy.NO_GUIDE_SENTENCE), 'the footer says no guide is named while it links to one');
    panel.unmount();
  } finally {
    delete process.env.SITE_DEPLOYMENT_GUIDE_URL;
  }
});

// --- Criterion 11: the names, rendered ------------------------------------------------------------

test('criterion 11: the panel shows each source\'s name without " MCP Server"', async () => {
  ANON();
  const { panel } = await panelWith(null);
  assert.ok(!panel.text().includes('MCP Server'), `the panel says "MCP Server": ${panel.text().slice(0, 400)}`);
  for (const entry of CIVIC_MANIFEST.filter((e) => CONFIGURED.includes(e.sourceId))) {
    assert.ok(panel.text().includes(readerName(entry.sourceId)), `the panel does not name ${entry.sourceId} as ${readerName(entry.sourceId)}`);
  }
  panel.unmount();
});

// --- R6 PL (D1 = A, D2 = A): what each source is, and whose connector reaches it ----------------
//
// The owner's rulings (R6 PL, 2026-10-20): each row adds one line saying what
// the source is, and replaces "Published by X" with "This site reaches it
// through an MCP server, a connector that X publishes, running at <where>.",
// X a link to the connector's repository (`target="_blank"`, `rel="noopener
// noreferrer"`, as `KeptByLine` and `LocalOnlyOffer` render theirs). The
// panel upper-cases the what-line's first letter; the privacy page prints it
// as stored. The strings are written out here from the ruling, with `<where>`
// as this file's configuration gives it (`sourceWhere`).
//
// THE FALLBACK AND THE CASE (criterion 3). A source with no map entry gets no
// what-line and the reach sentence with the statement's `publisher`,
// unlinked; with "not stated", the sentence says the publisher is not stated.
// The synthetic sources are served by a stand-in `/api/flows` (the real
// statement plus the four below), and the two synthetic map entries are added
// to `SOURCE_DESCRIPTIONS` for the test and removed after it: the panel reads
// the map when it renders.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the row reads "Published by X. Runs
// at Y.", with no what-line and no link, and `copy.ts` has no map.

const sourceName = await load('lib/sources/source-name.ts');

/** D1 = A, as the panel prints each what-line (first letter upper-cased). */
const RULED_WHAT: Record<string, string> = {
  socrata: 'An open-data portal platform from Tyler Technologies. Many cities and states publish their data on its portals.',
  'data-commons': 'Public statistics from government agencies and international organizations, gathered by Google.',
  'boston-opencontext': "The City of Boston's open data, from data.boston.gov.",
  'nyc-charter': "The text of New York City's Charter, Administrative Code and Rules.",
};
/** D2 = A: the publisher as the row prints it, and the connector's repository. */
const RULED_PUBLISHER: Record<string, { text: string; link: string }> = {
  socrata: { text: 'npstorey', link: 'https://github.com/npstorey/socrata-mcp-server' },
  'data-commons': { text: 'Google', link: 'https://github.com/datacommonsorg/agent-toolkit' },
  'boston-opencontext': { text: 'the City of Boston', link: 'https://github.com/CityOfBoston/OpenContext' },
  'nyc-charter': { text: 'BetaNYC', link: 'https://github.com/BetaNYC/nyc-charter-laws-rules' },
};
const reachSentence = (publisher: string, where: string) => `This site reaches it through an MCP server, a connector that ${publisher} publishes, running at ${where}.`;
const reachUnstated = (where: string) => `This site reaches it through an MCP server, a connector whose publisher is not stated, running at ${where}.`;

for (const id of CONFIGURED) {
  test(`PL criterion 1 (${id}): the row says what the source is, then whose connector reaches it and where, the publisher linked to its repository`, async () => {
    ANON();
    const { panel } = await panelWith(Object.fromEntries(CONFIGURED.map((s) => [s, 'on'])));
    const statement = await buildFlowsStatement();
    const source = statement.sources.find((s: { sourceId: string }) => s.sourceId === id);
    assert.ok(source, `premise: ${id} is configured`);
    const where: string = sourceName.sourceWhere(source);
    const row = rowOf(panel, id);
    const lines = [...within(row)].map((el) => textOf(el));
    const sentence = reachSentence(RULED_PUBLISHER[id].text, where);
    assert.ok(lines.includes(RULED_WHAT[id]), `${id}'s row has no line reading "${RULED_WHAT[id]}": ${textOf(row)}`);
    assert.ok(lines.includes(sentence), `${id}'s row has no line reading "${sentence}": ${textOf(row)}`);
    assert.ok(textOf(row).startsWith(`${readerName(id)} ${RULED_WHAT[id]} ${sentence} Who holds its logs: `), `${id}'s row does not read name, what-line, reach sentence, logs, in that order: ${textOf(row)}`);
    const links = [...within(row)].filter((el) => el.type === 'a' && el.props.href === RULED_PUBLISHER[id].link);
    assert.equal(links.length, 1, `${id}'s row does not link ${RULED_PUBLISHER[id].link} once`);
    assert.equal(textOf(links[0]), RULED_PUBLISHER[id].text, `${id}'s link does not read the publisher's name`);
    assert.equal(links[0].props.target, '_blank', `${id}'s link does not open a new tab`);
    assert.equal(links[0].props.rel, 'noopener noreferrer', `${id}'s link's rel is not "noopener noreferrer"`);
    panel.unmount();
  });
}

test('PL criterion 1: the panel renders neither "Published by" nor ", published by"', async () => {
  ANON();
  const { panel } = await panelWith(Object.fromEntries(CONFIGURED.map((s) => [s, 'ask-first'])));
  for (const old of ['Published by', ', published by']) {
    const at = panel.text().indexOf(old);
    assert.ok(at < 0, `the panel renders "${old}": …${panel.text().slice(Math.max(0, at - 80), at + 80)}…`);
  }
  panel.unmount();
});

/** Criterion 3's synthetic sources: two with no map entry, two whose entries the test adds. */
const FIXTURE_SOURCES = [
  { sourceId: 'fixture-unmapped', name: 'Fixture Unmapped', publisher: 'Fixture Publisher', host: 'unmapped.fixture.example' },
  { sourceId: 'fixture-unstated', name: 'Fixture Unstated', publisher: 'not stated', host: 'unstated.fixture.example' },
  { sourceId: 'fixture-proper', name: 'Fixture Proper', publisher: 'Fixture Proper Org', host: 'proper.fixture.example' },
  { sourceId: 'fixture-lower', name: 'Fixture Lower', publisher: 'Fixture Lower Org', host: 'lower.fixture.example' },
];
const FIXTURE_ENTRIES: Record<string, { what: string; publisher: string; link: string }> = {
  'fixture-proper': { what: "New York State's fixture records, from a fixture portal.", publisher: 'Fixture Proper Org', link: 'https://proper.fixture.example/connector' },
  'fixture-lower': { what: 'an example fixture platform, for the case test.', publisher: 'Fixture Lower Org', link: 'https://lower.fixture.example/connector' },
};

test('PL criterion 3 (panel): no map entry reads the reach sentence unlinked with no what-line; a proper noun stays, "an …" reads "An …"', async () => {
  ANON();
  const map = copy?.SOURCE_DESCRIPTIONS as Record<string, unknown> | undefined;
  assert.ok(map && typeof map === 'object', `${COPY} exports no SOURCE_DESCRIPTIONS`);
  const statement = await buildFlowsStatement();
  const synthetic = FIXTURE_SOURCES.map((f) => ({ ...statement.sources[0], sourceId: f.sourceId, displayName: `${f.name} MCP Server`, publisher: f.publisher, host: f.host }));
  for (const [id, entry] of Object.entries(FIXTURE_ENTRIES)) map![id] = entry;
  try {
    const component = Panel();
    installFetch(ORIGIN, {
      '/api/flows': () => new Response(JSON.stringify({ ...statement, sources: [...statement.sources, ...synthetic] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
    });
    const panel = await mount(h(component));
    const expected: Record<string, string> = {
      'fixture-unmapped': `Fixture Unmapped ${reachSentence('Fixture Publisher', 'unmapped.fixture.example')} Who holds its logs: `,
      'fixture-unstated': `Fixture Unstated ${reachUnstated('unstated.fixture.example')} Who holds its logs: `,
      'fixture-proper': `Fixture Proper New York State's fixture records, from a fixture portal. ${reachSentence('Fixture Proper Org', 'proper.fixture.example')} Who holds its logs: `,
      'fixture-lower': `Fixture Lower An example fixture platform, for the case test. ${reachSentence('Fixture Lower Org', 'lower.fixture.example')} Who holds its logs: `,
    };
    for (const f of FIXTURE_SOURCES) {
      const row = rowOf(panel, f.sourceId);
      assert.ok(textOf(row).startsWith(expected[f.sourceId]), `${f.sourceId}: expected the row to start "${expected[f.sourceId]}": ${textOf(row)}`);
      const named = [...within(row)].filter((el) => el.type === 'a' && textOf(el) === f.publisher);
      const entry = FIXTURE_ENTRIES[f.sourceId];
      if (entry) {
        assert.equal(named.length, 1, `${f.sourceId}: the mapped publisher is not linked once`);
        assert.equal(named[0].props.href, entry.link, `${f.sourceId}: the link is not the entry's`);
      } else {
        assert.equal(named.length, 0, `${f.sourceId}: an unmapped publisher is linked`);
      }
    }
    panel.unmount();
  } finally {
    for (const id of Object.keys(FIXTURE_ENTRIES)) delete map![id];
  }
});
