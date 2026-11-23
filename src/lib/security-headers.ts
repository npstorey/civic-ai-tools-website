/**
 * The site sends a Content-Security-Policy (report-only) and a Referrer-Policy.
 *
 * Set from `next.config.ts`'s `headers()` on every path, so every response
 * carries them: pages, the record page, `/ask`, sign-in, the talk decks (a
 * route handler) and the API. `src/proxy.ts` is not used: its matcher skips
 * `/api/`, `/_next/` and `/.well-known/`, and it decides routing, not headers.
 * The policy is read at build, as the analytics tag is.
 *
 * THE POLICY, four directives:
 *   - `img-src`: `'self'` (the site's own files and the image optimizer the
 *     avatars go through), `data:` (a notebook's plots and the talk decks'
 *     inline images), `https://typedstandards.org` (the record page's
 *     badge), and the configured analytics service's own image hosts, from
 *     `resolveAnalytics`, the resolver that picks the tag;
 *   - `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`.
 * Report-only: a browser reports what the policy would refuse and refuses
 * nothing. `script-src`, `default-src`, `connect-src` and `form-action` are
 * not set here.
 *
 * THE REFERRER-POLICY is `strict-origin-when-cross-origin`, the browsers' own
 * default, sent so it does not depend on the browser.
 *
 * A NEW ANALYTICS SERVICE needs an entry in ANALYTICS_IMAGE_HOSTS: the record
 * is keyed by every service, so a missing one fails the type check.
 */
import { resolveAnalytics, type AnalyticsEnv, type AnalyticsService } from './analytics-config.ts';

/**
 * The image hosts each analytics service's tag loads from.
 *   - google-analytics: the two hosts Google's CSP guide for the Google tag
 *     (developers.google.com/tag-platform/security/guides/csp, "Google
 *     Analytics without any Ads features") lists for `img-src`.
 *   - plausible: none; its script reports by request, not by image.
 */
export const ANALYTICS_IMAGE_HOSTS: Record<AnalyticsService, readonly string[]> = {
  'google-analytics': ['https://www.googletagmanager.com', 'https://*.google-analytics.com'],
  plausible: [],
};

const IMAGE_SOURCES = ["'self'", 'data:', 'https://typedstandards.org'] as const;

/** The policy's text for an instance's analytics configuration. */
export function contentSecurityPolicy(env: AnalyticsEnv): string {
  const analytics = resolveAnalytics(env);
  const images = [...IMAGE_SOURCES, ...(analytics ? ANALYTICS_IMAGE_HOSTS[analytics.service] : [])];
  return [`img-src ${images.join(' ')}`, "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"].join('; ');
}

export const REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** The `headers()` entries for `next.config.ts`: both headers on every path. */
export function securityHeaderRoutes(env: AnalyticsEnv): { source: string; headers: { key: string; value: string }[] }[] {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy(env) },
        { key: 'Referrer-Policy', value: REFERRER_POLICY },
      ],
    },
  ];
}
