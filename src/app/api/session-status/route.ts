import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import {
  isConfiguredMarketingOrigin,
  resolveMarketingCorsOrigin,
} from '@/lib/allowed-origins';

/**
 * GET /api/session-status — does this browser hold a session? (s6 P3, Q64)
 *
 * A BOOLEAN, NOTHING ELSE. The body is `{"signedIn":true|false}` — never
 * user data, never session details (charter rule, #229 G0). The session
 * cookie exists only on the app host, so this route answers there; the
 * marketing host's header probes it cross-origin to swap "Sign in" for
 * "Open app →" when the visitor already has a session.
 *
 * Reads the session with `getToken` (next-auth/jwt), not
 * `getServerSession`: a pure cookie decode — no session callbacks run, no
 * user object is materialized, no database is touched, and nothing can
 * emit a Set-Cookie. Any decode failure (no cookie, bad cookie, missing
 * NEXTAUTH_SECRET) is simply `false`, never a 5xx.
 *
 * CORS — exact-origin echo, one origin, or nothing:
 * - The request Origin is echoed ONLY when the shared predicate accepts it
 *   as the instance's configured marketing origin
 *   (`isConfiguredMarketingOrigin`, www-insensitive), together with
 *   `Access-Control-Allow-Credentials: true`. Never a wildcard — a
 *   wildcard cannot carry cookies, and the allow-list is one origin by
 *   design.
 * - `Vary: Origin` whenever a marketing origin is configured (response
 *   headers then depend on the Origin header — on matches AND misses).
 * - The boolean is never cacheable: `Cache-Control: no-store`.
 * - RULE ZERO: when topology names no marketing origin (unset topology, a
 *   single-host instance, app-only), the route is INERT — no CORS header,
 *   no Vary, on any request. A direct same-origin hit still gets an honest
 *   `200 {"signedIn":…}`: same-origin callers can already read the full
 *   session from NextAuth's own `/api/auth/session`, so the boolean is a
 *   strict subset of existing surface, and cross-origin readers are
 *   blocked by the browser precisely because no CORS grant exists.
 */

// The boolean depends on the request's cookie — never prerender or cache.
export const dynamic = 'force-dynamic';

/**
 * CORS headers for one request: empty when the route is inert; `Vary`
 * when a marketing origin is configured; the exact-origin echo pair only
 * when the request Origin IS that marketing origin. The literal header
 * value is echoed (under `Vary: Origin`) so the www and apex forms both
 * satisfy the browser's exact-match check.
 */
function corsHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  if (resolveMarketingCorsOrigin(process.env) === null) return headers;
  headers.set('Vary', 'Origin');
  const origin = request.headers.get('origin');
  if (origin !== null && isConfiguredMarketingOrigin(origin, process.env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request);
  headers.set('Cache-Control', 'no-store');

  let signedIn = false;
  try {
    signedIn = (await getToken({ req: request })) !== null;
  } catch {
    // Undecodable cookie or missing secret — an instance without working
    // sessions has no signed-in browsers to report.
    signedIn = false;
  }

  return NextResponse.json({ signedIn }, { headers });
}

/**
 * Preflight. A credentialed GET with no custom headers is a simple
 * request, so browsers normally skip this — but the contract is complete
 * anyway: allowed origin gets the echo plus methods; anything else gets a
 * bare 204 with no CORS grant. The preflight result (unlike the boolean)
 * may be cached briefly.
 */
export async function OPTIONS(request: NextRequest) {
  const headers = corsHeaders(request);
  if (headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new NextResponse(null, { status: 204, headers });
}
