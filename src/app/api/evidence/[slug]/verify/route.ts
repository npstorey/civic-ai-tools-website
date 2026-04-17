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
  // Packages signed before #66 shipped won't have a `kid` stored alongside
  // the signature. The P5 plan resets evidence state before publishing any
  // real packages, so a missing kid is an unsigned / pre-registry package
  // and we surface `registry_unavailable` to make that explicit.
  let keyTrust: KeyTrustResult | null = null;
  let registryPublicKeyForKid: string | undefined;
  if (sigPublicKey && sigKid) {
    const registry = await loadTrustRegistry();
    keyTrust = verifyKeyTrust(sigPublicKey, sigKid, rekorIntegratedTime, registry);
    // Diagnostic: when the registry has an entry with the same kid but a
    // different public key, surface that key so a mismatch (usually a
    // rotation-sync bug between EVIDENCE_SIGNING_KEY and the registry
    // file) can be diagnosed from the verify response.
    if (registry) {
      const entry = registry.keys.find((k) => k.kid === sigKid);
      registryPublicKeyForKid = entry?.publicKey;
    }
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
      // Diagnostic: both publicKeys (base64 SPKI DER) for easy diff when
      // `keyTrust.status === 'unknown_key'`. Public keys are non-sensitive.
      signaturePublicKey: sigPublicKey,
      registryPublicKey: registryPublicKeyForKid,
    },
  });
}
