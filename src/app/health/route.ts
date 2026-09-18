// GET /health — the root-level address of the liveness probe (#443, W1).
//
// Some deployment platforms fix the probe path at the root and offer no
// setting to move it. This file exists for those; it implements nothing.
// The handler is defined ONCE, at `/api/health`, and re-exported here, so
// both addresses dispatch to the same function object — asserted in
// `src/app/api/health/route.test.ts`, because two copies of a probe
// endpoint is exactly the shape that drifts unnoticed (both return 200
// until one of them stops).
//
// `dynamic` is re-declared rather than re-exported: Next reads
// route-segment config by parsing each route file's own source, and a
// re-export binding is invisible to that parse. The mirror is asserted
// alongside the function identity, so forgetting it here fails a test
// instead of silently prerendering one of the two addresses.
//
// Unlike `/api/health`, this path does not inherit the `/api` prefix's
// exemptions: it is listed in `CANONICALIZATION_EXEMPT_PATHS`
// (`src/lib/host-routing.ts`) and excluded from the matcher in
// `src/proxy.ts`, both asserted. A probe follows no redirect.
export const dynamic = 'force-dynamic';

export { GET } from '../api/health/route.ts';
