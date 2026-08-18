import { NextResponse, type NextRequest } from 'next/server';
import { decideRoute, readHostRoutingConfig } from '@/lib/host-routing';

/**
 * The framework's own not-found route. Next's App Router always builds one
 * (`app/_not-found/page`) whether or not the app supplies a
 * `not-found.tsx`, and — verified in this repo's build output — it is the
 * ONLY route in the manifest that carries a 404: `.next/server/
 * _not-found.meta` records `"status": 404` and the prerender manifest
 * records `"initialStatus": 404` for it.
 *
 * The path this replaced, `/404`, matches no route at all. That is why a
 * withheld route returned 200: the rewrite destination resolved to
 * nothing, the not-found BODY rendered, and no route's status ever
 * applied.
 */
const NOT_FOUND_ROUTE = '/_not-found';

/**
 * Host-topology routing proxy (app front-door v0.1.0, P3) — a thin
 * adapter over the pure decision function in `src/lib/host-routing.ts`.
 * All behavior (the role matrix, the withheld route list, the seam
 * convention that unset config means untouched requests) is decided and
 * unit-tested there; this file only translates a RouteAction into a
 * NextResponse.
 *
 * `proxy.ts`, not `middleware.ts`: Next 16 renamed the request-
 * interception file convention, and the old name emits a deprecation
 * warning on every build. Same standard mechanism, current name.
 *
 * THE DEFAULT CHANGED IN #259 P3. With nothing configured, every request
 * now resolves to the APP role: `/` redirects to `/ask` and the marketing
 * routes 404, because the marketing face is the reference deployment's own
 * website rather than part of what an instance ships. The former default —
 * every request a pass-through — is now spelled `SERVE_MARKETING=1`, which
 * governs hosts matching neither `APP_HOST` nor `MARKETING_HOST` and is
 * what keeps preview deployments serving both route groups.
 */
export function proxy(request: NextRequest) {
  const action = decideRoute(
    // The raw Host header, not nextUrl.hostname: on hosted platforms the
    // parsed URL can reflect the deployment's internal host rather than
    // the one the visitor addressed.
    request.headers.get('host'),
    request.nextUrl.pathname,
    readHostRoutingConfig(process.env),
    // Only a canonicalizing redirect consumes this; see decideRoute.
    request.nextUrl.search,
  );

  switch (action.kind) {
    case 'withhold':
      // 404, via two independent mechanisms that point the same way,
      // because neither can be observed from here (see below):
      //
      //  1. The DESTINATION is a route that genuinely exists and whose
      //     build artifact carries a 404 status, so the status comes from
      //     rendering it rather than from anything middleware asserts.
      //  2. The STATUS ON THE REWRITE. Reading Next 16.3.0's router
      //     (`server/lib/router-utils/resolve-routes.js`), the middleware
      //     response's status is assigned to the outgoing response before
      //     the rewrite destination is resolved, and the rewrite branch —
      //     unlike the redirect branch beside it — never overwrites it.
      //     That also explains the 200 this replaces: a rewrite with no
      //     init defaults to 200, and nothing downstream corrected it.
      //
      // The browser URL stays put either way; only the status changes.
      //
      // WHAT IS NOT VERIFIED. Neither mechanism has been observed
      // end-to-end. A local server cannot run here (an agent sandbox
      // denies port binding), and a preview deployment withholds nothing
      // because its host matches neither topology variable — so there is
      // no withheld route to probe. Production is the first place this is
      // observable. Both mechanisms are also strictly additive: if each
      // one fails, the response is the 200-plus-not-found-body it already
      // was, so the change cannot regress below the defect it targets.
      return NextResponse.rewrite(new URL(NOT_FOUND_ROUTE, request.url), { status: 404 });
    case 'redirect':
      // Temporary on purpose, for BOTH redirect kinds. Where the app root
      // points is a product decision (APP_ROOT_ACTION), and a canonical
      // host spelling is an operator's configuration — browsers cache
      // permanent redirects past the point where changing either would
      // take effect. The platform-level 308 this replaces is the standing
      // demonstration: it outlived its own fix in every browser that had
      // already seen it.
      //
      // `action.destination` is a path for the app-root hop and an
      // absolute URL for a canonicalization; `new URL(dest, base)` handles
      // both, ignoring the base when the destination is absolute.
      return NextResponse.redirect(new URL(action.destination, request.url), 307);
    default:
      return NextResponse.next();
  }
}

export const config = {
  /*
   * Everything EXCEPT the surfaces that serve on every host regardless of
   * topology and must never pay the middleware toll:
   * - /api/*           — the full API family serves on both hosts
   * - /_next/*         — build assets, image optimizer, RSC payloads
   * - /.well-known/*   — the trust registry must resolve on every host
   * - favicon.ico, robots.txt
   *
   * Public-folder files that still match (e.g. /bpmn/*, /talks/*, root
   * SVGs) fall through decideRoute unclassified and are served unchanged —
   * the matcher is an optimization, the function is the authority.
   *
   * The /api/ and /.well-known/ exclusions are load-bearing for #263, not
   * just a performance nicety: they are why a cross-origin fetch of an
   * evidence commitment or the trust registry meets a real response on
   * EITHER host spelling instead of a redirect it cannot follow. Because
   * that matters, `host-routing.ts` re-states the same exemption in
   * `CANONICALIZATION_EXEMPT_PREFIXES`, so editing this regex alone cannot
   * bring the defect back.
   *
   * Note the exclusions are prefix-with-slash: bare `/api` and bare
   * `/.well-known` DO reach the proxy. Neither names a route; both
   * classify as unclassified and serve, so the behavior is unchanged.
   */
  matcher: ['/((?!api/|_next/|\\.well-known/|favicon\\.ico|robots\\.txt).*)'],
};
