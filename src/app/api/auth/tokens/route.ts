import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiTokens, users } from '@/lib/db/schema';

/**
 * GET /api/auth/tokens — list the caller's active tokens.
 *
 * Session-authed only (no self-listing via bearer — prevents a stolen
 * token from enumerating siblings). Returns display-safe fields only;
 * the raw token is never stored server-side, so it can't be surfaced
 * here.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
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

  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      scope: apiTokens.scope,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(
      and(eq(apiTokens.userId, dbUser[0].id), isNull(apiTokens.revokedAt)),
    )
    .orderBy(desc(apiTokens.createdAt));

  return NextResponse.json({
    tokens: rows.map((r) => ({
      id: r.id,
      name: r.name,
      tokenPrefix: r.tokenPrefix,
      scope: r.scope,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    })),
  });
}
