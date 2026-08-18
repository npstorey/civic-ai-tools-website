/**
 * Host-topology routing (app front-door v0.1.0, P3).
 *
 * Pure decision logic for which routes each HOST serves. `src/proxy.ts`
 * is a thin adapter over `decideRoute`; everything testable lives here, with
 * no Next.js imports so the module runs under `node --test` and in the edge
 * runtime alike.
 *
 * THE PORTABLE DEFAULT (#259 P3): an instance that configures NOTHING
 * serves the app surface only. Every host it is addressed on takes the
 * `app` role — `/` redirects to `/ask`, the marketing routes 404. The
 * marketing face is the reference deployment's own website, not part of
 * what an instance ships, and this is how it is withheld: by
 * configuration, never by deleting files, so instances stay cleanly
 * `git pull`-able.
 *
 * This REPLACED an earlier default (rule zero) under which nothing was
 * configured meant every request passed through untouched. The old
 * behavior did not disappear; it is now spelled `SERVE_MARKETING=1`.
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
 *   the app role; `APP_HOST`/`MARKETING_HOST` are ignored. Redundant with
 *   the default above for an instance that configures nothing else, and
 *   deliberately KEPT: it is the explicit way to say "app-only even
 *   though a marketing host is named", which the default cannot express.
 * - `SERVE_MARKETING` — `1`/`true`: an UNNAMED host (one matching neither
 *   `APP_HOST` nor `MARKETING_HOST`) passes through and serves both route
 *   groups, the pre-#259 default. Governs unnamed hosts ONLY; a
 *   configured split-host deployment is unaffected by it either way.
 *
 * WHY THE MARKETING KNOB IS HOST-INDEPENDENT, which is the whole reason it
 * is a boolean and not a third host name. Hosting-platform preview URLs
 * match neither host variable, so before this change they resolved
 * `passthrough` and served everything. Naming hosts in the preview
 * environment would not help — a preview URL still matches neither, being
 * freshly minted per deployment. Only a host-independent boolean can keep
 * preview deployments serving both route groups after the flip.
 *
 * Roles are otherwise claimed EXPLICITLY: a named host takes the role it
 * was named for, and nothing else changes it. Withholding is topology,
 * not security: the access gate is sign-in (`SIGN_IN_ALLOWLIST`), and
 * routes keep enforcing their own sessions.
 *
 * Deliberately DUAL-SERVED either way: `/evidence` and `/evidence/[slug]`
 * (public product surface — published URLs must keep resolving on the
 * marketing host; their `(app)` group placement is structural, not an
 * access classification), the whole `/api/*` family, `_next`, and static
 * assets.
 *
 * Host MATCHING mirrors `api-auth.ts`'s origin normalization:
 * case-insensitive, port-insensitive, and `www.`-insensitive, so an
 * operator names a host once and either spelling of it resolves to the
 * role they configured.
 *
 * HOST CANONICALIZATION (#263). Matching is `www.`-insensitive; SERVING is
 * not. A request whose host matches a configured value but spells it with
 * the other `www.` form is 307-redirected to the spelling the operator
 * actually configured — www→apex or apex→www, whichever direction the
 * configuration points. Four properties are load-bearing:
 *
 *  - CONFIG-DERIVED, never a literal. The canonical spelling IS the
 *    `APP_HOST` / `MARKETING_HOST` value; this module knows no host names
 *    and needs no new variable to learn one.
 *  - UNNAMED HOSTS ARE NEVER STEERED. A preview URL, a health check by
 *    IP, an unnamed alias — none of them matched a configured value, so
 *    there is no spelling to steer them toward. That holds whatever role
 *    the unnamed host ends up with: since #259 P3 an unnamed host takes
 *    the `app` role by default rather than `passthrough`, and it is still
 *    canonicalized nowhere, because `matchedOrigin` keys on the MATCH and
 *    not on the role. Neither is an `APP_ONLY` instance canonicalized,
 *    which ignores both host variables by definition.
 *  - The CORS-sensitive path families are EXEMPT — see
 *    `CANONICALIZATION_EXEMPT_PREFIXES`, which is the entire point of
 *    #263. Per the Fetch spec, a cross-origin request that meets a
 *    redirect requires the REDIRECT RESPONSE ITSELF to pass the CORS
 *    check; a redirect carrying no `access-control-allow-origin` turns
 *    the fetch into a network error no matter how simple the request is.
 *    So `/api/*` and `/.well-known/*` must serve DIRECTLY on whichever
 *    spelling was addressed, and a third-party verifier resolving a
 *    commitment URL gets an answer instead of "Failed to fetch".
 *  - It composes with the path decision instead of stacking on top of it:
 *    a `www.` request to `/` on the app host produces ONE redirect
 *    straight to the canonical host's `/ask`, not a host hop followed by
 *    a path hop. Withholding wins outright — a route this host does not
 *    serve 404s on the spelling it was asked on, rather than redirecting
 *    to a second 404.
 *
 * 307, NOT 308, deliberately: browsers cache permanent redirects (the same
 * reasoning already recorded at `APP_ROOT_ACTION` below), and the platform
 * redirect this replaces is exactly why that matters — a cached 308
 * outlives its own fix. No `rel=canonical` work accompanies this; the
 * reference deployment sets `SITE_NOINDEX=1` (its `robots.txt` is
 * `Disallow: /`), so search-engine canonicalization is moot there.
 *
 * WHERE THIS WAS MEASURED — and where it was not. The redirect and CORS
 * behavior described above was measured against the PRODUCTION deployment
 * with `curl` and an explicit `Origin` header on 2026-08-18. It has not
 * been observed in a preview deployment or locally, and cannot be: a
 * preview host matches neither variable, so nothing is canonicalized or
 * withheld there. This app-layer canonicalization also ships INERT — while
 * the hosting platform's own domain-level redirect is enabled it fires at
 * the edge and no `www.` request ever reaches this module. That is
 * intentional: canonicalization and the CORS fix then go live in the same
 * instant the platform setting is turned off, with no window in which
 * `www.` serves duplicate, uncanonicalized content.
 */

/** What a request's host entitles it to. */
export type HostRole = 'app' | 'marketing' | 'passthrough';

/** Parsed host-topology configuration (see module doc). */
export interface HostRoutingConfig {
  /** Normalized `APP_HOST` — what MATCHING compares against. Null when unset. */
  appHost: string | null;
  /** Normalized `MARKETING_HOST` — what MATCHING compares against. Null when unset. */
  marketingHost: string | null;
  /**
   * `APP_HOST` as an origin, preserving the spelling the operator
   * configured — what CANONICALIZATION steers toward. Null when unset.
   */
  appOrigin: string | null;
  /** `MARKETING_HOST` as an origin, preserving the configured spelling. */
  marketingOrigin: string | null;
  /** `APP_ONLY` flag. */
  appOnly: boolean;
  /**
   * `SERVE_MARKETING` flag — the role an UNNAMED host takes. True gives it
   * `passthrough` (the pre-#259 default, and what preview deployments
   * need); false gives it `app` (the portable default). Named hosts do not
   * consult it.
   */
  serveMarketing: boolean;
}

/**
 * The action the middleware should take for one request.
 * - `serve`    — pass through untouched (NextResponse.next()).
 * - `withhold` — render the not-found page WITH a 404 status. The adapter
 *                in `src/proxy.ts` carries the mechanism and the exact
 *                limits of what has been verified about it.
 * - `redirect` — temporary (307) redirect to `destination`: a path for the
 *                app-root hop, an absolute URL for a host canonicalization.
 *
 * CORRECTION (#259 P2). This comment previously claimed a withheld route
 * was "indistinguishable from a route that does not exist". It was not.
 * Measured on the production deployment on 2026-08-18, a withheld route
 * returned HTTP 200 carrying a not-found BODY, while a genuinely unknown
 * URL on the same host returned 404 — so the two were distinguishable by
 * status alone. The content withholding always worked; only the status was
 * wrong. Nothing in the code had ever set the 404 the comment promised.
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
 * The shared parse: lowercase, trim, and strip scheme, path/query and port
 * from a host-shaped value. Accepts a bare hostname (recommended), a
 * `host:port`, or a full origin — so one variable value works for
 * matching, for canonicalization, and for origin construction (below).
 * Leaves both the leading `www.` and any trailing dot alone; the two
 * exported wrappers differ only in what they do about those.
 */
function hostPart(raw: string | null | undefined): string | null {
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
  return host.length > 0 ? host : null;
}

/**
 * A host reduced to the form CANONICALIZATION compares on: everything
 * `normalizeHost` does EXCEPT dropping the leading `www.`.
 *
 * The asymmetry is the whole design. `www.` presence is the only thing
 * `normalizeHost` erases that names a genuinely different host; case, port
 * and trailing dot are one name written differently. Steering on those
 * would be actively harmful rather than merely useless — an instance
 * configured as `example.org` but addressed on `example.org:8443` would be
 * redirected to a port it does not listen on, and one configured as
 * `http://localhost:3000` would redirect to itself forever, because the
 * literal config string never equals the Host header the browser sends
 * back. Comparing bare hosts makes both of those no-ops by construction.
 */
export function bareHost(raw: string | null | undefined): string | null {
  const host = hostPart(raw);
  if (host === null) return null;
  const trimmed = host.replace(/\.$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize a host for MATCHING: lowercase, scheme/path/port stripped,
 * leading `www.` and trailing dot dropped. Returns null for unset/empty
 * input. `www.`-insensitive, matching api-auth.ts `isSameOrigin` — which
 * is why a request can match a configured host and still be spelled
 * differently from it, and why `bareHost` above exists.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  const host = hostPart(raw);
  if (host === null) return null;
  // Order matters: `www.` first, then the trailing dot, so the degenerate
  // input `www.` reduces to empty (null) rather than to the host `www`.
  const stripped = host.replace(/^www\./, '').replace(/\.$/, '');
  return stripped.length > 0 ? stripped : null;
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
    // The same values a second time, un-normalized, because matching and
    // canonicalization need different things from them: matching wants the
    // `www.`-insensitive form, canonicalization wants the literal spelling.
    appOrigin: originFromHostValue(env.APP_HOST),
    marketingOrigin: originFromHostValue(env.MARKETING_HOST),
    appOnly: parseBooleanFlag(env.APP_ONLY),
    serveMarketing: parseBooleanFlag(env.SERVE_MARKETING),
  };
}

/**
 * Which role does this request's host get?
 *
 * PRECEDENCE, in evaluation order and decided rather than inherited:
 *
 *   1. `APP_ONLY` set             → `app`, on every host.
 *   2. host === `APP_HOST`        → `app`.
 *   3. host === `MARKETING_HOST`  → `marketing`.
 *   4. otherwise (an UNNAMED host) → `SERVE_MARKETING` ? `passthrough` : `app`.
 *
 * Rows 1-3 are untouched by #259 P3, which is the property that makes the
 * flip safe: a configured split-host deployment behaves exactly as it did
 * before, and `APP_HOST` still beats `MARKETING_HOST` when both are
 * (mis)configured to the same value.
 *
 * Row 4 is the flip. It used to be `passthrough` unconditionally; the
 * portable default is now `app`, with `SERVE_MARKETING` restoring the old
 * answer. A MISSING or unparseable Host header takes row 4 as well — it is
 * maximally unnamed, and splitting it out would leave the withholding with
 * a hole that depends on whether a client sent a header HTTP/1.1 requires.
 */
export function resolveHostRole(
  rawHost: string | null | undefined,
  config: HostRoutingConfig,
): HostRole {
  if (config.appOnly) return 'app';
  const host = normalizeHost(rawHost);
  if (host !== null) {
    if (config.appHost !== null && host === config.appHost) return 'app';
    if (config.marketingHost !== null && host === config.marketingHost) return 'marketing';
  }
  return config.serveMarketing ? 'passthrough' : 'app';
}

/**
 * Path families that are NEVER host-canonicalized, whatever the topology.
 *
 * This list is the #263 fix. `/api/*` and `/.well-known/*` are the paths
 * third parties fetch cross-origin — evidence commitments, the trust
 * registry — and per the Fetch spec a redirect met by a cross-origin
 * request must ITSELF carry `access-control-allow-origin` or the fetch
 * fails as a network error. Redirecting them is therefore not a detour,
 * it is an outage for every browser caller, preflights included. They
 * serve directly on whichever spelling was addressed.
 *
 * It deliberately DUPLICATES the matcher exclusions in `src/proxy.ts`
 * rather than trusting them. The matcher already keeps these requests out
 * of the proxy entirely — that is the primary mechanism and it is the one
 * that runs in production — but the matcher is a deployment-time
 * optimization living in a different file, while this function is the
 * documented authority for what happens to a request. Encoding the
 * exemption in both places means a future edit to the matcher cannot
 * silently reintroduce the defect.
 */
export const CANONICALIZATION_EXEMPT_PREFIXES = [
  '/api',
  '/_next',
  '/.well-known',
] as const;

/** Exact paths that are never canonicalized (see the prefixes above). */
export const CANONICALIZATION_EXEMPT_PATHS = ['/favicon.ico', '/robots.txt'] as const;

/** True when `pathname` must serve on the host it was addressed on. Pure. */
export function isCanonicalizationExempt(pathname: string): boolean {
  if (CANONICALIZATION_EXEMPT_PATHS.some((p) => p === pathname)) return true;
  return CANONICALIZATION_EXEMPT_PREFIXES.some((p) => underPath(pathname, p));
}

/**
 * The origin whose SPELLING this request's host should be canonicalized
 * to, or null when there is none to steer toward.
 *
 * Mirrors `resolveHostRole`'s precedence exactly — `APP_HOST` before
 * `MARKETING_HOST` — so a request can never be matched as one role and
 * canonicalized toward the other. Returns null for `APP_ONLY`, which
 * ignores both host variables by definition and therefore has no
 * configured spelling, and null for a host that matched neither (rule
 * zero: a preview URL or an unnamed alias is not steered anywhere).
 */
function matchedOrigin(
  rawHost: string | null | undefined,
  config: HostRoutingConfig,
): string | null {
  if (config.appOnly) return null;
  const host = normalizeHost(rawHost);
  if (host === null) return null;
  if (config.appHost !== null && host === config.appHost) return config.appOrigin;
  if (config.marketingHost !== null && host === config.marketingHost) {
    return config.marketingOrigin;
  }
  return null;
}

/**
 * Where a non-canonical spelling of a configured host should be sent, or
 * null when the request is already canonical (or must not be moved).
 *
 * TERMINATION is a property, not a hope: the destination's host IS
 * `bareHost(origin)`, so the follow-up request compares equal and returns
 * null here. Exactly one hop, always — pinned by a test that feeds the
 * redirect target back through this function.
 */
export function canonicalHostRedirect(
  rawHost: string | null | undefined,
  pathname: string,
  config: HostRoutingConfig,
  search = '',
): string | null {
  if (isCanonicalizationExempt(pathname)) return null;
  const origin = matchedOrigin(rawHost, config);
  if (origin === null) return null;
  const requested = bareHost(rawHost);
  const canonical = bareHost(origin);
  if (requested === null || canonical === null) return null;
  if (requested === canonical) return null;
  return `${origin}${pathname}${search}`;
}

/**
 * What this role does with this PATH, before any host spelling is
 * considered. Extracted from `decideRoute` so canonicalization can compose
 * with the answer rather than run before or after it.
 */
function decidePathAction(role: 'app' | 'marketing', pathname: string): RouteAction {
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
 * THE decision function: (host, pathname, config) → action. Pure; the
 * middleware adapter contributes nothing but the translation to
 * NextResponse. See the module doc for the full behavior matrix.
 *
 * `search` is optional and defaults to empty, so every existing caller and
 * test keeps its exact meaning. It exists only so a canonicalizing
 * redirect can carry the query string — `/explore?trace=…` is a documented
 * deep link, and dropping its query would break the link rather than move
 * it. The app-root hop deliberately does not take it: that redirect
 * discarded the query before this change and still does.
 *
 * PRECEDENCE, decided rather than inherited from evaluation order:
 *
 *  1. `passthrough` short-circuits everything — no withholding, no
 *     canonicalization, no root hop. Since #259 P3 an unnamed host reaches
 *     this only when `SERVE_MARKETING` says so; a named host never does.
 *  2. `withhold` beats canonicalization. A route this host does not serve
 *     404s on the spelling it was asked on. Redirecting first would spend
 *     a hop to arrive at the same 404, and would make the withheld status
 *     depend on which spelling the caller happened to use.
 *  3. Otherwise canonicalization COMPOSES with the path decision: the path
 *     action picks the destination path, the host check picks the host,
 *     and the two are emitted as ONE redirect. A `www.` request to `/` on
 *     the app host lands on the canonical host's `/ask` in a single hop,
 *     never a host hop followed by a path hop, and never a loop.
 */
export function decideRoute(
  rawHost: string | null | undefined,
  pathname: string,
  config: HostRoutingConfig,
  search = '',
): RouteAction {
  const role = resolveHostRole(rawHost, config);
  if (role === 'passthrough') return SERVE;

  const pathAction = decidePathAction(role, pathname);
  if (pathAction.kind === 'withhold') return pathAction;

  // Compose: where the path decision already redirects, canonicalize its
  // destination instead of the requested path, collapsing two hops to one.
  const isPathRedirect = pathAction.kind === 'redirect';
  const destination = canonicalHostRedirect(
    rawHost,
    isPathRedirect ? pathAction.destination : pathname,
    config,
    isPathRedirect ? '' : search,
  );
  return destination === null ? pathAction : { kind: 'redirect', destination };
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
 * DOES THIS INSTANCE SERVE A MARKETING SURFACE AT ALL? — the predicate the
 * chrome needs, and the one #259 P3 had to introduce because `APP_ONLY`
 * stopped being able to answer it.
 *
 * Before the flip, "no marketing site" and "`APP_ONLY`" were the same
 * statement, so every affordance that had to hide itself branched on
 * `APP_ONLY` directly. After the flip they came apart: an instance with
 * NOTHING configured routes as app-only while `APP_ONLY` is still false,
 * and a consumer still asking `APP_ONLY` would take the has-a-marketing-site
 * branch and render links into a surface that now 404s.
 *
 * So this asks the question the consumers actually mean, and it mirrors
 * `resolveHostRole` row for row rather than inventing a second topology
 * reading:
 *
 *   | `APP_ONLY` | `MARKETING_HOST` | `SERVE_MARKETING` | serves marketing |
 *   | set        | any              | any               | NO  (explicit)   |
 *   | unset      | named            | any               | YES (that host)  |
 *   | unset      | unnamed          | set               | YES (unnamed →   |
 *   |            |                  |                   |      passthrough)|
 *   | unset      | unnamed          | unset             | NO  (the flip)   |
 *
 * INSTANCE-level, not host-level, and deliberately: every resolver in this
 * file is env-only and host-independent (see the note in host-links.ts),
 * because reading request headers in a layout would force the static
 * marketing pages to render dynamically. On a split-host instance marketing
 * IS served — on the marketing host — so this is true on BOTH hosts, and the
 * hrefs the consumers build are absolute, which is what makes that correct.
 */
export function instanceServesMarketing(env: Record<string, string | undefined>): boolean {
  if (parseBooleanFlag(env.APP_ONLY)) return false;
  if (normalizeHost(env.MARKETING_HOST) !== null) return true;
  return parseBooleanFlag(env.SERVE_MARKETING);
}

/**
 * Where the site header's Dashboard links should point. The header renders
 * on EVERY page — including the marketing host, where `/dashboard` is
 * withheld once a split topology is configured — so on a split-host
 * deployment the link must carry the app origin. Relative everywhere else:
 * unset topology is today's exact href, and an app-only instance serves
 * the dashboard on whatever host the request came in on.
 *
 * UNCHANGED BY #259 P3, audited rather than assumed. The relative fallback
 * names an APP-PRIVATE path, and the flip gives an unnamed host the `app`
 * role — the role that SERVES app-private paths — so the href was already
 * right for the post-flip default. The `APP_ONLY` branch stays: here it
 * answers "where does the app surface live", not "does a marketing surface
 * exist", and only the latter question moved.
 */
export function resolveDashboardHref(env: Record<string, string | undefined>): string {
  if (parseBooleanFlag(env.APP_ONLY)) return '/dashboard';
  const appOrigin = resolveAppOrigin(env);
  return appOrigin !== null ? `${appOrigin}/dashboard` : '/dashboard';
}

/**
 * Where an "Ask" affordance should point (#210 — the `AppChrome` strip).
 *
 * Exactly `resolveDashboardHref`'s shape, and for exactly its reason: the
 * strip renders on the DUAL-SERVED `/evidence` pages, which serve on the
 * marketing host too — where `/ask` is app-private and withheld. A relative
 * href there is a 404, so a split-host instance must carry the app origin.
 * Relative everywhere else: unset topology serves `/ask` on whatever host the
 * request arrived on, and an app-only instance is its own app host.
 *
 * UNCHANGED BY #259 P3, for `resolveDashboardHref`'s reason exactly —
 * `/ask` is app-private, an unnamed host now takes the role that serves
 * app-private paths, and the relative fallback lands on a route that
 * serves. It is also the destination `APP_ROOT_ACTION` sends `/` to, so
 * this href and the root hop cannot disagree.
 */
export function resolveAskHref(env: Record<string, string | undefined>): string {
  if (parseBooleanFlag(env.APP_ONLY)) return '/ask';
  const appOrigin = resolveAppOrigin(env);
  return appOrigin !== null ? `${appOrigin}/ask` : '/ask';
}

/**
 * Where the app surface's "Public site" affordances should point (the
 * `AppChrome` exit link):
 * - instance serves no marketing surface → null: there IS no public site —
 *   hide the affordance rather than link a gated user to a 404 or back to
 *   the dashboard. `AppChrome` guards on exactly this null.
 * - split-host → the marketing origin.
 * - unnamed hosts passing through (`SERVE_MARKETING`) → `/`, the relative
 *   link this has always emitted for a single-host instance.
 *
 * THE GATE MOVED FROM `APP_ONLY` TO `instanceServesMarketing` (#259 P3),
 * and it had to. Left on `APP_ONLY`, an instance with nothing configured
 * would have returned `/` — and `/` is precisely the path that now
 * redirects to `/ask`. The exit link out of the app would have led back
 * into the app: one hop, no error, and no public site at the end of it.
 */
export function resolvePublicSiteHref(
  env: Record<string, string | undefined>,
): string | null {
  if (!instanceServesMarketing(env)) return null;
  const marketingOrigin = originFromHostValue(env.MARKETING_HOST);
  if (marketingOrigin !== null) return marketingOrigin;
  return '/';
}
