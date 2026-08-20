import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deviceCodes } from '@/lib/db/schema';
import {
  DEVICE_CODE_LIFETIME_SECONDS,
  DEVICE_CODE_POLL_INTERVAL_SECONDS,
  buildVerificationUri,
  buildVerificationUriComplete,
  generateDeviceCode,
  generateUserCode,
  getBaseUrl,
} from '@/lib/device-flow';
import {
  ACCEPTED_PUBLISH_SCOPES,
  isAcceptedMintScope,
  resolveMintScope,
} from '@/lib/publish-scope';

/**
 * Device authorization grant start (RFC 8628 §3.1).
 *
 * A client posts `{ name, scope }` and receives a device_code,
 * user_code, and the verification URL to display to the user. The
 * client then polls /api/auth/device/token with the device_code until
 * the user approves the flow in a browser.
 *
 * SCOPE, under two names (civic-ai-tools#160 P3). The 2026-08-19 vocabulary
 * settlement renames the publish scope `evidence:publish` → `records:publish`
 * as an alias-and-deprecate: BOTH are accepted here, an omitted scope now
 * takes the canonical `records:publish`, and an explicitly requested scope is
 * granted VERBATIM. Verbatim matters — this endpoint and the token endpoint
 * echo the granted scope back, and RFC 8628 clients compare that against what
 * they asked for. Silently upgrading a client's string would fail that
 * comparison for a client that did nothing wrong. Enforcement treats the two
 * as one authorization (`hasPublishScope`), so which string a token ends up
 * carrying never changes what it can do.
 */

interface DeviceCodeRequest {
  name?: string;
  scope?: string;
}

const ALLOWED_SCOPES = new Set(ACCEPTED_PUBLISH_SCOPES);
const MAX_NAME_LENGTH = 80;
const MAX_USER_CODE_COLLISION_RETRIES = 5;

export async function POST(request: NextRequest) {
  let body: DeviceCodeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const scope = resolveMintScope(body.scope);
  if (!isAcceptedMintScope(scope)) {
    return NextResponse.json(
      {
        error: 'invalid_scope',
        error_description:
          `Unknown scope: ${scope}. Accepted: ${[...ALLOWED_SCOPES].join(', ')}`,
      },
      { status: 400 },
    );
  }

  const rawName = (body.name ?? '').trim();
  if (!rawName) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: '`name` is required' },
      { status: 400 },
    );
  }
  const clientName = rawName.slice(0, MAX_NAME_LENGTH);

  const deviceCode = generateDeviceCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_LIFETIME_SECONDS * 1000);

  // Retry on the extraordinarily unlikely event of a user_code collision.
  // Unique constraint makes this safe; we just want a nicer error than
  // 500 if it does happen.
  let userCode = '';
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_USER_CODE_COLLISION_RETRIES; attempt++) {
    userCode = generateUserCode();
    try {
      await db.insert(deviceCodes).values({
        deviceCode,
        userCode,
        clientName,
        scope,
        expiresAt,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    console.error('[api/auth/device/code] insert failed after retries', lastError);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Could not allocate device code' },
      { status: 500 },
    );
  }

  const baseUrl = getBaseUrl(request);
  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: buildVerificationUri(baseUrl),
    verification_uri_complete: buildVerificationUriComplete(baseUrl, userCode),
    expires_in: DEVICE_CODE_LIFETIME_SECONDS,
    interval: DEVICE_CODE_POLL_INTERVAL_SECONDS,
    scope,
  });
}
