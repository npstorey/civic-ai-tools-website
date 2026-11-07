// The analysis page's reviews, read once for the summary row and the list
// (UX-2 P2, M2). A pure mapping from what the record's attestation list route
// answers, and each expert review's stored payload, to the `RecordReviews`
// that `reviewsLine` reads (`review-summary.ts`), the registry row's input.
//
// RED STUB (UX-2 P2 leg B): the exports are typed and their bodies are not
// written yet; the green leg writes them. The words and the section id are
// final.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import type { RecordReviews } from './review-summary.ts';

/** One row of `GET /api/records/[slug]/attestations`, as far as the mapping reads it. */
export interface ReviewListRow {
  id: string;
  type: string;
  createdAt: string;
}

/**
 * Each expert review's stored payload, by the review's id: `undefined` while
 * its read has not returned, `null` when the read failed.
 */
export type ExpertPayloads = Record<string, { rating?: unknown } | null | undefined>;

/** The list's line when the reviews could not be read (Q2, ruled by the seat, relay 25). */
export const REVIEWS_LOAD_FAILED = 'The reviews could not be loaded. Reloading the page tries again.';

/** The id of the analysis page's "Reviews" section, the target of the summary row's "See them". */
export const REVIEWS_SECTION_ID = 'reviews';

/**
 * What the summary row's `reviewsLine` reads for one record: the rows sorted
 * by `createdAt` (the route states no order), each expert review's rating word
 * read from its payload and checked against the vocabulary (`null` when it
 * cannot be read), and the evaluations and consistency tests counted.
 */
export function recordReviewsOf(rows: readonly ReviewListRow[], expertPayloads: ExpertPayloads): RecordReviews {
  void rows;
  void expertPayloads;
  return { expertRatings: [], evaluations: 0, consistencyTests: 0 };
}

/** Whether every expert review's payload read has returned (loaded or failed). */
export function expertPayloadsSettled(rows: readonly ReviewListRow[], expertPayloads: ExpertPayloads): boolean {
  void rows;
  void expertPayloads;
  return false;
}
