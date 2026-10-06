import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackageText } from '@/lib/storage';
import { canReadRecord } from '@/lib/evidence/sealed-access';
import { storedPackageResponse } from '@/lib/evidence/package-response';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const records = await db
    .select({
      basePackageStorageKey: evidenceRecords.basePackageStorageKey,
      visibility: evidenceRecords.visibility,
      creatorId: evidenceRecords.creatorId,
    })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);

  if (records.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Sealed records' content is creator-only (civic-ai-tools#71).
  if (!(await canReadRecord(request, records[0]))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storageKey = records[0].basePackageStorageKey;
  if (!storageKey) {
    return NextResponse.json({ error: 'Package not available' }, { status: 404 });
  }

  // The stored text, served as is (#553): the record page's Download saves this
  // body, so it must be the stored object's bytes, not a re-serialization.
  const text = await getPackageText(storageKey);
  if (text === null) {
    return NextResponse.json({ error: 'Package retrieval failed' }, { status: 502 });
  }

  return storedPackageResponse(text);
}
