// CKAN-2-WEB P2 (npstorey/civic-ai-tools#329; the owner's rulings on the words memo, OA-1043, every card A): the CKAN
// source's words, as each surface renders them.
//
// WHAT IS DRIVEN. The real components on the surface harness (`registerHooks` + `transpileModule` + the real
// `renderToStaticMarkup`), fed the statement this site builds with `CKAN_MCP_URL` set:
//   - CKAN's row (`SourceRow.tsx`, the Settings row and the picker's set-up row), its drawer included;
//   - the pause card (`ConsentStep.tsx`), mounted off the bus;
//   - the privacy page (`page.tsx`), its source row and its "What recipients keep" section;
//   - a record's "Where this question went" (`WhereItWent.tsx`) for a record whose reference names the served
//     statement's hash (matched) and whose one call went to the CKAN source.
// The picker's not-set-up row is driven in `src/components/composer/picks/picker-surfaces.test.ts`, where the
// picker's mount lives.
//
// WHAT IS PINNED, as the cards rule it:
//   - M1 A and M3 A: the description line, upper-cased first on the row and the card, as stored after "CKAN: " on the
//     privacy page;
//   - M5 A: two sentences right after CKAN's reach sentence on its row, the privacy page and the pause card, and on no
//     other source's row;
//   - M4 A: "Who holds its logs: the operator of <host>: what it keeps is for this site's operator to state; the
//     operator of each portal a call names (the record names each portal by its address): not read." on the row, the
//     card, the privacy page's row and the record, with no City of Boston line; and the privacy page's definition of
//     "not read", right after the one of "not stated".
//
// WHAT MAKES IT ABLE TO FAIL. At the base (`c451a735`) the description line is P1b's two sentences, no surface prints
// M5's sentences, CKAN's holders are the server's operator and the City of Boston (metadata, its statement read
// 2026-11-16), and the privacy page defines "not stated" only: every test below fails at an assertion there. Every
// other source in the statement is rendered too, so a sentence printed on every row fails the "no other source"
// assertion.
//
// BLIND SPOTS, stated. Node, not a browser: no layout, and the drawer's text is read whether it is open or closed. The
// served bundle on a deployment is not read here.
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
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';
import { attr, readText, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, 'next/script': 'export default function Script() { return null; }' });

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const REPO = path.resolve(SRC, '..');

const { ENV_SPEC } = (await import(pathToFileURL(path.join(REPO, 'scripts', 'preflight-env.mjs')).href)) as { ENV_SPEC: { name: string }[] };
const CLEARED = [...ENV_SPEC.map((row) => row.name), 'http_proxy', 'https_proxy', 'no_proxy'];
const CKAN_HOST = 'ckan.fixture.example';
/** Every optional source on, so each other source's row is rendered beside CKAN's. Inert values: nothing is called. */
const CONFIG: Record<string, string> = {
  RATE_LIMIT_SECRET: 'fixture',
  SOCRATA_MCP_URL: 'https://socrata.fixture.example',
  BOSTON_OPENCONTEXT_MCP_URL: 'https://boston.fixture.example/mcp',
  CKAN_MCP_URL: `https://${CKAN_HOST}/mcp`,
  NYC_CHARTER_HOSTING: 'sandbox',
  NYC_CHECKBOOK_HOSTING: 'sandbox',
  NYS_LEGISLATION_HOSTING: 'sandbox',
  NYS_LEGISLATION_API_KEY: 'fixture',
  EXECUTOR_DRIVER: 'vercel-sandbox',
};
for (const name of CLEARED) delete process.env[name];
Object.assign(process.env, CONFIG);

const { buildFlowsStatementFor, statementHash } = await load('lib/flows/statement.ts');
const { whereItWentFromPackage } = await load('lib/flows/where-it-went.ts');
const SourceRow = (await load('components/sources/SourceRow.tsx')).default as ComponentType<Json>;
const ConsentStep = (await load('components/answer-view/ConsentStep.tsx')).default as ComponentType<Json>;
const WhereItWent = (await load('components/answer-view/WhereItWent.tsx')).default as ComponentType<Json>;
const PrivacyPage = (await load('app/(app)/privacy/page.tsx')).default as ComponentType;
const flowsRoute = await load('app/api/flows/route.ts');

const STATEMENT = buildFlowsStatementFor(null) as { sources: Array<Json & { sourceId: string }> };
const CKAN = STATEMENT.sources.find((s) => s.sourceId === 'ckan-server');
const OTHERS = STATEMENT.sources.filter((s) => s.sourceId !== 'ckan-server');

// --- The ruled words (the memo's cards, RULED as version 2; OA-1043) ------------------------------------------------

const WHAT = 'An open-source platform for open-data portals. Many governments publish their data on CKAN portals. Universities and other groups run CKAN portals too. The AI model chooses the portal for each request, and the record names each portal.';
const WHAT_STORED = `a${WHAT.slice(1)}`;
const REACH = `This site reaches it through an MCP server, a connector that onData publishes, running at ${CKAN_HOST}.`;
const M5 = "That server sends the AI model's searches and queries to the portal each one names. They are part of the web address the server requests, and can include words from your question.";
const LOGS = `Who holds its logs: the operator of ${CKAN_HOST}: what it keeps is for this site's operator to state; the operator of each portal a call names (the record names each portal by its address): not read.`;
const NOT_STATED = 'If a provider says nothing, we write "not stated."';
const NOT_READ = 'If we have not read a recipient\'s page, we write "not read."';
const BASE_HOLDER = 'City of Boston';

const sentences = (text: string, from: string): string => text.slice(text.indexOf(from));

function control(sourceId: string, name: string): Json {
  return { sourceId, name, state: 'ask-first', since: undefined, inForce: false, writing: false, setState: async () => true, confirmed: null, setConfirmed: () => {} };
}
async function rowOf(source: Json & { sourceId: string }): Promise<Surface> {
  return mount(h(SourceRow, { source, control: control(source.sourceId, String(source.displayName)), consent: { routing: 'in-loop', store: true, pauses: {} } }));
}

const ORIGIN = 'https://site.fixture.example';
async function cardOf(source: Json): Promise<Surface> {
  installFetch(ORIGIN, {
    '/api/sources/consent/decision': () => new Response(JSON.stringify({ routing: 'in-loop' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    '/api/flows': () => flowsRoute.GET(),
  });
  const pause = {
    key: 'ckan-words-fixture-key-000000000',
    source,
    outbound: [],
    links: { privacy: '/privacy', deploymentGuideOmitted: 'fixture' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    holds: true,
  };
  return mount(h(ConsentStep, { pause }));
}

const privacy = await mount(h(PrivacyPage));
const statementText = (id: string): string => {
  const found = privacy.elements().filter((el: HostElement) => attr(el, 'data-statement') === id);
  assert.equal(found.length, 1, `the privacy page's statement ${id}: ${found.length}`);
  return readText(found[0]);
};

test('premise: with CKAN_MCP_URL set, the statement has a CKAN row at its host, beside every other optional source', () => {
  assert.ok(CKAN, `no ckan-server row: ${STATEMENT.sources.map((s) => s.sourceId).join(', ')}`);
  assert.equal(CKAN!.host, CKAN_HOST);
  assert.ok(OTHERS.length >= 6, `the other sources: ${OTHERS.map((s) => s.sourceId).join(', ')}`);
});

test('criterion 1 (M1 A, M3 A): CKAN\'s row prints the description line, its first letter upper-cased', async () => {
  const row = await rowOf(CKAN!);
  const text = row.text();
  row.unmount();
  assert.ok(text.includes(WHAT), `CKAN's row: ${text}`);
});

test('criterion 1 (M1 A, M3 A): the pause card prints the description line, its first letter upper-cased', async () => {
  const card = await cardOf(CKAN!);
  const text = card.text();
  card.unmount();
  assert.ok(text.includes(WHAT), `the card: ${text}`);
});

test('criterion 1 (M1 A, M3 A): the privacy page\'s source row prints the line as stored, after "CKAN: "', () => {
  const text = statementText('source-row-ckan-server');
  assert.ok(text.startsWith(`CKAN: ${WHAT_STORED} ${REACH}`), `the privacy page's CKAN row: ${text}`);
});

test('criterion 2 (M5 A): the two sentences follow CKAN\'s reach sentence on its row, the pause card and the privacy page', async () => {
  const row = await rowOf(CKAN!);
  const rowText = row.text();
  row.unmount();
  const card = await cardOf(CKAN!);
  const cardText = card.text();
  card.unmount();
  const privacyText = statementText('source-row-ckan-server');
  for (const [where, text] of [['the row', rowText], ['the card', cardText], ['the privacy page', privacyText]] as const) {
    assert.ok(sentences(text, REACH).startsWith(`${REACH} ${M5} `), `${where}: the reach sentence is not followed by M5's two: ${sentences(text, REACH).slice(0, 400)}`);
  }
});

test('criterion 2 (M5 A): no other source prints the two sentences, on its row, the pause card or the privacy page', async () => {
  const first = M5.slice(0, 40);
  for (const source of OTHERS) {
    const row = await rowOf(source);
    const rowText = row.text();
    row.unmount();
    const card = await cardOf(source);
    const cardText = card.text();
    card.unmount();
    assert.ok(!rowText.includes(first), `${source.sourceId}'s row prints M5's sentences`);
    assert.ok(!cardText.includes(first), `${source.sourceId}'s card prints M5's sentences`);
    assert.ok(!statementText(`source-row-${source.sourceId}`).includes(first), `${source.sourceId}'s privacy row prints M5's sentences`);
  }
});

test('criterion 3 (M4 A): the logs line reads as ruled on CKAN\'s row and the pause card, with no City of Boston line', async () => {
  const row = await rowOf(CKAN!);
  const rowText = row.text();
  row.unmount();
  const card = await cardOf(CKAN!);
  const cardText = card.text();
  card.unmount();
  for (const [where, text] of [['the row', rowText], ['the card', cardText]] as const) {
    assert.ok(text.includes(LOGS), `${where}: ${text}`);
    assert.ok(!text.includes(BASE_HOLDER), `${where} names the ${BASE_HOLDER}`);
  }
});

test('criterion 3 (M4 A): the privacy page\'s source row carries the logs line; the page defines "not read" right after "not stated"', () => {
  const row = statementText('source-row-ckan-server');
  assert.ok(row.includes(` ${LOGS} How current its data is: `), `the privacy page's CKAN row: ${row}`);
  assert.ok(!row.includes(BASE_HOLDER), `the privacy page's CKAN row names the ${BASE_HOLDER}`);
  const keep = statementText('consent-3');
  assert.ok(keep.includes(`${NOT_STATED} ${NOT_READ} `), `"What recipients keep": ${keep}`);
});

test('criterion 3 (M4 A): a record\'s "Where this question went", matched, carries the logs line for its CKAN call', async () => {
  const served = buildFlowsStatementFor(null);
  const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const record = {
    trace: {
      resourceSpans: [{ scopeSpans: [{ spans: [
        { name: 'llm_inference', attributes: [attribute('gen_ai.request.model', 'fixture/model'), attribute('gen_ai.system', 'fixture')] },
        { name: 'mcp_tool_call', attributes: [attribute('tool.name', 'ckan__ckan_package_search'), attribute('mcp.source', 'ckan-server'), attribute('tool.operation_type', 'search'), attribute('tool.arguments', JSON.stringify({ server_url: 'https://portal.fixture.example', q: 'x' }))] },
      ] }] }],
    },
    extensions: { 'org.civicaitools.composition': { flowsStatement: { hash: statementHash(served), url: `${ORIGIN}/api/flows`, date: served.date } } },
  };
  const model = whereItWentFromPackage(record, served);
  assert.ok(model, 'premise: the record has a section');
  assert.equal(model.statement.kind, 'in-force', 'premise: the record\'s reference matches the served statement');
  const section = await mount(h(WhereItWent, { model }));
  const text = section.text();
  section.unmount();
  assert.ok(text.includes(`CKAN (${CKAN_HOST})`), `premise: the section names the CKAN source's recipient: ${text}`);
  assert.ok(text.includes(LOGS), `the section: ${text}`);
  assert.ok(!text.includes(BASE_HOLDER), `the section names the ${BASE_HOLDER}`);
});

test('criterion 3 (M4 A): /api/flows serves CKAN\'s new holder, not-read, and no City of Boston line', async () => {
  const served = JSON.parse(await (await flowsRoute.GET()).text()) as { sources: Array<{ sourceId: string; recipients: Array<{ keptBy: Json[] }> }> };
  const ckan = served.sources.find((s) => s.sourceId === 'ckan-server');
  assert.ok(ckan, 'premise: the served statement has a CKAN row');
  assert.deepEqual(ckan!.recipients.flatMap((r) => r.keptBy), [
    { holder: `the operator of ${CKAN_HOST}`, keeps: 'operator-states' },
    { holder: 'the operator of each portal a call names (the record names each portal by its address)', keeps: 'not-read' },
  ]);
  // Boston OpenContext, set in this file, names the City of Boston as its own holder; CKAN's row must not.
  assert.ok(!JSON.stringify(ckan).includes(BASE_HOLDER), `the served CKAN row names the ${BASE_HOLDER}`);
});

test('premise: the privacy page mounted under this configuration has every source row', () => {
  const ids = privacy.elements().map((el: HostElement) => attr(el, 'data-statement')).filter((id): id is string => id !== null && id.startsWith('source-row-'));
  assert.deepEqual(ids.sort(), STATEMENT.sources.map((s) => `source-row-${s.sourceId}`).sort());
  assert.ok(within(privacy.elements()[0]).length > 0, 'premise: the page rendered');
});
