/**
 * Host-topology routing (app front-door v0.1.0, P3).
 *
 * Pure decision logic for which routes each HOST serves. `src/proxy.ts`
 * is a thin adapter over `decideRoute`; everything testable lives here, with
 * no Next.js imports so the module runs under `node --test` and in the edge
 * runtime alike.
 *
 * THE SEAM CONVENTION (rule zero): with none of the three variables below
 * set, every request passes through untouched — no withholding, no
 * rewrites, anywhere. An instance that has never heard of host topology
 * behaves exactly as before this module existed.
 *
 * Configuration (all optional; host names are env-driven, never literals):
 *
 * - `APP_HOST` — the host that serves the gated `(app)` surface. On it,
 *   `/` redirects to the query surface at `/ask` (see APP_ROOT_ACTION),
 *   the marketing routes 404, and the full `(app)` group serves.
 * - `MARKETING_HOST` — the host that serves the marketing face and the
 *   public evidence registry. On it, the app-private routes
 *   (`/ask`, `/dashboard`, `/auth/device`, `/dev/notebook-preview`) 404;
 *   everything else serves byte-identically to a single-host deployment.
 * - `APP_ONLY` — `1`/`true`: a single-host instance that deploys ONLY the
 *   gated surface (no marketing site). Every request, on every host, gets
 *   the app role; `APP_HOST`/`MARKETING_HOST` are ignored.
 *
 * Roles are claimed EXPLICITLY: a request on a host that matches neither
 * variable (a preview deployment, a health check by IP, a not-yet-flipped
 * alias) passes through — today's behavior, on purpose. Withholding is
 * topology, not security: the access gate is sign-in
 * (`SIGN_IN_ALLOWLIST`), and routes keep enforcing their own sessions.
 *
 * Deliberately DUAL-SERVED either way: `/evidence` and `/evidence/[slug]`
 * (public product surface — published URLs must keep resolving on the
 * marketing host; their `(app)` group placement is structural, not an
 * access classification), the whole `/api/*` family, `_next`, and static
 * assets.
 *
 * Host matching mirrors `api-auth.ts`'s origin normalization:
 * case-insensitive, port-insensitive, and `www.`-insensitive — the
 * production deployment 307-redirects apex → www for GET, so browsers land
 * on `www.` even when the configured host is the apex.
 */

/** What a request's host entitles it to. */
export type HostRole = 'app' | 'marketing' | 'passthrough';

/** Parsed host-topology configuration (see module doc). */
export interface HostRoutingConfig {
  /** Normalized `APP_HOST`, or null when unset. */
  appHost: string | null;
  /** Normalized `MARKETING_HOST`, or null when unset. */
  marketingHost: string | null;
  /** `APP_ONLY` flag. */
  appOnly: boolean;
}

/**
 * The action the middleware should take for one request.
 * - `serve`    — pass through untouched (NextResponse.next()).
 * - `withhold` — 404: rewrite to a path no route claims, so the standard
 *                not-found page renders and the response status is 404 —
 *                indistinguishable from a route that does not exist.
 * - `redirect` — temporary (307) redirect to `destination`.
 */
export type RouteAction =
  | { kind: 'serve' }
  | { kind: 'withhold' }
  | { kind: 'redirect'; destination: string };

const SERVE: RouteAction = { kind: 'serve' };
const WITHHOLD: RouteAction = { kind: 'withhold' };

/**
 * What the app host serves at `/` — the app surface's front door. P4
 * claimed the seam P3 left here: the destination is now `/ask`, the
 * signed-in query mount (`src/app/(app)/ask/page.tsx`), rather than P3's
 * interim `/evidence`.
 *
 * REDIRECT, NOT REWRITE, and the reasoning is recorded because both were
 * available. A rewrite would make `/` itself BE the query surface, which
 * reads well in a URL bar; it would also give the same content two
 * addresses on the same host (`/` and `/ask`), invisibly — nothing in the
 * response says the proxy substituted a route, so "why does the root
 * render the query page?" becomes unanswerable without reading this file.
 * A redirect is one visible hop (`curl -I` shows it), leaves exactly one
 * canonical URL for the surface, needs no new RouteAction kind, and keeps
 * the proxy adapter untouched. 307, not 308: browsers cache permanent
 * redirects; this is not one.
 *
 * NO LOOP, and the property is load-bearing rather than incidental. The
 * destination must be a path this same function SERVES on the app host,
 * and whose page does not itself redirect a signed-out visitor. `/ask`
 * satisfies both: it is app-private (served here, withheld on the
 * marketing host), and it renders a sign-in prompt in place for anonymous
 * visitors instead of bouncing them. That is why the target is not
 * `/dashboard` — the dashboard does `redirect('/')` without a session, so
 * `/` → `/dashboard` → `/` would loop for every anonymous visitor. The
 * signed-out chain on the app host now terminates in one render:
 * `/dashboard` → `/` → `/ask` → sign-in prompt (200).
 */
export const APP_ROOT_ACTION: RouteAction = { kind: 'redirect', destination: '/ask' };

/**
 * Route classes, matched by first path segment(s). Derived from the route
 * groups under `src/app/` — verify against the filesystem when adding a
 * page. Paths not listed anywhere (public files like `/bpmn/*`, unknown
 * URLs) are unclassified and always pass through: unknown URLs 404
 * naturally, and static assets serve on both hosts by design.
 */
export const MARKETING_PATHS = [
  '/about',
  '/directory',
  '/explore',
  '/learn',
  '/project',
  '/roadmap',
] as const;

/**
 * The `(app)`-private routes the marketing host withholds.
 *
 * `/ask` is the signed-in query mount (P4). It is app-private rather than
 * dual-served because the apex already has its own query surface at `/` in
 * anonymous demo configuration — a second, signed-in copy of it on the
 * public face would be two front doors to the same thing.
 */
export const APP_PRIVATE_PATHS = [
  '/ask',
  '/dashboard',
  '/auth/device',
  '/dev/notebook-preview',
] as const;

/** Public product surface served on BOTH hosts (owner-decided; see module doc). */
export const DUAL_SERVED_PATHS = ['/evidence'] as const;

export type PathClass = 'root' | 'marketing' | 'app-private' | 'dual-served' | 'other';

/** True when `pathname` is `prefix` itself or nested under it. */
function underPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Classify a pathname into the route classes above. Pure. */
export function classifyPath(pathname: string): PathClass {
  if (pathname === '/') return 'root';
  if (APP_PRIVATE_PATHS.some((p) => underPath(pathname, p))) return 'app-private';
  if (MARKETING_PATHS.some((p) => underPath(pathname, p))) return 'marketing';
  if (DUAL_SERVED_PATHS.some((p) => underPath(pathname, p))) return 'dual-served';
  return 'other';
}

/**
 * Normalize a host for comparison: lowercase, scheme/path/port stripped,
 * leading `www.` and trailing dot dropped. Accepts a bare hostname
 * (recommended), a `host:port`, or a full origin — so the same variable
 * value works for matching and for origin construction (below). Returns
 * null for unset/empty input.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let host = raw.trim().toLowerCase();
  if (host.length === 0) return null;
  // Strip a scheme if a full origin was supplied.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // Strip any path/query suffix.
  host = host.split('/')[0].split('?')[0];
  // Strip the port — bracketed IPv6 first, then host:port.
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) host = host.slice(0, end + 1);
  } else {
    host = host.split(':')[0];
  }
  // www-insensitive, matching api-auth.ts isSameOrigin.
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  return host.length > 0 ? host : null;
}

/** `1`/`true` (any case, trimmed) is on; anything else — including unset — is off. */
export function parseBooleanFlag(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Read the host-topology configuration from an env record. Takes the record
 * as an argument (never `process.env` directly) so tests can pass fixtures.
 */
export function readHostRoutingConfig(
  env: Record<string, string | undefined>,
): HostRoutingConfig {
  return {
    appHost: normalizeHost(env.APP_HOST),
    marketingHost: normalizeHost(env.MARKETING_HOST),
    appOnly: parseBooleanFlag(env.APP_ONLY),
  };
}

/**
 * Which role does this request's host get?
 *
 * Precedence: `APP_ONLY` beats host matching; `APP_HOST` beats
 * `MARKETING_HOST` if both are (mis)configured to the same value; a host
 * matching neither is `passthrough` — today's behavior, so previews and
 * unnamed aliases are never withheld from.
 */
export function resolveHostRole(
  rawHost: string | null | undefined,
  config: HostRoutingConfig,
): HostRole {
  if (config.appOnly) return 'app';
  const host = normalizeHost(rawHost);
  if (host === null) return 'passthrough';
  if (config.appHost !== null && host === config.appHost) return 'app';
  if (config.marketingHost !== null && host === config.marketingHost) return 'marketing';
  return 'passthrough';
}

/**
 * THE decision function: (host, pathname, config) → action. Pure; the
 * middleware adapter contributes nothing but the translation to
 * NextResponse. See the module doc for the full behavior matrix.
 */
export function decideRoute(
  rawHost: string | null | undefined,
  pathname: string,
  config: HostRoutingConfig,
): RouteAction {
  const role = resolveHostRole(rawHost, config);
  if (role === 'passthrough') return SERVE;

  const pathClass = classifyPath(pathname);

  if (role === 'marketing') {
    // The marketing host serves everything it serves today EXCEPT the
    // app-private routes. Root, marketing pages, evidence, and everything
    // unclassified are untouched — the apex demo stays byte-identical.
    return pathClass === 'app-private' ? WITHHOLD : SERVE;
  }

  // role === 'app': the gated surface. No marketing face here.
  switch (pathClass) {
    case 'root':
      return APP_ROOT_ACTION;
    case 'marketing':
      return WITHHOLD;
    default:
      // app-private, dual-served evidence, and unclassified (assets, API
      // under a non-excluded matcher miss, unknown URLs → natural 404).
      return SERVE;
  }
}

/**
 * Build an origin (`https://host`) from a host-shaped env value. A value
 * already carrying a scheme is honored as given (trailing slash trimmed) —
 * that is how a dev instance says `http://localhost:3000`; a bare host gets
 * `https://`. Null for unset/empty.
 */
export function originFromHostValue(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value.replace(/\/+$/, '');
  return `https://${value.replace(/\/+$/, '')}`;
}

/**
 * Origin of the gated app surface, or null when no split-host topology is
 * configured. Used by URL builders that must point AT the app surface —
 * e.g. the device-flow pairing URL, whose `/auth/device` page is withheld
 * on the marketing host once `MARKETING_HOST` is set.
 */
export function resolveAppOrigin(env: Record<string, string | undefined>): string | null {
  return originFromHostValue(env.APP_HOST);
}

/**
 * Where the site header's Dashboard links should point. The header renders
 * on EVERY page — including the marketing host, where `/dashboard` is
 * withheld once a split topology is configured — so on a split-host
 * deployment the link must carry the app origin. Relative everywhere else:
 * unset topology is today's exact href, and an app-only instance serves
 * the dashboard on whatever host the request came in on.
 */
export function resolveDashboardHref(env: Record<string, string | undefined>): string {
  if (parseBooleanFlag(env.APP_ONLY)) return '/dashboard';
  const appOrigin = resolveAppOrigin(env);
  return appOrigin !== null ? `${appOrigin}/dashboard` : '/dashboard';
}

/**
 * Where the app surface's "Public site" affordances should point (the
 * `AppChrome` exit link):
 * - app-only instance → null: there IS no public marketing site — hide the
 *   affordance rather than link a gated user to a 404 or back to the
 *   dashboard.
 * - split-host → the marketing origin.
 * - no topology configured → `/` (today's relative link, byte-identical).
 */
export function resolvePublicSiteHref(
  env: Record<string, string | undefined>,
): string | null {
  if (parseBooleanFlag(env.APP_ONLY)) return null;
  const marketingOrigin = originFromHostValue(env.MARKETING_HOST);
  if (marketingOrigin !== null) return marketingOrigin;
  return '/';
}
