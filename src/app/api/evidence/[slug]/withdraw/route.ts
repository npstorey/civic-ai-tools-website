import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords, attestationNodes, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { putPackage } from '@/lib/storage';
import {
  signPackage,
  getRfc3161Timestamp,
  publishToRekor,
  getActiveSigner,
} from '@/lib/evidence/signing';
import { buildAttestationNode, ATTESTATION_WITHDRAWS } from '@/lib/evidence/attestation';
import { evaluateSealCommitGate } from '@/lib/evidence/unsigned-tier';

/**
 * POST /api/evidence/[slug]/withdraw
 *
 * Withdraws an evidence record (spec §8.10, ADR-0010; PR3). The withdrawal is a
 * separately-signed `attestation/withdraws/v1` node — its own nodeId (envelope
 * hash), signature, RFC 3161 timestamp, and Rekor inclusion — referencing the
 * content node by `targetNodeId`. The content node's own signature is untouched.
 *
 * The legacy `withdrawn_at` / `withdrawn_reason` columns are ALSO written as a
 * denormalized status mirror so the simple list / dashboard / index consumers
 * (which filter + render on those columns) keep working unchanged. The signed
 * attestation node is the canonical, conformant representation; verify check #10
 * and the detail page read the chain first and fall back to the columns only for
 * pre-PR3 records (§8.10.4 dual-read).
 *
 * Authorization is publisher-only: only the content node's creator may withdraw
 * it (parity with the pre-PR3 behavior). The platform key signs the attestation
 * on the author's behalf (§8.5), so its `signer` matches the content node's.
 *
 * Body: { reason: string }
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

  // A withdrawal is a separately-signed node, so it reaches the same signing
  // path as a content publish and takes the same gate: an instance that
  // cannot sign honestly (no key, or a key with no declared EVIDENCE_KEY_ID)
  // is refused specifically here rather than emitting an attestation labeled
  // with a key id it never configured.
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
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }
  const record = records[0];

  // Publisher-only: only the creator can withdraw (§8.12.3 authorization rule).
  if (record.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the creator can withdraw evidence' }, { status: 403 });
  }

  // Single-cycle parity: reject if already withdrawn. The current status is read
  // from the legacy column mirror, which the dual-write keeps in sync with the
  // attestation chain.
  if (record.withdrawnAt) {
    return NextResponse.json({ error: 'Evidence is already withdrawn' }, { status: 400 });
  }

  // An attestation MUST reference a content node by nodeId (§8.12.3). Published
  // records always carry one; refuse otherwise rather than emit a non-conformant
  // node.
  if (!record.basePackageHash) {
    return NextResponse.json(
      { error: 'Cannot withdraw: record has no content node hash to reference' },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { reason } = body;
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json({ error: 'Withdrawal reason is required' }, { status: 400 });
  }

  // Build the signed attestation/withdraws/v1 node. nodeId = envelope hash via
  // the shared PR2 canonicalization (RFC 8785 JCS).
  const { node, nodeId } = buildAttestationNode({
    type: ATTESTATION_WITHDRAWS,
    targetNodeId: record.basePackageHash,
    signer: getActiveSigner(),
    reason: reason.trim(),
  });

  // Sign + timestamp + Rekor over the nodeId, exactly like a content package.
  const signResult = signPackage(nodeId);
  const [rfc3161Token, rekorResult] = await Promise.all([
    getRfc3161Timestamp(nodeId).catch(() => null),
    signResult
      ? publishToRekor(nodeId, signResult.signature, signResult.publicKey).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Persist the canonical attestation node FIRST (blob + DB row), so a later
  // column-mirror failure can't lose the signed artifact.
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
    type: ATTESTATION_WITHDRAWS,
    storageKey: blobUrl,
    signature: signatureJson,
    rfc3161Timestamp: rfc3161Token,
    rekorEntryId: rekorResult?.entryId || null,
    rekorInclusionProof: rekorResult?.inclusionProof || null,
    signer: node.signer,
    payload: { reason: reason.trim(), effectiveAt: node.effectiveAt },
    creatorId: userId,
  });

  // Dual-write the legacy column mirror (keeps list/dashboard/index working).
  const now = new Date();
  await db
    .update(evidenceRecords)
    .set({
      withdrawnAt: now,
      withdrawnReason: reason.trim(),
      withdrawalSignature: signatureJson,
      withdrawalTimestamp: rfc3161Token,
      updatedAt: now,
    })
    .where(eq(evidenceRecords.id, record.id));

  return NextResponse.json({
    withdrawn: true,
    withdrawnAt: now.toISOString(),
    attestationNodeId: nodeId,
  });
}
