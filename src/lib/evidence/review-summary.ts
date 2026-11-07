// The registry row's reviews line (UX-2 P5; R18 C with R4 B's words, R3 B's
// reader noun "reviews", G0-13 a). A pure function of what the list route
// reports for one record: how many reviews of each kind it holds, and each
// expert review's own rating word, read from that review's stored payload.
//
// RULED words (X5): "No reviews yet"; "N reviews: 1 expert review (concerns),
// 1 evaluation, 1 consistency test". PENDING (the research check): the forms
// the ruled example does not show: "1 review" in the singular, the plural
// kinds ("2 expert reviews", "2 evaluations", "2 consistency tests"), two
// rating words in one pair of parentheses, joined by ", ". They are the
// `count` and `ratings` rules below, and nowhere else.

import type { ExpertRating } from './expert-attestation.ts';

/** What the list route reports about one record's reviews. */
export interface RecordReviews {
  /**
   * One entry per expert review on the record, oldest first: the attester's
   * rating word, or `null` when the review's stored payload could not be read
   * (the word is then left out, never guessed).
   */
  expertRatings: Array<ExpertRating | null>;
  /** Evaluations (adversarial reviews by a second model). */
  evaluations: number;
  /** Consistency tests (replays). */
  consistencyTests: number;
}

/** The line for a record with no reviews (X5, X7). */
export const NO_REVIEWS = 'No reviews yet';

/** "1 <one>" or "N <many>": the pending singular and plural rule. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The rating words that were read, in parentheses; nothing when none was. */
function ratings(words: Array<ExpertRating | null>): string {
  const read = words.filter((w): w is ExpertRating => w !== null);
  return read.length > 0 ? ` (${read.join(', ')})` : '';
}

/** The reviews line: "No reviews yet", or "N reviews: 1 expert review (concerns), 1 evaluation, 1 consistency test". */
export function reviewsLine(reviews: RecordReviews): string {
  const experts = reviews.expertRatings.length;
  const total = experts + reviews.evaluations + reviews.consistencyTests;
  if (total === 0) return NO_REVIEWS;
  const kinds: string[] = [];
  if (experts > 0) kinds.push(count(experts, 'expert review', 'expert reviews') + ratings(reviews.expertRatings));
  if (reviews.evaluations > 0) kinds.push(count(reviews.evaluations, 'evaluation', 'evaluations'));
  if (reviews.consistencyTests > 0) kinds.push(count(reviews.consistencyTests, 'consistency test', 'consistency tests'));
  return `${count(total, 'review', 'reviews')}: ${kinds.join(', ')}`;
}
