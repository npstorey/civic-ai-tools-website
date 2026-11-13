// S2-B P3R criterion 6 (npstorey/civic-ai-tools#309): the failure words as the owner ruled them (OA-790, all A; the
// seat's 6863083397), verbatim, and where each shows. R2's report is their source; no other word is admitted.
//
//   - D5: `FAILURE_REASON`'s `unavailable` and `not_offered`, bundle revision 4's words in the site's form, which
//     names no source.
//   - D1: `FAILURE_REASON.base_changed`, a sixth kind; on the step list it shows alone, with no "This request did
//     not complete." in front (as `not_offered` does); in the executed cell it takes the "was not sent" closing line.
//   - `where-it-went.ts`'s `NOT_RECEIVED` holds `base_changed`: nothing was sent, so its source is not reached.
//
// (D2, the skeleton note, is pinned in `skeleton-not-offered-sentence.test.ts`; D3, the model's line, in
// `mcp/refused-call-copy.test.ts`.)
//
// SHAPED TO FAIL. The step-list and closing-line cases each set `base_changed` beside a kind that takes the other
// branch (`timeout`), so a branch that ignored the kind would read the same for both. The where-it-went case sets
// a `base_changed` call beside an answered call to the same source, and its decoy is the same run with `unknown`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE_REASON, TOOL_FAILURE_KINDS, renderFetchToolCell } from './notebook-author/tool-to-cell.ts';
import { describeQueryOutcome } from './evidence/query-step.ts';
import { whereItWentFromCalls } from './flows/where-it-went.ts';

const REASONS = FAILURE_REASON as Record<string, string>;
const BASE_CHANGED =
  "The site that ran this question did not send this request. This data source's requests go through another source's server, and that server did not match what this data source was written for.";
const NOT_SENT_FOLLOW_ON =
  'No code cell is generated for it — a request that was not sent cannot be reproduced. The steps below rest only on the requests that did return data.';
const NO_DATA_FOLLOW_ON =
  'No code cell is generated for it — a request that returned no data cannot be reproduced. The steps below rest only on the requests that did return data.';

test('D5: unavailable and not_offered read as ruled', () => {
  assert.equal(REASONS.unavailable, 'The data source could not be reached or could not answer, so the request returned no data.');
  assert.equal(REASONS.not_offered, 'This question was not using this data source at the time, so nothing was sent to it.');
});

test('D1: base_changed is a sixth kind, beside the five, with the ruled reason', () => {
  assert.deepEqual([...TOOL_FAILURE_KINDS], ['timeout', 'unavailable', 'not_configured', 'not_offered', 'unknown', 'base_changed']);
  assert.equal(REASONS.base_changed, BASE_CHANGED);
});

test('D1: on the step list base_changed shows its reason alone; a timeout keeps the lead-in', () => {
  const kinds = { base: 'base_changed', timeout: 'timeout' } as const;
  const timed = describeQueryOutcome({ failed: true, failureKind: kinds.timeout, duration_ms: 1500 }).text;
  const elapsed = timed.slice(`This request did not complete. ${REASONS.timeout}`.length);
  assert.ok(elapsed.startsWith(' The attempt took'), 'premise: an elapsed is stated');
  assert.deepEqual(describeQueryOutcome({ failed: true, failureKind: kinds.base as never, duration_ms: 1500 }), { kind: 'failed', text: `${BASE_CHANGED}${elapsed}` });
  assert.equal(describeQueryOutcome({ failed: true, failureKind: kinds.timeout }).text, `This request did not complete. ${REASONS.timeout}`);
});

test('D1: the executed cell gives base_changed the "was not sent" closing line, and its reason', () => {
  const cell = (failureKind: string) => {
    const out = renderFetchToolCell({ name: 'nyc_record__get_data', args: { type: 'query', query: 'SELECT 1' }, failed: true, failureKind: failureKind as never }, { dataFrameIndex: 1, defaultPortal: 'data.cityofnewyork.us' });
    assert.ok(out, 'a failed call renders a cell');
    return out.cells.map((c) => c.source.join('')).join('\n');
  };
  const based = cell('base_changed');
  assert.ok(based.includes(NOT_SENT_FOLLOW_ON), `the base_changed cell does not say the request was not sent:\n${based}`);
  assert.ok(!based.includes(NO_DATA_FOLLOW_ON));
  assert.ok(based.includes(BASE_CHANGED), 'the base_changed cell does not state its reason');
  assert.ok(cell('timeout').includes(NO_DATA_FOLLOW_ON), 'premise: a timeout keeps the "returned no data" line');
});

test('NOT_RECEIVED holds base_changed: a pack call not sent does not count as a call its base received', () => {
  const run = (failureKind: string) => whereItWentFromCalls({
    toolCalls: [
      { name: 'socrata__get_data', args: { dataset_id: 'erm2-nwe9' } },
      { name: 'nyc_record__get_data', args: { dataset_id: 'dg92-zbpx' }, failed: true, failureKind },
    ] as never,
    resolveSource: () => 'socrata',
    sourcesOffered: [{ sourceId: 'socrata', alias: 'socrata', reason: 'configured' }, { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'configured' }],
    model: 'fake/model',
    service: 'fixture service',
  });
  const calls = (failureKind: string) => (run(failureKind).reached.find((row) => row.kind === 'source' && row.sourceId === 'socrata') as { calls?: number } | undefined)?.calls;
  assert.equal(calls('base_changed'), 1, 'the unsent pack call was counted as received by its base');
  assert.equal(calls('unknown'), 2, 'decoy: a call that failed as unknown was sent, and counts');
});
