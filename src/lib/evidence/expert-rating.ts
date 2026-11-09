// The one rating check and the one aggregation into `RecordReviews` (UX-2 P4a,
// criterion 6). Client-safe: it imports no storage, database or other
// server-only module, because the analysis page's client components read it
// through `record-reviews.ts`. The storage-reading half is
// `./expert-rating-read.ts`.
//
// UX-2 P4a red: typed stubs. The red commit carries these signatures so the
// tests type-check and fail at their assertions; the green leg fills them in.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import type { ExpertRating } from './expert-attestation.ts';
import type { RecordReviews } from './review-summary.ts';

/** One review, as the aggregation reads it: its kind, and an expert review's rating word (`null` otherwise or when unread). */
export interface TalliedReview {
  type: string;
  rating: ExpertRating | null;
}

/** A stored payload's rating word, checked against the vocabulary; null otherwise. */
export function expertRatingOf(payload: { rating?: unknown } | null | undefined): ExpertRating | null {
  void payload;
  return null;
}

/** One record's reviews, in the order given (oldest first is the caller's): the expert ratings, and the two machine counts. */
export function tallyReviews(reviews: readonly TalliedReview[]): RecordReviews {
  void reviews;
  return { expertRatings: [], evaluations: 0, consistencyTests: 0 };
}
