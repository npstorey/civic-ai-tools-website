// #426 (Wave N11 P3, criterion A4; the owner's ruling R5): the chat notebook
// output's section D states each recorded call in words that already exist —
// the outcome in `describeQueryOutcome`'s (`src/lib/evidence/query-step.ts`),
// the phrase through `reasonWithoutIdentifier` (`src/lib/streaming.ts`) — on
// every call, answered or rejected. When the phrase drops, the line falls back
// to the step's number, as the skeleton generator titles a step
// (`src/lib/notebook.ts:467`, `Query ${i + 1}`).
//
// WHICH NUMBER. Section D lists EVERY call, in the order the run made them; the
// skeleton generator numbers only ANALYSIS steps (`isAnalysisStep`), so a
// catalog search has no number there and the numbers of the two lists differ.
// Section D shows the call's position in the list the reader is looking at —
// the list it is a number in — which is also how the live card numbers a step
// (`ProgressLog.tsx`, `stepNumber={globalIdx + 1}`).
//
// DRIVEN through the `.ts` the component renders from: `ChatNotebookOutput.tsx`
// calls `deliberativeTraceLine(q, i + 1)` for each call and renders its three
// fields; `src/components/reason-phrase-readers.test.ts` reads that wiring (it
// follows the component's import into `buildChatEvidenceView.ts`).
//
// RED at f32b679: `buildChatEvidenceView.ts` exports no `deliberativeTraceLine`
// — the component interpolated `{q.reason}` itself, and never read `failed`.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/notebook/deliberative-trace-line.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as chatView from './buildChatEvidenceView.ts';
import { generateToolReason, reasonWithoutIdentifier } from '../../lib/streaming.ts';
import { describeQueryOutcome } from '../../lib/evidence/query-step.ts';

const FETCH_ID = 'record:data.example.org/efgh-5678/7';
const IDENTIFIER_PIECES = ['record:', 'data.example.org', 'efgh-5678'];

interface Call {
  name: string;
  operationType?: string;
  reason?: string;
  resultSummary?: { rows: number; columns: number };
  failed?: boolean;
  failureKind?: 'timeout' | 'unavailable' | 'not_configured' | 'unknown';
}

interface Line {
  label: string;
  heading: string;
  outcome: string | null;
}

const REJECTED_FETCH: Call = { name: 'fetch', reason: generateToolReason({ id: FETCH_ID }, 'fetch'), failed: true, failureKind: 'unknown' };
const ANSWERED_FETCH: Call = { name: 'fetch', reason: generateToolReason({ id: FETCH_ID }, 'fetch') };
const CATALOG: Call = {
  name: 'get_data',
  operationType: 'catalog',
  reason: generateToolReason({ type: 'catalog', query: 'noise complaints' }, 'get_data'),
};
const ANSWERED_QUERY: Call = {
  name: 'get_data',
  operationType: 'query',
  reason: generateToolReason({ type: 'query', dataset_id: 'abcd-1234', select: 'count(*)' }, 'get_data'),
  resultSummary: { rows: 1, columns: 1 },
};

function lineOf(call: Call, position: number): Line {
  const fn = (chatView as Record<string, unknown>).deliberativeTraceLine as ((c: Call, p: number) => Line) | undefined;
  assert.equal(
    typeof fn,
    'function',
    'buildChatEvidenceView.ts exports no deliberativeTraceLine: section D writes each call’s words inside the component, where no test reads them',
  );
  return fn!(call, position);
}

test('premise: a fetch’s recorded phrase names its identifier, and the sanitiser drops the phrase whole', () => {
  assert.ok(REJECTED_FETCH.reason!.includes(FETCH_ID), `the phrase is ${JSON.stringify(REJECTED_FETCH.reason)}`);
  assert.equal(reasonWithoutIdentifier(REJECTED_FETCH.reason), undefined);
});

test('A4: section D states a rejected fetch as rejected, in describeQueryOutcome’s words, and prints no identifier', () => {
  const line = lineOf(REJECTED_FETCH, 3);
  assert.equal(line.outcome, describeQueryOutcome({ failed: true, failureKind: 'unknown' }).text);
  assert.match(line.outcome ?? '', /did not complete/);
  assert.equal(line.heading, 'Query 3', 'R5: the phrase dropped, the line falls back to its number');
  for (const piece of IDENTIFIER_PIECES) {
    assert.ok(!JSON.stringify(line).includes(piece), `section D prints ${piece}: ${JSON.stringify(line)}`);
  }
});

test('A4 (R5, every call): an answered fetch prints no identifier either, and claims no outcome it did not record', () => {
  const line = lineOf(ANSWERED_FETCH, 2);
  assert.equal(line.heading, 'Query 2');
  assert.equal(line.outcome, null, 'no result summary was recorded, so none is stated — as on the live card');
  for (const piece of IDENTIFIER_PIECES) assert.ok(!JSON.stringify(line).includes(piece), `section D prints ${piece}`);
});

test('A4: a phrase that names no identifier is kept — a searched phrase in quotes included — and a returned row count is stated in the one formatter’s words', () => {
  const query = lineOf(ANSWERED_QUERY, 4);
  assert.equal(query.heading, ANSWERED_QUERY.reason);
  assert.equal(query.outcome, describeQueryOutcome({ resultRows: 1, resultColumns: 1 }).text);
  const catalog = lineOf(CATALOG, 1);
  assert.equal(catalog.heading, 'to find datasets about "noise complaints"');
  assert.equal(catalog.outcome, null);
});

test('A4: the label is the recorded tool name, with its operation type when the record carries one', () => {
  assert.equal(lineOf(ANSWERED_QUERY, 1).label, 'get_data (query)');
  assert.equal(lineOf(REJECTED_FETCH, 1).label, 'fetch');
});

test('A4: a record carrying no phrase falls back to its number, never to a phrase it did not record', () => {
  assert.equal(lineOf({ name: 'get_data' }, 5).heading, 'Query 5');
});

test('which number: section D numbers every call it lists, so a fetch after a catalog search is its second line', () => {
  const lines = [CATALOG, REJECTED_FETCH].map((call, i) => lineOf(call, i + 1));
  assert.deepEqual(lines.map((l) => l.heading), ['to find datasets about "noise complaints"', 'Query 2']);
});

test('R5, the live card: the slot it fills from reasonWithoutIdentifier stays empty for a fetch, answered or rejected', () => {
  // `ToolCallCard.tsx` renders the phrase only as `reasonWithoutIdentifier(reason)`
  // (its wiring is read by `reason-phrase-readers.test.ts`); for a fetch that is
  // nothing, on every call, from the moment the card paints.
  assert.equal(reasonWithoutIdentifier(ANSWERED_FETCH.reason), undefined);
  assert.equal(reasonWithoutIdentifier(REJECTED_FETCH.reason), undefined);
  assert.equal(reasonWithoutIdentifier(ANSWERED_QUERY.reason), ANSWERED_QUERY.reason);
});
