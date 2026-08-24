// Guards the model-roster/pricing coupling that caused #232.
//
// The original defect: the UI roster (`availableModels`) and the cost table
// (`MODEL_PRICING`) were two hand-synchronized maps, and an id present in one
// and missing from the other made `estimateCostUsd` return null in silence.
// civic-ai-tools-website#30 P2 folded both — and the display-name map, the
// notebook default and the publication gate's evaluator literals — into one
// catalog entry per model, so the two can no longer disagree by construction.
// What is still worth pinning is the OUTPUT: this file asserts that the ids
// this repo priced and named at `b95c768` still price and name identically, so
// the consolidation cannot be a silent reader-facing regression on records
// already published.
//
// The structural half of the guard (every offered entry carries pricing, the
// default resolves, the evaluator order reproduces the two literals) lives in
// model-catalog.test.ts.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUsd, formatModelName } from './models.ts';
import { BUILT_IN_CATALOG, catalogDefaultEntry } from './model-catalog.ts';

/**
 * Display name and per-1M-token prices for every id this repo knew at
 * `b95c768` — the three in the selector, the notebook/evaluator default, and
 * the three that were priced and named but never selectable. A frozen literal,
 * not a re-derivation: it is the pre-catalog `MODEL_PRICING` and
 * `formatModelName` maps read off that commit.
 */
const FROZEN_MODEL_RENDERING: Record<string, { name: string; input: number; output: number }> = {
  'openai/gpt-4o': { name: 'GPT-4o', input: 2.5, output: 10.0 },
  'openai/gpt-5.4': { name: 'GPT-5.4', input: 2.5, output: 15.0 },
  'google/gemini-3.5-flash-lite': { name: 'Gemini 3.5 Flash Lite', input: 0.3, output: 2.5 },
  'anthropic/claude-sonnet-4': { name: 'Claude Sonnet 4', input: 3.0, output: 15.0 },
  'anthropic/claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', input: 3.0, output: 15.0 },
  'anthropic/claude-opus-5': { name: 'Claude Opus 5', input: 5.0, output: 25.0 },
  'anthropic/claude-haiku-4.5': { name: 'Claude Haiku 4.5', input: 1.0, output: 5.0 },
};

test('every id this repo priced at b95c768 still estimates the same cost', () => {
  for (const [id, expected] of Object.entries(FROZEN_MODEL_RENDERING)) {
    const cost = estimateCostUsd(id, 1_000_000, 1_000_000);
    assert.equal(
      cost,
      expected.input + expected.output,
      `cost estimation changed for "${id}" — a record already published renders through this`,
    );
  }
});

test('every id this repo named at b95c768 still formats to the same display name', () => {
  for (const [id, expected] of Object.entries(FROZEN_MODEL_RENDERING)) {
    assert.equal(formatModelName(id), expected.name, `display name changed for "${id}"`);
  }
});

test('an unknown id still falls back to the raw id and to no cost estimate', () => {
  assert.equal(formatModelName('vendor/model-nobody-knows'), 'vendor/model-nobody-knows');
  assert.equal(estimateCostUsd('vendor/model-nobody-knows', 1000, 1000), null);
});

test('every catalog entry has a display name and a cost estimate', () => {
  // The #232 invariant, restated against the structure that replaced the two
  // maps: an offered model is one record, so its name and its price cannot be
  // in different states.
  for (const entry of BUILT_IN_CATALOG) {
    assert.equal(formatModelName(entry.id), entry.name);
    assert.notEqual(
      estimateCostUsd(entry.id, 1000, 1000),
      null,
      `estimateCostUsd is null for offered model "${entry.id}"`,
    );
  }
});

test('the notebook route default model is a catalog entry with pricing', () => {
  // Replaces the hand-kept NOTEBOOK_DEFAULT_MODEL duplicate this file used to
  // carry: the route no longer holds a slug to drift from, it asks the catalog.
  const fallback = catalogDefaultEntry(BUILT_IN_CATALOG);
  assert.ok(fallback.pricing, `default model "${fallback.id}" has no pricing`);
  assert.equal(formatModelName(fallback.id), fallback.name);
});
