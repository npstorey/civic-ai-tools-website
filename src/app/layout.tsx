import type { Metadata } from 'next';
import Script from 'next/script';
import localFont from 'next/font/local';
import './globals.css';
import Link from 'next/link';
import Providers from '@/components/Providers';
import Header from '@/components/Header';
import { HostLinksProvider } from '@/components/HostLinksProvider';
import { resolveDashboardHref } from '@/lib/host-routing';
import { resolveHostLinks } from '@/lib/host-links';
import { resolveSessionAffordance } from '@/lib/allowed-origins';
import RunningUnsignedBanner from '@/components/RunningUnsignedBanner';
import SponsorLine from '@/components/SponsorLine';
import { BrandProvider } from '@/components/BrandProvider';
import { EvidenceOriginProvider } from '@/components/EvidenceOriginProvider';
import { SignInOptionsProvider } from '@/components/SignInOptionsProvider';
import { buildProviders } from '@/lib/auth-providers';
import { toSignInOptions } from '@/lib/auth-provider-options';
import {
  getBrandAccent,
  getBrandAttribution,
  getBrandName,
  getBrandTagline,
} from '@/lib/brand-config';
import { getEvidenceSiteOrigin, getRoadmapSource } from '@/lib/site-config';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

/**
 * Self-hosted typefaces (#225). These were loaded through
 * `next/font/google` until Next.js 16.2.11 turned an unreachable
 * `fonts.googleapis.com` from a build-time warning into a hard build
 * failure — which broke every restricted-egress build environment, the
 * exact environment the operator-built container path in docs/deploy.md
 * serves. Loading the same files from the repo removes the build-time
 * network dependency outright.
 *
 * The .woff2 files in `src/fonts/` are the Google Fonts latin-subset
 * builds, vendored from `@fontsource/*` 5.3.0 (upstream:
 * github.com/google/fonts; Space Grotesk v22, Noto Sans v42). Both faces
 * are SIL OFL 1.1 — license texts sit beside the files. Provenance and
 * the vendor-over-dependency reasoning: `src/fonts/README.md`.
 *
 * Weight sets are exactly the ones `next/font/google` was asked for, so
 * every `var(--font-*)` consumer in globals.css and the components keeps
 * resolving to the same faces at the same weights. Anything asking for a
 * weight outside these sets (a markdown `<strong>` in body copy, say)
 * gets browser-synthesized bold today and still does — adding real 700
 * Noto Sans here would be a rendering change, not a fix.
 */
const spaceGrotesk = localFont({
  variable: '--font-space-grotesk',
  src: [
    { path: '../fonts/space-grotesk-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/space-grotesk-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/space-grotesk-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
});

const notoSans = localFont({
  variable: '--font-noto-sans',
  src: [
    { path: '../fonts/noto-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/noto-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/noto-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
});

export const metadata: Metadata = {
  title: `${getBrandName()} - MCP Demo`,
  description:
    'See the difference MCP (Model Context Protocol) makes when querying civic data. Compare AI responses with and without live data access.',
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: `${getBrandName()} - MCP Demo`,
    description:
      'See the difference MCP makes when querying civic data. Compare AI responses with and without live data access.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${getBrandName()} - MCP Demo`,
    description:
      'See the difference MCP makes when querying civic data. Compare AI responses with and without live data access.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /**
   * Cross-host link targets (P4c), derived once per render from the
   * environment — never from the request's host, which would force every
   * static marketing page to render dynamically. Unset topology resolves to
   * an empty marketing prefix and a null sign-in href: today's exact links
   * and today's in-place sign-in.
   */
  const hostLinks = resolveHostLinks(process.env);

  /**
   * The header's cross-host session affordance (s6 P3, Q64) — non-null only
   * on a full split topology (both hosts named, not app-only). Spread
   * conditionally below, like `accentProps`: an explicit null prop would
   * serialize into the RSC flight payload, a needless byte delta on every
   * configuration that has no affordance.
   */
  const sessionProbe = resolveSessionAffordance(process.env);

  /**
   * Instance branding (#217), resolved server-side like the host links
   * above. All four knobs default to the demo chrome, so with nothing
   * configured every branch below renders today's exact bytes.
   *
   * The accent override writes the four accent-family custom properties as
   * an inline style on <html> — inline beats the stylesheet's `:root` block,
   * so every `var(--accent…)` reference (including the aliased `--nyc-*`
   * names) follows the configured color. `null` (unset or invalid) writes NO
   * style attribute at all: the stylesheet defaults render, a zero-byte
   * delta.
   */
  const brandName = getBrandName();
  const brandTagline = getBrandTagline();
  const brandAttribution = getBrandAttribution();
  const brandAccent = getBrandAccent();

  /**
   * Whether this instance has a roadmap of its own (#241). An instance that
   * has published none keeps the route — it explains itself to anyone who
   * lands on it — but drops the nav entry, the same "hidden rather than
   * pointed at nothing" treatment the marketing links get on an app-only
   * instance. With `ROADMAP_RAW_URL` set, every link is exactly today's.
   * Content, not chrome: it reads site-config.ts, not brand-config.ts.
   */
  const showRoadmap = getRoadmapSource() !== null;

  /**
   * The instance's sign-in choices (#229 P1 / Q63), derived here for the same
   * reason the host links are: `buildProviders()` returns provider configs
   * carrying client secrets, so the derivation is server-only and only the
   * narrowed `{id, name}` list crosses to the client. `/ask` has done this
   * since P4b; this hoists it to the layout so the five affordances outside
   * `/ask` stop hardcoding one provider.
   */
  const signInOptions = toSignInOptions(buildProviders());
  // Conditional SPREAD, not `style={maybeUndefined}`: an explicit
  // `style={undefined}` would still serialize a `"style":"$undefined"` entry
  // into the RSC flight payload, a needless unset-case byte delta. With the
  // spread, the unset case carries no style prop at all.
  const accentProps = brandAccent
    ? {
        style: {
          '--accent': brandAccent.accent,
          '--accent-rgb': brandAccent.accentRgb,
          '--accent-hover': brandAccent.accentHover,
          '--accent-light': brandAccent.accentLight,
        } as React.CSSProperties,
      }
    : {};

  return (
    <html lang="en" {...accentProps}>
      {GA_MEASUREMENT_ID && (
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
      )}
      <body className={`${spaceGrotesk.variable} ${notoSans.variable}`}>
        <Providers>
          <HostLinksProvider value={hostLinks}>
          {/* Brand name for client components props cannot reach (#217) —
              currently the chat citation preview. Same pattern and mount
              point as HostLinksProvider above. */}
          <BrandProvider value={brandName}>
          {/* Evidence site origin for the same unreachable client surface
              (#227) — instance identity (EVIDENCE_SITE_ORIGIN), so its own
              provider rather than a rider on the chrome-brand one. */}
          <EvidenceOriginProvider value={getEvidenceSiteOrigin()}>
          {/* Sign-in choices for the affordances inside client trees (#229
              P1) — QueryForm, RateLimitBanner, McpResponseDisplay and
              NotebookOutput all render under the apex page, a client
              component with no server ancestor to thread a prop from. */}
          <SignInOptionsProvider value={signInOptions}>
          <div className="flex flex-col">
            {/* Env-driven (P3): on a split-host topology the marketing host
                withholds /dashboard, so the signed-in menu must carry the
                app origin. Unset topology resolves to '/dashboard'.
                `marketingOrigin`/`signInHref` are P4c's equivalents for the
                nav links and the sign-in button — props here because the
                layout renders Header directly; the components deeper inside
                the page read the same values from HostLinksProvider. */}
            <Header
              dashboardHref={resolveDashboardHref(process.env)}
              marketingOrigin={hostLinks.marketingOrigin}
              signInHref={hostLinks.signInHref}
              brandName={brandName}
              showRoadmap={showRoadmap}
              signInOptions={signInOptions}
              {...(sessionProbe !== null ? { sessionProbe } : {})}
            />
            {/* ADR-0020: running-unsigned indicator — renders only when this
                instance has no signing key AND is outside a dev environment. */}
            <RunningUnsignedBanner />
            <main>{children}</main>
            <footer className="border-t py-8 text-center" style={{ borderColor: 'var(--border-color)' }}>
              <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                {/* Footer identity lines (#217): the tagline and attribution
                    are instance-config knobs. Repo links and the sponsor line
                    below are NOT part of the seam and stay as they are. */}
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0 }}>
                  {brandTagline}
                </p>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '8px 0 0 0' }}>
                  <a href="https://github.com/npstorey/civic-ai-tools" target="_blank" rel="noopener noreferrer">GitHub</a>
                  {/* Marketing routes (P4c): prefixed with the marketing
                      origin on a split host so they resolve from the app
                      host too, exactly relative when nothing is configured,
                      and omitted entirely on an app-only instance \u2014 which
                      has no marketing site for them to point at. */}
                  {hostLinks.marketingOrigin !== null && (
                    <>
                      {' \u00b7 '}
                      <Link href={`${hostLinks.marketingOrigin}/learn`}>Learn</Link>
                      {' \u00b7 '}
                      <Link href={`${hostLinks.marketingOrigin}/about`}>About</Link>
                      {/* Roadmap: only for an instance that has one (#241). */}
                      {showRoadmap && (
                        <>
                          {' \u00b7 '}
                          <Link href={`${hostLinks.marketingOrigin}/roadmap`}>Roadmap</Link>
                        </>
                      )}
                    </>
                  )}
                  {' \u00b7 '}
                  <a href="https://github.com/npstorey/civic-ai-tools/issues/new?template=suggest-server.yml&labels=directory-submission" target="_blank" rel="noopener noreferrer">Suggest a Server</a>
                </p>
                {/* Attribution: a configured instance supplies its own
                    plain-text line; unset renders the demo deployment's
                    authored markup verbatim (it carries a hyperlink, so it
                    cannot live in the config module as a string default). */}
                {brandAttribution !== null ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0 0', opacity: 0.8 }}>
                    {brandAttribution}
                  </p>
                ) : (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0 0', opacity: 0.8 }}>
                    By <a href="https://nathanstorey.com" target="_blank" rel="noopener noreferrer">Nathan Storey</a>
                    {' \u00b7 '}Personal project{' \u00b7 '}Not affiliated with any employer.
                  </p>
                )}
                <SponsorLine style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0 0', opacity: 0.8 }} />
              </div>
            </footer>
          </div>
          </SignInOptionsProvider>
          </EvidenceOriginProvider>
          </BrandProvider>
          </HostLinksProvider>
        </Providers>
      </body>
    </html>
  );
}
