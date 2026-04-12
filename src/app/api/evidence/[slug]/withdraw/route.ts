import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { signPackage, getRfc3161Timestamp } from '@/lib/evidence/signing';

/**
 * POST /api/evidence/[slug]/withdraw
 *
 * Withdraws an evidence record. Only the creator can withdraw their own evidence.
 * The withdrawal is a signed, timestamped action — the record and its cryptographic
 * proofs remain accessible but are flagged as withdrawn.
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

  // Only the creator can withdraw
  if (record.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the creator can withdraw evidence' }, { status: 403 });
  }

  // Already withdrawn
  if (record.withdrawnAt) {
    return NextResponse.json({ error: 'Evidence is already withdrawn' }, { status: 400 });
  }

  const body = await request.json();
  const { reason } = body;
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json({ error: 'Withdrawal reason is required' }, { status: 400 });
  }

  const now = new Date();

  // Sign the withdrawal action: hash of slug + reason + timestamp
  const withdrawalContent = JSON.stringify({
    action: 'withdraw',
    slug,
    reason: reason.trim(),
    timestamp: now.toISOString(),
    evidencePackageHash: record.basePackageHash,
  });
  const withdrawalHash = crypto.createHash('sha256').update(withdrawalContent).digest('hex');

  const signResult = signPackage(withdrawalHash);
  const rfc3161Token = await getRfc3161Timestamp(withdrawalHash).catch(() => null);

  // Update the record
  await db
    .update(evidenceRecords)
    .set({
      withdrawnAt: now,
      withdrawnReason: reason.trim(),
      withdrawalSignature: signResult
        ? JSON.stringify({ hash: withdrawalHash, signature: signResult.signature, publicKey: signResult.publicKey, algorithm: signResult.algorithm })
        : null,
      withdrawalTimestamp: rfc3161Token,
      updatedAt: now,
    })
    .where(eq(evidenceRecords.id, record.id));

  return NextResponse.json({
    withdrawn: true,
    withdrawnAt: now.toISOString(),
  });
}
