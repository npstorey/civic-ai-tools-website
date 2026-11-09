// The storage-reading half of the rating check (UX-2 P4a, criterion 6): an
// expert review's rating word, read from its stored payload, and the reviews
// of a page of records, read with one storage read per expert review and none
// for anything else (F4 = A; relay 13, rulings 1-2). Server-only: it reads
// storage. The registry's list route and the dashboard page both import it;
// the check and the aggregation themselves are `./expert-rating.ts`.
//
// Relative, extension-carrying imports (the convention of src/lib since #345).

import { getPackage } from '../storage/index.ts';
import type { ExpertRating } from './expert-attestation.ts';
import type { RecordReviews } from './review-summary.ts';
import { expertRatingOf, tallyReviews } from './expert-rating.ts';

/** One `attestation_packages` row, as far as the reviews read it. */
export interface StoredReviewRow {
  evidenceRecordId: string;
  type: string;
  storageKey: string;
  createdAt: Date;
}

/** An expert review's rating word, read from its stored payload; null when it cannot be read. */
export async function ratingOf(storageKey: string): Promise<ExpertRating | null> {
  try {
    return expertRatingOf(await getPackage(storageKey));
  } catch {
    return null;
  }
}

/**
 * Each record's reviews, by record id, from its review rows in the order given
 * (the callers query them oldest first): one storage read per expert review,
 * none for an evaluation, a consistency test or any other kind. A record with
 * no row is absent from the map.
 */
export async function readRecordReviews(rows: readonly StoredReviewRow[]): Promise<Map<string, RecordReviews>> {
  const ratings = await Promise.all(
    rows.map((row) => (row.type === 'expert_attestation' ? ratingOf(row.storageKey) : Promise.resolve(null))),
  );
  const byRecord = new Map<string, Array<{ type: string; rating: ExpertRating | null }>>();
  for (const [i, row] of rows.entries()) {
    const list = byRecord.get(row.evidenceRecordId) ?? [];
    list.push({ type: row.type, rating: ratings[i] });
    byRecord.set(row.evidenceRecordId, list);
  }
  return new Map([...byRecord].map(([id, list]) => [id, tallyReviews(list)]));
}
