// R6 W2 (#632, the seat's ruling 5 at G5): the skeleton notebook's sentence for
// a call that was never sent.
//
// A `not_offered` call was refused before any request: the run was not offered
// that source, so nothing was sent and nothing rejected it. The skeleton
// (`src/lib/notebook.ts`, `rejectedNote`) said "…, and it was rejected." of
// every refused call; for a `not_offered` call its sentence ends at the
// attempt, as the executed notebook's does (`renderFailedToolCell`). Every
// other kind kept "and it was rejected" until S2-B P3R.
//
// S2-B P3R (the owner's D2, OA-790): every kind's sentence now ends at the
// attempt, so the site and bundle revision 4 say one thing: none of the
// reasons says a source refused the call. The property kept: the sentence for
// one kind is told apart from another's only by its reason, never by a tail
// that claims a refusal; the call with no tool name reads as an attempt too.
//
// THE FIXTURE CAN FAIL. Two calls with the same tool and arguments, differing
// only in `failureKind`, in one run: a renderer that ignored the kind would
// write the same sentence for both.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNotebook } from './notebook.ts';
import { describeAttempt, describeToolFailure, type ToolFailureKind } from './notebook-author/tool-to-cell.ts';

const ARGS = { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us', select: 'count(*)' };
const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

function skeletonText(calls: Parameters<typeof generateNotebook>[2]): string {
  return generateNotebook('How many complaints?', 'data.cityofnewyork.us', calls, 'An answer.', NO_ATTRIBUTION)
    .cells.map((cell) => cell.source.join(''))
    .join('\n');
}

const attempt = (failureKind: ToolFailureKind) =>
  describeAttempt({ name: 'socrata__get_data', args: ARGS, failed: true, failureKind }, { dataFrameIndex: 0, defaultPortal: 'data.cityofnewyork.us' });

test('ruling 5: a not_offered call\'s sentence ends at the attempt, with no "and it was rejected"', () => {
  const text = skeletonText([{ name: 'socrata__get_data', args: ARGS, failed: true, failureKind: 'not_offered' } as Parameters<typeof generateNotebook>[2][number]]);
  const expected = `The original analysis tried to ${attempt('not_offered')}. ${describeToolFailure('not_offered')}`;
  assert.ok(text.includes(expected), `the skeleton does not read:\n  ${expected}\nit reads:\n  ${text.split('\n').find((l) => l.includes('Not reproduced below')) ?? '(no not-reproduced line)'}`);
  assert.ok(!text.includes(`${attempt('not_offered')}, and it was rejected.`), 'the skeleton says a call that was never sent was rejected');
});

test('D2: every kind\'s sentence ends at the attempt, and none says the call was rejected', () => {
  for (const kind of ['timeout', 'unavailable', 'not_configured', 'unknown', 'base_changed'] as const) {
    const text = skeletonText([
      { name: 'socrata__get_data', args: ARGS, failed: true, failureKind: kind } as Parameters<typeof generateNotebook>[2][number],
      { name: 'socrata__get_data', args: ARGS, failed: true, failureKind: 'not_offered' } as Parameters<typeof generateNotebook>[2][number],
    ]);
    assert.ok(text.includes(`The original analysis tried to ${attempt(kind as ToolFailureKind)}. ${describeToolFailure(kind as ToolFailureKind)}`), `${kind}: the sentence does not end at the attempt`);
    assert.ok(!text.includes('was rejected'), `${kind}: the skeleton says a call was rejected`);
    assert.ok(text.includes(`The original analysis tried to ${attempt('not_offered')}. ${describeToolFailure('not_offered')}`), `${kind}: the not_offered call beside it was not told apart`);
  }
});

test('D2: a call with no tool name reads as an attempt, and the closing sentence says a cell that ran the request', () => {
  const text = skeletonText([{ args: ARGS, failed: true, failureKind: 'timeout' } as unknown as Parameters<typeof generateNotebook>[2][number]]);
  assert.ok(
    text.includes(`The original analysis tried to make a request whose tool name it does not carry. ${describeToolFailure('timeout')}`),
    `the no-name note does not read as ruled:\n${text.split('\n').find((l) => l.includes('Not reproduced below')) ?? '(no not-reproduced line)'}`,
  );
  assert.ok(text.includes('No URL is written for it: a cell that ran the request would put a result in this notebook that the original step never produced.'));
  assert.ok(!text.includes('re-ran'), 'the closing sentence still says re-ran');
});
