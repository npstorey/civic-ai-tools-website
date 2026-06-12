import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords, attestationPackages, users } from '@/lib/db/schema';
import { eq, desc, asc, ilike, or, and, gte, isNull, isNotNull, sql } from 'drizzle-orm';

const PAGE_SIZE = 20;

/**
 * GET /api/evidence/list
 *
 * Paginated, filterable evidence listing.
 * Query params:
 *   q       - text search (title + summary)
 *   status  - verification status filter
 *   range   - date range: 7d, 30d, 90d, all
 *   sort    - newest (default), attested, alpha
 *   page    - 1-based page number
 *   withdrawn - "include" to include withdrawn records (excluded by default)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get('q')?.trim() || '';
  const status = params.get('status') || '';
  const range = params.get('range') || 'all';
  const sort = params.get('sort') || 'newest';
  const includeWithdrawn = params.get('withdrawn') === 'include';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));

  // Build WHERE conditions. Committed records (civic-ai-tools#71) are never
  // listed — their commitment is public via the commitment endpoint, but the
  // record itself is creator-only until published.
  const conditions = [
    eq(evidenceRecords.isPublic, true),
    eq(evidenceRecords.visibility, 'published' as const),
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

  if (status && ['unverified', 'consistency_tested', 'evaluated', 'fully_attested'].includes(status)) {
    conditions.push(
      eq(evidenceRecords.verificationStatus, status as 'unverified' | 'consistency_tested' | 'evaluated' | 'fully_attested'),
    );
  }

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

  // Batch-fetch creators
  const creatorIds = [...new Set(records.map(r => r.creatorId))];
  const creators = creatorIds.length > 0
    ? await db.select().from(users)
    : [];
  const creatorMap = new Map(creators.map(c => [c.id, c]));

  // Fetch attestation counts if sorting by 'attested'
  let attestationCountMap = new Map<string, number>();
  if (sort === 'attested' && records.length > 0) {
    const counts = await db
      .select({
        evidenceRecordId: attestationPackages.evidenceRecordId,
        count: sql<number>`count(*)::int`,
      })
      .from(attestationPackages)
      .where(
        sql`${attestationPackages.evidenceRecordId} IN (${sql.join(
          records.map(r => sql`${r.id}`),
          sql`,`,
        )})`,
      )
      .groupBy(attestationPackages.evidenceRecordId);
    attestationCountMap = new Map(counts.map(c => [c.evidenceRecordId, c.count]));
  }

  const results = records.map(r => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary.slice(0, 200) + (r.summary.length > 200 ? '...' : ''),
    model: r.model,
    verificationStatus: r.verificationStatus,
    withdrawnAt: r.withdrawnAt?.toISOString() || null,
    reinstatedAt: r.reinstatedAt?.toISOString() || null,
    createdAt: r.createdAt.toISOString(),
    creatorName: creatorMap.get(r.creatorId)?.displayName || 'Unknown',
    attestationCount: attestationCountMap.get(r.id) || 0,
  }));

  // Re-sort by attestation count if needed
  if (sort === 'attested') {
    results.sort((a, b) => b.attestationCount - a.attestationCount);
  }

  return NextResponse.json({ records: results, total, page, totalPages });
}
