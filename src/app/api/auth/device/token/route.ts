import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiTokens, deviceCodes } from '@/lib/db/schema';
import { mintRawToken } from '@/lib/api-auth';
import {
  API_TOKEN_LIFETIME_SECONDS,
  DEVICE_CODE_POLL_INTERVAL_SECONDS,
  DEVICE_CODE_SLOW_DOWN_INCREMENT_SECONDS,
} from '@/lib/device-flow';

/**
 * Device authorization grant polling endpoint (RFC 8628 §3.4).
 *
 * Clients POST `{ device_code }` at the interval returned from
 * /api/auth/device/code. Responses:
 *
 *   - 400 `authorization_pending` — user hasn't approved yet, keep polling
 *   - 400 `slow_down` — client is polling too fast, add 5s to interval
 *   - 400 `expired_token` — device_code has aged out (>15 min)
 *   - 400 `access_denied` — code was denied (no DB row for this)
 *   - 400 `invalid_grant` — unknown or already-consumed code
 *   - 200 `{ access_token, token_type, expires_at, scope }` — approved
 */

interface TokenRequest {
  device_code?: string;
}

export async function POST(request: NextRequest) {
  let body: TokenRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const deviceCode = (body.device_code ?? '').trim();
  if (!deviceCode) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: '`device_code` is required' },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCode, deviceCode))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }
  const row = rows[0];

  // Polling too fast — enforce the minimum interval from RFC 8628.
  const now = new Date();
  const lastPolled = row.lastPolledAt?.getTime() ?? 0;
  if (
    lastPolled &&
    now.getTime() - lastPolled < DEVICE_CODE_POLL_INTERVAL_SECONDS * 1000
  ) {
    await db
      .update(deviceCodes)
      .set({ lastPolledAt: now })
      .where(eq(deviceCodes.id, row.id));
    return NextResponse.json(
      {
        error: 'slow_down',
        error_description: `Poll no faster than every ${DEVICE_CODE_POLL_INTERVAL_SECONDS + DEVICE_CODE_SLOW_DOWN_INCREMENT_SECONDS}s`,
      },
      { status: 400 },
    );
  }

  // Record this poll for the next round's rate check.
  await db
    .update(deviceCodes)
    .set({ lastPolledAt: now })
    .where(eq(deviceCodes.id, row.id));

  if (row.consumedAt) {
    return NextResponse.json(
      {
        error: 'invalid_grant',
        error_description: 'Device code already exchanged for a token',
      },
      { status: 400 },
    );
  }

  if (row.expiresAt.getTime() <= now.getTime()) {
    return NextResponse.json({ error: 'expired_token' }, { status: 400 });
  }

  if (!row.approvedUserId || !row.approvedAt) {
    return NextResponse.json({ error: 'authorization_pending' }, { status: 400 });
  }

  // Approved — mint the bearer token and consume the device code.
  const { raw, hash, prefix } = mintRawToken();
  const tokenExpiresAt = new Date(Date.now() + API_TOKEN_LIFETIME_SECONDS * 1000);
  await db.insert(apiTokens).values({
    userId: row.approvedUserId,
    tokenHash: hash,
    tokenPrefix: prefix,
    name: row.clientName,
    scope: row.scope,
    expiresAt: tokenExpiresAt,
  });
  await db
    .update(deviceCodes)
    .set({ consumedAt: now })
    .where(eq(deviceCodes.id, row.id));

  return NextResponse.json({
    access_token: raw,
    token_type: 'Bearer',
    expires_at: tokenExpiresAt.toISOString(),
    expires_in: API_TOKEN_LIFETIME_SECONDS,
    scope: row.scope,
  });
}
