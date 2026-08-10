// Tests for the query-surface mount configuration derivations (s6 P2, #229).
//
// Rule zero, stated as assertions: with the defaults a mount passes today
// (comparison presentation, standard default mode, no stored choices), every
// derivation reproduces the apex demo's existing behavior — two model arms,
// standard mode, footnote waits on both panes.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStoredMode,
  parseStoredComparison,
  resolveEffectiveMode,
  shouldRunMcpOnly,
  isComparisonRunComplete,
} from './query-presentation.ts';
import { panelsForRun } from './streaming.ts';

test('parseStoredMode: only the two real modes parse; junk is "no choice"', () => {
  assert.equal(parseStoredMode('notebook'), 'notebook');
  assert.equal(parseStoredMode('standard'), 'standard');
  assert.equal(parseStoredMode(null), null);
  assert.equal(parseStoredMode(''), null);
  assert.equal(parseStoredMode('sandbox'), null);
});

test('parseStoredComparison: on/off parse; junk is "no choice"', () => {
  assert.equal(parseStoredComparison('on'), 'on');
  assert.equal(parseStoredComparison('off'), 'off');
  assert.equal(parseStoredComparison(null), null);
  assert.equal(parseStoredComparison('true'), null);
});

test('effective mode, rule zero: apex shape (standard default, nothing stored) is standard', () => {
  assert.equal(
    resolveEffectiveMode({ enabled: true, chosen: null, defaultMode: 'standard' }),
    'standard',
  );
});

test('effective mode: an answer-first mount may default to notebook', () => {
  assert.equal(
    resolveEffectiveMode({ enabled: true, chosen: null, defaultMode: 'notebook' }),
    'notebook',
  );
});

test("effective mode: the user's explicit choice beats the mount default, both ways", () => {
  // /ask visitor who switched to Standard stays on Standard...
  assert.equal(
    resolveEffectiveMode({ enabled: true, chosen: 'standard', defaultMode: 'notebook' }),
    'standard',
  );
  // ...and an apex visitor who chose notebook keeps it (today's stickiness).
  assert.equal(
    resolveEffectiveMode({ enabled: true, chosen: 'notebook', defaultMode: 'standard' }),
    'notebook',
  );
});

test('effective mode: executed-sandbox unavailable forces standard, whatever is stored or defaulted', () => {
  assert.equal(
    resolveEffectiveMode({ enabled: false, chosen: 'notebook', defaultMode: 'notebook' }),
    'standard',
  );
  assert.equal(
    resolveEffectiveMode({ enabled: false, chosen: null, defaultMode: 'notebook' }),
    'standard',
  );
});

test('mcpOnly, rule zero: a comparison mount always runs both arms', () => {
  assert.equal(shouldRunMcpOnly('comparison', false), false);
  // A stray stored "restore" flag changes nothing on a comparison mount.
  assert.equal(shouldRunMcpOnly('comparison', true), false);
});

test('mcpOnly: answer-first runs one arm until the visitor restores the comparison', () => {
  assert.equal(shouldRunMcpOnly('answer-first', false), true);
  assert.equal(shouldRunMcpOnly('answer-first', true), false);
});

test('run completion, rule zero: a two-arm run waits for both panels', () => {
  assert.equal(isComparisonRunComplete(false, false, true), false);
  assert.equal(isComparisonRunComplete(false, true, false), false);
  assert.equal(isComparisonRunComplete(false, true, true), true);
});

test('run completion: a demoted run is complete when the with-data arm is', () => {
  assert.equal(isComparisonRunComplete(true, false, true), true);
  assert.equal(isComparisonRunComplete(true, false, false), false);
});

test('panelsForRun: one arm demoted, two arms by default — with-data arm always present', () => {
  assert.deepEqual(panelsForRun(true), ['withMcp']);
  assert.deepEqual(panelsForRun(false), ['withoutMcp', 'withMcp']);
});
