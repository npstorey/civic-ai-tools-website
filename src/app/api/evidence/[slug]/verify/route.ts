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
  type KeyTrustResult,
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
  if (record.basePackageStorageKey) {
    const pkg = await getPackage(record.basePackageStorageKey);
    if (pkg) {
      recomputedHash = recomputePackageHash(pkg);
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

  // Step 4: Verify key trust against the platform trust registry.
  // Three paths:
  //   - Signature with a kid → registry lookup via `verifyKeyTrust`.
  //   - Signature without a kid (pre-#66 package) → `legacy_embedded`: the
  //     embedded public key verified the signature mathematically, but the
  //     registry cannot vouch for it. The UI renders this as neutral rather
  //     than failed so older packages aren't visually penalized.
  //   - No signature at all → keep `keyTrust: null`.
  let keyTrust: KeyTrustResult | null = null;
  if (sigPublicKey && sigKid) {
    const registry = await loadTrustRegistry();
    keyTrust = verifyKeyTrust(sigPublicKey, sigKid, rekorIntegratedTime, registry);
  } else if (sigPublicKey) {
    keyTrust = legacyEmbeddedKeyTrust();
  }

  return NextResponse.json({
    hashMatch,
    signatureValid,
    rekorVerified,
    hasTimestamp: !!record.basePackageRfc3161Timestamp,
    keyTrust,
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
