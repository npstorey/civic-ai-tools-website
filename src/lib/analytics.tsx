/**
 * Page analytics: which service's tag the root layout renders, if any (#516 P2).
 *
 * TYPED STUB. This commit carries the base behaviour behind the new module's
 * signature, so the render test can be red at its assertions: one variable,
 * `NEXT_PUBLIC_GA_MEASUREMENT_ID`, and the Google Analytics tag when it is
 * set. The two-variable decision replaces it in the next commit.
 */
import Script from 'next/script';

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

export function resolveAnalytics(env: AnalyticsEnv): AnalyticsConfig | null {
  const id = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  return id ? { service: 'google-analytics', id } : null;
}

export function AnalyticsTags({ config }: { config: AnalyticsConfig | null }) {
  if (config === null || config.service !== 'google-analytics') return null;
  const GA_MEASUREMENT_ID = config.id;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}');
            `}
      </Script>
    </>
  );
}
