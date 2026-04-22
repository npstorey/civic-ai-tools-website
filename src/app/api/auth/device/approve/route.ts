import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { deviceCodes, users } from '@/lib/db/schema';
import { normalizeUserCode } from '@/lib/device-flow';

/**
 * User-facing approval endpoint. Called from /auth/device when the
 * signed-in user clicks "Allow". Requires a NextAuth session cookie
 * (never a bearer token — you can't approve your own token mint).
 *
 * Same-origin-only: checks the Origin header matches the deployment's
 * base URL so a cross-site POST (with user's cookie) can't auto-approve
 * an attacker-controlled device code.
 */

interface ApproveRequest {
  user_code?: string;
  decision?: 'approve' | 'deny';
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const expected = process.env.NEXTAUTH_URL;
  if (!expected) {
    // Dev fallback: allow the request's own host.
    const host = request.headers.get('host');
    return !!host && origin.endsWith(host);
  }
  return origin === expected.replace(/\/+$/, '');
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden (cross-origin)' }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: ApproveRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userCode = normalizeUserCode(body.user_code ?? '');
  if (!userCode) {
    return NextResponse.json(
      { error: 'Enter an 8-character code (e.g. ABCD-EFGH)' },
      { status: 400 },
    );
  }

  const decision = body.decision === 'deny' ? 'deny' : 'approve';

  const rows = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, userCode))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'That code is not valid. Ask the client to start over.' },
      { status: 404 },
    );
  }
  const row = rows[0];

  if (row.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'That code has expired. Ask the client to start over.' },
      { status: 410 },
    );
  }
  if (row.approvedAt || row.consumedAt) {
    return NextResponse.json(
      { error: 'That code has already been used.' },
      { status: 409 },
    );
  }

  if (decision === 'deny') {
    // Mark the row expired so the polling client sees `expired_token`
    // rather than `authorization_pending` forever. We don't store a
    // distinct "denied" state today — the signal to the client is the
    // same: try again.
    await db
      .update(deviceCodes)
      .set({ expiresAt: new Date() })
      .where(eq(deviceCodes.id, row.id));
    return NextResponse.json({ ok: true, decision: 'deny' });
  }

  // Approve. Look up the DB user ID from the GitHub ID in the session.
  const githubId = session.user.id;
  const dbUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  if (dbUser.length === 0) {
    return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
  }
  await db
    .update(deviceCodes)
    .set({ approvedUserId: dbUser[0].id, approvedAt: new Date() })
    .where(eq(deviceCodes.id, row.id));

  return NextResponse.json({
    ok: true,
    decision: 'approve',
    clientName: row.clientName,
    scope: row.scope,
  });
}
