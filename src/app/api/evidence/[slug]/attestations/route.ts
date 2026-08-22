import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { canReadRecord } from '@/lib/evidence/sealed-access';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords, attestationPackages, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage } from '@/lib/storage';
import {
  evaluateAttestationSigningGate,
  signAndStoreAttestationPackage,
} from '@/lib/evidence/attestation-signing';
import { resolveReviewSignature } from '@/lib/evidence/trust-signal';
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

  // Sealed records are creator-only (civic-ai-tools#71).
  if (!(await canReadRecord(request, records[0]))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rows = await db
    .select({
      id: attestationPackages.id,
      type: attestationPackages.type,
      packageHash: attestationPackages.packageHash,
      storageKey: attestationPackages.storageKey,
      createdAt: attestationPackages.createdAt,
      signature: attestationPackages.signature,
      signingKeyId: attestationPackages.signingKeyId,
      rfc3161Timestamp: attestationPackages.rfc3161Timestamp,
      signedAt: attestationPackages.signedAt,
      unsignedReason: attestationPackages.unsignedReason,
      creatorDisplayName: users.displayName,
      creatorGithubUrl: users.githubProfileUrl,
    })
    .from(attestationPackages)
    .innerJoin(users, eq(attestationPackages.creatorId, users.id))
    .where(eq(attestationPackages.evidenceRecordId, records[0].id));

  // Every attestation carries its own signing disclosure. Per-review, never a
  // page-level summary: the rows on one record can legitimately be in
  // different states (reviews predating migration 0016 sit alongside signed
  // ones), and a single banner would either overclaim for the old rows or
  // underclaim for the new.
  const attestations = rows.map((row) => {
    const { signature, signingKeyId, rfc3161Timestamp, signedAt, unsignedReason, ...rest } = row;
    const resolved = resolveReviewSignature({ signature, rfc3161Timestamp, unsignedReason });
    return {
      ...rest,
      signature: {
        status: resolved.status,
        tier: resolved.tier,
        label: resolved.label,
        detail: resolved.detail,
        keyId: signingKeyId,
        signedAt: signedAt ? signedAt.toISOString() : null,
        rfc3161Timestamped: rfc3161Timestamp !== null,
        // The envelope is served so a reader can check the signature rather
        // than take the label's word for it — the signature and public key are
        // public by construction. Parsed defensively: a row whose JSON cannot
        // be read reports absence rather than failing the whole listing.
        envelope: parseSignatureEnvelope(signature),
      },
    };
  });

  return NextResponse.json({ attestations });
}

function parseSignatureEnvelope(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/evidence/[slug]/attestations
 *
 * Stores a new attestation package. Supports three types:
 *   - `consistency`  — N-run replay metrics (machine-generated)
 *   - `evaluation`   — adversarial LLM rubric (machine-generated)
 *   - `expert_attestation` — free-text review by a human reviewer
 *
 * Signs the package hash with the instance key and PERSISTS the resulting
 * envelope, requests an RFC 3161 timestamp, stores the package body in blob
 * storage, inserts the DB row, and (for machine types only) advances the
 * parent record's verification status.
 *
 * The signature is persisted as of migration 0016. Before it, this handler
 * computed a signature, discarded it, and inserted a row into a table with no
 * column to hold one — so rows written before then are unsigned, and the
 * record page labels them as such rather than inferring a signature they
 * never had.
 *
 * `expert_attestation` is a separate dimension of review and does not advance
 * `verification_status` in v1; issue #67 will revisit when multi-signer and
 * identity tiers land. Signing it does NOT change that: a signed review is
 * still not a verification input (spec §9.2 #10, ADR-0010) — the signature
 * attests who recorded the review, never that the analysis is correct.
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

  // This legacy surface (#173, pending consolidation with the ratified
  // attestation/* node system) reaches the signing path, so a half-configured
  // instance is refused specifically here instead of throwing out of the
  // signing call below.
  //
  // NARROWER than the seal/commit gate this used to call. That gate also
  // refuses the KEYLESS tier (403 `unsigned_tier`), which meant a first-run
  // self-hoster or a keyless CI instance could not accept a review at all.
  // Sealing and publishing are genuinely unreachable unsigned (ADR-0020
  // Decision C bounds what an unsigned RECORD may reach), but attaching a
  // review neither seals nor publishes anything — the review inherits the
  // visibility of the record it hangs on and has none of its own. So a keyless
  // instance stores the review and labels it unsigned, and only the two
  // MISCONFIGURATION states (key without kid, signing pair without declared
  // identity) still refuse. See `evaluateAttestationSigningGate`.
  const gate = evaluateAttestationSigningGate();
  if (gate) {
    return NextResponse.json(gate.body, { status: gate.status });
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
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  const record = records[0];

  // Sealed records are creator-only (civic-ai-tools#71).
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
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

  // Sign, timestamp, store, insert — IN THAT ORDER. The signing decision runs
  // and completes before any external write, so a refusal leaves nothing
  // behind. The previous ordering wrote the blob first, which was harmless
  // only while signing could not fail the request; now that it can, that
  // ordering would orphan a blob on every refusal.
  const signing = await signAndStoreAttestationPackage(
    { packageHash, attestationPkg },
    {
      putPackage,
      insertRow: async (columns) => {
        await db.insert(attestationPackages).values({
          evidenceRecordId: record.id,
          type: attestationType,
          creatorId: user.id,
          packageHash,
          referencesBaseHash: record.basePackageHash || '',
          ...columns,
        });
      },
    },
  );

  if (!signing.ok) {
    // The cause is logged server-side and never returned: it can carry raw
    // infrastructure detail, and a reviewer can do nothing with it.
    console.error(
      '[attestations] signing failed — review not stored:',
      signing.cause instanceof Error ? signing.cause.message : signing.cause,
    );
    return NextResponse.json(signing.refusal.body, { status: signing.refusal.status });
  }

  const blobUrl = signing.storageKey;

  // Echo the signing disclosure back, so a client knows what was actually
  // recorded without having to re-list. A keyless instance gets `unsigned_no_
  // signing_key` here — a successful store, honestly labeled, not a failure.
  const stored = resolveReviewSignature({
    signature: signing.columns.signature,
    rfc3161Timestamp: signing.columns.rfc3161Timestamp,
    unsignedReason: signing.columns.unsignedReason,
  });
  const signatureResponse = {
    status: stored.status,
    tier: stored.tier,
    label: stored.label,
    detail: stored.detail,
    keyId: signing.columns.signingKeyId,
    signedAt: signing.columns.signedAt ? signing.columns.signedAt.toISOString() : null,
    rfc3161Timestamped: signing.columns.rfc3161Timestamp !== null,
  };

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
      signature: signatureResponse,
    });
  }

  return NextResponse.json({
    id: packageHash,
    storageKey: blobUrl,
    verificationStatus: record.verificationStatus,
    signature: signatureResponse,
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
