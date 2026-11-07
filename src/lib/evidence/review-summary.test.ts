// UX-2 P5 (X5, R4 B's words with R3 B's noun, G0-13 a): the registry row's
// reviews line, from what the list route reports for one record.
//
// RULED, verbatim: "No reviews yet"; "N reviews: 1 expert review (concerns),
// 1 evaluation, 1 consistency test" (the count and the types, the rating word
// in parentheses).
//
// RULED by the second research check (P5_words = A): the forms the first
// example does not show, held in `RULED` below, their one home in this suite:
// the singular count and the plural kinds (C2a, KEEP), two expert reviews'
// words as the page's labels, lowercased (C2b, REVISE), and an unread rating
// left out (C2c, KEEP).
//
// WHAT MAKES IT ABLE TO FAIL. Each case has a count and a kind the others do
// not; a review whose payload could not be read (`null`) is counted with its
// kind but gives no word.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_REVIEWS, reviewsLine, type RecordReviews } from './review-summary.ts';

const RULED = {
  oneExpert: '1 review: 1 expert review (concerns)',
  plural: '5 reviews: 2 expert reviews (endorsed, disputed), 2 evaluations, 1 consistency test',
  unreadRating: '2 reviews: 1 expert review, 1 consistency test',
};

const r = (expertRatings: RecordReviews['expertRatings'], evaluations = 0, consistencyTests = 0): RecordReviews =>
  ({ expertRatings, evaluations, consistencyTests });

test('X5: a record with no reviews reads "No reviews yet"', () => {
  assert.equal(NO_REVIEWS, 'No reviews yet');
  assert.equal(reviewsLine(r([])), 'No reviews yet');
});

test('X5 (ruled example): one of each kind, the expert review\'s rating word in parentheses', () => {
  assert.equal(reviewsLine(r(['concerns'], 1, 1)), '3 reviews: 1 expert review (concerns), 1 evaluation, 1 consistency test');
});

test('X5 (C2a-C2c, ruled): one review; plural kinds and two rating words; a rating that could not be read', () => {
  assert.equal(reviewsLine(r(['concerns'])), RULED.oneExpert);
  assert.equal(reviewsLine(r(['endorse', 'dispute'], 2, 1)), RULED.plural);
  assert.equal(reviewsLine(r([null], 0, 1)), RULED.unreadRating);
});

test('X5 (C2b): each rating word is the analysis page\'s label, lowercased, from the one map both read', async () => {
  const { EXPERT_RATING_LABELS } = await import('./expert-attestation.ts');
  assert.deepEqual(EXPERT_RATING_LABELS, { endorse: 'Endorsed', concerns: 'Concerns', dispute: 'Disputed', neutral: 'Neutral note' });
  assert.equal(reviewsLine(r(['endorse', 'concerns', 'dispute', 'neutral'])), '4 reviews: 4 expert reviews (endorsed, concerns, disputed, neutral note)');
});

test('X5: a kind with no review is left out of the line', () => {
  const line = reviewsLine(r([], 1, 0));
  assert.ok(line.length > 0 && !/expert|consistency/.test(line), `the line reads ${JSON.stringify(line)}`);
});
