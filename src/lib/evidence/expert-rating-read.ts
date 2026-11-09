// The storage-reading half of the rating check (UX-2 P4a, criterion 6): an
// expert review's rating word, read from its stored payload, and the reviews
// of a page of records, read with one storage read per expert review and none
// for anything else. Server-only: it reads storage. The registry's list route
// and the dashboard page both import it; the check itself is
// `./expert-rating.ts`.
//
// UX-2 P4a red: typed stubs. The red commit carries these signatures so the
// tests type-check and fail at their assertions; the green leg fills them in.

import type { ExpertRating } from './expert-attestation.ts';
import type { RecordReviews } from './review-summary.ts';

/** One `attestation_packages` row, as far as the reviews read it. */
export interface StoredReviewRow {
  evidenceRecordId: string;
  type: string;
  storageKey: string;
  createdAt: Date;
}

/** An expert review's rating word, read from its stored payload; null when it cannot be read. */
export async function ratingOf(storageKey: string): Promise<ExpertRating | null> {
  void storageKey;
  return null;
}

/**
 * Each record's reviews, by record id, from its review rows: one storage read
 * per expert review, none for an evaluation or a consistency test. A record
 * with no row is absent from the map.
 */
export async function readRecordReviews(rows: readonly StoredReviewRow[]): Promise<Map<string, RecordReviews>> {
  void rows;
  return new Map();
}
