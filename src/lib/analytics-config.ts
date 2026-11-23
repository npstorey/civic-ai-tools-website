/**
 * Page analytics: which service the instance configured, if any (#516 P2).
 *
 * The decision `src/lib/analytics.tsx` renders its tag from, in a module of
 * its own with no JSX, so `next.config.ts` can load it: the site's
 * Content-Security-Policy (`src/lib/security-headers.ts`) is built from the
 * same resolver that picks the tag, and the two cannot disagree. The rule and
 * what each id holds are stated in `analytics.tsx`, which re-exports
 * everything here; the lines below moved from it unchanged.
 */

export const ANALYTICS_SERVICES = ['google-analytics', 'plausible'] as const;
export type AnalyticsService = (typeof ANALYTICS_SERVICES)[number];

export interface AnalyticsEnv {
  NEXT_PUBLIC_ANALYTICS_SERVICE?: string;
  NEXT_PUBLIC_ANALYTICS_ID?: string;
  NEXT_PUBLIC_GA_MEASUREMENT_ID?: string;
}

export interface AnalyticsConfig {
  service: AnalyticsService;
  id: string;
}

/** A set value, trimmed; `null` for unset, empty, or whitespace alone. */
function present(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

function isService(value: string): value is AnalyticsService {
  return (ANALYTICS_SERVICES as readonly string[]).includes(value);
}

export function resolveAnalytics(env: AnalyticsEnv): AnalyticsConfig | null {
  const service = present(env.NEXT_PUBLIC_ANALYTICS_SERVICE);
  const id = present(env.NEXT_PUBLIC_ANALYTICS_ID);
  if (service !== null || id !== null) {
    if (service === null || id === null || !isService(service)) return null;
    return { service, id };
  }
  const priorEraId = present(env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
  return priorEraId === null ? null : { service: 'google-analytics', id: priorEraId };
}
