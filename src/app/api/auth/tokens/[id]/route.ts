import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, eq, isNull } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiTokens, users } from '@/lib/db/schema';
import { isSameOrigin } from '@/lib/api-auth';

/**
 * DELETE /api/auth/tokens/:id — revoke a token the caller owns.
 *
 * Session-authed only. Ownership is enforced by the WHERE clause so a
 * caller can't revoke another user's token.
 */

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden (cross-origin)' }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Missing token id' }, { status: 400 });
  }

  const githubId = session.user.id;
  const dbUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  if (dbUser.length === 0) {
    return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
  }

  const result = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.userId, dbUser[0].id),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });

  if (result.length === 0) {
    return NextResponse.json(
      { error: 'Token not found or already revoked' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: result[0].id });
}
