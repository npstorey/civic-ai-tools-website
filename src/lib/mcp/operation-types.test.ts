// Unit tests for operation-type and source derivation used by the M9.3
// multi-source evidence integration.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperationType, sourceIdForToolName } from './operation-types.ts';

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
