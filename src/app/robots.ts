import type { MetadataRoute } from 'next';
import { resolveRobotsRules } from '../lib/site-indexing.ts';

/**
 * `robots.txt` (#258 finding E1, owner ruling G0-3), replacing a permanent
 * static `public/robots.txt` that blocked every crawler with no instance
 * ever able to opt in. A static file at that path would also SHADOW this
 * route, so it had to go — see `.gitignore`-adjacent history in
 * git-log for the deleted file.
 *
 * `SITE_NOINDEX` decides the posture (`src/lib/site-indexing.ts`, shared
 * with the root layout's `<head>` metadata so the two surfaces cannot
 * disagree). Absent/whitespace-only is the standard web default:
 * indexable, `Allow: /`. Set truthy, every path is disallowed.
 *
 * `dynamic = 'force-dynamic'`: a metadata route with nothing
 * request-specific is statically generated and cached at build time by
 * default, which would bake in whatever `SITE_NOINDEX` happened to be set
 * (or not) at build — the same pitfall `NEXT_PUBLIC_*` build-time inlining
 * causes for chrome config (docs/deploy.md's "One build-time caveat" note),
 * except this route is not `NEXT_PUBLIC_*` and does not need to be: forcing
 * per-request evaluation reads the live server environment on every
 * request instead, matching the dynamic (app)-group pages
 * (`src/app/(app)/ask/page.tsx` and siblings) that already do this.
 */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return resolveRobotsRules(process.env);
}
