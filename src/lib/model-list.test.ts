// Tests for the /api/models response-shape guard (#283).
//
// The defect: QueryForm's fetch effect did `setModels(data.models)` inside
// its try block with nothing checking the shape. A 200 response missing the
// `models` key (or shipping a non-array in its place) would set `models` to
// `undefined`, and the render path's `models.find(...)` would throw. This
// guard turns that into a `null` the caller can route through the same
// reader-facing failure path as a network/JSON error, instead of crashing.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelsResponse } from './model-list.ts';

test('parseModelsResponse: a well-formed body returns the models array', () => {
  const models = [
    { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
  ];
  assert.deepEqual(parseModelsResponse({ models }), models);
});

test('parseModelsResponse: an empty models array is valid (not an error)', () => {
  assert.deepEqual(parseModelsResponse({ models: [] }), []);
});

test('parseModelsResponse: a 200 body missing the `models` key is null, not undefined', () => {
  // The literal shape #283 describes: /api/models responds 200 with a body
  // that has no `models` key at all.
  assert.equal(parseModelsResponse({}), null);
});

test('parseModelsResponse: a non-array `models` value is null', () => {
  assert.equal(parseModelsResponse({ models: 'openai/gpt-4o' }), null);
  assert.equal(parseModelsResponse({ models: null }), null);
  assert.equal(parseModelsResponse({ models: { id: 'openai/gpt-4o' } }), null);
});

test('parseModelsResponse: a non-object body is null', () => {
  assert.equal(parseModelsResponse(null), null);
  assert.equal(parseModelsResponse(undefined), null);
  assert.equal(parseModelsResponse('not json'), null);
  assert.equal(parseModelsResponse(42), null);
});
