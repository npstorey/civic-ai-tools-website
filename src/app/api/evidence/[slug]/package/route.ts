import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const records = await db
    .select({
      basePackageStorageKey: evidenceRecords.basePackageStorageKey,
    })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);

  if (records.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storageKey = records[0].basePackageStorageKey;
  if (!storageKey) {
    return NextResponse.json({ error: 'Package not available' }, { status: 404 });
  }

  const pkg = await getPackage(storageKey);
  if (!pkg) {
    return NextResponse.json({ error: 'Package retrieval failed' }, { status: 502 });
  }

  return NextResponse.json(pkg);
}
