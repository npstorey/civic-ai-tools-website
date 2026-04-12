import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords, attestationPackages, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage } from '@/lib/storage';
import { signPackage, getRfc3161Timestamp } from '@/lib/evidence/signing';

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * GET /api/evidence/[slug]/attestations
 *
 * Lists all attestation packages for an evidence record.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Look up evidence record by slug
  const records = await db
    .select({ id: evidenceRecords.id })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const attestations = await db
    .select({
      id: attestationPackages.id,
      type: attestationPackages.type,
      packageHash: attestationPackages.packageHash,
      storageKey: attestationPackages.storageKey,
      createdAt: attestationPackages.createdAt,
      creatorDisplayName: users.displayName,
      creatorGithubUrl: users.githubProfileUrl,
    })
    .from(attestationPackages)
    .innerJoin(users, eq(attestationPackages.creatorId, users.id))
    .where(eq(attestationPackages.evidenceRecordId, records[0].id));

  return NextResponse.json({ attestations });
}

/**
 * POST /api/evidence/[slug]/attestations
 *
 * Stores a new attestation package (consistency test or evaluation).
 * Signs, timestamps, stores in Vercel Blob, creates DB record,
 * and updates the evidence record's verification status.
 *
 * Body: { type: 'consistency' | 'evaluation', data: {...} }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Look up DB user
  const githubId = session.user.id;
  const dbUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  if (dbUser.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const userId = dbUser[0].id;

  // Look up evidence record
  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) {
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }
  const record = records[0];

  const body = await request.json();
  const { type, data } = body;

  if (!type || !['consistency', 'evaluation'].includes(type)) {
    return NextResponse.json({ error: 'Invalid attestation type' }, { status: 400 });
  }
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Attestation data required' }, { status: 400 });
  }

  // Build attestation package
  const attestationPkg = {
    schemaVersion: '0.1.0',
    type,
    evidenceBaseHash: record.basePackageHash,
    createdAt: new Date().toISOString(),
    ...data,
  };

  // Hash and store
  const canonical = JSON.stringify(attestationPkg);
  const packageHash = sha256(canonical);

  const blobUrl = await putPackage(
    `attestation-${packageHash}`,
    attestationPkg,
  );

  // Sign (non-blocking — failures don't prevent storage)
  signPackage(packageHash);

  // Timestamp (best-effort)
  await getRfc3161Timestamp(packageHash).catch(() => null);

  // Create DB record
  await db.insert(attestationPackages).values({
    evidenceRecordId: record.id,
    type: type as 'consistency' | 'evaluation',
    creatorId: userId,
    packageHash,
    storageKey: blobUrl,
    referencesBaseHash: record.basePackageHash || '',
  });

  // Update evidence record verification status
  const newStatus = determineVerificationStatus(
    record.verificationStatus,
    type as 'consistency' | 'evaluation',
  );

  const updateFields: Record<string, unknown> = {
    verificationStatus: newStatus,
    updatedAt: new Date(),
  };

  // For consistency tests, also set the classification
  if (type === 'consistency' && data.metrics?.consistencyClassification) {
    updateFields.consistencyClassification = data.metrics.consistencyClassification;
  }

  await db
    .update(evidenceRecords)
    .set(updateFields)
    .where(eq(evidenceRecords.id, record.id));

  return NextResponse.json({
    id: packageHash,
    storageKey: blobUrl,
    verificationStatus: newStatus,
  });
}

function determineVerificationStatus(
  current: string,
  newType: 'consistency' | 'evaluation',
): string {
  // fully_attested = both consistency and evaluation exist
  if (current === 'fully_attested') return 'fully_attested';

  if (newType === 'consistency') {
    if (current === 'evaluated') return 'fully_attested';
    return 'consistency_tested';
  }

  if (newType === 'evaluation') {
    if (current === 'consistency_tested') return 'fully_attested';
    return 'evaluated';
  }

  return current;
}
