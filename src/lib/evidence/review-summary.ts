// The registry row's reviews line (UX-2 P5; R18 C with R4 B's words, R3 B's
// reader noun "reviews", G0-13 a). A pure function of what the list route
// reports for one record: how many reviews of each kind it holds, and each
// expert review's own rating word, read from that review's stored payload.
//
// RED STUB (UX-2 P5 leg B). The types are the contract the list route, the
// registry and the tests share; the function body is the green's.

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

/** The reviews line: "No reviews yet", or "N reviews: 1 expert review (concerns), 1 evaluation, 1 consistency test". */
export function reviewsLine(reviews: RecordReviews): string {
  void reviews;
  return '';
}
