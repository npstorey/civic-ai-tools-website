import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { signPackage, getRfc3161Timestamp } from '@/lib/evidence/signing';

/**
 * POST /api/evidence/[slug]/reinstate
 *
 * Reinstates a withdrawn evidence record. Only the creator can reinstate their own
 * evidence. The reinstatement is a signed, timestamped action — the withdrawal record
 * is preserved for transparency, and both withdrawal + reinstatement appear in the
 * status history.
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

  // Only the creator can reinstate
  if (record.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the creator can reinstate evidence' }, { status: 403 });
  }

  // Must be currently withdrawn (withdrawn and not already reinstated)
  if (!record.withdrawnAt) {
    return NextResponse.json({ error: 'Evidence is not withdrawn' }, { status: 400 });
  }
  if (record.reinstatedAt) {
    return NextResponse.json({ error: 'Evidence has already been reinstated' }, { status: 400 });
  }

  const body = await request.json();
  const { reason } = body;
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json({ error: 'Reinstatement reason is required' }, { status: 400 });
  }

  const now = new Date();

  // Sign the reinstatement action — hash binds the reinstatement to the prior withdrawal
  const reinstatementContent = JSON.stringify({
    action: 'reinstate',
    slug,
    reason: reason.trim(),
    timestamp: now.toISOString(),
    evidencePackageHash: record.basePackageHash,
    priorWithdrawalSignature: record.withdrawalSignature,
  });
  const reinstatementHash = crypto.createHash('sha256').update(reinstatementContent).digest('hex');

  const signResult = signPackage(reinstatementHash);
  const rfc3161Token = await getRfc3161Timestamp(reinstatementHash).catch(() => null);

  await db
    .update(evidenceRecords)
    .set({
      reinstatedAt: now,
      reinstatedReason: reason.trim(),
      reinstatementSignature: signResult
        ? JSON.stringify({ hash: reinstatementHash, signature: signResult.signature, publicKey: signResult.publicKey, algorithm: signResult.algorithm })
        : null,
      reinstatementTimestamp: rfc3161Token,
      updatedAt: now,
    })
    .where(eq(evidenceRecords.id, record.id));

  return NextResponse.json({
    reinstated: true,
    reinstatedAt: now.toISOString(),
  });
}
