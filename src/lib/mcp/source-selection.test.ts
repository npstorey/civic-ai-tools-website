// #599 W4 (ruling D3) — the composition takes an explicit source selection.
//
// `offeredMcpTools`, `buildSystemPrompt`, `withPortalLockGuidance` and
// `composeSystemPrompt` take `selection?: readonly string[]`. Absent, a run is
// offered every source its configuration offers — what every run is offered
// today, and what the query routes pass (`DEFAULT_SOURCE_SELECTION`) until R6's
// panel adds a request field. Given, the run is offered only the configured
// sources it names: the tools array and the prompt narrow, and the record
// states `selected` / `not-selected` for each configured source. An id the
// manifest does not hold is ignored, as the router ignores it.
//
// THE SHAPE THAT CAN FAIL. All three sources are configured, so a selection
// that is not applied leaves every source's tools and prompt text in place.
// The tool names are aliased (`data_commons__…`), and no other source's text
// carries them, so their absence is a property of the selection.
//
// RED before W4: the adapters take no selection, so the extra argument is
// dropped and every narrowing assertion fails, and `composeSystemPrompt` does
// not exist. The adapters are called through casts so this file type-checks
// against a tree whose signatures lack the parameter.
//
// The request every route sends with the DEFAULT selection is compared with
// the base's byte for byte by a separate instrument (the phase report's
// criterion 4), over the router goldens' configurations.
//
// No network: the Socrata prompt fetch finds no configured server, the Data
// Commons address is a closed loopback port, and every non-loopback fetch is
// refused before it is sent.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch refused by the test: not loopback');
  return realFetch(input, init);
}) as typeof fetch;
delete process.env.SOCRATA_MCP_URL;
delete process.env.BOSTON_OPENCONTEXT_MCP_URL;
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/mcp';

const tools = await import('./tools.ts');
const skill = await import('./socrata-skill.ts');
type Env = import('./registry.ts').McpRegistryEnv;

type Selection = readonly string[] | undefined;
const offeredMcpTools = tools.offeredMcpTools as unknown as (t: ChatCompletionTool[], c: Env, s?: Selection) => ChatCompletionTool[];
const buildSystemPrompt = skill.buildSystemPrompt as unknown as (p: string | undefined, c: Env, s?: Selection) => Promise<string>;
const withPortalLockGuidance = skill.withPortalLockGuidance as unknown as (p: string, l: string | undefined, c: Env, s?: Selection) => string;
interface Composed {
  prompt: string;
  assertedDate: string;
  sourcesOffered: Array<{ sourceId: string; alias: string; reason: string }>;
  components: Array<{ id: string; version?: string; guidanceHash?: string; guidanceOrigin?: string }>;
}
const composeSystemPrompt = (skill as unknown as Record<string, unknown>).composeSystemPrompt as
  | ((input: { portal?: string; configured?: Env; selection?: Selection; now?: Date }) => Promise<Composed>)
  | undefined;

const PORTAL = 'data.cityofnewyork.us';
const FULL: Env = {
  socrataUrl: 'http://127.0.0.1:9/socrata',
  dataCommonsUrl: 'http://127.0.0.1:9/mcp',
  bostonOpencontextUrl: 'http://127.0.0.1:9/boston',
};
const NO_BOSTON: Env = { socrataUrl: FULL.socrataUrl, dataCommonsUrl: FULL.dataCommonsUrl };
/** Every source on, router 0.3.0's hosted one included (#617 P3). FULL leaves
 *  NYC_CHARTER_HOSTING unset, so there Charter's five tools are withheld and
 *  its `sourcesOffered` row is `not-configured`: the moves the anchor names. */
const ALL_ON: Env = { ...FULL, nycCharterHosting: 'sandbox', nycCheckbookHosting: 'sandbox', nycRecordHosting: 'sandbox', nysLegislationHosting: 'sandbox' };
/** The hosted sources' rows with their switches unset: Charter's (#617 P3),
 *  then router 0.6.0's three (R8 W3), each not-configured with or without a
 *  selection. ALL_ON above switches all four on. */
const HOSTED_ROWS = ['nyc-charter:nyc_charter:not-configured', 'nyc-checkbook:nyc_checkbook:not-configured', 'nyc-record:nyc_record:not-configured', 'nys-legislation:nys_legislation:not-configured'];
const HOSTED_PREFIXES = ['nyc_charter__', 'nyc_checkbook__', 'nyc_record__', 'nys_legislation__'];

const ALL_TOOLS = tools.mcpToolsFor(undefined);
const names = (list: ChatCompletionTool[]) => list.map((t) => (t as { function: { name: string } }).function.name);
const prefixes = (list: ChatCompletionTool[]) => [...new Set(names(list).map((n) => n.split('__')[0]))];

// Quieten the composer's soft-failure logs (the fetches fail by design here).
console.warn = () => {};
console.log = () => {};

test('premise: with every source configured and no selection, all three sources are offered', () => {
  assert.deepEqual(prefixes(offeredMcpTools(ALL_TOOLS, FULL)), ['socrata', 'data_commons', 'boston']);
});

test('the default selection is no selection: the same array object, byte for byte what was offered before', () => {
  const fallback = (skill as unknown as Record<string, unknown>).DEFAULT_SOURCE_SELECTION as Selection;
  assert.equal(fallback, undefined);
  assert.equal(offeredMcpTools(ALL_TOOLS, ALL_ON, undefined), ALL_TOOLS, 'with every source offered the array itself is returned');
  assert.equal(offeredMcpTools(ALL_TOOLS, ALL_ON, fallback), offeredMcpTools(ALL_TOOLS, ALL_ON));
  // With the switches unset: the vocabulary less the four hosted sources'
  // tools (Charter's five, router 0.6.0's forty-one), the same either way.
  assert.deepEqual(offeredMcpTools(ALL_TOOLS, FULL, undefined), ALL_TOOLS.filter((t) => !HOSTED_PREFIXES.some((prefix) => names([t])[0].startsWith(prefix))));
  assert.deepEqual(offeredMcpTools(ALL_TOOLS, FULL, fallback), offeredMcpTools(ALL_TOOLS, FULL));
});

test('an explicit selection narrows the offered tools to the sources it names', () => {
  assert.deepEqual(prefixes(offeredMcpTools(ALL_TOOLS, FULL, ['socrata'])), ['socrata']);
  assert.deepEqual(prefixes(offeredMcpTools(ALL_TOOLS, FULL, ['data-commons', 'boston-opencontext'])), ['data_commons', 'boston']);
  assert.deepEqual(offeredMcpTools(ALL_TOOLS, FULL, []), []);
});

test('a selection cannot offer a source the configuration does not', () => {
  assert.deepEqual(prefixes(offeredMcpTools(ALL_TOOLS, NO_BOSTON, ['boston-opencontext', 'socrata'])), ['socrata']);
});

test('an unknown id in a selection is ignored, not refused', () => {
  assert.deepEqual(
    names(offeredMcpTools(ALL_TOOLS, FULL, ['socrata', 'no-such-source'])),
    names(offeredMcpTools(ALL_TOOLS, FULL, ['socrata'])),
  );
  assert.deepEqual(offeredMcpTools(ALL_TOOLS, FULL, ['no-such-source']), []);
});

test('an explicit selection narrows the prompt\'s sources: no tool of an unselected source is named', async () => {
  const all = await buildSystemPrompt(PORTAL, FULL);
  for (const prefix of ['socrata__', 'data_commons__', 'boston__']) assert.ok(all.includes(prefix), `premise: the full prompt names ${prefix}`);
  const socrataOnly = await buildSystemPrompt(PORTAL, FULL, ['socrata']);
  assert.ok(socrataOnly.includes('socrata__'));
  assert.ok(!socrataOnly.includes('data_commons__'), 'the prompt still names Data Commons tools');
  assert.ok(!socrataOnly.includes('boston__'), 'the prompt still names Boston tools');
  const dataCommonsOnly = await buildSystemPrompt(PORTAL, FULL, ['data-commons']);
  assert.ok(dataCommonsOnly.includes('data_commons__') && !dataCommonsOnly.includes('socrata__') && !dataCommonsOnly.includes('boston__'));
});

test('the lock section names only the selected sources beside the locked one', () => {
  const all = withPortalLockGuidance('P', PORTAL, FULL);
  const socrataOnly = withPortalLockGuidance('P', PORTAL, FULL, ['socrata']);
  assert.notEqual(all, socrataOnly, 'the lock section does not follow the selection');
  assert.ok(all.includes('Boston') && !socrataOnly.includes('Boston'));
});

test('the record states selected / not-selected with a selection, configured with none, and not-configured either way', async () => {
  assert.equal(typeof composeSystemPrompt, 'function', 'socrata-skill.ts exports no composeSystemPrompt');
  const reasons = async (configured: Env, selection?: Selection) =>
    (await composeSystemPrompt!({ portal: PORTAL, configured, selection })).sourcesOffered.map((s) => `${s.sourceId}:${s.alias}:${s.reason}`);
  // Each list ends with the hosted sources' rows: not-configured with their
  // switches unset, with or without a selection (the named moves, #617 P3 and
  // R8 W3).
  assert.deepEqual(await reasons(FULL), ['socrata:socrata:configured', 'data-commons:data_commons:configured', 'boston-opencontext:boston:configured', ...HOSTED_ROWS]);
  assert.deepEqual(await reasons(NO_BOSTON), ['socrata:socrata:configured', 'data-commons:data_commons:configured', 'boston-opencontext:boston:not-configured', ...HOSTED_ROWS]);
  assert.deepEqual(await reasons(FULL, ['socrata', 'no-such-source']), ['socrata:socrata:selected', 'data-commons:data_commons:not-selected', 'boston-opencontext:boston:not-selected', ...HOSTED_ROWS]);
  assert.deepEqual(await reasons(NO_BOSTON, ['boston-opencontext', 'nyc-charter']), ['socrata:socrata:not-selected', 'data-commons:data_commons:not-selected', 'boston-opencontext:boston:not-configured', ...HOSTED_ROWS]);
});

test('composeSystemPrompt states the date the prompt carries, its components, and the prompt buildSystemPrompt returns', async () => {
  assert.equal(typeof composeSystemPrompt, 'function', 'socrata-skill.ts exports no composeSystemPrompt');
  const now = new Date('2026-01-15T23:30:00.000Z');
  const composed = await composeSystemPrompt!({ portal: PORTAL, configured: FULL, selection: ['socrata'], now });
  assert.equal(composed.assertedDate, '2026-01-15');
  assert.ok(composed.prompt.includes("Today's date is 2026-01-15."), 'the prompt does not state the date the record states');
  // One component per OFFERED source, then the router package.
  assert.deepEqual(composed.components.map((c) => c.id), [
    'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server',
    '@typedstandards/civic-typed-router',
  ]);
  const installed = JSON.parse(readFileSync(path.join(process.cwd(), 'node_modules/@typedstandards/civic-typed-router/package.json'), 'utf8')) as { version: string };
  assert.equal(composed.components.at(-1)?.version, installed.version, 'the router component does not state the installed version');
  // No Socrata server is configured in this process, so the fetch fails and
  // the block is the package's fallback.
  assert.equal(composed.components[0].guidanceOrigin, 'fallback');
  assert.match(composed.components[0].guidanceHash ?? '', /^[0-9a-f]{64}$/);
});
