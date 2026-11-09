// The one rating check and the one aggregation into `RecordReviews` (UX-2 P4a,
// criterion 6). Client-safe: it imports no storage, database or other
// server-only module, because the analysis page's client components read it
// through `record-reviews.ts`. The storage-reading half is
// `./expert-rating-read.ts`, which the registry's list route and the dashboard
// page share.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import { EXPERT_RATINGS, type ExpertRating } from './expert-attestation.ts';
import type { RecordReviews } from './review-summary.ts';

/** One review, as the aggregation reads it: its kind, and an expert review's rating word (`null` otherwise or when unread). */
export interface TalliedReview {
  type: string;
  rating: ExpertRating | null;
}

/** A stored payload's rating word, checked against the vocabulary; null otherwise. */
export function expertRatingOf(payload: { rating?: unknown } | null | undefined): ExpertRating | null {
  const rating = payload?.rating;
  return typeof rating === 'string' && (EXPERT_RATINGS as readonly string[]).includes(rating) ? (rating as ExpertRating) : null;
}

/**
 * One record's reviews, in the order given (oldest first is the caller's): each
 * expert review's rating word, and the evaluations and consistency tests
 * counted. Any other kind (a correction, a re-evaluation) is not counted.
 */
export function tallyReviews(reviews: readonly TalliedReview[]): RecordReviews {
  const out: RecordReviews = { expertRatings: [], evaluations: 0, consistencyTests: 0 };
  for (const review of reviews) {
    if (review.type === 'expert_attestation') out.expertRatings.push(review.rating);
    else if (review.type === 'evaluation') out.evaluations += 1;
    else if (review.type === 'consistency') out.consistencyTests += 1;
  }
  return out;
}
