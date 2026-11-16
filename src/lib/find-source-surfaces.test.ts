// S3-B W2 (npstorey/civic-ai-tools#318; W2-7's classification, the ORCH's A2): every surface that reads a run or a
// record and special-cases `load_source` reads a `find_source` call as the instance's own step, never as a source's
// call. Each surface is driven with a `find_source` call and asserted on the words it shows.
//
// THE WORDS. Those marked "bundle :N" are bundle revision 5's, verbatim (pinned to its digest in
// `chooser-search-revision-5.test.ts`). The site's own are words r2 (planning `temp/s3/s3b-orch/words/
// w2-words-a2.r2.md`), checked by an independent research check (`research-check-w2.md`, 39d99d20…44828; KEEP 11,
// REVISE 12, folded in r2); the owner ruled them on 2026-11-16 (D9 = A). Ids S1 to S23 are r2's. No route shows any
// of them in S3: no route offers `find_source` (G0-4 = A), and the replay dialog shows S22 and S23 only for a record
// whose run offered a search (the ORCH's condition 2), which no production record is.
//
// THE FIX ROUND'S CONDITIONS, each held here: (1) the record page's search step leads with bundle :205's sentence, or
// :196's (S14, S15); (2) the dialog's decoy is `attestation-dialog-routing-configuration.test.ts`; (3) the progress
// line reads the query exactly as the span records it, `''` for missing or non-string arguments (S3, S4); (4) S23
// keeps :115's inventory clause.
//
// RED at 2d649c4: each surface reads the call by its name, as a source's tool ("Calling find_source...", "to call
// find_source", a discovery call, "Gathering data"), or by a source it does not have.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const streaming = (await import('./streaming.ts')) as unknown as Loose;
const steps = (await import('./answer-view/steps.ts')) as unknown as Loose;
const toolToCell = (await import('./notebook-author/tool-to-cell.ts')) as unknown as Loose;
const whereItWent = (await import('./flows/where-it-went.ts')) as unknown as Loose;
const operationTypes = (await import('./mcp/operation-types.ts')) as unknown as Loose;
const evalChecks = (await import('../../scripts/eval-checks.mjs')) as unknown as Loose;
const searchWords = (await import('./flows/search-words.ts')) as unknown as Loose;

const QUERY = 'payments to vendors';
const SEARCH = { name: 'find_source', args: { query: QUERY }, operationType: 'find_source' };
const SEARCHED = { ...SEARCH, searchOutcome: 'searched', searchHits: ['nyc-record', 'socrata'] };
const LIMITED = { ...SEARCH, searchOutcome: 'limit-reached' };

test('A2: find_source derives its own operation type, as load_source does', () => {
  assert.equal(operationTypes.deriveOperationType('find_source', { query: QUERY }), 'find_source');
  assert.ok((operationTypes.DERIVABLE_OPERATION_TYPES as string[]).includes('find_source'));
});

test('A2 (S3, S4): the progress line names a search for sources, never a source\'s tool', () => {
  assert.equal(streaming.formatToolProgress('find_source', { query: QUERY }), `The model asked for a search for sources, using the words: “${QUERY}”`);
  // Condition 3: the query exactly as the span records it, '' for missing or non-string arguments (A6).
  for (const args of [{}, { query: 5 }, { query: null }, { query: ['a'] }, { query: '' }]) {
    assert.equal(streaming.formatToolProgress('find_source', args), 'The model asked for a search for sources, with no search words', JSON.stringify(args));
  }
});

test('A2 (S5 to S8): the result line is the bundle\'s words for the outcome (bundle :214, :196)', () => {
  assert.equal(streaming.formatToolResult({ query: QUERY }, undefined, 'find_source', undefined, { outcome: 'searched', hits: ['nyc-record', 'socrata'] }),
    'The search returned 2 sources. They are listed in the search\'s order, its best match first: NYC City Record; Socrata.');
  assert.equal(streaming.formatToolResult({ query: QUERY }, undefined, 'find_source', undefined, { outcome: 'searched', hits: ['socrata'] }),
    'The search returned one source: Socrata.');
  assert.equal(streaming.formatToolResult({ query: QUERY }, undefined, 'find_source', undefined, { outcome: 'searched', hits: [] }),
    'The search returned no sources.');
  assert.equal(streaming.formatToolResult({ query: QUERY }, undefined, 'find_source', undefined, { outcome: 'limit-reached' }),
    'The site that ran this question did not run this search. It had already run two searches for this question, which was its limit.');
  assert.equal(streaming.formatToolResult({ query: QUERY }, undefined, 'find_source'), null, 'with no outcome recorded, nothing is said about how it ended');
});

test('A2 (S9, S10): the reason phrase and the breadcrumb', () => {
  assert.equal(streaming.generateToolReason({ query: QUERY }, 'find_source'), 'to search for sources');
  assert.equal(streaming.buildBreadcrumbLabel(SEARCH), 'Search for sources');
});

test('A2 (S11 to S13): the narrative says what the search did, and never that a source was called', () => {
  const narrative = (tools: Loose[]) => streaming.buildNarrativeSummary(tools) as string;
  assert.ok(narrative([SEARCHED]).includes('searched for sources'), narrative([SEARCHED]));
  assert.ok(narrative([LIMITED]).includes('asked for another search, which this site did not run'), narrative([LIMITED]));
  assert.ok(narrative([SEARCH]).includes('asked for a search for sources'), narrative([SEARCH]));
  for (const tools of [[SEARCHED], [LIMITED], [SEARCH]]) assert.ok(!narrative(tools).includes('called find_source'));
});

test('A2 (S1, S2): the step label', () => {
  const start = { message: 'x', timestamp: 0, phase: 'tool_start', iteration: 1, args: { query: QUERY }, toolName: 'find_source', operationType: 'find_source' };
  assert.equal(steps.generateGroupLabel([start, { ...start, phase: 'tool_complete', isComplete: true }]), 'The model asked for a search for sources');
  assert.equal(typeof steps.openStepLabel, 'function', 'steps.ts exports no openStepLabel');
  assert.equal(steps.openStepLabel([start]), 'The model asked for a search for sources');
});

test('A2 (S14 to S16): the record page\'s step view states a search\'s outcome in the bundle\'s words, never "No result summary"', () => {
  const query = { tool: 'find_source', operationType: 'find_source', arguments: { query: QUERY } };
  const searches = new Map([[0, { outcome: 'searched', query: QUERY, hits: ['socrata'] }], [1, { outcome: 'limit-reached', query: QUERY }]]);
  const view = steps.buildRecordStepView([query, query, query], new Set(), searches);
  const outcomes = view.steps.flatMap((s: Loose) => s.calls).concat(view.unplaced).map((c: Loose) => c.outcome);
  // Condition 1: each leads with bundle :205's sentence, or :196's, so the search words show.
  assert.deepEqual(outcomes, [
    `The model searched for sources, using the words: “${QUERY}”. The search returned one source: Socrata. The site that ran this question did the search itself. It did not send the search to any source.`,
    `The model asked for another search, using the words: “${QUERY}”. The site that ran this question did not run this search. It had already run two searches for this question, which was its limit.`,
    'The site that ran this question answered this request itself. No source received it.',
  ]);
});

test('A2 (S14, S15): a live run\'s step view states a search\'s outcome in the same words, from what the loop recorded', () => {
  const view = steps.buildRunStepView([], [SEARCHED, LIMITED]);
  assert.deepEqual(view.unplaced.map((c: Loose) => c.outcome), [
    `The model searched for sources, using the words: “${QUERY}”. The search returned 2 sources. They are listed in the search's order, its best match first: NYC City Record; Socrata. The site that ran this question did the search itself. It did not send the search to any source.`,
    `The model asked for another search, using the words: “${QUERY}”. The site that ran this question did not run this search. It had already run two searches for this question, which was its limit.`,
  ]);
});

test('A2 (S18 to S21): the notebook states the searches in a note, and lists none as a discovery call', () => {
  const cell = toolToCell.renderDiscoverySummaryCell([SEARCHED, LIMITED]);
  assert.ok(cell, 'no cell');
  const text = ([] as string[]).concat(cell.source).join('');
  assert.ok(!text.includes('### Discovery'), text);
  assert.ok(text.includes('### Searches for sources'), text);
  assert.ok(text.includes('The model asked the site that ran this question to search for data sources. The site answered each request itself and sent none to any source, so nothing is re-run for them here.'), text);
  assert.ok(text.includes(`- The model searched for sources, using the words: “${QUERY}”. The search returned 2 sources. They are listed in the search's order, its best match first: NYC City Record; Socrata.`), text);
  assert.ok(text.includes(`- The model asked for another search, using the words: “${QUERY}”. The site that ran this question did not run this search. It had already run two searches for this question, which was its limit.`), text);
});

test('A2 (S17): the graph\'s Summary tab words a search activity by the bundle\'s sentences (bundle :205, :196)', () => {
  assert.equal(typeof searchWords.searchActivityDescription, 'function', 'search-words.ts has no searchActivityDescription');
  const node = (outcome: string, query: string) => ({ '@type': 'prov:Activity', 'civic:searchOutcome': outcome, 'civic:searchQuery': query, 'dcterms:description': 'MCP tool call: find_source (find_source)' });
  assert.equal(searchWords.searchActivityDescription(node('searched', QUERY)), `The model searched for sources, using the words: “${QUERY}”`);
  assert.equal(searchWords.searchActivityDescription(node('searched', '')), 'The model searched for sources with no search words.');
  assert.equal(searchWords.searchActivityDescription(node('limit-reached', QUERY)), `The model asked for another search, using the words: “${QUERY}”`);
  assert.equal(searchWords.searchActivityDescription(node('limit-reached', '')), 'The model asked for another search, with no search words.');
  assert.equal(searchWords.searchActivityDescription({ '@type': 'prov:Activity', 'dcterms:description': 'MCP tool call: get_data (query)' }), undefined);
});

test('A2 (S22, S23): the replay dialog shows the recorded configuration, and says it is not applied again', () => {
  assert.equal(typeof searchWords.replayRoutingLines, 'function', 'search-words.ts has no replayRoutingLines');
  const lines = searchWords.replayRoutingLines({
    rule: { id: 'test-listed-subset', version: '1' }, cap: 'none', search: { method: 'bm25', version: '1' },
    inventory: { id: 'civic', version: '2026-11-09.1+ed7302810ed4', hash: 'a'.repeat(64) }, hash: 'b'.repeat(64),
  }) as string[];
  assert.deepEqual(lines, [
    'Each of these replays shows the model all the sources it can use, and none offers it a search. The original analysis showed the model its sources under the configuration below, which the replays do not apply again.',
    'The model was offered a search for sources. The search method is recorded as bm25, version 1.',
    'The first list of sources had no size limit.',
    'routing rule recorded as test-listed-subset, version 1',
    'built over the source inventory civic (version 2026-11-09.1+ed7302810ed4)',
    `routing configuration ${'b'.repeat(64)}`,
  ]);
  // Condition 2: nothing for a configuration whose run offered no search, or for none.
  assert.deepEqual(searchWords.replayRoutingLines({
    rule: { id: 'directory-set', version: '1' }, cap: 'none', search: 'none',
    inventory: { id: 'civic', version: 'v', hash: 'a'.repeat(64) }, hash: 'b'.repeat(64),
  }), []);
  assert.deepEqual(searchWords.replayRoutingLines(undefined), []);
});

// S3-B F, F-1 (the cold read's F2): a record's composition block can carry any object as its `routingConfiguration`
// (`recordRoutingConfiguration` passes any object, and a caller's `extensions` reach the block), and `offeredASearch`
// asks only that `search` is an object. A configuration not of the complete shape gives no lines and never throws.
// RED at 71b43b0f: the first two shapes the cold read drove throw reading `rule.id`; the others return six lines,
// one of which names `undefined` or a number. What makes each able to fail: every shape has an object `search`, so
// each passes the guard the dialog had; and the complete configuration beside them still gives its six lines.
const COMPLETE = {
  rule: { id: 'test-listed-subset', version: '1' }, cap: 'none', search: { method: 'bm25', version: '1' },
  inventory: { id: 'civic', version: '2026-11-09.1+ed7302810ed4', hash: 'a'.repeat(64) }, hash: 'b'.repeat(64),
};
const WITHOUT_HASH = { rule: COMPLETE.rule, cap: COMPLETE.cap, search: COMPLETE.search, inventory: COMPLETE.inventory };
for (const [name, value] of [
  ['search with a method and a version, and nothing else (the cold read\'s first)', { search: { method: 'bm25', version: '1' } }],
  ['an empty search, and nothing else (the cold read\'s second)', { search: {} }],
  ['the complete configuration with no hash', WITHOUT_HASH],
  ['a rule with no version', { ...COMPLETE, rule: { id: 'test-listed-subset' } }],
  ['a number for the cap', { ...COMPLETE, cap: 5 }],
  ['a search with no version', { ...COMPLETE, search: { method: 'bm25' } }],
  ['an inventory with no id', { ...COMPLETE, inventory: { version: 'v', hash: 'a'.repeat(64) } }],
] as const) {
  test(`F-1: a configuration not of the complete shape gives the dialog no lines and does not throw: ${name}`, () => {
    let lines: unknown;
    try {
      lines = searchWords.replayRoutingLines(value);
    } catch (error) {
      lines = `threw: ${(error as Error).message}`;
    }
    assert.deepEqual(lines, []);
  });
}

test('F-1 pin: the complete configuration still gives the six lines, and a cap other than none is named', () => {
  assert.equal((searchWords.replayRoutingLines(COMPLETE) as string[]).length, 6);
  assert.equal((searchWords.replayRoutingLines({ ...COMPLETE, cap: '3' }) as string[])[2], 'The first list of sources was limited to 3.');
});

test('Where this question went: a search is no contact with any source', () => {
  const base = { sourcesOffered: [{ sourceId: 'socrata', alias: 'socrata', reason: 'configured' }], model: 'm', service: 's' };
  const fromCalls = whereItWent.whereItWentFromCalls({ ...base, toolCalls: [SEARCHED], resolveSource: () => 'socrata' });
  assert.deepEqual(fromCalls.reached.filter((entry: Loose) => entry.kind === 'source'), [], 'a search was read as a contact with the source its name resolved to');
});

test('eval-checks: a search is not a source\'s call made before a load', () => {
  const verdict = evalChecks.pauseCheck({ consent: { mode: 'every-source-on' }, toolCalls: [SEARCHED] });
  assert.equal(verdict.noCallBeforeLoad.pass, true, JSON.stringify(verdict.noCallBeforeLoad));
});
