// #644 W2 criterion 5, the reader's side: a load that ended `no-answer` or
// `unavailable` reads as a sentence of its own, true on every branch it
// covers, in the result line, the narrative and the notebook's load line.
//
// The rider: declined, no answer, unavailable, off and not configured are
// five different sentences, and none reads as "the data came back empty".
// At the base both outcomes fall to the default branch ("was not loaded",
// "did not load", "not loaded"), which says nothing of why.
//
// The branches each sentence must be true on:
//   - `no-answer`: the reader did not decide in 60 s; a poll read failed;
//     the run's 120 s of holds were spent; there is no store, or its write
//     failed. The record cannot tell them apart, so the words are those
//     true of all: no answer arrived in time (the harness's own definition of
//     the outcome, and R6 W4's words for it).
//   - `unavailable`: the load step threw, which it is not expected to do.
//   - `declined` keeps its words, which are true after Not now.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/pause-outcome-renderings.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNarrativeSummary, formatToolResult } from './streaming.ts';
import { renderDiscoverySummaryCell, type PhaseAToolCall } from './notebook-author/tool-to-cell.ts';

const LOAD = 'load_source';

/** The sentences W2 states, as rendered. */
const RESULT = {
  noAnswer: 'No answer about the Boston OpenContext source arrived in time, so it was not used for this question',
  noAnswerUnnamed: 'No answer about a source set to Ask first arrived in time, so it was not used for this question',
  unavailable: 'This site could not load the Boston OpenContext source for this question',
  unavailableUnnamed: 'This site could not load a data source for this question',
  declined: 'The Boston OpenContext source is set to Ask first, so it was not used for this question',
};
const NARRATIVE = {
  noAnswer: 'did not use the Boston OpenContext source, because no answer about it arrived in time',
  unavailable: 'asked to load the Boston OpenContext source, which this site could not load',
};
const NOTE = {
  noAnswer: '- `boston`: not used, no answer arrived in time',
  unavailable: '- `boston`: could not be loaded',
  declined: '- `boston`: not used, set to Ask first',
};

test('criterion 5: the result line states no-answer and unavailable in sentences of their own', () => {
  assert.equal(formatToolResult({ alias: 'boston' }, undefined, LOAD, 'no-answer'), RESULT.noAnswer);
  assert.equal(formatToolResult({ alias: '{"x":1}' }, undefined, LOAD, 'no-answer'), RESULT.noAnswerUnnamed);
  assert.equal(formatToolResult({ alias: 'boston' }, undefined, LOAD, 'unavailable'), RESULT.unavailable);
  assert.equal(formatToolResult({ alias: '{"x":1}' }, undefined, LOAD, 'unavailable'), RESULT.unavailableUnnamed);
  assert.equal(formatToolResult({ alias: 'boston' }, undefined, LOAD, 'declined'), RESULT.declined, 'declined\'s words moved');
});

test('criterion 5: the narrative states no-answer and unavailable in clauses of their own', () => {
  const narrative = buildNarrativeSummary([
    { name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'no-answer' },
  ]);
  assert.ok(narrative.includes(NARRATIVE.noAnswer), `the narrative: ${narrative}`);
  const unavailable = buildNarrativeSummary([
    { name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'unavailable' },
  ]);
  assert.ok(unavailable.includes(NARRATIVE.unavailable), `the narrative: ${unavailable}`);
});

test('criterion 5: the notebook\'s load line states no-answer and unavailable in words of their own', () => {
  const calls: PhaseAToolCall[] = [
    { name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'no-answer' },
  ];
  const text = (call: PhaseAToolCall) => {
    const cell = renderDiscoverySummaryCell([call]);
    return Array.isArray(cell?.source) ? cell!.source.join('') : String(cell?.source ?? '');
  };
  assert.ok(text(calls[0]).includes(NOTE.noAnswer), text(calls[0]));
  const unavailable: PhaseAToolCall = { name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'unavailable' };
  assert.ok(text(unavailable).includes(NOTE.unavailable), text(unavailable));
  const declined: PhaseAToolCall = { name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'declined' };
  assert.ok(text(declined).includes(NOTE.declined), text(declined));
});

test('criterion 5 (the rider): loaded, declined, no answer, unavailable and not offered read as five different sentences on each surface', () => {
  const outcomes = ['loaded', 'declined', 'no-answer', 'unavailable', 'not-offered'];
  const results = outcomes.map((o) => formatToolResult({ alias: 'boston' }, undefined, LOAD, o));
  assert.equal(new Set(results).size, 5, `the result lines: ${JSON.stringify(results)}`);
  const narratives = outcomes.map((o) => buildNarrativeSummary([{ name: LOAD, args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: o }]));
  assert.equal(new Set(narratives).size, 5, `the narratives: ${JSON.stringify(narratives)}`);
  for (const line of [...results, ...narratives]) {
    assert.doesNotMatch(String(line), /empty|no (rows|records|data) (were|was) returned|returned no/i, `reads as empty data: ${line}`);
    assert.doesNotMatch(String(line), /\{/, `carries a brace: ${line}`);
  }
});
