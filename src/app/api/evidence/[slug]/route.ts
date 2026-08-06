import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { canReadRecord } from '@/lib/evidence/sealed-access';
import { buildRecordReadback } from '@/lib/evidence/readback';

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

  // Sealed records are creator-only (civic-ai-tools#71). 404 (not 403) so
  // probing can't confirm a sealed record's existence.
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const creator = await db
    .select({ displayName: users.displayName, githubProfileUrl: users.githubProfileUrl })
    .from(users)
    .where(eq(users.id, record.creatorId))
    .limit(1);

  // The body shape (including the `listed` / `isPublic` pair and the canonical
  // `visibility`) lives in `@/lib/evidence/readback` so it is unit-testable.
  return NextResponse.json(buildRecordReadback(record, creator[0] || null));
}
