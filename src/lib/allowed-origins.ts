// Topology-aware allowed-origin predicate (s6 P3, #229 — #213 + Q64).
//
// THE QUESTION THIS MODULE ANSWERS: "is this request's Origin one of this
// instance's own origins?" — derived entirely from the same environment
// variables the rest of the host-topology seam reads (`NEXTAUTH_URL`,
// `APP_HOST`, `MARKETING_HOST`, `APP_ONLY`), never from request state, so
// the answer is identical on every host and every render.
//
// Two consumers, two DIFFERENT origin sets, on purpose:
//
//   - `isTrustedRequestOrigin` — the same-origin gate for state-changing
//     user actions (`api-auth.ts` `isSameOrigin`). Its set is EVERY origin
//     the instance owns: `NEXTAUTH_URL` plus, on a split topology, the app
//     and marketing origins. Before #213 the gate compared only against
//     `NEXTAUTH_URL`, so on a split host where `NEXTAUTH_URL` stays on the
//     marketing host, device-approve and token-revoke POSTs from the app
//     host 403'd. With topology unset the set is exactly `{NEXTAUTH_URL}`
//     — today's behavior, unchanged.
//
//   - `isConfiguredMarketingOrigin` — the CORS allow-list for the
//     `/api/session-status` boolean (Q64). Its set is AT MOST ONE origin:
//     the configured marketing origin, because the only legitimate
//     cross-origin reader of the session boolean is the marketing host's
//     header affordance. Rule zero: on a single-host, app-only, or
//     null-topology configuration this set is EMPTY and the endpoint stays
//     inert — no CORS header is ever emitted.
//
// MATCHING RULES (security-relevant; keep them boring):
//   - Exact string equality of normalized origins — never `endsWith`,
//     never substring, never suffix matching. `evil-app.example.test` and
//     `app.example.test.evil.com` share no normalized form with
//     `app.example.test`.
//   - Scheme-sensitive (`http://` is not `https://`) and port-sensitive
//     (an explicit non-default port must match; default ports are elided
//     by URL parsing on both sides).
//   - `www.`-insensitive on the host, matching `normalizeHost` in
//     host-routing.ts (see the comment there). Direction corrected in
//     #259 P2: this used to cite a production "307 apex → www for GET"
//     redirect. Measured with curl against the PRODUCTION deployment on
//     2026-08-18, the redirect ran the other way and was platform-level
//     rather than ours — a 308 www → apex. The rule survives on firmer
//     ground than the story it replaced. Since #263 the app canonicalizes
//     PAGES to the configured spelling, while `/api/*` and
//     `/.well-known/*` are EXEMPT and serve directly on whichever
//     spelling was addressed (a cross-origin fetch cannot follow a
//     redirect carrying no CORS header). So an API request from a browser
//     on the `www.` spelling genuinely arrives here bearing a `www.`
//     Origin, by design — and must still match the apex value the
//     operator configured.
//
// `SERVE_MARKETING` DELIBERATELY DOES NOT APPEAR HERE (#259 P3 consumer
// audit). All three `APP_ONLY` branches below survived the flip unchanged,
// and the reason is the same one each time: every origin this module can
// emit has to be NAMED by a host variable before it exists at all. Change
// the role an UNNAMED host takes and none of these answers move —
// `resolveTrustedOrigins` adds only origins `APP_HOST`/`MARKETING_HOST`
// spell out, and both `resolveMarketingCorsOrigin` and
// `resolveSessionAffordance` are already null whenever `MARKETING_HOST` is
// unset, whatever `APP_ONLY` says. An instance with nothing configured
// therefore keeps exactly the singleton `{NEXTAUTH_URL}` trust set and the
// inert session-status endpoint it had before, which is correct: it owns no
// second origin and has no marketing host to grant CORS to. Wiring the new
// flag in would have widened a security-relevant set on the strength of a
// flag that names no origin.
//
// Pure module: no Next.js imports, env passed as a record — runs under
// `node --test` like host-routing.ts and host-links.ts.

import {
  originFromHostValue,
  parseBooleanFlag,
  resolveAppOrigin,
} from './host-routing.ts';

/**
 * Normalize an origin (or absolute URL) to a canonical comparison form:
 * `scheme//host[:port]` with the hostname lowercased, a leading `www.`
 * and trailing dot dropped, and default ports elided (URL parsing does
 * that). Returns null for anything unparseable, non-http(s), or empty —
 * including the literal `Origin: null` an opaque-origin request sends,
 * which `new URL('null')` rejects.
 */
export function normalizeOriginForComparison(
  input: string | null | undefined,
): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Only web origins participate; a scheme mismatch can never equal a
  // configured http(s) origin anyway, but rejecting early keeps the
  // comparison space small and the failure mode obvious.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const hostname = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  if (hostname.length === 0) return null;
  // `url.port` is '' when the port is the scheme default — elision for free.
  const host = url.port ? `${hostname}:${url.port}` : hostname;
  return `${url.protocol}//${host}`;
}

/**
 * Every origin this instance owns, normalized and deduplicated:
 * `NEXTAUTH_URL`, and — unless `APP_ONLY`, which declares the two host
 * variables ignored (mirroring `resolveHostRole`) — the app and marketing
 * origins. Order is stable but meaningless; membership is the contract.
 *
 * With topology unset this is exactly the singleton `NEXTAUTH_URL` set
 * the pre-#213 `isSameOrigin` compared against; with nothing configured
 * at all it is empty, which sends `isTrustedRequestOrigin` to the
 * request-host dev fallback.
 */
export function resolveTrustedOrigins(
  env: Record<string, string | undefined>,
): string[] {
  const candidates = [normalizeOriginForComparison(env.NEXTAUTH_URL)];
  if (!parseBooleanFlag(env.APP_ONLY)) {
    candidates.push(
      normalizeOriginForComparison(originFromHostValue(env.APP_HOST)),
      normalizeOriginForComparison(originFromHostValue(env.MARKETING_HOST)),
    );
  }
  const origins: string[] = [];
  for (const candidate of candidates) {
    if (candidate !== null && !origins.includes(candidate)) {
      origins.push(candidate);
    }
  }
  return origins;
}

/**
 * Normalize a Host header for the dev fallback below: lowercased, leading
 * `www.` and trailing dot dropped from the name, an explicit port kept.
 * (No scheme — Host headers don't carry one.)
 */
function normalizeHostHeader(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return null;
  if (value.startsWith('[')) {
    // Bracketed IPv6, optionally with a port — already canonical enough.
    return value;
  }
  let name = value;
  let port = '';
  const idx = value.lastIndexOf(':');
  if (idx !== -1 && /^\d+$/.test(value.slice(idx + 1))) {
    name = value.slice(0, idx);
    port = value.slice(idx);
  }
  name = name.replace(/^www\./, '').replace(/\.$/, '');
  if (name.length === 0) return null;
  return `${name}${port}`;
}

/**
 * THE #213 PREDICATE: does this request's Origin name one of the
 * instance's own origins? `api-auth.ts` `isSameOrigin` is a thin adapter
 * over this (request headers in, `process.env` in, boolean out).
 *
 * - No Origin header, or an unparseable one → false. Callers who need to
 *   support header-less clients use bearer tokens, which skip this gate.
 * - Any configured origin (`resolveTrustedOrigins` non-empty) → exact
 *   membership, nothing else. Configuration narrows trust; there is no
 *   union with the fallback below.
 * - Nothing configured anywhere (dev) → trust the request's own host:
 *   the Origin's host must EQUAL the Host header (www-insensitively).
 *   The pre-#213 fallback used `endsWith`, which a registrable-domain
 *   lookalike (`https://evil-example.org` vs host `example.org`)
 *   satisfied; exact equality accepts every request the old check was
 *   for (a page POSTing to its own host) and closes that hole.
 */
export function isTrustedRequestOrigin(
  originHeader: string | null | undefined,
  hostHeader: string | null | undefined,
  env: Record<string, string | undefined>,
): boolean {
  const origin = normalizeOriginForComparison(originHeader);
  if (origin === null) return false;

  const trusted = resolveTrustedOrigins(env);
  if (trusted.length > 0) {
    return trusted.includes(origin);
  }

  // Dev fallback: no configured origin anywhere. Accept only the
  // request's own host, exactly.
  if (typeof hostHeader !== 'string') return false;
  const host = normalizeHostHeader(hostHeader);
  if (host === null) return false;
  const originHost = origin.slice(origin.indexOf('//') + 2);
  return originHost === host;
}

/**
 * The single origin `/api/session-status` may echo in CORS headers — the
 * configured marketing origin — or null when topology names none, which
 * keeps the endpoint inert (rule zero): unset topology, a single-host
 * instance, and an app-only instance (where `MARKETING_HOST` is declared
 * ignored) all resolve to null.
 */
export function resolveMarketingCorsOrigin(
  env: Record<string, string | undefined>,
): string | null {
  if (parseBooleanFlag(env.APP_ONLY)) return null;
  return normalizeOriginForComparison(originFromHostValue(env.MARKETING_HOST));
}

/**
 * THE Q64 CORS PREDICATE: is this request's Origin the instance's
 * configured marketing origin? True is the ONLY condition under which
 * `/api/session-status` echoes an Origin. www-insensitive like everything
 * above, so `https://www.example.org` matches a configured `example.org`
 * — the route echoes whichever literal form the browser sent, under
 * `Vary: Origin`.
 */
export function isConfiguredMarketingOrigin(
  originHeader: string | null | undefined,
  env: Record<string, string | undefined>,
): boolean {
  const allowed = resolveMarketingCorsOrigin(env);
  if (allowed === null) return false;
  const origin = normalizeOriginForComparison(originHeader);
  return origin !== null && origin === allowed;
}

/**
 * What the marketing header's session-aware affordance needs, or null when
 * the affordance must not exist (and no client fetch may fire): the
 * app-origin URL to probe and where "Open app →" points.
 *
 * Non-null ONLY on a full split topology — both `APP_HOST` (somewhere to
 * probe and to open) and `MARKETING_HOST` (an origin the probe endpoint
 * will actually answer CORS for) named, and not `APP_ONLY`. A partial
 * rollout (`APP_HOST` alone) stays null rather than firing a probe the
 * inert endpoint is guaranteed to refuse.
 *
 * `openAppHref` targets `/ask` — the app front door `/` 307s to
 * (APP_ROOT_ACTION) — going there directly skips the redirect hop.
 */
export interface SessionAffordanceTarget {
  /** Absolute URL of the app host's `/api/session-status`. */
  statusUrl: string;
  /** Where the swapped-in "Open app →" control points. */
  openAppHref: string;
}

export function resolveSessionAffordance(
  env: Record<string, string | undefined>,
): SessionAffordanceTarget | null {
  if (parseBooleanFlag(env.APP_ONLY)) return null;
  if (resolveMarketingCorsOrigin(env) === null) return null;
  const appOrigin = resolveAppOrigin(env);
  if (appOrigin === null) return null;
  return {
    statusUrl: `${appOrigin}/api/session-status`,
    openAppHref: `${appOrigin}/ask`,
  };
}
