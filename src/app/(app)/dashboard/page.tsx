import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiTokens, evidenceRecords, attestationPackages, users } from '@/lib/db/schema';
import { eq, asc, desc, and, ne, isNull, inArray, sql } from 'drizzle-orm';
import { findDbUserByAccountKey } from '@/lib/db/creator-evidence';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import { Page } from '@/components/ui/Page';
import { readRecordReviews } from '@/lib/evidence/expert-rating-read';
import { isSigningConfigured } from '@/lib/evidence/unsigned-tier';
import { isSealOnly } from '@/lib/site-config';
import { pageTitle } from '@/lib/brand-config';

export const dynamic = 'force-dynamic';

/** Analyses per page on the first tab (UX-2 P4a). */
const PAGE_SIZE = 25;

/**
 * The requested page: digits only, else the first; past the last, the last
 * (UX-2 P4a, measurement 2). `pageCount` is at least 1.
 */
function requestedPage(raw: string | string[] | undefined, pageCount: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d+$/.test(value)) return 1;
  const n = Number(value);
  if (n < 1) return 1;
  return Math.min(n, pageCount);
}

export const metadata: Metadata = {
  title: pageTitle('Dashboard'),
  description: 'Manage your analyses and evaluations.',
};

interface DashboardPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  // `?tab=sources` opens the Sources tab (R6 W3, Q7); nothing links there now
  // that the Sources panel is gone (UX-2 P4b), and the parameter still works.
  // `?page=` is the first tab's page, beside it (UX-2 P4a).
  const params = await searchParams;
  const initialTab = params?.tab === 'sources' ? 'sources' : 'evidence';
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/');
  }

  // Account key → internal user row, via the shared by-creator data path
  // (src/lib/db/creator-evidence.ts — extracted for #239 so the /ask
  // first-run block keys on the same lookup instead of duplicating it).
  const dbUser = await findDbUserByAccountKey(session.user.id);
  if (dbUser === null) {
    redirect('/');
  }
  const userId = dbUser.id;
  const displayName = dbUser.displayName;

  // --- Tab 1: My analyses, 25 a page, newest first (UX-2 P4a) ---
  // The tab's count is the total over pages, so the total is its own query.
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.creatorId, userId));
  const analysesTotal = countResult[0]?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(analysesTotal / PAGE_SIZE));
  const page = requestedPage(params?.page, pageCount);

  const myEvidence = await db
    .select({
      id: evidenceRecords.id,
      slug: evidenceRecords.slug,
      title: evidenceRecords.title,
      summary: evidenceRecords.summary,
      model: evidenceRecords.model,
      withdrawnAt: evidenceRecords.withdrawnAt,
      reinstatedAt: evidenceRecords.reinstatedAt,
      createdAt: evidenceRecords.createdAt,
      visibility: evidenceRecords.visibility,
    })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.creatorId, userId))
    .orderBy(desc(evidenceRecords.createdAt), desc(evidenceRecords.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Each row's reviews line (P5's `reviewsLine`): the page's review rows, and
  // each expert review's rating word from its stored payload, through the
  // registry's own reader. One storage read per expert review on the page and
  // none for anything else (`dashboard-page.test.ts` counts them).
  const reviewRows = myEvidence.length > 0
    ? await db
        .select({
          evidenceRecordId: attestationPackages.evidenceRecordId,
          type: attestationPackages.type,
          storageKey: attestationPackages.storageKey,
          createdAt: attestationPackages.createdAt,
        })
        .from(attestationPackages)
        .where(inArray(attestationPackages.evidenceRecordId, myEvidence.map(e => e.id)))
        .orderBy(asc(attestationPackages.createdAt))
    : [];
  const reviewsMap = await readRecordReviews(reviewRows);

  const myEvidenceData = myEvidence.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    withdrawnAt: e.withdrawnAt?.toISOString() || null,
    reinstatedAt: e.reinstatedAt?.toISOString() || null,
    reviews: reviewsMap.get(e.id) ?? { expertRatings: [], evaluations: 0, consistencyTests: 0 },
  }));

  // --- Tab 2: My reviews and checks ---
  // No storage key: the tab links each review's analysis and reads nothing
  // from storage (#565 item 1).
  const myEvaluations = await db
    .select({
      id: attestationPackages.id,
      type: attestationPackages.type,
      createdAt: attestationPackages.createdAt,
      evidenceTitle: evidenceRecords.title,
      evidenceSlug: evidenceRecords.slug,
    })
    .from(attestationPackages)
    .innerJoin(evidenceRecords, eq(attestationPackages.evidenceRecordId, evidenceRecords.id))
    .where(eq(attestationPackages.creatorId, userId))
    .orderBy(desc(attestationPackages.createdAt));

  const myEvaluationsData = myEvaluations.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  }));

  // --- Tab 3: Activity (others' attestations on my records) ---
  const activity = await db
    .select({
      id: attestationPackages.id,
      type: attestationPackages.type,
      createdAt: attestationPackages.createdAt,
      evidenceTitle: evidenceRecords.title,
      evidenceSlug: evidenceRecords.slug,
      creatorDisplayName: users.displayName,
      creatorGithubUrl: users.githubProfileUrl,
    })
    .from(attestationPackages)
    .innerJoin(evidenceRecords, eq(attestationPackages.evidenceRecordId, evidenceRecords.id))
    .innerJoin(users, eq(attestationPackages.creatorId, users.id))
    .where(
      and(
        eq(evidenceRecords.creatorId, userId),
        ne(attestationPackages.creatorId, userId),
      ),
    )
    .orderBy(desc(attestationPackages.createdAt));

  const activityData = activity.map(a => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
  }));

  // --- Tab 4: Tokens (device-flow-minted bearer tokens) ---
  const tokens = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      scope: apiTokens.scope,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  const tokenData = tokens.map(t => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    expiresAt: t.expiresAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() || null,
  }));

  return (
    // The P9 frame's `record` width (800 px, its 24/16 px gutter); the page's
    // own vertical padding stays as it was (the frame sets none).
    <Page width="record">
      <div style={{ padding: '40px 0 64px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Dashboard</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '32px' }}>
          Welcome back, {displayName}
        </p>

        <DashboardTabs
          initialTab={initialTab}
          myEvidence={myEvidenceData}
          analysesTotal={analysesTotal}
          page={page}
          pageCount={pageCount}
          myEvaluations={myEvaluationsData}
          activity={activityData}
          tokens={tokenData}
          signingConfigured={isSigningConfigured()}
          sealOnly={isSealOnly()}
        />
      </div>
    </Page>
  );
}
