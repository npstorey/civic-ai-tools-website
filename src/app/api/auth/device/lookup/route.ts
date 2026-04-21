import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { deviceCodes } from '@/lib/db/schema';
import { normalizeUserCode } from '@/lib/device-flow';

/**
 * Lookup a device code by user_code so the /auth/device page can show
 * "You're about to authorize `<client name>` with scope `<scope>`" before
 * the user clicks Approve. Session-authed; returns only display-safe
 * fields.
 */

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const userCodeParam = request.nextUrl.searchParams.get('user_code') ?? '';
  const userCode = normalizeUserCode(userCodeParam);
  if (!userCode) {
    return NextResponse.json(
      { error: 'Enter an 8-character code (e.g. ABCD-EFGH)' },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      clientName: deviceCodes.clientName,
      scope: deviceCodes.scope,
      approvedAt: deviceCodes.approvedAt,
      consumedAt: deviceCodes.consumedAt,
      expiresAt: deviceCodes.expiresAt,
    })
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, userCode))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const row = rows[0];
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  if (row.consumedAt || row.approvedAt) {
    return NextResponse.json({ error: 'already_used' }, { status: 409 });
  }
  return NextResponse.json({
    userCode,
    clientName: row.clientName,
    scope: row.scope,
    expiresAt: row.expiresAt.toISOString(),
  });
}
