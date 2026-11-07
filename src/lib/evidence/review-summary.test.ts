// UX-2 P5 (X5, R4 B's words with R3 B's noun, G0-13 a): the registry row's
// reviews line, from what the list route reports for one record.
//
// RULED, verbatim: "No reviews yet"; "N reviews: 1 expert review (concerns),
// 1 evaluation, 1 consistency test" (the count and the types, the rating word
// in parentheses).
//
// PENDING (the research check): the forms the ruling's example does not show
// are held in `PENDING` below, their one home in this suite: the singular
// count, the plural types, and two expert reviews' words.
//
// WHAT MAKES IT ABLE TO FAIL. Each case has a count and a kind the others do
// not; a review whose payload could not be read (`null`) is counted with its
// kind but gives no word.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_REVIEWS, reviewsLine, type RecordReviews } from './review-summary.ts';

const PENDING = {
  oneExpert: '1 review: 1 expert review (concerns)',
  plural: '5 reviews: 2 expert reviews (endorse, dispute), 2 evaluations, 1 consistency test',
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

test('X5 (pending forms): one review; plural kinds and two rating words; a rating that could not be read', () => {
  assert.equal(reviewsLine(r(['concerns'])), PENDING.oneExpert);
  assert.equal(reviewsLine(r(['endorse', 'dispute'], 2, 1)), PENDING.plural);
  assert.equal(reviewsLine(r([null], 0, 1)), PENDING.unreadRating);
});

test('X5: a kind with no review is left out of the line', () => {
  const line = reviewsLine(r([], 1, 0));
  assert.ok(line.length > 0 && !/expert|consistency/.test(line), `the line reads ${JSON.stringify(line)}`);
});
