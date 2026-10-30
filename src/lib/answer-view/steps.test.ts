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
  asStepCall,
  buildClosingRows,
  PHASE_WORDS,
  phaseLabel,
  buildRecordStepView,
  buildRunStepView,
  pairCallsToSteps,
  stepSentence,
  stepsAuthorLine,
  type ProgressGroup,
  type ProgressLogEntry,
  type StepCall,
  type StepLog,
  type StepProgressEvent,
} from './steps.ts';
import { generateToolReason, reasonWithoutIdentifier } from '../streaming.ts';
import { describeQueryOutcome } from '../evidence/query-step.ts';

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

// --- LAYOUT-WEB W3 P1 item 5: a named call's label -------------------------------
//
// A call that names its tool and has a recorded operation type, but that the
// labels do not otherwise describe, reads by that operation type in user
// language, never by its tool name. The shape is a published record's
// (`…b8cc28`): a `ckan__get_schema` call, operation type `metadata`, with a
// `resource_id` and no `dataset_id`, so the metadata label that names a dataset
// has nothing to name. The expected words are the module's own for a metadata
// step (its message fallback), read from it rather than written here.
//
// RED at 2bd807b: the step reads "Calling ckan__get_schema" on every path.

const B8CC28 = { tool: 'ckan__get_schema', operationType: 'metadata', arguments: { resource_id: 'a1b2c3d4-0000-4000-8000-000000000001' } };
const METADATA_WORDS = generateGroupLabel([start({ message: 'Loading metadata...' })]);

test('W3 P1 (8) b8cc28’s shape reads by its operation type in user language through the record’s, the run’s and the entry’s paths', () => {
  assert.equal(METADATA_WORDS, 'Understanding dataset structure', 'premise: the module’s words for a metadata step');
  const viaRecord = buildRecordStepView([B8CC28]).steps[0].label;
  const entry = start({ toolName: B8CC28.tool, operationType: B8CC28.operationType });
  const group: ProgressGroup = { iteration: 1, label: OPEN_STEP_LABEL, entries: [entry], isComplete: true };
  const viaRun = buildRunStepView([group], [{ name: B8CC28.tool, operationType: B8CC28.operationType, args: B8CC28.arguments }]).steps[0].label;
  const viaExposedName = generateGroupLabel([start({ toolName: `boston__${B8CC28.tool}`, operationType: 'metadata', args: B8CC28.arguments })]);
  for (const [path, label] of [['record', viaRecord], ['run', viaRun], ['exposed name', viaExposedName]] as const) {
    assert.equal(label, METADATA_WORDS, `the ${path} path reads by the operation type`);
    assert.doesNotMatch(label, /ckan|get_schema|Calling|__/, `the ${path} path reads by the tool name: "${label}"`);
  }
});

test('W3 P1 (8) every recorded operation type the labels do not describe reads in user language; an unknown one claims nothing', () => {
  const named = (operationType: string) => generateGroupLabel([start({ toolName: 'opencontext_tool', operationType, args: {} })]);
  assert.equal(named('metadata'), METADATA_WORDS);
  assert.equal(named('metrics'), generateGroupLabel([start({ message: 'Fetching metrics...' })]), 'metrics with no dataset to name');
  assert.equal(named('catalog'), 'Searching the data catalog', 'catalog is always described');
  assert.equal(named('compute'), OPEN_STEP_LABEL, 'an operation type with no words of its own claims nothing, and is never read by the name');
  for (const op of ['metadata', 'metrics', 'compute']) assert.doesNotMatch(named(op), /opencontext_tool|Calling/);
});

test('W3 P1 (8) a call with no operation type, or the record’s statement that none is known, is left as it was: called by its upstream name', () => {
  assert.equal(generateGroupLabel([start({ toolName: 'nyc_charter__get_section', args: { section: '1' } })]), 'Calling get_section');
  assert.equal(buildRecordStepView([{ tool: 'get_section', operationType: 'unknown', arguments: { section: '1' } }]).steps[0].label, 'Calling get_section',
    '`unknown` is what the packager records for an operation the name does not state; it states no type');
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

// --- The step view (LAYOUT-WEB W2 P2) ----------------------------------------------
//
// The executed run's calls arrive with repeats removed (the route drops a call
// whose name and arguments equal an earlier one's), so its progress lines can
// outnumber its calls. These fixtures each have a shape position pairing gets
// wrong, so the pairing's answer is asserted where `mapGroupsToToolCalls`
// would give another.

const Q_A = { type: 'query', dataset_id: 'aaaa-1111', select: 'count(*)' };
const Q_B = { type: 'query', dataset_id: 'bbbb-2222', where: "issued > '2026-01-01'" };
const Q_A_BY = { type: 'query', dataset_id: 'aaaa-1111', group: 'borough' };
const M_A = { type: 'metadata', dataset_id: 'aaaa-1111' };

/** Fold a run's `tool_start`/`tool_complete` pairs into its steps, as the hook does. */
function stepsOf(lines: Array<{ iteration: number; message: string; op: string; failed?: boolean }>): ProgressGroup[] {
  const events: StepProgressEvent[] = lines.flatMap((l) => {
    const tool = { toolName: 'socrata__get_data', operationType: l.op };
    return [
      { message: l.message, phase: 'tool_start', iteration: l.iteration, ...tool },
      {
        message: l.message, phase: 'tool_complete', iteration: l.iteration, ...tool,
        ...(l.failed ? { failed: true, failureKind: 'timeout' as const } : {}),
      },
    ];
  });
  return closeStepsOnComplete(run(events)).progressGroups;
}

const call = (args: Record<string, unknown>, fields: Partial<StepCall> = {}): StepCall =>
  ({ name: 'socrata__get_data', operationType: args.type as string, args, ...fields });

// Step 1: two calls. Step 2: an identical repeat of step 1's query (dropped from
// the calls). Step 3: a rejected call on a dataset no other call touches, then
// a new query.
const REPEAT_GROUPS = stepsOf([
  { iteration: 1, message: 'Reading the columns', op: 'metadata' },
  { iteration: 1, message: 'Counting records', op: 'query' },
  { iteration: 2, message: 'Counting records', op: 'query' },
  { iteration: 3, message: 'Querying permits', op: 'query', failed: true },
  { iteration: 3, message: 'Grouping by borough', op: 'query' },
]);
const REPEAT_CALLS = [
  call(M_A),
  call(Q_A, { resultSummary: { rows: 1, columns: 1 } }),
  call(Q_B, { failed: true, failureKind: 'timeout', duration_ms: 45000 }),
  call(Q_A_BY, { resultSummary: { rows: 5, columns: 2 } }),
];

test('W2 P2 pairing: a dropped repeat does not move a later call into the step before its own', () => {
  // The premise: by position, the rejected call lands in step 2.
  const byPosition = mapGroupsToToolCalls(REPEAT_GROUPS, REPEAT_CALLS);
  assert.deepEqual(byPosition.map((g) => g.toolCalls.length), [2, 1, 1], 'premise: position pairing misplaces the calls here');
  assert.equal(byPosition[1].toolCalls[0], REPEAT_CALLS[2], 'premise: position pairing puts the rejected call in step 2');

  const pairing = pairCallsToSteps(REPEAT_GROUPS, REPEAT_CALLS);
  assert.deepEqual(pairing.placed, [[REPEAT_CALLS[0], REPEAT_CALLS[1]], [], [REPEAT_CALLS[2], REPEAT_CALLS[3]]]);
  assert.deepEqual(pairing.unplaced, []);
  const startsArgs = pairing.entries.map((g) => g.filter((e) => e.phase === 'tool_start').map((e) => e.args));
  assert.deepEqual(startsArgs, [[M_A, Q_A], [Q_A], [Q_B, Q_A_BY]], 'each line carries its call’s arguments, and the repeat its twin’s');
  assert.equal(REPEAT_GROUPS[0].entries[0].args, undefined, 'the groups handed in are not changed');
});

test('W2 P2 pairing: a call that could sit in either of two steps is placed in neither', () => {
  // Step 1 holds two identical-looking queries, step 2 one; two calls came
  // back. The first sits on step 1's first line in every history; the second
  // could be step 1's second line (step 2's is a repeat) or step 2's (step 1's
  // second is a repeat). The lines carry no arguments to tell them apart.
  const groups = stepsOf([
    { iteration: 1, message: 'Counting records', op: 'query' },
    { iteration: 1, message: 'Counting records', op: 'query' },
    { iteration: 2, message: 'Counting records', op: 'query' },
  ]);
  const calls = [call(Q_A), call(Q_A_BY)];
  const pairing = pairCallsToSteps(groups, calls);
  assert.deepEqual(pairing.placed, [[calls[0]], []]);
  assert.deepEqual(pairing.unplaced, [calls[1]]);
  const startsArgs = pairing.entries.map((g) => g.filter((e) => e.phase === 'tool_start').map((e) => e.args));
  assert.deepEqual(startsArgs, [[Q_A, undefined], [undefined]], 'only the line whose call is certain learns arguments');
});

test('W2 P2 pairing: a successful retry of a rejected call, dropped as a repeat, leaves the rejection in its own step', () => {
  const groups = stepsOf([
    { iteration: 1, message: 'Counting records', op: 'query', failed: true },
    { iteration: 2, message: 'Counting records', op: 'query' },
  ]);
  const calls = [call(Q_A, { failed: true, failureKind: 'timeout' })];
  const pairing = pairCallsToSteps(groups, calls);
  assert.deepEqual(pairing.placed, [[calls[0]], []]);
  assert.deepEqual(pairing.unplaced, []);
  assert.deepEqual(pairing.entries[1].filter((e) => e.phase === 'tool_start').map((e) => e.args), [Q_A], 'the retry repeats the one call before it');
});

test('W2 P2 pairing: calls no history can hold are all unplaced, and no line learns arguments', () => {
  const groups = stepsOf([{ iteration: 1, message: 'Counting records', op: 'query' }]);
  const calls = [call(Q_A), call(Q_B)];
  const pairing = pairCallsToSteps(groups, calls);
  assert.deepEqual(pairing.placed, [[]]);
  assert.deepEqual(pairing.unplaced, calls);
  assert.equal(pairing.entries[0][0].args, undefined);
});

test('W2 P2 the run’s step view: one step per iteration, the calls placed, each line written by the formatters', () => {
  const view = buildRunStepView(REPEAT_GROUPS, REPEAT_CALLS);
  assert.equal(view.steps.length, 3, 'one step per iteration');
  assert.deepEqual(view.steps.map((s) => s.calls.length), [2, 0, 2]);
  assert.deepEqual(view.unplaced, []);
  const pairing = pairCallsToSteps(REPEAT_GROUPS, REPEAT_CALLS);
  view.steps.forEach((step, gi) => {
    assert.equal(step.label, generateGroupLabel(pairing.entries[gi], pairing.entries.slice(0, gi).flat()), `step ${gi + 1}'s label`);
  });
  assert.notEqual(view.steps[0].label, OPEN_STEP_LABEL, 'the labels read the arguments the calls carried');
  const shown = view.steps.flatMap((s) => s.calls);
  REPEAT_CALLS.forEach((c, i) => {
    assert.equal(shown[i].sentence, reasonWithoutIdentifier(generateToolReason(c.args, c.name)));
    assert.equal(shown[i].outcome, describeQueryOutcome({
      failed: c.failed, failureKind: c.failureKind, resultRows: c.resultSummary?.rows,
      resultColumns: c.resultSummary?.columns, duration_ms: c.duration_ms,
    }).text);
  });
  assert.equal(view.steps[2].calls[0].failed, true, 'the rejected call is in step 3, stated as failed');
});

test('W2 P2 the run’s step view: with no recorded steps, every call is listed as unplaced, none in a step', () => {
  const view = buildRunStepView([], REPEAT_CALLS);
  assert.equal(view.steps.length, 0);
  assert.equal(view.unplaced.length, REPEAT_CALLS.length);
});

test('W2 P2 the record’s step view: one step per entry, the sentence and outcome from the formatters', () => {
  const queries = [
    { tool: 'socrata__get_data', operationType: 'query', arguments: Q_A_BY, resultRows: 5, resultColumns: 2, duration_ms: 410 },
    { tool: 'socrata__fetch', operationType: 'fetch', arguments: { id: 'record:data.example.org:abcd-1234:7' } },
    { tool: 'socrata__get_data', operationType: 'query', arguments: Q_B },
  ];
  const refused = new Set([2]);
  const view = buildRecordStepView(queries, refused);
  assert.equal(view.steps.length, queries.length);
  queries.forEach((q, i) => {
    assert.equal(view.steps[i].calls.length, 1);
    assert.equal(view.steps[i].calls[0].sentence, reasonWithoutIdentifier(generateToolReason(q.arguments, q.tool)));
    assert.equal(view.steps[i].calls[0].outcome, describeQueryOutcome(q, { refusedInTrace: refused.has(i) }).text);
  });
  assert.equal(view.steps[1].calls[0].sentence, undefined, 'a sentence that names an identifier is dropped');
  assert.equal(view.steps[2].calls[0].failed, true, 'an entry its trace marks refused is stated as failed');
  assert.ok(view.steps.every((s) => !s.label.includes('__')), 'no label prints the exposed name');
});

test('W2 P2 the author line names the instance, and is absent when none is declared', () => {
  assert.equal(stepsAuthorLine('records.example.test'), "Steps, written by records.example.test from the model's calls");
  assert.equal(stepsAuthorLine(null), null);
  assert.equal(stepsAuthorLine(''), null);
});

test('W2 P2 asStepCall: absent arguments read as none, and every other field is kept', () => {
  const captured = { name: 'socrata__get_data', reason: 'to query X', failed: true as const };
  const mapped = asStepCall(captured);
  assert.deepEqual(mapped, { ...captured, args: {} });
  assert.equal('args' in captured, false, 'the captured call is not changed');
  const withArgs = { name: 'socrata__get_data', args: Q_A };
  assert.equal(asStepCall(withArgs).args, Q_A);
  assert.equal(stepSentence(mapped), reasonWithoutIdentifier(generateToolReason({}, captured.name)));
});

test('W2 P2 fix 1 closing rows: B, C, D in phase order, only those reported, C with the recorded sandbox duration', () => {
  const reported = [
    { phase: 'A', message: 'Discovering datasets…' },
    { phase: 'C', message: 'Executing in sandbox…' },
    { phase: 'B', message: 'Synthesizing notebook…' },
    { phase: 'complete', message: 'Done.' },
  ];
  assert.deepEqual(buildClosingRows(reported, 4200), [
    { phase: 'B', label: 'Writing the notebook' },
    { phase: 'C', label: 'Running it in a sandbox', fact: 'Sandbox duration 4.2 s' },
  ], 'no row for A, complete or an unreported D; B before C whatever the order reported');
  assert.deepEqual(buildClosingRows(reported, null).map((r) => r.fact), [undefined, undefined], 'no duration stated when none was recorded');
  assert.deepEqual(buildClosingRows([], 4200), [], 'no rows when no phase was recorded');
});

test('UX pass row 21: the phase words are mapped by phase name, the route\'s message the fallback for a phase the table lacks', () => {
  assert.deepEqual({ ...PHASE_WORDS }, { A: 'Finding the data', B: 'Writing the notebook', C: 'Running it in a sandbox', D: 'Checking the result', complete: 'Done' });
  // The route's messages are unchanged; the label does not read them for a known phase.
  assert.equal(phaseLabel('B', 'Synthesizing notebook…'), 'Writing the notebook');
  assert.equal(phaseLabel('D', 'Finalizing…'), 'Checking the result');
  assert.equal(phaseLabel('E', 'Checking the result…'), 'Checking the result', 'an unknown phase reads its message without the ellipsis, as before');
  assert.equal(phaseLabel('E', 'Checking the result...'), 'Checking the result');
});

// --- R8 W2 (#644): the load label, every derivable type, and the pause step ---------------
//
// Consent 1 (LAYOUT-WEB's G4c record, #619 comment 6298590738): one
// `OPERATION_WORDS` entry, `load_source: 'Loading a data source'`, with two
// tests. Test 1: a `load_source` step reads it, where the base read the open
// step's "Gathering data". Test 2: every type `deriveOperationType` can
// return, driven through `generateGroupLabel` on an entry that carries args,
// reads a label of its own; red at the base on `load_source` only.

/** The derivable set, as LAYOUT-WEB-D and the G0 record state it: the map's values and `get_data`'s `type` enum. */
const DERIVABLE = ['search', 'metadata', 'query', 'load_source', 'catalog', 'metrics'];

test('R8 W2 (LAYOUT-WEB-D test 1): a load_source step reads "Loading a data source"', () => {
  const label = generateGroupLabel([start({ message: 'Loading the Socrata source', toolName: 'load_source', operationType: 'load_source', args: { alias: 'socrata' } })]);
  assert.equal(label, 'Loading a data source');
});

test('R8 W2 (LAYOUT-WEB-D test 2): every derivable operation type, on an entry with args, reads a label other than the open step\'s', () => {
  const open = DERIVABLE.filter((type) => generateGroupLabel([start({ toolName: 'any_tool', operationType: type, args: {} })]) === OPEN_STEP_LABEL);
  assert.deepEqual(open, [], `these types read "${OPEN_STEP_LABEL}": ${open.join(', ')}`);
});

test('R8 W2 (LAYOUT-WEB-D test 2): the derivable set is exported from operation-types.ts, the map\'s values and get_data\'s type enum', async () => {
  const ops = (await import('../mcp/operation-types.ts')) as Record<string, unknown>;
  const exported = ops.DERIVABLE_OPERATION_TYPES as readonly string[] | undefined;
  assert.ok(Array.isArray(exported), 'operation-types.ts exports no DERIVABLE_OPERATION_TYPES');
  assert.deepEqual([...exported!].sort(), [...DERIVABLE].sort());
  for (const type of exported!) {
    assert.notEqual(generateGroupLabel([start({ toolName: 'any_tool', operationType: type, args: {} })]), OPEN_STEP_LABEL, type);
  }
});

const PAUSE = {
  key: 'ab'.repeat(16),
  source: { sourceId: 'boston-opencontext', displayName: 'Boston OpenContext MCP Server', publisher: 'not stated', variant: { variant: 'remote', kind: 'remote' as const, runsAt: 'other' as const }, freshness: 'Varies', recipients: [], version: '0'.repeat(64) },
  outbound: [],
  links: { privacy: '/privacy', deploymentGuideOmitted: 'This site does not name a deployment guide.' },
  expiresAt: '2026-10-21T12:01:00.000Z',
  holds: true,
};

test('R8 W2: a consent_pause event is a step of its own: no iteration, its pause kept, and the load it paused stays open', () => {
  const log = run([
    { message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, toolName: 'load_source', operationType: 'load_source', args: { alias: 'boston' } },
    { message: 'Waiting for your answer', phase: 'consent_pause', pause: PAUSE } as StepProgressEvent,
  ]);
  const entry = log.progressLog.at(-1) as ProgressLogEntry & { pause?: unknown };
  assert.equal(entry.phase, 'consent_pause');
  assert.equal(entry.iteration, undefined);
  assert.deepEqual(entry.pause, PAUSE, 'the pause did not reach the entry');
  assert.equal(log.progressLog[0].isComplete, undefined, 'the pause marked the load it paused done');
  assert.equal(log.progressGroups.length, 1);
  assert.equal(log.progressGroups[0].entries.length, 1, 'the pause joined the load\'s step');
});

test('R8 W2: the next line of the run marks the pause done', () => {
  const log = run([
    { message: 'Loading the Boston OpenContext source', phase: 'tool_start', iteration: 1, toolName: 'load_source', operationType: 'load_source', args: { alias: 'boston' } },
    { message: 'Waiting for your answer', phase: 'consent_pause', pause: PAUSE } as StepProgressEvent,
    { message: 'Loading the Boston OpenContext source', phase: 'tool_complete', iteration: 1, duration_ms: 4000, toolName: 'load_source', operationType: 'load_source' },
  ]);
  const pause = log.progressLog.find((e) => e.phase === 'consent_pause');
  assert.equal(pause?.isComplete, true);
});

test('R8 W2: with no pause, every entry is what it was: no pause key appears', () => {
  const log = run([
    { message: 'Reading your question...', phase: 'analyze' },
    { message: 'Querying', phase: 'tool_start', iteration: 1, toolName: 'socrata__get_data', operationType: 'query', args: { type: 'query' } },
  ]);
  for (const entry of log.progressLog) assert.equal(Object.hasOwn(entry, 'pause'), false);
});

// --- R10 P1 criterion 6 (G0 D1 = A): a load step's label says the model chose the source -------
//
// Live, open and closed: a comparison's stream folds `tool_start` →
// `tool_complete` → `tool_result` → `thinking` for one `load_source` call
// carrying Socrata's alias. At the base the open step read "Gathering data"
// and the closed one "Loading a data source". The names come from each load's
// alias through `loadedSourceName`, never from the message: every message
// below names a different source than its alias, so a label read from the
// message text fails. An entry with no `args` (the executed run's live events,
// P-a) or an alias no source has states the choice without a name.

const LOAD_TOOL = { toolName: 'load_source', operationType: 'load_source' } as const;
const loadEvents = (alias: string | undefined, iteration = 1, message = 'Loading the NYC Checkbook source'): StepProgressEvent[] => [
  { message, phase: 'tool_start', iteration, ...LOAD_TOOL, ...(alias !== undefined ? { args: { alias } } : {}) },
  { message, phase: 'tool_complete', iteration, duration_ms: 12, ...LOAD_TOOL },
  { message: 'Loaded the NYC Checkbook source', phase: 'tool_result', iteration, ...LOAD_TOOL, ...(alias !== undefined ? { args: { alias } } : {}) },
];

test('R10 P1 criterion 6, live: one load of Socrata is "choosing" while open and "chose" once closed, by the alias, never the message', async () => {
  const { LOAD_STEP_LABEL } = await import('../sources/copy.ts');
  const [open, complete, result] = loadEvents('socrata');
  const opened = run([open]);
  assert.equal(opened.progressGroups[0].label, LOAD_STEP_LABEL.open(['Socrata'], 1));
  const closed = run([complete, result, { message: 'Thinking', phase: 'thinking', iteration: 1 }], opened);
  assert.equal(closed.progressGroups[0].label, LOAD_STEP_LABEL.closed(['Socrata'], 1));
});

test('R10 P1 criterion 6, live: two loads in one step name both, in call order', async () => {
  const { LOAD_STEP_LABEL } = await import('../sources/copy.ts');
  const [openA] = loadEvents('socrata');
  const [openB, completeB, resultB] = loadEvents('boston');
  const opened = run([openA, openB]);
  assert.equal(opened.progressGroups[0].label, LOAD_STEP_LABEL.open(['Socrata', 'Boston OpenContext'], 2));
  const closed = run([completeB, resultB, { message: 'Thinking', phase: 'thinking', iteration: 1 }], opened);
  assert.equal(closed.progressGroups[0].label, LOAD_STEP_LABEL.closed(['Socrata', 'Boston OpenContext'], 2));
});

test('R10 P1 criterion 6: a load with no args, or an alias no source has, states the choice without a name', async () => {
  const { LOAD_STEP_LABEL } = await import('../sources/copy.ts');
  for (const alias of [undefined, 'nowhere_at_all']) {
    const [open, complete, result] = loadEvents(alias);
    const opened = run([open]);
    assert.equal(opened.progressGroups[0].label, LOAD_STEP_LABEL.open([], 1), `alias ${alias}`);
    const closed = run([complete, result, { message: 'Thinking', phase: 'thinking', iteration: 1 }], opened);
    assert.equal(closed.progressGroups[0].label, LOAD_STEP_LABEL.closed([], 1), `alias ${alias}`);
  }
});

test('R10 P1 criterion 6, the finished executed run: buildRunStepView names the source from the captured call that carries args', async () => {
  const { LOAD_STEP_LABEL } = await import('../sources/copy.ts');
  // The executed run's live events carry no args (P-a), so its steps are nameless until the run's calls arrive.
  const steps = run([...loadEvents(undefined), { message: 'Thinking', phase: 'thinking', iteration: 1 }]);
  assert.equal(steps.progressGroups[0].label, LOAD_STEP_LABEL.closed([], 1), 'premise: the live step names no source');
  const view = buildRunStepView(steps.progressGroups, [{ name: 'load_source', operationType: 'load_source', args: { alias: 'socrata' } }]);
  assert.equal(view.steps[0].label, LOAD_STEP_LABEL.closed(['Socrata'], 1));
});

test('R10 P1 criterion 6, the record page: buildRecordStepView labels a load step the same way', async () => {
  const { LOAD_STEP_LABEL } = await import('../sources/copy.ts');
  const view = buildRecordStepView([
    { tool: 'load_source', operationType: 'load_source', arguments: { alias: 'socrata' } },
    { tool: 'load_source', operationType: 'load_source', arguments: { alias: 'nowhere_at_all' } },
  ]);
  assert.deepEqual(view.steps.map((s) => s.label), [LOAD_STEP_LABEL.closed(['Socrata'], 1), LOAD_STEP_LABEL.closed([], 1)]);
});
