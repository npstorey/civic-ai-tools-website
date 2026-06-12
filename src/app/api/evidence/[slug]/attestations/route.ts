import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { canReadRecord } from '@/lib/evidence/committed-access';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords, attestationPackages, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage } from '@/lib/storage';
import { signPackage, getRfc3161Timestamp } from '@/lib/evidence/signing';
import {
  buildExpertAttestationPayload,
  validateExpertAttestation,
} from '@/lib/evidence/expert-attestation';

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

type AttestationType = 'consistency' | 'evaluation' | 'expert_attestation';
const ACCEPTED_TYPES: AttestationType[] = ['consistency', 'evaluation', 'expert_attestation'];

/**
 * GET /api/evidence/[slug]/attestations
 *
 * Lists all attestation packages for an evidence record.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Look up evidence record by slug
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

  // Committed records are creator-only (civic-ai-tools#71).
  if (!(await canReadRecord(request, records[0]))) {
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
 * Stores a new attestation package. Supports three types:
 *   - `consistency`  — N-run replay metrics (machine-generated)
 *   - `evaluation`   — adversarial LLM rubric (machine-generated)
 *   - `expert_attestation` — signed free-text review by a human reviewer
 *
 * Signs the package hash with the platform key, requests an RFC 3161
 * timestamp, stores the package body in Vercel Blob, inserts the DB row,
 * and (for machine types only) advances the parent record's verification
 * status. `expert_attestation` is a separate dimension of review and does
 * not advance `verification_status` in v1; issue #67 will revisit when
 * multi-signer and identity tiers land.
 *
 * Body: { type: <AttestationType>, data: <type-specific payload> }
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
    .select({
      id: users.id,
      displayName: users.displayName,
      githubProfileUrl: users.githubProfileUrl,
    })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  if (dbUser.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const user = dbUser[0];

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

  // Committed records are creator-only (civic-ai-tools#71).
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }

  const body = await request.json();
  const { type, data } = body as { type?: string; data?: unknown };

  if (!type || !ACCEPTED_TYPES.includes(type as AttestationType)) {
    return NextResponse.json({ error: 'Invalid attestation type' }, { status: 400 });
  }
  const attestationType = type as AttestationType;

  // Type-specific validation + payload build
  const createdAt = new Date().toISOString();
  let attestationPkg: Record<string, unknown>;
  let typeSpecific: Record<string, unknown>;

  if (attestationType === 'expert_attestation') {
    const v = validateExpertAttestation(data);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    attestationPkg = buildExpertAttestationPayload(
      v.value,
      {
        dbUserId: user.id,
        githubId,
        displayName: user.displayName,
        githubProfileUrl: user.githubProfileUrl,
      },
      record.basePackageHash,
      createdAt,
    );
    typeSpecific = {};
  } else {
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Attestation data required' }, { status: 400 });
    }
    typeSpecific = data as Record<string, unknown>;
    attestationPkg = {
      schemaVersion: '0.1.0',
      type: attestationType,
      evidenceBaseHash: record.basePackageHash,
      createdAt,
      ...typeSpecific,
    };
  }

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
    type: attestationType,
    creatorId: user.id,
    packageHash,
    storageKey: blobUrl,
    referencesBaseHash: record.basePackageHash || '',
  });

  // Update evidence record verification status — only machine attestations
  // (`consistency`, `evaluation`) feed into the existing state machine.
  // Expert attestations are a separate dimension of review and leave the
  // status unchanged; issue #67 (multi-signer) / #69 (identity tiers) will
  // revisit whether human reviews should contribute to a verification
  // verdict, and if so, how they should be weighted.
  if (attestationType === 'consistency' || attestationType === 'evaluation') {
    const newStatus = determineVerificationStatus(
      record.verificationStatus,
      attestationType,
    );

    const updateFields: Record<string, unknown> = {
      verificationStatus: newStatus,
      updatedAt: new Date(),
    };

    // For consistency tests, also set the classification
    if (attestationType === 'consistency') {
      const metricsData = typeSpecific.metrics as { consistencyClassification?: string } | undefined;
      if (metricsData?.consistencyClassification) {
        updateFields.consistencyClassification = metricsData.consistencyClassification;
      }
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

  return NextResponse.json({
    id: packageHash,
    storageKey: blobUrl,
    verificationStatus: record.verificationStatus,
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
