/**
 * Site indexing posture (`SITE_NOINDEX`; #258 finding E1, owner ruling G0-3).
 *
 * Every instance used to hardcode "block all crawlers" — a static
 * `public/robots.txt` with `Disallow: /` and a `robots: { index: false,
 * follow: false }` block in the root layout's metadata, both undocumented
 * and both permanent. Indexing is now explicit instance config, one flag,
 * parsed with the repo's existing boolean-flag idiom
 * (`parseBooleanFlag` in `./host-routing.ts` — the `APP_ONLY` pattern).
 *
 * Absent or whitespace-only `SITE_NOINDEX` is the standard web default:
 * indexable, no `robots.txt` disallow, no noindex metadata. Set truthy, an
 * instance opts OUT of indexing: `robots.txt` (`src/app/robots.ts`)
 * disallows every path for every user agent, and the root layout's
 * metadata (`src/app/layout.tsx`) carries `index: false, follow: false`.
 *
 * This is chrome/ops configuration, like the host-topology and branding
 * seams — it is never emitted into signed evidence output, and no getter
 * here is reachable from the packager or the verify path.
 *
 * Every function takes `env` as an explicit argument rather than reading
 * `process.env` directly, so both surfaces and their tests share one
 * decision with no drift between "what robots.txt says" and "what the
 * metadata says" — see `src/lib/site-indexing.test.ts`.
 */

import { parseBooleanFlag } from './host-routing.ts';

/** Whether this instance has opted OUT of crawler indexing (`SITE_NOINDEX`). */
export function isNoindexConfigured(env: Record<string, string | undefined>): boolean {
  return parseBooleanFlag(env.SITE_NOINDEX);
}

/**
 * The `robots.txt` rules `src/app/robots.ts` renders, in the shape
 * Next.js's `MetadataRoute.Robots['rules']` (single-object form) accepts.
 * Indexable (the default): `Allow: /` for every user agent — the explicit,
 * standard-web-default form, not an absent file. Opted out: `Disallow: /`.
 */
export function resolveRobotsRules(env: Record<string, string | undefined>): {
  rules: { userAgent: string; allow?: string; disallow?: string };
} {
  return isNoindexConfigured(env)
    ? { rules: { userAgent: '*', disallow: '/' } }
    : { rules: { userAgent: '*', allow: '/' } };
}

/**
 * The root layout `<head>` metadata's `robots` entry, or `undefined` when
 * indexing is allowed — so the caller spreads it away entirely and no
 * `<meta name="robots">` tag renders at all, rather than an explicit
 * `index, follow` (functionally identical to the tag's absence, but the
 * point of the flag-off state is to emit nothing extra).
 */
export function resolveRobotsMetadata(
  env: Record<string, string | undefined>,
): { index: false; follow: false } | undefined {
  return isNoindexConfigured(env) ? { index: false, follow: false } : undefined;
}
