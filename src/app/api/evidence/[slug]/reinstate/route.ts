import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords, attestationNodes, users } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { putPackage } from '@/lib/storage';
import {
  signPackage,
  getRfc3161Timestamp,
  publishToRekor,
  getActiveSigner,
} from '@/lib/evidence/signing';
import {
  buildAttestationNode,
  ATTESTATION_REINSTATES,
  ATTESTATION_WITHDRAWS,
} from '@/lib/evidence/attestation';
import { evaluateSealCommitGate } from '@/lib/evidence/unsigned-tier';

/**
 * POST /api/evidence/[slug]/reinstate
 *
 * Reinstates a withdrawn evidence record (spec §8.10, ADR-0010; PR3).
 *
 * When the prior withdrawal was itself a signed `attestation/withdraws/v1` node
 * (the post-PR3 path), the reinstatement is a signed `attestation/reinstates/v1`
 * node referencing the target by `targetNodeId` and the prior withdrawal by
 * `priorWithdrawalNodeId`; the legacy `reinstated_at` column is also written as
 * the status mirror.
 *
 * When the prior withdrawal was a pre-PR3 legacy column (no attestation node to
 * reference), the reinstatement stays column-only — keeping that record's
 * lifecycle in a single representation so the dual-read (verify check #10 /
 * detail page) shows its full history from the legacy columns rather than a
 * partial chain.
 *
 * Authorization is publisher-only (parity with pre-PR3). Body: { reason: string }
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

  // Same gate as withdraw: a reinstatement is a separately-signed attestation
  // node, so it must not be emitted by an instance that has no key id to put
  // in it (see unsigned-tier.ts).
  const gate = evaluateSealCommitGate();
  if (gate) {
    return NextResponse.json(gate.body, { status: gate.status });
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

  // Fetch evidence record
  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  const record = records[0];

  // Publisher-only: only the creator can reinstate (§8.12.3 authorization rule).
  if (record.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the creator can reinstate a record' }, { status: 403 });
  }

  // Single-cycle parity: must be currently withdrawn and not already reinstated.
  if (!record.withdrawnAt) {
    return NextResponse.json({ error: 'Record is not withdrawn' }, { status: 400 });
  }
  if (record.reinstatedAt) {
    return NextResponse.json({ error: 'Record has already been reinstated' }, { status: 400 });
  }

  const body = await request.json();
  const { reason } = body;
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json({ error: 'Reinstatement reason is required' }, { status: 400 });
  }
  const now = new Date();

  // Find the prior withdrawal ATTESTATION node, if the withdrawal went through
  // the post-PR3 path. Its presence decides whether this reinstatement is an
  // attestation node or a legacy column-only update.
  const priorWithdrawals = record.basePackageHash
    ? await db
        .select({ nodeId: attestationNodes.nodeId })
        .from(attestationNodes)
        .where(
          and(
            eq(attestationNodes.targetNodeId, record.basePackageHash),
            eq(attestationNodes.type, ATTESTATION_WITHDRAWS),
          ),
        )
        .orderBy(desc(attestationNodes.createdAt))
        .limit(1)
    : [];
  const priorWithdrawalNodeId = priorWithdrawals[0]?.nodeId;

  let attestationNodeId: string | null = null;

  if (priorWithdrawalNodeId && record.basePackageHash) {
    // Post-PR3 path: emit a signed attestation/reinstates/v1 node referencing
    // the target and the prior withdrawal node (§8.12.1).
    const { node, nodeId } = buildAttestationNode({
      type: ATTESTATION_REINSTATES,
      targetNodeId: record.basePackageHash,
      signer: getActiveSigner(),
      reason: reason.trim(),
      priorWithdrawalNodeId,
    });
    attestationNodeId = nodeId;

    const signResult = signPackage(nodeId);
    const [rfc3161Token, rekorResult] = await Promise.all([
      getRfc3161Timestamp(nodeId).catch(() => null),
      signResult
        ? publishToRekor(nodeId, signResult.signature, signResult.publicKey).catch(() => null)
        : Promise.resolve(null),
    ]);

    const blobUrl = await putPackage(nodeId, node as unknown as Record<string, unknown>);
    const signatureJson = signResult
      ? JSON.stringify({
          nodeId,
          signature: signResult.signature,
          publicKey: signResult.publicKey,
          algorithm: signResult.algorithm,
          kid: signResult.kid,
        })
      : null;

    await db.insert(attestationNodes).values({
      nodeId,
      targetNodeId: record.basePackageHash,
      type: ATTESTATION_REINSTATES,
      storageKey: blobUrl,
      signature: signatureJson,
      rfc3161Timestamp: rfc3161Token,
      rekorEntryId: rekorResult?.entryId || null,
      rekorInclusionProof: rekorResult?.inclusionProof || null,
      signer: node.signer,
      payload: { reason: reason.trim(), priorWithdrawalNodeId },
      creatorId: userId,
    });

    await db
      .update(evidenceRecords)
      .set({
        reinstatedAt: now,
        reinstatedReason: reason.trim(),
        reinstatementSignature: signatureJson,
        reinstatementTimestamp: rfc3161Token,
        updatedAt: now,
      })
      .where(eq(evidenceRecords.id, record.id));
  } else {
    // Legacy bridge: the withdrawal predates PR3 (column-only, no node to
    // reference). Keep the reinstatement column-only so this record's lifecycle
    // stays in one representation; the dual-read reads its full history from the
    // legacy columns.
    await db
      .update(evidenceRecords)
      .set({
        reinstatedAt: now,
        reinstatedReason: reason.trim(),
        updatedAt: now,
      })
      .where(eq(evidenceRecords.id, record.id));
  }

  return NextResponse.json({
    reinstated: true,
    reinstatedAt: now.toISOString(),
    attestationNodeId,
  });
}
