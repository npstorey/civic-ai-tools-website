// Unit tests for operation-type and source derivation used by the M9.3
// multi-source evidence integration.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperationType, sourceIdForToolName } from './operation-types.ts';
import { mcpTools } from './tools.ts';

test('Data Commons: search_indicators maps to "search"', () => {
  assert.equal(deriveOperationType('search_indicators', { query: 'median income' }), 'search');
});

test('Data Commons: get_observations maps to "query"', () => {
  assert.equal(
    deriveOperationType('get_observations', {
      variable_dcid: 'Median_Income_Household',
      place_dcid: 'geoId/36061',
    }),
    'query',
  );
});

test('Data Commons: tool-name mapping wins even if args.type is present', () => {
  // Defensive: even if an LLM hallucinated a `type` arg for a DC tool, the
  // tool-name mapping is still authoritative.
  assert.equal(
    deriveOperationType('get_observations', { type: 'catalog', variable_dcid: 'X' }),
    'query',
  );
});

test('Socrata get_data falls through to args.type', () => {
  assert.equal(deriveOperationType('get_data', { type: 'query', dataset_id: 'abc-1234' }), 'query');
  assert.equal(deriveOperationType('get_data', { type: 'catalog' }), 'catalog');
  assert.equal(deriveOperationType('get_data', { type: 'metadata' }), 'metadata');
  assert.equal(deriveOperationType('get_data', { type: 'metrics' }), 'metrics');
});

test('Unknown tool with no args.type returns undefined', () => {
  assert.equal(deriveOperationType('mystery_tool', {}), undefined);
});

test('args.type that is not a string is ignored', () => {
  // Be defensive: if an args.type comes through as a non-string, don't coerce.
  assert.equal(deriveOperationType('get_data', { type: 42 }), undefined);
  assert.equal(deriveOperationType('get_data', { type: null }), undefined);
});

test('sourceIdForToolName: Socrata tools', () => {
  assert.equal(sourceIdForToolName('get_data'), 'socrata');
  assert.equal(sourceIdForToolName('search'), 'socrata');
  assert.equal(sourceIdForToolName('fetch'), 'socrata');
});

test('sourceIdForToolName: Data Commons tools', () => {
  assert.equal(sourceIdForToolName('search_indicators'), 'data-commons');
  assert.equal(sourceIdForToolName('get_observations'), 'data-commons');
});

test('sourceIdForToolName: Boston OpenContext tools', () => {
  for (const toolName of [
    'ckan__search_datasets',
    'ckan__get_dataset',
    'ckan__query_data',
    'ckan__get_schema',
    'ckan__execute_sql',
    'ckan__aggregate_data',
  ]) {
    assert.equal(sourceIdForToolName(toolName), 'boston-opencontext', `expected "${toolName}" to route to boston-opencontext`);
  }
});

test('Boston OpenContext: operation types map per tool', () => {
  assert.equal(deriveOperationType('ckan__search_datasets', { query: '311' }), 'search');
  assert.equal(deriveOperationType('ckan__get_dataset', { dataset_id: 'x' }), 'metadata');
  assert.equal(deriveOperationType('ckan__get_schema', { resource_id: 'x' }), 'metadata');
  assert.equal(deriveOperationType('ckan__query_data', { resource_id: 'x' }), 'query');
  assert.equal(deriveOperationType('ckan__execute_sql', { sql: 'SELECT 1' }), 'query');
  assert.equal(deriveOperationType('ckan__aggregate_data', { resource_id: 'x', metrics: {} }), 'query');
});

test('sourceIdForToolName: unknown tool returns undefined', () => {
  assert.equal(sourceIdForToolName('mystery_tool'), undefined);
  assert.equal(sourceIdForToolName(''), undefined);
});

// --- #323: the two Socrata tools that became callable when they got schemas ---
//
// Before `search` and `fetch` had entries in `mcpTools`, the model could not
// call either, so how they typed here was inert. Now they can be called, and
// the answer lands in a signed package's `queries[].operationType`.

test('Socrata search maps to "search", like every other name-keyed discovery tool', () => {
  assert.equal(deriveOperationType('search', { query: '311 noise complaints' }), 'search');
  // The same answer the other two discovery tools give, which is the point:
  // one operation, three sources, one label.
  assert.equal(deriveOperationType('search_indicators', { query: 'x' }), 'search');
  assert.equal(deriveOperationType('ckan__search_datasets', { query: 'x' }), 'search');
});

test('Socrata search is not typed "query", so its preview rows stay out of "records analyzed"', () => {
  // The server enriches some catalog hits with a few preview rows. Those are an
  // enrichment of a dataset descriptor, not rows the analysis queried, and
  // `records analyzed` sums only operationType === 'query' (#339).
  assert.notEqual(deriveOperationType('search', { query: 'x' }), 'query');
});

test('Socrata fetch is deliberately unmapped, because its operation is not knowable from its name', () => {
  // Not an oversight — a measurement. `handleFetchTool` returns dataset
  // METADATA for a `dataset:` identifier and ONE DATA ROW for a `record:`
  // identifier, and nothing in the tool name says which. Deciding here would
  // mean reimplementing the server's identifier grammar in this repository and
  // writing the guess into a signed package. `undefined` becomes 'unknown' at
  // `packager.ts`, which asserts nothing false.
  //
  // This test fails if someone adds an entry for `fetch`. That is the intent:
  // the fix is the server reporting the operation it performed, not this file
  // guessing, so a future entry should arrive with that change and with this
  // test rewritten deliberately rather than deleted in passing.
  assert.equal(
    deriveOperationType('fetch', { id: 'dataset:data.cityofnewyork.us:erm2-nwe9' }),
    undefined,
  );
  assert.equal(
    deriveOperationType('fetch', { id: 'record:data.cityofnewyork.us:erm2-nwe9:12345' }),
    undefined,
  );

  // The source, by contrast, IS knowable from the name and always was.
  assert.equal(sourceIdForToolName('fetch'), 'socrata');
});

test('#323: every tool the model can call is either typed or knowingly untyped', () => {
  // The property, not the two instances. Every name in `mcpTools` must resolve
  // to a source — a tool whose calls cannot be attributed has no business being
  // advertised — and every one must either derive an operation type or be on
  // the short list of tools measured to have none derivable from their name.
  // A tenth tool added to `mcpTools` without a decision here fails this.
  const UNTYPED_BY_MEASUREMENT: Record<string, string> = {
    fetch: 'returns metadata or one row depending on the id shape — see operation-types.ts',
  };

  for (const tool of mcpTools) {
    if (tool.type !== 'function') continue;
    const name = tool.function.name;

    assert.ok(
      sourceIdForToolName(name),
      `mcpTools advertises "${name}" but sourceIdForToolName does not know it — its calls could not be attributed to a source.`,
    );

    // `get_data` carries its operation in args.type, so it is exercised with one.
    const args = name === 'get_data' ? { type: 'query' } : {};
    const derived = deriveOperationType(name, args);
    assert.ok(
      derived !== undefined || name in UNTYPED_BY_MEASUREMENT,
      `mcpTools advertises "${name}" and no operation type derives from it. Either map it in ` +
        'TOOL_OPERATION_TYPES, or add it to UNTYPED_BY_MEASUREMENT here with the measurement that ' +
        'says its operation is not knowable from its name — "unknown" in a signed package should ' +
        'be a decision, not an accident.',
    );
  }

  for (const name of Object.keys(UNTYPED_BY_MEASUREMENT)) {
    assert.equal(
      deriveOperationType(name, {}),
      undefined,
      `"${name}" is listed as knowingly untyped but now derives an operation type. Remove it from ` +
        'UNTYPED_BY_MEASUREMENT — a stale exemption is a false statement about the tree.',
    );
  }
});
