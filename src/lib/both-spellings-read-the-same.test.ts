// #599 W3: every site that keys on a tool name reads both spellings.
//
// Since W3 a record names a tool `socrata__get_data`; every record made before
// it names it `get_data`, and so does a model that calls the bare name. Each
// site below takes a tool name from a record, a trace or an event, and must
// answer the same for either spelling — and where it shows the name to a
// reader, show the name the reader saw before W3, never the alias
// (`docs/design-principles.md`: user language, not implementation language).
//
//   - the identity key a consistency attestation is computed from
//     (`canonicalizeToolCall`): a replayed pre-W3 record keeps its identities;
//   - both notebook generators: the same cells for either spelling;
//   - the progress, result, reason, breadcrumb and narrative formatters, and
//     the live view's group labels;
//   - the replay of a recorded trace into progress data.
//
// The fixtures are shaped so the assertions can fail: each spelling pair
// reaches a branch that keys on the name (`get_data`'s query cell, a `fetch`,
// `search_indicators`' noun, a CKAN helper), not only the operation-type table.
//
// RED at 617b18b (W2): every one of these keys on the literal bare name, so
// the aliased spelling takes the generic branch or a different key.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeToolCall } from './evidence/tool-call-identity.ts';
import { synthesizeNotebook } from './notebook-author/synthesize.ts';
import type { PhaseAToolCall } from './notebook-author/tool-to-cell.ts';
import { helperForToolName } from './notebook-author/helpers/index.ts';
import { generateNotebook } from './notebook.ts';
import {
  buildBreadcrumbLabel,
  buildNarrativeSummary,
  formatToolProgress,
  formatToolResult,
  generateToolReason,
  searchSubject,
} from './streaming.ts';
import { traceEventsToProgressData } from './bpmn/trace-progress.ts';
import type { TraceEvent } from './bpmn/traces.ts';
import { generateGroupLabel, type ProgressLogEntry } from '../hooks/useStreamingComparison.ts';

const ALIAS: Record<string, string> = {
  get_data: 'socrata__get_data',
  search: 'socrata__search',
  fetch: 'socrata__fetch',
  search_indicators: 'data_commons__search_indicators',
  get_observations: 'data_commons__get_observations',
  ckan__search_datasets: 'boston__ckan__search_datasets',
  ckan__get_dataset: 'boston__ckan__get_dataset',
  ckan__get_schema: 'boston__ckan__get_schema',
  ckan__query_data: 'boston__ckan__query_data',
  ckan__aggregate_data: 'boston__ckan__aggregate_data',
  ckan__execute_sql: 'boston__ckan__execute_sql',
};
const ALIAS_PREFIX = /(socrata|data_commons|boston)__/;
const PORTAL = 'data.cityofnewyork.us';

/** One call per tool, each with arguments that reach its name-keyed branch. */
const CALLS: PhaseAToolCall[] = [
  { name: 'get_data', args: { type: 'catalog', query: 'noise', portal: PORTAL }, operationType: 'catalog', reason: 'to find datasets about "noise"' },
  { name: 'get_data', args: { type: 'query', dataset_id: 'erm2-nwe9', portal: PORTAL, select: 'count(*)' }, operationType: 'query', resultSummary: { rows: 1, columns: 1 } },
  { name: 'search', args: { query: 'noise' }, operationType: 'search' },
  { name: 'fetch', args: { id: 'dataset:data.cityofnewyork.us:erm2-nwe9' } },
  { name: 'search_indicators', args: { query: 'median income' }, operationType: 'search' },
  { name: 'get_observations', args: { variable_dcid: 'Median_Income_Household', place_dcid: 'geoId/36061' }, operationType: 'query', resultSummary: { rows: 5, columns: 3 } },
  { name: 'ckan__search_datasets', args: { query: '311' }, operationType: 'search' },
  { name: 'ckan__get_schema', args: { resource_id: 'r-1' }, operationType: 'metadata' },
  { name: 'ckan__query_data', args: { resource_id: 'r-1', filters: { type: 'pothole' } }, operationType: 'query', resultSummary: { rows: 9, columns: 4 } },
  { name: 'ckan__execute_sql', args: { sql: 'SELECT 1' }, operationType: 'query', resultSummary: { rows: 1, columns: 1 } },
  { name: 'ckan__aggregate_data', args: { resource_id: 'r-1', metrics: { n: 'count' } }, operationType: 'query', resultSummary: { rows: 2, columns: 2 } },
  { name: 'ckan__get_dataset', args: { dataset_id: 'd-1' }, operationType: 'metadata' },
] as PhaseAToolCall[];

const aliased = <T extends { name: string }>(calls: readonly T[]): T[] =>
  calls.map((call) => ({ ...call, name: ALIAS[call.name] }));

// --- The identity key ------------------------------------------------------------------

test('canonicalizeToolCall gives a call the same key in either spelling, answered or rejected', () => {
  for (const call of CALLS) {
    for (const failed of [undefined, true]) {
      assert.equal(
        canonicalizeToolCall({ name: ALIAS[call.name], args: call.args, failed }),
        canonicalizeToolCall({ name: call.name, args: call.args, failed }),
        `${call.name} (failed: ${failed})`,
      );
    }
  }
  // An answered bare call's key is the one it had before W3.
  assert.equal(canonicalizeToolCall({ name: 'get_data', args: { type: 'catalog' } }), 'get_data:{"type":"catalog"}');
});

// --- The notebooks ------------------------------------------------------------------------

test('the executed-notebook generator authors the same notebook for either spelling', () => {
  const inputs = {
    query: 'How many noise complaints?',
    defaultPortal: PORTAL,
    finalAnswer: 'About 1 complaint.',
    modelName: 'fake/model',
    modelAccess: 'through a fixture',
    generatedAt: '2026-01-15T12:00:00.000Z',
  };
  const bare = synthesizeNotebook({ ...inputs, toolCalls: CALLS });
  const viaAliases = synthesizeNotebook({ ...inputs, toolCalls: aliased(CALLS) });
  assert.deepEqual(viaAliases.embeddedHelpers, bare.embeddedHelpers);
  assert.deepEqual(viaAliases.dataFrameVariables, bare.dataFrameVariables);
  // Cell ids come from a counter that runs across notebooks in one process;
  // everything else must be byte-identical.
  const withoutIds = (nb: unknown) => JSON.stringify(nb).replace(/"id":"cell-[0-9a-z]+"/g, '"id":"cell"');
  assert.equal(withoutIds(viaAliases.notebook), withoutIds(bare.notebook));
  assert.ok(!ALIAS_PREFIX.test(JSON.stringify(viaAliases.notebook)), 'a cell shows an aliased name');
  // The fixture reaches the branches that key on a name.
  assert.ok(bare.dataFrameVariables.length >= 3, 'the fixture rendered too few re-run cells to discriminate');
});

test('the skeleton-notebook generator authors the same notebook for either spelling', () => {
  const attribution = { host: null, origin: null, platformTitle: null } as unknown as Parameters<typeof generateNotebook>[4];
  const bare = generateNotebook('How many noise complaints?', PORTAL, CALLS as never, 'About 1.', attribution);
  const viaAliases = generateNotebook('How many noise complaints?', PORTAL, aliased(CALLS) as never, 'About 1.', attribution);
  const strip = (nb: unknown) =>
    JSON.stringify(nb).replace(/\*\*Generated:\*\* \d{4}-\d{2}-\d{2}/g, '').replace(/"id":"cell-[0-9a-z]+"/g, '"id":"cell"');
  assert.equal(strip(viaAliases), strip(bare));
  assert.ok(!ALIAS_PREFIX.test(JSON.stringify(viaAliases)), 'a cell shows an aliased name');
});

test('the helper a tool implies is the same for either spelling', () => {
  for (const [bare, exposed] of Object.entries(ALIAS)) {
    assert.equal(helperForToolName(exposed), helperForToolName(bare), exposed);
  }
  assert.equal(helperForToolName('boston__ckan__query_data'), 'fetch_opencontext');
});

// --- The formatters ---------------------------------------------------------------------

test('the progress, result, reason, breadcrumb and narrative copy is the same for either spelling, and shows no alias', () => {
  const everyName = [...CALLS, { name: 'get_data', args: {} } as PhaseAToolCall];
  for (const call of everyName) {
    const exposed = ALIAS[call.name];
    const tool = { name: call.name, args: call.args, operationType: call.operationType };
    const viaAlias = { ...tool, name: exposed };
    const pairs: Array<[string, unknown, unknown]> = [
      ['formatToolProgress', formatToolProgress(exposed, call.args), formatToolProgress(call.name, call.args)],
      ['formatToolResult', formatToolResult(call.args, call.resultSummary, exposed), formatToolResult(call.args, call.resultSummary, call.name)],
      ['generateToolReason', generateToolReason(call.args, exposed), generateToolReason(call.args, call.name)],
      ['searchSubject', searchSubject(exposed), searchSubject(call.name)],
      ['buildBreadcrumbLabel', buildBreadcrumbLabel(viaAlias), buildBreadcrumbLabel(tool)],
    ];
    for (const [fn, a, b] of pairs) {
      assert.deepEqual(a, b, `${fn}(${exposed})`);
      assert.ok(!ALIAS_PREFIX.test(JSON.stringify(a) ?? ''), `${fn}(${exposed}) shows an alias: ${JSON.stringify(a)}`);
    }
  }
  const narrativeBare = buildNarrativeSummary(CALLS.map((c) => ({ name: c.name, args: c.args, operationType: c.operationType })) as never);
  const narrativeAliased = buildNarrativeSummary(aliased(CALLS).map((c) => ({ name: c.name, args: c.args, operationType: c.operationType })) as never);
  assert.equal(narrativeAliased, narrativeBare);
  assert.ok(!ALIAS_PREFIX.test(narrativeAliased), `the narrative shows an alias: ${narrativeAliased}`);
});

test('the live view\'s group label is the same for either spelling, and shows no alias', () => {
  const entry = (toolName: string, args: Record<string, unknown>): ProgressLogEntry => ({
    phase: 'tool_start',
    message: 'm',
    iteration: 1,
    toolName,
    args,
    timestamp: 0,
  } as unknown as ProgressLogEntry);
  for (const call of [...CALLS, { name: 'get_data', args: {} } as PhaseAToolCall, { name: 'ckan__get_dataset', args: {} } as PhaseAToolCall]) {
    const a = generateGroupLabel([entry(ALIAS[call.name], call.args)]);
    const b = generateGroupLabel([entry(call.name, call.args)]);
    assert.equal(a, b, call.name);
    assert.ok(!ALIAS_PREFIX.test(a), `label shows an alias: ${a}`);
  }
});

test('a recorded trace replays into the same progress data for either spelling, the name as recorded', () => {
  const events = (name: (bare: string) => string): TraceEvent[] => [
    { relativeMs: 0, phase: 'tool_start', message: 'Searching', iteration: 1, toolName: name('search_indicators'), args: { query: 'income' } },
    { relativeMs: 900, phase: 'tool_complete', message: 'Searching', iteration: 1, toolName: name('search_indicators'), duration_ms: 900 },
    { relativeMs: 1000, phase: 'tool_start', message: 'Looking up', iteration: 2, toolName: name('fetch'), args: { id: 'abcd-1234' } },
    { relativeMs: 1900, phase: 'tool_complete', message: 'Looking up', iteration: 2, toolName: name('fetch'), duration_ms: 900 },
  ] as TraceEvent[];
  const bare = traceEventsToProgressData(events((n) => n), 3, true);
  const viaAliases = traceEventsToProgressData(events((n) => ALIAS[n]), 3, true);
  assert.deepEqual(viaAliases.toolsCalled.map((c) => c.operationType), bare.toolsCalled.map((c) => c.operationType));
  assert.deepEqual(viaAliases.toolsCalled.map((c) => c.name), ['data_commons__search_indicators', 'socrata__fetch'], 'the replay renamed a recorded call');
  assert.deepEqual(bare.toolsCalled.map((c) => c.operationType), ['search', undefined]);
});
