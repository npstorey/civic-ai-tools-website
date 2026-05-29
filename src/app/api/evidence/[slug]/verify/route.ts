import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import {
  verifySignature,
  verifyRekorEntry,
  recomputePackageHash,
  verifyKeyTrust,
  loadTrustRegistry,
  legacyEmbeddedKeyTrust,
  verifyPackageBlobRefs,
  resolvePackageType,
  checkSignerIdentity,
  checkCaptureMethodVocab,
  resolveContentCanonicalization,
  verifyContentHash,
  type KeyTrustResult,
  type BlobRefVerification,
  type TypeResolution,
  type SignerIdentityCheck,
  type CaptureMethodVocabCheck,
  type ContentCanonicalizationResolution,
  type ContentHashCheck,
} from '@/lib/evidence/verify';

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

  // Step 1: Recompute package hash from stored package
  let hashMatch = false;
  let recomputedHash: string | null = null;
  let pkgJson: Record<string, unknown> | null = null;
  if (record.basePackageStorageKey) {
    pkgJson = await getPackage(record.basePackageStorageKey);
    if (pkgJson) {
      recomputedHash = recomputePackageHash(pkgJson);
      hashMatch = recomputedHash === record.basePackageHash;
    }
  }

  // Step 2: Verify signature
  let signatureValid: boolean | null = null;
  let sigPublicKey: string | undefined;
  let sigKid: string | undefined;
  if (record.basePackageSignature && record.basePackageHash) {
    try {
      const sigData = JSON.parse(record.basePackageSignature);
      sigPublicKey = sigData.publicKey;
      sigKid = sigData.kid;
      signatureValid = verifySignature(
        record.basePackageHash,
        sigData.signature,
        sigData.publicKey,
      );
    } catch {
      signatureValid = false;
    }
  }

  // Step 3: Verify Rekor entry (also gives us integratedTime for key-trust)
  let rekorVerified: boolean | null = null;
  let rekorDetails: { logIndex?: number; logEntryUrl?: string } | null = null;
  let rekorIntegratedTime: number | undefined;
  if (record.basePackageRekorEntryId && record.basePackageHash) {
    const rekorResult = await verifyRekorEntry(
      record.basePackageRekorEntryId,
      record.basePackageHash,
    );
    rekorVerified = rekorResult.verified;
    rekorIntegratedTime = rekorResult.integratedTime;
    if (rekorResult.logIndex !== undefined) {
      rekorDetails = {
        logIndex: rekorResult.logIndex,
        logEntryUrl: rekorResult.logEntryUrl,
      };
    }
  }

  // Step 3b: Verify any blob references embedded in the package. `blobRefs`
  // is always an array — empty for pre-Phase-B.6 packages that store all
  // fields inline, populated with per-reference verdicts when the publisher
  // pushed content out of band via the upload-token flow. `blobRefsVerified`
  // summarises the array (true/false/null-for-no-refs) so clients that
  // don't care about per-ref granularity can branch on one boolean.
  let blobRefs: BlobRefVerification[] = [];
  let blobRefsVerified: boolean | null = null;
  if (pkgJson) {
    blobRefs = await verifyPackageBlobRefs(pkgJson);
    if (blobRefs.length > 0) {
      blobRefsVerified = blobRefs.every((r) => r.ok);
    }
  }

  // Step 4: Verify key trust against the platform trust registry.
  // Three paths:
  //   - Signature with a kid → registry lookup via `verifyKeyTrust`.
  //   - Signature without a kid (pre-#66 package) → `legacy_embedded`: the
  //     embedded public key verified the signature mathematically, but the
  //     registry cannot vouch for it. The UI renders this as neutral rather
  //     than failed so older packages aren't visually penalized.
  //   - No signature at all → keep `keyTrust: null`.
  // Load the trust registry once — used by both key-trust (step 4) and the
  // signer-identity cross-check (#14 below). Cached; falls back to the
  // build-time embedded copy.
  const registry = await loadTrustRegistry();

  let keyTrust: KeyTrustResult | null = null;
  if (sigPublicKey && sigKid) {
    keyTrust = verifyKeyTrust(sigPublicKey, sigKid, rekorIntegratedTime, registry);
  } else if (sigPublicKey) {
    keyTrust = legacyEmbeddedKeyTrust();
  }

  // Step 5: Canonicalization, content-hash, and typed-standards envelope
  // checks (spec §9.2). These run against the canonical package JSON when
  // available; each degrades gracefully for pre-v0.1 packages that omit the
  // corresponding field.
  //   #3  contentCanonicalization — known URI resolves; unknown renders as
  //                              unknown_canonicalization_rule; absent infers
  //                              the rule from the content profile
  //   #4  contentHash          — recompute off-log digest under the resolved
  //                              rule and confirm at least one algorithm
  //                              matches; pre-v0.1 relabels the slug hash
  //   #12 type resolution      — non-fatal (unknown_type renders, doesn't fail)
  //   #13 nodeId               — the recomputed envelope hash; dual-chain via
  //                              recomputePackageHash (JCS for v0.1 packages,
  //                              legacy JSON.stringify for pre-v0.1)
  //   #14 signer ↔ registry    — fatal on mismatch; skipped when no signer
  //   #15 captureMethod vocab  — captureMethod_unknown rejects; bundle-
  //                              unresolved degrades gracefully
  let contentCanonicalization: ContentCanonicalizationResolution | null = null;
  let contentHashCheck: ContentHashCheck | null = null;
  let typeResolution: TypeResolution | null = null;
  let signerIdentity: SignerIdentityCheck | null = null;
  let captureMethodVocab: CaptureMethodVocabCheck | null = null;
  if (pkgJson) {
    contentCanonicalization = resolveContentCanonicalization(pkgJson);
    // The legacy external single-SHA-256 (relabeled for pre-v0.1 packages) is
    // the package's stored slug hash — pass it so check #4 can surface it.
    contentHashCheck = verifyContentHash(
      pkgJson,
      contentCanonicalization,
      record.basePackageHash ?? undefined,
    );
    typeResolution = resolvePackageType(pkgJson);
    signerIdentity = checkSignerIdentity(pkgJson, sigKid, registry);
    captureMethodVocab = checkCaptureMethodVocab(pkgJson);
  }

  return NextResponse.json({
    hashMatch,
    signatureValid,
    rekorVerified,
    hasTimestamp: !!record.basePackageRfc3161Timestamp,
    keyTrust,
    blobRefsVerified,
    blobRefs,
    // Canonicalization & content-hash checks (spec §9.2 checks #3-#4).
    contentCanonicalization,
    contentHash: contentHashCheck,
    // Typed-standards envelope checks (spec §9.2 checks #12-#15).
    nodeId: recomputedHash,
    typeResolution,
    signerIdentity,
    captureMethodVocab,
    details: {
      storedHash: record.basePackageHash,
      recomputedHash,
      hasSigning: !!record.basePackageSignature,
      hasRekor: !!record.basePackageRekorEntryId,
      rekor: rekorDetails,
      kid: sigKid,
    },
  });
}
