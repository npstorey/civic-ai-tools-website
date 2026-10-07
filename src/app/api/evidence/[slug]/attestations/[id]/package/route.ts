import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { attestationPackages, evidenceRecords } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getPackageText } from '@/lib/storage';
import { canReadRecord } from '@/lib/evidence/sealed-access';
import { storedPackageResponse } from '@/lib/evidence/package-response';

/** The form the database gives an attestation's id (a `uuid` column). */
const ATTESTATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/evidence/[slug]/attestations/[id]/package
 *
 * One attestation's stored package, through the app (#559). The record page
 * used to fetch each attestation's storage URL in the browser, which works only
 * while the bucket is world-readable. This route reads the object through the
 * storage driver and answers with its bytes unchanged, as the record's own
 * package route does (#553).
 *
 * Gated as the record is: a sealed record's attestations go to its creator
 * alone, a public record's to anyone. An id that is not an attestation of this
 * record is a 404 with the same body as the gate's, so the answer says nothing
 * about whether the id exists elsewhere.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;

  const records = await db
    .select({
      id: evidenceRecords.id,
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

  // The database refuses a value that is not a UUID against a `uuid` column;
  // such an id names no attestation, so it is a 404 and never a query.
  if (!ATTESTATION_ID.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Scoped to the record: an attestation of another record is not served here.
  const rows = await db
    .select({ storageKey: attestationPackages.storageKey })
    .from(attestationPackages)
    .where(and(eq(attestationPackages.id, id), eq(attestationPackages.evidenceRecordId, records[0].id)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // The stored text, served as is: the bytes that were hashed and signed.
  const text = await getPackageText(rows[0].storageKey);
  if (text === null) {
    return NextResponse.json({ error: 'Package retrieval failed' }, { status: 502 });
  }

  return storedPackageResponse(text);
}
