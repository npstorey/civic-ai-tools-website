/**
 * Page analytics: which service's tag the root layout renders, if any (#516 P2).
 *
 * TWO VARIABLES, BOTH READ AT BUILD. `NEXT_PUBLIC_ANALYTICS_SERVICE` names the
 * service and `NEXT_PUBLIC_ANALYTICS_ID` the instance's id with it. Neither
 * set: no tag, so no reader's browser is asked to contact any analytics
 * service. The caller (`src/app/layout.tsx`) reads each name literally, so
 * `next build` inlines the values; nothing here reads the environment.
 *
 * THE RULE (#516 G0-2, ruled (A)):
 *   - If either new name is non-empty, the new pair alone decides.
 *   - Otherwise a non-empty `NEXT_PUBLIC_GA_MEASUREMENT_ID`, the prior-era
 *     variable, means `google-analytics` with that id, so an instance that set
 *     it keeps its tag across this change with nothing to edit.
 *   - Empty counts as absent for all three names: a build argument that is not
 *     passed can arrive as an empty string. Whitespace alone is empty, as in
 *     the preflight's presence test.
 *   - An unknown service, or one of the pair without the other, renders
 *     nothing. The preflight names the problem (`allowedValues` on the service
 *     row, and the pair as an all-or-nothing group); this module does not log,
 *     because it runs at build and on every render.
 *
 * WHY NOT `priorEraName`. That preflight field is a one-to-one rename whose
 * resolver lets a defined-but-empty canonical name win
 * (`resolveEnvName`, scripts/preflight-env.mjs). Here an empty new name must
 * fall through to the old id, and the old id maps to a PAIR, not to one name.
 *
 * WHAT EACH ID HOLDS.
 *   - `google-analytics`: the GA4 measurement id (`G-…`), the value the
 *     prior-era variable held.
 *   - `plausible`: the per-site script key the vendor's site settings show
 *     (`pa-` followed by a 21-character id), which names the script file. Not
 *     the site's domain: only the vendor's older script took that.
 *
 * WHAT EACH SERVICE RENDERS.
 *   - `google-analytics`: the two scripts the root layout carried before this
 *     module existed, byte for byte, whitespace included.
 *   - `plausible`: the vendor's own snippet, read 2026-10-17 from the
 *     installation instructions in the vendor's open-source repository
 *     (plausible/analytics, `lib/plausible_web/live/installation/instructions.ex`
 *     at 2e385f14): an `async` script from `https://plausible.io/js/<id>.js`
 *     and a two-line initializer. Rendered through `next/script`, as the
 *     library the vendor's Next.js page points to renders it.
 *
 * A NEW SERVICE is a value in ANALYTICS_SERVICES, a branch in AnalyticsTags,
 * the same value in the preflight row's `allowedValues`, and a paragraph in
 * docs/deploy.md's Analytics section; `src/lib/analytics.test.ts` fails on a
 * missing one of the last three.
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

/** A set value, trimmed; `null` for unset, empty, or whitespace alone. */
function present(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  return raw;
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

const PLAUSIBLE_INIT =
  'window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};\n' +
  'plausible.init()';

export function AnalyticsTags({ config }: { config: AnalyticsConfig | null }) {
  if (config === null) return null;
  if (config.service === 'plausible') {
    return (
      <>
        <Script async src={`https://plausible.io/js/${config.id}.js`} strategy="afterInteractive" />
        <Script id="plausible-init" strategy="afterInteractive">
          {PLAUSIBLE_INIT}
        </Script>
      </>
    );
  }
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
