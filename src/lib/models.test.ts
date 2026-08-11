// Guards the model-roster/pricing-table coupling that caused #232: the UI
// roster (`availableModels` in mcp/tools.ts) and the cost-estimation table
// (`MODEL_PRICING` in this file) are two separate maps kept in sync by hand.
// A model id present in one and missing from the other is exactly the defect
// class from #232 — `estimateCostUsd` silently returns null for it. This test
// turns that into a CI failure instead of a silent gap.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PRICING } from './models.ts';
import { availableModels } from './mcp/tools.ts';

test('every availableModels id has a MODEL_PRICING entry', () => {
  const missing = availableModels
    .map((m) => m.id)
    .filter((id) => !(id in MODEL_PRICING));
  assert.deepEqual(
    missing,
    [],
    `availableModels ids missing from MODEL_PRICING: ${missing.join(', ')}`,
  );
});

test('the notebook route default model has a MODEL_PRICING entry', () => {
  // Mirrors DEFAULT_MODEL in src/app/api/query-notebook/route.ts. That file
  // pulls in next/headers and next-auth, which aren't safe to import under
  // node:test, so the id is duplicated here rather than imported — keep the
  // two in sync by hand if the route's default model changes.
  const NOTEBOOK_DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
  assert.ok(
    NOTEBOOK_DEFAULT_MODEL in MODEL_PRICING,
    `notebook route default model "${NOTEBOOK_DEFAULT_MODEL}" is missing from MODEL_PRICING`,
  );
});
