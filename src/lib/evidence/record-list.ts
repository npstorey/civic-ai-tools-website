// The `GET /api/evidence/list` row → response projection.
//
// Extracted from the route for the same reason `./readback.ts` was: the route
// imports `db` at module scope, so the test runner — which resolves no path
// aliases and cannot load a route module — could not reach the projection to
// assert anything about it. #307 is a defect that is invisible without such a
// test, because the value it emitted (`0`) is a perfectly plausible-looking
// number. Nothing here touches the database; the route does the queries, then
// hands the rows to this pure function.
//
// ---------------------------------------------------------------------------
// THE PROPERTY (#307): a listing never states a count it did not compute
// ---------------------------------------------------------------------------
//
// The route used to run the attestation-count query ONLY when `sort=attested`,
// then emit `attestationCount: map.get(id) || 0` for every record under every
// sort. Under the default sort the map was empty, so every record on the
// public index reported `0` — measured against production, while the database
// held nine attestation rows across seven records.
//
// A count reading zero tells a reader nobody reviewed an analysis when someone
// did. That is a stronger claim than the honest one, and it is exactly the
// failure `docs/design-principles.md` principle 3 names: no false precision.
// The number was not stale or rounded; it was never computed.
//
// So `attestationCounts` is `Map | null`, not `Map`, and the two states mean
// different things:
//
//   a Map  — the counts WERE computed. A record absent from the map genuinely
//            has zero attestations, and `attestationCount: 0` is a true
//            statement. `?? 0` on a computed map is fine.
//   `null` — the counts were NOT computed. The field is OMITTED. A caller that
//            cannot count has no way, through this function, to say "zero"
//            instead of saying nothing — which is the point.
//
// The route computes on every listing, so the served responses always carry
// the field. The `null` arm is the contract that keeps a future caller (a
// lighter listing, a cache-warm path) from re-introducing the defect by
// passing an empty map.

import type { evidenceRecords, users } from '../db/schema.ts';

/** The columns `GET /api/evidence/list` selects off each record row. */
export type RecordListRow = Pick<
  typeof evidenceRecords.$inferSelect,
  | 'id'
  | 'slug'
  | 'title'
  | 'summary'
  | 'model'
  | 'verificationStatus'
  | 'withdrawnAt'
  | 'reinstatedAt'
  | 'createdAt'
  | 'creatorId'
>;

/** The creator fields the listing renders — public display identity only. */
export type RecordListCreator = Pick<typeof users.$inferSelect, 'displayName'>;

/** One row of the public index, as it goes on the wire. */
export type RecordListItem = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  model: string;
  verificationStatus: RecordListRow['verificationStatus'];
  withdrawnAt: string | null;
  reinstatedAt: string | null;
  createdAt: string;
  creatorName: string;
  /** Present only when the count was actually computed — see the header. */
  attestationCount?: number;
};

/** Characters of `summary` the index preview carries before it is elided. */
export const SUMMARY_PREVIEW_CHARS = 200;

/** Shown when a record's creator row is missing from the batch. */
export const UNKNOWN_CREATOR_NAME = 'Unknown';

export type RecordListContext = {
  /** Creator rows, keyed by `users.id`. */
  creators: ReadonlyMap<string, RecordListCreator>;
  /**
   * Attestation counts keyed by record id, or `null` when the caller did not
   * run the count query. `null` omits the field; it never becomes `0`.
   */
  attestationCounts: ReadonlyMap<string, number> | null;
};

/** Project one selected record row onto its public index entry. */
export function buildRecordListItem(
  row: RecordListRow,
  context: RecordListContext,
): RecordListItem {
  const item: RecordListItem = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary:
      row.summary.slice(0, SUMMARY_PREVIEW_CHARS) +
      (row.summary.length > SUMMARY_PREVIEW_CHARS ? '...' : ''),
    model: row.model,
    verificationStatus: row.verificationStatus,
    withdrawnAt: row.withdrawnAt?.toISOString() || null,
    reinstatedAt: row.reinstatedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
    creatorName: context.creators.get(row.creatorId)?.displayName || UNKNOWN_CREATOR_NAME,
  };

  // Assigned only on the computed branch. Spreading a `{ attestationCount:
  // undefined }` would put the key on the object with an undefined value,
  // which `JSON.stringify` drops but `'attestationCount' in item` does not —
  // and "the field is absent" is the property under test.
  if (context.attestationCounts) {
    item.attestationCount = context.attestationCounts.get(row.id) ?? 0;
  }

  return item;
}

/** Project a page of record rows onto their public index entries. */
export function buildRecordListItems(
  rows: readonly RecordListRow[],
  context: RecordListContext,
): RecordListItem[] {
  return rows.map(row => buildRecordListItem(row, context));
}

/**
 * Order a page by attestation count, descending — the `sort=attested` view.
 *
 * Separate from the projection because it is only meaningful over items whose
 * counts were computed: an uncounted item sorts as if it had none, which is
 * why the route computes unconditionally rather than counting only here.
 */
export function sortByAttestationCount(items: RecordListItem[]): RecordListItem[] {
  return items.sort((a, b) => (b.attestationCount ?? 0) - (a.attestationCount ?? 0));
}
