import { NextResponse, type NextRequest } from 'next/server';
import { decideRoute, readHostRoutingConfig } from '@/lib/host-routing';

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
 * With none of APP_HOST / MARKETING_HOST / APP_ONLY set, every request
 * resolves to `serve` and this proxy is a pass-through.
 */
export function proxy(request: NextRequest) {
  const action = decideRoute(
    // The raw Host header, not nextUrl.hostname: on hosted platforms the
    // parsed URL can reflect the deployment's internal host rather than
    // the one the visitor addressed.
    request.headers.get('host'),
    request.nextUrl.pathname,
    readHostRoutingConfig(process.env),
  );

  switch (action.kind) {
    case 'withhold':
      // Rewrite to a path no route claims: Next renders the standard
      // not-found page with a 404 status while the browser URL stays put —
      // indistinguishable from a route that does not exist.
      return NextResponse.rewrite(new URL('/404', request.url));
    case 'redirect':
      // Temporary on purpose: where the app root points is a product
      // decision (APP_ROOT_ACTION), and browsers cache permanent redirects
      // past the point where changing it would take effect.
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
   */
  matcher: ['/((?!api/|_next/|\\.well-known/|favicon\\.ico|robots\\.txt).*)'],
};
