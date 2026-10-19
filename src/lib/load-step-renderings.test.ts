// #644 W1 criterion 4 — how a `load_source` call reads to a reader.
//
// A load is the instance's own step: no source answers it and no data comes
// back. Every renderer that switches on a call's operation type sent an
// unknown type to a `default` branch written for data requests ("Calling
// load_source...", "to call load_source", "called load_source"), and the
// executed notebook filed it under discovery calls made "before fetching
// data". So the operation type is derived (`load_source`), each of the
// operation-type formatters in `streaming.ts` has a case for it that names
// the source in the reader's words and states the outcome only where it is
// known, and the notebook states a load as a note, never as a step or a
// discovery call.
//
// An alias the model sends that names no source is never echoed: it is text
// the endpoint chose.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/load-step-renderings.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperationType } from './mcp/operation-types.ts';
import {
  buildBreadcrumbLabel,
  buildNarrativeSummary,
  formatToolProgress,
  formatToolResult,
  generateToolReason,
  getEducationalAnnotation,
} from './streaming.ts';
import { isAnalysisStep, renderDiscoverySummaryCell, renderFetchToolCell, type PhaseAToolCall } from './notebook-author/tool-to-cell.ts';

const LOAD = 'load_source';
const UNKNOWN_ALIAS = '{"alias":"x"} `injected`';

test('the load step: a load_source call derives the operation type load_source', () => {
  assert.equal(deriveOperationType(LOAD, { alias: 'socrata' }), 'load_source');
  assert.equal(deriveOperationType(LOAD, {}), 'load_source');
});

test('the load step: the progress line and the reason name the source in the reader\'s words', () => {
  assert.equal(formatToolProgress(LOAD, { alias: 'socrata' }), 'Loading the Socrata source');
  assert.equal(formatToolProgress(LOAD, { alias: 'data_commons' }), 'Loading the Google Data Commons source');
  assert.equal(formatToolProgress(LOAD, { alias: UNKNOWN_ALIAS }), 'Loading a data source');
  assert.equal(generateToolReason({ alias: 'boston' }, LOAD), 'to load the Boston OpenContext source');
  assert.equal(generateToolReason({ alias: UNKNOWN_ALIAS }, LOAD), 'to load a data source');
});

test('the load step: the result line states each outcome W1 records, and nothing without one', () => {
  assert.equal(formatToolResult({ alias: 'socrata' }, undefined, LOAD, 'loaded'), 'Loaded the Socrata source');
  assert.equal(
    formatToolResult({ alias: 'boston' }, undefined, LOAD, 'declined'),
    'The Boston OpenContext source is set to Ask first, so it was not used for this question',
  );
  assert.equal(
    formatToolResult({ alias: UNKNOWN_ALIAS }, undefined, LOAD, 'not-offered'),
    'No source was loaded: the request named none this question can use',
  );
  assert.equal(formatToolResult({ alias: 'socrata' }, undefined, LOAD), null);
});

test('the load step: the annotation, the breadcrumb and the narrative have a load case', () => {
  assert.equal(
    getEducationalAnnotation('tool_start', 'load_source'),
    "The AI is loading a data source it chose from this site's list, so it can use that source's tools next.",
  );
  assert.equal(buildBreadcrumbLabel({ name: LOAD, args: { alias: 'socrata' } }), 'Load Socrata');
  assert.equal(buildBreadcrumbLabel({ name: LOAD, args: { alias: UNKNOWN_ALIAS } }), 'Load a source');
  const narrative = buildNarrativeSummary([
    { name: LOAD, args: { alias: 'socrata' }, operationType: 'load_source', loadOutcome: 'loaded' },
    { name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'declined' },
    { name: LOAD, args: { alias: UNKNOWN_ALIAS }, operationType: 'load_source', loadOutcome: 'not-offered' },
    { name: LOAD, args: { alias: 'data_commons' }, operationType: 'load_source' },
  ]);
  assert.match(narrative, /loaded the Socrata source/);
  assert.match(narrative, /did not use the Boston OpenContext source, which is set to Ask first/);
  assert.match(narrative, /asked for a source this question cannot use/);
  assert.match(narrative, /asked to load the Google Data Commons source/);
});

test('the load step: no renderer narrates a load as a data request or echoes an unknown alias', () => {
  const lines = [
    formatToolProgress(LOAD, { alias: 'socrata' }),
    formatToolProgress(LOAD, { alias: UNKNOWN_ALIAS }),
    formatToolResult({ alias: UNKNOWN_ALIAS }, undefined, LOAD, 'not-offered') ?? '',
    generateToolReason({ alias: UNKNOWN_ALIAS }, LOAD),
    buildBreadcrumbLabel({ name: LOAD, args: { alias: UNKNOWN_ALIAS } }),
    buildNarrativeSummary([{ name: LOAD, args: { alias: UNKNOWN_ALIAS }, operationType: 'load_source', loadOutcome: 'not-offered' }]),
  ];
  for (const line of lines) {
    assert.doesNotMatch(line, /Calling|to call|called|Looking up|look up|load_source/, `a default branch: ${line}`);
    assert.ok(!line.includes('injected') && !line.includes('{'), `the alias was echoed: ${line}`);
  }
});

test('the load step: the notebook states a load as a note, never a fetch cell or a discovery call', () => {
  const load: PhaseAToolCall = { name: LOAD, args: { alias: 'socrata' }, operationType: 'load_source', reason: 'to load the Socrata source', loadOutcome: 'loaded' };
  const declined: PhaseAToolCall = { name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'declined' };
  const unknown: PhaseAToolCall = { name: LOAD, args: { alias: UNKNOWN_ALIAS }, operationType: 'load_source', loadOutcome: 'not-offered' };
  const search: PhaseAToolCall = { name: 'socrata__search', args: { query: 'potholes' }, operationType: 'search', reason: 'to find datasets about "potholes"' };
  assert.equal(isAnalysisStep(load), false);
  assert.equal(renderFetchToolCell(load, { dataFrameIndex: 1, defaultPortal: '' }), null);

  const withLoads = renderDiscoverySummaryCell([load, search, declined, unknown]);
  const text = Array.isArray(withLoads?.source) ? withLoads!.source.join('') : String(withLoads?.source ?? '');
  const [discovery, note] = text.split('### Sources loaded');
  assert.ok(note !== undefined, `no load note:\n${text}`);
  assert.ok(!discovery.includes('load_source'), `a load is listed as a discovery call:\n${text}`);
  assert.match(discovery, /`search`/);
  assert.match(note, /- `socrata`: loaded/);
  assert.match(note, /- `boston`: not used, set to Ask first/);
  assert.match(note, /- a request that named no source of the directory: nothing loaded/);
  assert.ok(!text.includes('injected'), 'an unknown alias was echoed into the notebook');

  // A run with no load renders the cell it rendered before loads existed.
  const without = renderDiscoverySummaryCell([search]);
  const plain = Array.isArray(without?.source) ? without!.source.join('') : String(without?.source ?? '');
  assert.ok(!plain.includes('Sources loaded'));
  // Loads alone still make a note.
  const loadsOnly = renderDiscoverySummaryCell([load]);
  const only = Array.isArray(loadsOnly?.source) ? loadsOnly!.source.join('') : String(loadsOnly?.source ?? '');
  assert.match(only, /### Sources loaded/);
  assert.ok(!only.includes('### Discovery'));
});
