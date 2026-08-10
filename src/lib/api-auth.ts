import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiTokens, users } from '@/lib/db/schema';
import { isTrustedRequestOrigin } from '@/lib/allowed-origins';

/**
 * Auth resolution for write endpoints (POST /api/evidence,
 * POST /api/blob/upload-token, etc.).
 *
 * Supports two paths:
 *  - `Authorization: Bearer evpub_...` — device-flow-minted token
 *    (website#73 / RFC 8628). Preferred for programmatic clients.
 *  - NextAuth session cookie — original path, kept working indefinitely
 *    for browser flows and one-off curls. Responses from cookie-authed
 *    writes carry `X-Auth-Deprecated: cookie` as a gentle nudge.
 */

const TOKEN_PREFIX = 'evpub_';
const TOKEN_RANDOM_BYTES = 24; // 24 bytes → 32 base64url chars → ~192 bits
const TOKEN_PREFIX_LENGTH = 12; // "evpub_" + 6 random chars, stored for UI

const LAST_USED_UPDATE_THROTTLE_MS = 60_000;

export type AuthMethod = 'cookie' | 'bearer';

export interface AuthResult {
  /** Internal DB user ID (not GitHub ID). */
  userId: string;
  method: AuthMethod;
  /** Scopes the caller holds. Cookie auth returns `['*']` (unscoped). */
  scopes: string[];
  /** `api_tokens.id` — only set for bearer auth. */
  tokenId?: string;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * RFC 4648 §5 base64url, no padding. Used for opaque random tokens.
 */
function base64UrlRandom(bytes: number): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function mintRawToken(): { raw: string; hash: string; prefix: string } {
  const raw = TOKEN_PREFIX + base64UrlRandom(TOKEN_RANDOM_BYTES);
  return {
    raw,
    hash: sha256Hex(raw),
    prefix: raw.slice(0, TOKEN_PREFIX_LENGTH),
  };
}

/**
 * Checks a required scope against an auth result. Cookie auth holds `*`
 * (browser flows are already gated by NextAuth + user session, not by
 * scope). Bearer tokens carry an explicit scope assigned at mint time.
 */
export function hasScope(auth: AuthResult, required: string): boolean {
  return auth.scopes.includes('*') || auth.scopes.includes(required);
}

/**
 * Same-origin check for state-changing user actions (device approve,
 * token revoke). A thin adapter over the topology-aware predicate in
 * `allowed-origins.ts` (#213): the request's Origin must name one of the
 * INSTANCE'S OWN origins — `NEXTAUTH_URL` plus, on a split topology, the
 * app and marketing origins. Before #213 only `NEXTAUTH_URL` matched, so
 * with `NEXTAUTH_URL` on the marketing host every device-approve and
 * token-revoke POST from the app host 403'd. With topology unset the set
 * is exactly `{NEXTAUTH_URL}` — the pre-#213 behavior.
 *
 * Matching is www-insensitive (the production deployment 307-redirects
 * apex → www for GET, so browsers send the www form even when the
 * configured value is the apex), scheme- and port-sensitive, and always
 * exact — see the predicate module for the full rules.
 *
 * Returns false for cross-origin POSTs and for requests with no Origin
 * header (e.g. plain curl without `-H Origin`) — callers who want to
 * support those paths should use bearer tokens, which skip this check.
 */
export function isSameOrigin(request: NextRequest): boolean {
  return isTrustedRequestOrigin(
    request.headers.get('origin'),
    request.headers.get('host'),
    process.env,
  );
}

async function resolveBearer(raw: string): Promise<AuthResult | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const hash = sha256Hex(raw);
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);
  if (rows.length === 0) return null;
  const token = rows[0];
  if (token.revokedAt) return null;
  if (token.expiresAt.getTime() <= Date.now()) return null;

  // Fire-and-forget last_used_at update, throttled so we don't write on
  // every request. Errors are swallowed — auth succeeds either way.
  const lastUsed = token.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsed > LAST_USED_UPDATE_THROTTLE_MS) {
    void db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, token.id))
      .catch(() => {});
  }

  return {
    userId: token.userId,
    method: 'bearer',
    scopes: [token.scope],
    tokenId: token.id,
  };
}

async function resolveCookie(): Promise<AuthResult | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const githubId = session.user.id;
  const dbUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  if (dbUser.length === 0) return null;
  return { userId: dbUser[0].id, method: 'cookie', scopes: ['*'] };
}

/**
 * Resolves the caller's user ID and auth method. Returns `null` if
 * neither a valid bearer token nor a valid session is present.
 */
export async function resolveRequestUser(
  request: NextRequest,
): Promise<AuthResult | null> {
  const header = request.headers.get('authorization');
  if (header) {
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (match) {
      const bearer = await resolveBearer(match[1]);
      if (bearer) return bearer;
      // A bearer header was present but invalid — don't silently fall
      // through to cookie auth, since the caller clearly intended bearer.
      return null;
    }
  }
  return resolveCookie();
}
