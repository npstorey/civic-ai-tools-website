/**
 * GET /api/health — the liveness probe target (#443, Wave N12 W1).
 *
 * WHAT IT IS FOR. A deployment platform probes a fixed path on the
 * container port and expects 200. Before this route the compose
 * healthcheck pointed at `/api/evidence/signing-status`, which happens to
 * be dependency-free but is named for signing: an operator configuring a
 * platform probe has no way to know that route is safe to point at, and
 * nothing stops a later change from giving it a dependency. This route
 * exists for the probe and for nothing else, so both facts are stable.
 *
 * IT IMPORTS NOTHING — NOT EVEN `next/server`. That is deliberate and it
 * is what makes the route's central claim measurable rather than asserted.
 * `NextResponse.json()` is a thin wrapper over the Web `Response.json()`
 * used here; what it costs is the one import, and `next` publishes no
 * `exports` map, so the extensionless `next/server` specifier is
 * unresolvable outside a bundler. With that import the handler could not
 * be CALLED by `npm test` (`node --test` over plain modules) at all, and
 * "returns 200 with nothing configured" would have to be taken on faith
 * from `next build` registering a route entry. Without it, `route.test.ts`
 * invokes this function with every dependency variable deleted from the
 * environment and reads the status and the body. Returning a plain
 * `Response` from a route handler is the App Router's documented contract,
 * so nothing is given up for it.
 *
 * `route.test.ts` also asserts, over this file's SOURCE, that its module
 * specifier list is empty — so an import added here in a later edit fails
 * that test rather than turning a liveness probe into an accidental
 * readiness probe. A readiness check against dependencies is a different
 * route with its own issue (#443, "Not asked"): a liveness probe that
 * fails when Postgres is slow gets the container killed and restarted for
 * someone else's outage.
 *
 * SERVED AT TWO ADDRESSES, ONE HANDLER. `src/app/health/route.ts`
 * re-exports this `GET` for platforms whose probe path is fixed at the
 * root. The two addresses share one function object (asserted), so they
 * cannot drift. `/api/health` inherits its host-canonicalization and
 * proxy-matcher exemptions from the `/api` prefix; `/health` needs both
 * stated explicitly, and they are — in `CANONICALIZATION_EXEMPT_PATHS`
 * (`src/lib/host-routing.ts`) and in the matcher in `src/proxy.ts`. A
 * probe follows no redirect: on a non-canonical host spelling an
 * unexempted `/health` would answer 307 and the platform would read the
 * instance as down.
 *
 * WHY `force-dynamic`. Without it Next may answer this handler from a
 * response rendered during `next build`. The property the probe is
 * pointed at is "this process is serving requests now", not "this image
 * was built" — so the response is rendered per request. The re-export at
 * `/health` re-declares the same literal, because Next reads route-segment
 * config by parsing each route file's own source and a re-export binding
 * is invisible to that parse (measured in
 * `src/app/api/records/segment-alias.test.ts`); the mirror is asserted.
 *
 * SECRET HYGIENE: the body is a constant. It discloses no configuration,
 * no version, no hostname — nothing an unauthenticated caller could not
 * already infer from the fact that it answered.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: 'ok' });
}
