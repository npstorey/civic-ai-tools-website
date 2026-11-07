// UX-2 P2 criterion 1 (M2): the one mapping from the analysis page's review
// list to the `RecordReviews` that `reviewsLine` reads (`record-reviews.ts`).
//
// WHAT MAKES IT ABLE TO FAIL. The fixture holds one review of each counted
// kind by distinct attesters, two expert reviews whose rating words differ
// and whose rows arrive newest first (so an unsorted mapping reads the words
// in the wrong order), an expert review whose payload read failed and one
// whose payload names a word outside the vocabulary (each a `null`, never a
// guess), and a `re_evaluation` and a `correction` row (kinds `reviewsLine`
// does not count). A mapping that counts every row, keeps the route's order,
// or reads the rating without checking it gives a different answer.
//
// Run with: npm test (or node --test --experimental-strip-types src/lib/evidence/record-reviews.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expertPayloadsSettled, recordReviewsOf, REVIEWS_LOAD_FAILED, type ReviewListRow } from './record-reviews.ts';
import { reviewsLine } from './review-summary.ts';

// Newest first: the route's GET states no order.
const ROWS: ReviewListRow[] = [
  { id: 'r-correction', type: 'correction', createdAt: '2026-11-06T09:00:00.000Z' },
  { id: 'r-expert-late', type: 'expert_attestation', createdAt: '2026-11-05T09:00:00.000Z' },
  { id: 'r-consistency', type: 'consistency', createdAt: '2026-11-04T09:00:00.000Z' },
  { id: 'r-expert-unread', type: 'expert_attestation', createdAt: '2026-11-03T09:00:00.000Z' },
  { id: 'r-evaluation', type: 'evaluation', createdAt: '2026-11-02T09:00:00.000Z' },
  { id: 'r-expert-off-vocabulary', type: 'expert_attestation', createdAt: '2026-11-01T12:00:00.000Z' },
  { id: 'r-expert-early', type: 'expert_attestation', createdAt: '2026-11-01T09:00:00.000Z' },
  { id: 'r-re-evaluation', type: 're_evaluation', createdAt: '2026-10-31T09:00:00.000Z' },
];

const PAYLOADS = {
  'r-expert-early': { rating: 'endorse' },
  'r-expert-off-vocabulary': { rating: 'excellent' },
  'r-expert-unread': null,
  'r-expert-late': { rating: 'concerns' },
};

test('UX-2 P2 (1) the mapping: oldest first, ratings read and checked, three kinds counted', () => {
  const reviews = recordReviewsOf(ROWS, PAYLOADS);
  assert.deepEqual(reviews, {
    expertRatings: ['endorse', null, null, 'concerns'],
    evaluations: 1,
    consistencyTests: 1,
  });
  assert.equal(reviewsLine(reviews), '6 reviews: 4 expert reviews (endorsed, concerns), 1 evaluation, 1 consistency test');
});

test('UX-2 P2 (1) the mapping on a record with none is the empty line', () => {
  const reviews = recordReviewsOf([], {});
  assert.deepEqual(reviews, { expertRatings: [], evaluations: 0, consistencyTests: 0 });
  assert.equal(reviewsLine(reviews), 'No reviews yet');
});

test('UX-2 P2 (1) settled: every expert payload read has returned, loaded or failed; a pending one is not settled', () => {
  assert.equal(expertPayloadsSettled(ROWS, PAYLOADS), true, 'every expert row has a payload or a failed read');
  assert.equal(expertPayloadsSettled([], {}), true, 'no expert row: nothing to wait for');
  const pending = { ...PAYLOADS } as Record<string, unknown>;
  delete pending['r-expert-late'];
  assert.equal(expertPayloadsSettled(ROWS, pending as typeof PAYLOADS), false, 'one expert payload still on its way');
});

test('UX-2 P2 (8) the list’s failure line, byte for byte (Q2, ruled, relay 25)', () => {
  assert.equal(REVIEWS_LOAD_FAILED, 'The reviews could not be loaded. Reloading the page tries again.');
});
