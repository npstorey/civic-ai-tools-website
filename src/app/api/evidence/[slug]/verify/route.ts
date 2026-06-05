import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
// The §9.2 check suite runs through verify-core's `verifyEvidence` orchestrator —
// the SAME implementation the typedstandards.org browser verifier (WS3) will run,
// so a tampered package fails identically in both (parity test in
// verify-core/verify-core.test.ts). The server supplies what only it can: its
// loaded trust registry, its `fetch`, and — to keep this route's output
// byte-identical — its server-deeper lifecycle resolution from the signed
// attestation chain (check #10 at chain depth; verify-core's portable default is
// state depth).
import {
  verifyEvidence,
  type VerifySignatureEnvelope,
} from '@/lib/evidence/verify-core';
import { loadTrustRegistry } from '@/lib/evidence/verify';
import { resolveLifecycle } from '@/lib/evidence/lifecycle';

export async function GET(
  _request: NextRequest,
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

  // Resolve the canonical package JSON from the blob (null mirrors the prior
  // "blob unavailable" path — integrity fails, package-derived checks report
  // null).
  const pkgJson = record.basePackageStorageKey
    ? await getPackage(record.basePackageStorageKey)
    : null;

  // Parse the persisted signature envelope. A present-but-corrupt column is
  // surfaced as a present, invalid signature (the route's long-standing
  // try/catch semantics), conveyed to verify-core via `signatureMalformed`.
  let signature: VerifySignatureEnvelope | null = null;
  let signatureMalformed = false;
  if (record.basePackageSignature) {
    try {
      signature = JSON.parse(record.basePackageSignature) as VerifySignatureEnvelope;
    } catch {
      signatureMalformed = true;
    }
  }

  // Load the trust registry once (cached; falls back to the build-time embedded
  // copy) and resolve lifecycle at the server's chain depth.
  const [registry, lifecycleResolution] = await Promise.all([
    loadTrustRegistry(),
    resolveLifecycle(
      record,
      (pkgJson?.['signer'] as { identifier?: string } | undefined)?.identifier,
    ),
  ]);

  const result = await verifyEvidence(
    {
      package: pkgJson,
      packageHash: record.basePackageHash ?? '',
      signature,
      signatureMalformed,
      rfc3161Timestamp: record.basePackageRfc3161Timestamp,
      rekorEntryId: record.basePackageRekorEntryId,
      legacyExternalHash: record.basePackageHash ?? undefined,
    },
    { registry, fetch: globalThis.fetch, lifecycleResolution },
  );

  return NextResponse.json({
    hashMatch: result.hashMatch,
    signatureValid: result.signatureValid,
    rekorVerified: result.rekorVerified,
    hasTimestamp: result.hasTimestamp,
    keyTrust: result.keyTrust,
    blobRefsVerified: result.blobRefsVerified,
    blobRefs: result.blobRefs,
    // Canonicalization & content-hash checks (spec §9.2 checks #3-#4).
    contentCanonicalization: result.contentCanonicalization,
    contentHash: result.contentHash,
    // Typed-standards envelope checks (spec §9.2 checks #12-#15).
    nodeId: result.nodeId,
    typeResolution: result.typeResolution,
    signerIdentity: result.signerIdentity,
    captureMethodVocab: result.captureMethodVocab,
    // Lifecycle check (spec §9.2 check #10, §8.10) — attestation chain or
    // legacy-column fallback.
    lifecycle: result.lifecycle,
    details: {
      storedHash: record.basePackageHash,
      recomputedHash: result.recomputedHash,
      hasSigning: result.hasSigning,
      hasRekor: result.hasRekor,
      rekor: result.rekorDetails,
      kid: result.kid,
    },
  });
}
