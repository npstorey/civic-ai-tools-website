import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { canReadRecord } from '@/lib/evidence/sealed-access';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);

  if (records.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const record = records[0];

  // Committed records are creator-only (civic-ai-tools#71). 404 (not 403) so
  // probing can't confirm a committed record's existence.
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const creator = await db
    .select({ displayName: users.displayName, githubProfileUrl: users.githubProfileUrl })
    .from(users)
    .where(eq(users.id, record.creatorId))
    .limit(1);

  return NextResponse.json({
    slug: record.slug,
    title: record.title,
    summary: record.summary,
    model: record.model,
    promptHash: record.promptHash,
    promptVisibility: record.promptVisibility,
    verificationStatus: record.verificationStatus,
    consistencyClassification: record.consistencyClassification,
    jurisdiction: record.jurisdiction,
    civicContext: record.civicContext,
    basePackageHash: record.basePackageHash,
    isPublic: record.isPublic,
    visibility: record.visibility,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    creator: creator[0] || null,
  });
}
