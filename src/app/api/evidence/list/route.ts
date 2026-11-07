import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords, attestationPackages, users } from '@/lib/db/schema';
import { eq, desc, asc, ilike, or, and, gte, isNull, isNotNull, sql, inArray, notInArray, type SQL } from 'drizzle-orm';
import { visibilityMatches } from '@/lib/evidence/visibility-sql';
import { buildRecordListItems, sortByAttestationCount } from '@/lib/evidence/record-list';
import { getPackage } from '@/lib/storage';
import { EXPERT_RATINGS, type ExpertRating } from '@/lib/evidence/expert-attestation';
import type { RecordReviews } from '@/lib/evidence/review-summary';

const PAGE_SIZE = 20;

/**
 * GET /api/evidence/list
 *
 * Paginated, filterable evidence listing.
 * Query params:
 *   q       - text search (title + summary)
 *   reviews - the reviews filter (UX-2 P5, R18b C): `none` (no review of
 *             any kind), `expert`, `evaluation` or `consistency` (holds at
 *             least one review of that kind); absent or anything else, all.
 *             The retired `status` parameter is not read.
 *   range   - date range: 7d, 30d, 90d, all
 *   sort    - newest (default), attested, alpha
 *   page    - 1-based page number
 *   withdrawn - "include" to include withdrawn records (excluded by default)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get('q')?.trim() || '';
  const reviewsFilter = params.get('reviews') || '';
  const range = params.get('range') || 'all';
  const sort = params.get('sort') || 'newest';
  const includeWithdrawn = params.get('withdrawn') === 'include';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));

  // Build WHERE conditions. Sealed records (civic-ai-tools#71) are never
  // listed — their commitment is public via the commitment endpoint, but the
  // record itself is creator-only until published.
  //
  // The visibility filter is a SET-membership test over both public-state
  // labels rather than equality against one (ADR-0016 §A; see
  // `@/lib/evidence/visibility`). Equality against a single spelling would
  // silently empty this listing the moment the row flip renames the rows.
  const conditions = [
    eq(evidenceRecords.isPublic, true),
    visibilityMatches(evidenceRecords.visibility, 'public'),
  ];

  // Exclude currently-withdrawn records by default.
  // Reinstated records (withdrawn then reinstated) remain visible.
  if (!includeWithdrawn) {
    conditions.push(
      or(
        isNull(evidenceRecords.withdrawnAt),
        isNotNull(evidenceRecords.reinstatedAt),
      )!,
    );
  }

  if (q) {
    conditions.push(
      or(
        ilike(evidenceRecords.title, `%${q}%`),
        ilike(evidenceRecords.summary, `%${q}%`),
      )!,
    );
  }

  // The reviews filter (UX-2 P5, R18b C) reads the attestation rows, never
  // the `verification_status` column R18 C retires from every reader surface.
  // It is an id set from one query over `attestation_packages`, a table of
  // tens of rows; a record in `none` holds no row of any kind.
  const reviewsCondition = await reviewsFilterCondition(reviewsFilter);
  if (reviewsCondition) conditions.push(reviewsCondition);

  if (range !== 'all') {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      conditions.push(gte(evidenceRecords.createdAt, cutoff));
    }
  }

  const where = conditions.length > 1 ? and(...conditions) : conditions[0];

  // Count total for pagination
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(evidenceRecords)
    .where(where);
  const total = countResult[0]?.count || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Build ORDER BY
  let orderBy;
  if (sort === 'alpha') {
    orderBy = asc(evidenceRecords.title);
  } else {
    // 'newest' and 'attested' both use createdAt desc as primary sort;
    // 'attested' will be re-sorted after attestation count join
    orderBy = desc(evidenceRecords.createdAt);
  }

  // Fetch records
  const records = await db
    .select({
      id: evidenceRecords.id,
      slug: evidenceRecords.slug,
      title: evidenceRecords.title,
      summary: evidenceRecords.summary,
      model: evidenceRecords.model,
      verificationStatus: evidenceRecords.verificationStatus,
      withdrawnAt: evidenceRecords.withdrawnAt,
      reinstatedAt: evidenceRecords.reinstatedAt,
      createdAt: evidenceRecords.createdAt,
      creatorId: evidenceRecords.creatorId,
    })
    .from(evidenceRecords)
    .where(where)
    .orderBy(orderBy)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Batch-fetch creators — projected to the two columns the response actually
  // needs (`record-list.ts`'s RecordListCreator reads only `displayName`) and
  // filtered to this page's ids. `creatorIds.length > 0` still short-circuits
  // the query entirely: drizzle's `inArray` over an empty array is a caller
  // error, not an empty result (#366).
  const creatorIds = [...new Set(records.map(r => r.creatorId))];
  const creators = creatorIds.length > 0
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, creatorIds))
    : [];
  const creatorMap = new Map(creators.map(c => [c.id, c]));

  // Fetch attestation counts — on EVERY listing, not only `sort=attested`
  // (#307).
  //
  // The query used to be gated on the sort, while the projection below emitted
  // `attestationCount` unconditionally. Under every other sort the map was
  // empty and the field fell through to `0`, so the public index told every
  // reader that no one had reviewed any record — measured against production,
  // where the database held nine attestation rows across seven records.
  //
  // The count is a review signal on a page whose whole job is scrutiny, so a
  // false zero is worse than a slower page. It is one query over at most
  // `PAGE_SIZE` ids, on a page that already runs three queries.
  //
  // UX-2 P5 (R18 C, G0-13 a): the same query reads each row's kind and storage
  // key, so the count, the per-kind counts and the reviews line come from one
  // query. An expert review's rating word lives only in its stored payload
  // (`expert-attestation.ts`), so the listing reads that payload: one storage
  // read per expert review on the page, and none for any other review or for
  // any record's package (F4 = A; relay 13, rulings 1-2;
  // `reviews-filter-and-reads.test.ts` counts them). A payload that cannot be
  // read gives `null`, and the line leaves the word out.
  //
  // `null` (rather than an empty map) is what the projection reads as "not
  // computed" and omits the field for; it is never `0`. See
  // `@/lib/evidence/record-list`.
  let attestationCountMap: Map<string, number> | null = null;
  let reviewsMap: Map<string, RecordReviews> | null = null;
  if (records.length > 0) {
    const rows = await db
      .select({
        evidenceRecordId: attestationPackages.evidenceRecordId,
        type: attestationPackages.type,
        storageKey: attestationPackages.storageKey,
        createdAt: attestationPackages.createdAt,
      })
      .from(attestationPackages)
      .where(inArray(attestationPackages.evidenceRecordId, records.map(r => r.id)))
      .orderBy(asc(attestationPackages.createdAt));
    const ratings = await Promise.all(
      rows.map(row => (row.type === 'expert_attestation' ? ratingOf(row.storageKey) : Promise.resolve(null))),
    );
    attestationCountMap = new Map();
    reviewsMap = new Map();
    for (const [i, row] of rows.entries()) {
      const id = row.evidenceRecordId;
      attestationCountMap.set(id, (attestationCountMap.get(id) ?? 0) + 1);
      const reviews = reviewsMap.get(id) ?? { expertRatings: [], evaluations: 0, consistencyTests: 0 };
      if (row.type === 'expert_attestation') reviews.expertRatings.push(ratings[i]);
      else if (row.type === 'evaluation') reviews.evaluations += 1;
      else if (row.type === 'consistency') reviews.consistencyTests += 1;
      reviewsMap.set(id, reviews);
    }
  }

  // The row -> response projection lives in `@/lib/evidence/record-list` so it
  // is reachable by the test runner, which cannot load this module (it imports
  // `db` at module scope). Same reason `[slug]`'s read-back projection lives in
  // `@/lib/evidence/readback`.
  const results = buildRecordListItems(records, {
    creators: creatorMap,
    attestationCounts: attestationCountMap,
    reviews: reviewsMap,
  });

  // Re-sort by attestation count if needed
  if (sort === 'attested') {
    sortByAttestationCount(results);
  }

  return NextResponse.json({ records: results, total, page, totalPages });
}

/** The record ids holding at least one review of `type`, or of any type. */
async function recordIdsHolding(type: 'expert_attestation' | 'evaluation' | 'consistency' | null): Promise<string[]> {
  const query = db
    .selectDistinct({ id: attestationPackages.evidenceRecordId })
    .from(attestationPackages);
  const rows = type === null ? await query : await query.where(eq(attestationPackages.type, type));
  return rows.map(row => row.id);
}

/** The listing condition the `reviews` parameter asks for, or none. */
async function reviewsFilterCondition(filter: string): Promise<SQL | null> {
  switch (filter) {
    case 'none':
      return notInArray(evidenceRecords.id, await recordIdsHolding(null));
    case 'expert':
      return inArray(evidenceRecords.id, await recordIdsHolding('expert_attestation'));
    case 'evaluation':
      return inArray(evidenceRecords.id, await recordIdsHolding('evaluation'));
    case 'consistency':
      return inArray(evidenceRecords.id, await recordIdsHolding('consistency'));
    default:
      return null;
  }
}

/** An expert review's rating word, read from its stored payload; null when it cannot be read. */
async function ratingOf(storageKey: string): Promise<ExpertRating | null> {
  try {
    const payload = await getPackage(storageKey);
    const rating = payload?.rating;
    return typeof rating === 'string' && (EXPERT_RATINGS as readonly string[]).includes(rating) ? (rating as ExpertRating) : null;
  } catch {
    return null;
  }
}
