import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiTokens, evidenceRecords, attestationPackages, users } from '@/lib/db/schema';
import { eq, desc, and, ne, isNull, sql } from 'drizzle-orm';
import { findDbUserByAccountKey } from '@/lib/db/creator-evidence';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import { isSigningConfigured } from '@/lib/evidence/unsigned-tier';
import { pageTitle } from '@/lib/brand-config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: pageTitle('Dashboard'),
  description: 'Manage your records and evaluations.',
};

export default async function DashboardPage() {
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

  // --- Tab 1: My Records ---
  const myEvidence = await db
    .select({
      id: evidenceRecords.id,
      slug: evidenceRecords.slug,
      title: evidenceRecords.title,
      summary: evidenceRecords.summary,
      model: evidenceRecords.model,
      verificationStatus: evidenceRecords.verificationStatus,
      consistencyClassification: evidenceRecords.consistencyClassification,
      withdrawnAt: evidenceRecords.withdrawnAt,
      reinstatedAt: evidenceRecords.reinstatedAt,
      createdAt: evidenceRecords.createdAt,
      visibility: evidenceRecords.visibility,
    })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.creatorId, userId))
    .orderBy(desc(evidenceRecords.createdAt));

  // Get attestation counts per record
  const attestationCounts = myEvidence.length > 0
    ? await db
        .select({
          evidenceRecordId: attestationPackages.evidenceRecordId,
          count: sql<number>`count(*)::int`,
        })
        .from(attestationPackages)
        .where(
          sql`${attestationPackages.evidenceRecordId} IN (${sql.join(
            myEvidence.map(e => sql`${e.id}`),
            sql`,`,
          )})`,
        )
        .groupBy(attestationPackages.evidenceRecordId)
    : [];

  const countMap = new Map(attestationCounts.map(c => [c.evidenceRecordId, c.count]));

  const myEvidenceData = myEvidence.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    withdrawnAt: e.withdrawnAt?.toISOString() || null,
    reinstatedAt: e.reinstatedAt?.toISOString() || null,
    attestationCount: countMap.get(e.id) || 0,
  }));

  // --- Tab 2: My Evaluations ---
  const myEvaluations = await db
    .select({
      id: attestationPackages.id,
      type: attestationPackages.type,
      storageKey: attestationPackages.storageKey,
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
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px 64px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '32px' }}>
        Welcome back, {displayName}
      </p>

      <DashboardTabs
        myEvidence={myEvidenceData}
        myEvaluations={myEvaluationsData}
        activity={activityData}
        tokens={tokenData}
        signingConfigured={isSigningConfigured()}
      />
    </div>
  );
}
