// The step module, driven directly (LAYOUT-WEB W2 P1): the labels, the pairing
// of steps to calls, and the accumulation of progress events into steps.
//
// The module is imported here with no loader hook — under plain
// `--experimental-strip-types`, which transforms no JSX and maps no `@/` — so
// this file loading at all is part of the purity check; the source read below
// is the rest of it (no React, no DOM, no `'use client'`, no clock).
//
// The comparison's rendered steps are compared byte for byte with the base in
// `src/components/comparison-steps-render.test.ts`; this file pins the
// module's own behaviour, branch by branch.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/answer-view/steps.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OPEN_STEP_LABEL,
  applyProgressEvent,
  closeStepsOnAnswer,
  closeStepsOnComplete,
  closeStepsOnError,
  generateGroupLabel,
  mapGroupsToToolCalls,
  type ProgressGroup,
  type ProgressLogEntry,
  type StepCall,
  type StepLog,
  type StepProgressEvent,
} from './steps.ts';

const EMPTY: StepLog = { progressLog: [], progressGroups: [] };

function start(fields: Partial<ProgressLogEntry> & { message?: string } = {}): ProgressLogEntry {
  return { message: 'step...', timestamp: 0, phase: 'tool_start', iteration: 1, ...fields };
}

function run(events: StepProgressEvent[], from: StepLog = EMPTY): StepLog {
  return events.reduce((log, event, i) => applyProgressEvent(log, event, 1000 + i), from);
}

// --- Purity --------------------------------------------------------------------

test('steps.ts is pure: no use-client directive, no React, no DOM, no clock', () => {
  const source = readFileSync(fileURLToPath(new URL('./steps.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /^\s*['"]use client['"]/m, "steps.ts carries a 'use client' directive");
  const imports = [...source.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'no import read; the pattern no longer matches this file');
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /^(react|react-dom|next)(\/|$)/, `steps.ts imports ${specifier}`);
    assert.match(specifier, /^\.\.?\/.*\.ts$/, `steps.ts imports ${specifier}: src/lib imports are relative and carry their extension`);
  }
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const global of ['window', 'document', 'navigator', 'localStorage', 'Date.now', 'performance']) {
    assert.ok(!new RegExp(`\\b${global.replace('.', '\\.')}\\b`).test(code), `steps.ts reads ${global}`);
  }
});

// --- generateGroupLabel --------------------------------------------------------

test('generateGroupLabel: a search is labelled by its query, in either spelling of the name', () => {
  for (const toolName of ['search', 'socrata__search']) {
    assert.equal(
      generateGroupLabel([start({ toolName, operationType: 'search', args: { query: 'noise' } })]),
      'Searching for datasets about "noise"',
    );
  }
  assert.equal(generateGroupLabel([start({ toolName: 'socrata__search', args: {} })]), 'Searching for datasets', 'the operation type is derived from the name when the entry carries none');
  assert.equal(
    generateGroupLabel([start({ toolName: 'search_indicators', args: { query: 'median income' } })]),
    'Searching for statistical indicators about "median income"',
  );
});

test('generateGroupLabel: catalog, metadata and metrics labels read the arguments', () => {
  assert.equal(generateGroupLabel([start({ operationType: 'catalog', args: { query: 'rats' } })]), 'Searching for datasets about "rats"');
  assert.equal(generateGroupLabel([start({ operationType: 'catalog', args: {} })]), 'Searching the data catalog');
  assert.equal(generateGroupLabel([start({ operationType: 'metadata', args: { dataset_id: 'erm2-nwe9' } })]), 'Understanding 311 Service Requests structure');
  assert.equal(generateGroupLabel([start({ operationType: 'metrics', args: { dataset_id: '43nn-pn8j' } })]), 'Checking Restaurant Inspections statistics');
});

test('generateGroupLabel: one query takes its intent label, read against the earlier steps; two take "Querying multiple datasets"', () => {
  const query = start({ toolName: 'socrata__get_data', operationType: 'query', args: { type: 'query', dataset_id: 'erm2-nwe9', select: 'count(*)' } });
  assert.equal(typeof generateGroupLabel([query]), 'string');
  assert.notEqual(generateGroupLabel([query]), OPEN_STEP_LABEL);
  assert.equal(generateGroupLabel([query, { ...query, message: 'other...' }]), 'Querying multiple datasets');
});

test('generateGroupLabel: a fetch names what was asked for; a tool with no operation type is called by its upstream name', () => {
  assert.equal(generateGroupLabel([start({ toolName: 'fetch', args: { id: 'record:x/1' } })]), 'Looking up record:x/1');
  assert.equal(generateGroupLabel([start({ toolName: 'socrata__fetch', args: {} })]), 'Looking up one item');
  assert.equal(generateGroupLabel([start({ toolName: 'nyc_charter__get_section', args: { section: '1' } })]), 'Calling get_section');
  assert.equal(generateGroupLabel([start({ toolName: 'get_section' })]), 'Calling get_section');
  assert.equal(generateGroupLabel([start({ toolName: 'socrata__get_data' })]), OPEN_STEP_LABEL, 'get_data with nothing to describe gathers data');
});

test('generateGroupLabel: entries with no name and no operation type fall back to their messages, and claim nothing otherwise', () => {
  assert.equal(generateGroupLabel([start({ message: 'Searching the catalog...' })]), 'Finding relevant datasets');
  assert.equal(generateGroupLabel([start({ message: 'Loading metadata...' })]), 'Understanding dataset structure');
  assert.equal(generateGroupLabel([start({ message: 'Querying...' }), start({ message: 'Counting...' })]), 'Querying multiple datasets');
  assert.equal(generateGroupLabel([start({ message: 'Previewing rows...' })]), 'Querying data');
  assert.equal(generateGroupLabel([start({ message: 'Fetching metrics...' })]), 'Checking dataset statistics');
  assert.equal(generateGroupLabel([start({ message: 'Working...' })]), OPEN_STEP_LABEL);
  assert.equal(generateGroupLabel([{ message: 'Thinking...', timestamp: 0, phase: 'thinking' }]), 'Processing');
  assert.equal(generateGroupLabel([]), 'Processing');
});

// --- mapGroupsToToolCalls ----------------------------------------------------------

test('mapGroupsToToolCalls: each step takes as many calls, in order, as it has tool_start entries, and keeps the caller’s call type', () => {
  const group = (iteration: number, starts: number): ProgressGroup => ({
    iteration,
    label: 'x',
    isComplete: true,
    entries: [
      ...Array.from({ length: starts }, (_, i) => start({ iteration, message: `call ${i}` })),
      { message: 'result', timestamp: 0, phase: 'tool_result', iteration },
    ],
  });
  type Recorded = StepCall & { recordedAt: string };
  const calls: Recorded[] = ['a', 'b', 'c', 'd'].map((name) => ({ name, args: {}, recordedAt: `t-${name}` }));
  const enriched = mapGroupsToToolCalls([group(1, 1), group(2, 2), group(3, 0), group(4, 1)], calls);
  assert.deepEqual(enriched.map((e) => e.toolCalls.map((c) => c.name)), [['a'], ['b', 'c'], [], ['d']]);
  assert.equal(enriched[1].toolCalls[1].recordedAt, 't-c', 'the call type passes through');
  assert.deepEqual(mapGroupsToToolCalls([group(1, 2)], calls.slice(0, 1)).map((e) => e.toolCalls.length), [1], 'fewer calls than starts: the step takes what there is');
});

// --- The accumulation ----------------------------------------------------------------

test('applyProgressEvent: a tool_start opens its iteration’s step; a second joins it; the entry is stamped with the caller’s clock', () => {
  const log = run([
    { message: 'a...', phase: 'tool_start', iteration: 1, toolName: 'socrata__get_data', args: { type: 'query' } },
    { message: 'b...', phase: 'tool_start', iteration: 1, toolName: 'socrata__get_data', args: { type: 'query' } },
  ]);
  assert.equal(log.progressGroups.length, 1);
  assert.equal(log.progressGroups[0].label, OPEN_STEP_LABEL);
  assert.equal(log.progressGroups[0].isComplete, false);
  assert.deepEqual(log.progressGroups[0].entries.map((e) => [e.message, e.timestamp]), [['a...', 1000], ['b...', 1001]]);
  assert.equal(log.progressLog.length, 2);
  assert.ok(!('failed' in log.progressLog[0]), 'absent stays absent');
});

test('applyProgressEvent: a tool_complete carries its duration and the rejection onto the start it pairs to, by iteration and message', () => {
  const log = run([
    { message: 'a...', phase: 'tool_start', iteration: 1, args: {} },
    { message: 'b...', phase: 'tool_start', iteration: 1, args: {} },
    { message: 'b...', phase: 'tool_complete', iteration: 1, duration_ms: 300, failed: true, failureKind: 'timeout' },
    { message: 'a...', phase: 'tool_complete', iteration: 1, duration_ms: 100 },
  ]);
  const [a, b] = log.progressGroups[0].entries;
  assert.deepEqual([a.isComplete, a.duration_ms, a.failed, a.failureKind], [true, 100, undefined, undefined]);
  assert.ok(!('failed' in a), 'an answered call’s start carries no failed key');
  assert.deepEqual([b.isComplete, b.duration_ms, b.failed, b.failureKind], [true, 300, true, 'timeout']);
  assert.deepEqual(log.progressLog.map((e) => e.duration_ms), [100, 300], 'the flat log is paired the same way');
  assert.equal(log.progressGroups[0].entries.length, 2, 'an end event adds no entry');
});

test('applyProgressEvent: a tool_result joins its step done; thinking closes the step with its label and total, read against earlier iterations', () => {
  const log = run([
    { message: 'Searching...', phase: 'tool_start', iteration: 1, toolName: 'search', operationType: 'search', args: { query: 'rats' } },
    { message: 'Searching...', phase: 'tool_complete', iteration: 1, duration_ms: 200 },
    { message: 'Found 3 datasets', phase: 'tool_result', iteration: 1 },
    { message: 'Thinking...', phase: 'thinking', iteration: 1 },
  ]);
  const [group] = log.progressGroups;
  assert.equal(group.entries[1].isComplete, true);
  assert.equal(group.isComplete, true);
  assert.equal(group.label, 'Searching for datasets about "rats"');
  assert.equal(group.totalDuration_ms, 200);
  assert.equal(log.progressLog.length, 2, 'thinking adds nothing to the flat log');
  const unpaired = run([{ message: 'x...', phase: 'tool_start', iteration: 1, args: {} }, { message: 'Thinking...', phase: 'thinking', iteration: 1 }]);
  assert.ok(!('totalDuration_ms' in unpaired.progressGroups[0]), 'no recorded duration, no total');
});

test('applyProgressEvent: a standalone entry marks the entry before it done', () => {
  const log = run([
    { message: 'Analyzing...', phase: 'analyze' },
    { message: 'Composing...', phase: 'synthesize' },
  ]);
  assert.deepEqual(log.progressLog.map((e) => e.isComplete), [true, undefined]);
  assert.equal(log.progressGroups.length, 0);
});

test('closeStepsOnAnswer: open steps close with a label, entries done and a total; a closed step is left as it is', () => {
  const log = run([
    { message: 'Searching...', phase: 'tool_start', iteration: 1, toolName: 'search', args: { query: 'rats' } },
    { message: 'Thinking...', phase: 'thinking', iteration: 1 },
    { message: 'Calling get_section...', phase: 'tool_start', iteration: 2, toolName: 'get_section', args: {} },
    { message: 'Calling get_section...', phase: 'tool_complete', iteration: 2, duration_ms: 40 },
    { message: 'Calling get_version...', phase: 'tool_start', iteration: 2, toolName: 'get_version', args: {} },
  ]);
  const closed = closeStepsOnAnswer(log);
  assert.equal(closed.progressGroups[0], log.progressGroups[0], 'the step closed by thinking is the same object');
  const [, second] = closed.progressGroups;
  assert.equal(second.isComplete, true);
  assert.equal(second.label, 'Calling get_section');
  assert.equal(second.totalDuration_ms, 40);
  assert.ok(second.entries.every((e) => e.isComplete));
  assert.equal(closed.progressLog.at(-1)!.isComplete, true, 'the last log entry is done');
  assert.equal(closed.progressLog[0].isComplete, undefined, 'earlier log entries are not touched');
});

test('closeStepsOnComplete: every step closes and is labelled again; a total it already has is kept', () => {
  const log = run([
    { message: 'a...', phase: 'tool_start', iteration: 1, toolName: 'fetch', args: { id: 'r1' } },
    { message: 'a...', phase: 'tool_complete', iteration: 1, duration_ms: 10 },
    { message: 'Thinking...', phase: 'thinking', iteration: 1 },
    { message: 'b...', phase: 'tool_start', iteration: 2, toolName: 'fetch', args: { id: 'r2' } },
    { message: 'b...', phase: 'tool_complete', iteration: 2, duration_ms: 20 },
  ]);
  const relabelled = { ...log, progressGroups: log.progressGroups.map((g) => ({ ...g, label: 'stale', totalDuration_ms: g.iteration === 1 ? 999 : undefined })) };
  const closed = closeStepsOnComplete(relabelled);
  assert.deepEqual(closed.progressGroups.map((g) => [g.label, g.isComplete, g.totalDuration_ms]), [
    ['Looking up r1', true, 999],
    ['Looking up r2', true, 20],
  ]);
  assert.ok(closed.progressLog.every((e) => e.isComplete));
});

test('closeStepsOnError: every step and entry is done, and no label changes', () => {
  const log = run([{ message: 'a...', phase: 'tool_start', iteration: 1, toolName: 'fetch', args: { id: 'r1' } }]);
  const closed = closeStepsOnError(log);
  assert.deepEqual(closed.progressGroups.map((g) => [g.label, g.isComplete]), [[OPEN_STEP_LABEL, true]]);
  assert.ok(closed.progressGroups[0].entries.every((e) => e.isComplete));
  assert.ok(closed.progressLog.every((e) => e.isComplete));
});

test('the accumulation never mutates the log it is handed', () => {
  const before = run([
    { message: 'a...', phase: 'tool_start', iteration: 1, args: {} },
    { message: 'b...', phase: 'tool_start', iteration: 2, args: {} },
  ]);
  const snapshot = JSON.stringify(before);
  run([
    { message: 'a...', phase: 'tool_complete', iteration: 1, duration_ms: 5 },
    { message: 'r', phase: 'tool_result', iteration: 1 },
    { message: 'Thinking...', phase: 'thinking', iteration: 1 },
    { message: 'standalone' },
  ], before);
  closeStepsOnAnswer(before);
  closeStepsOnComplete(before);
  closeStepsOnError(before);
  assert.equal(JSON.stringify(before), snapshot);
});
