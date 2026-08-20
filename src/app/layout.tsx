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
import { McpRoutingProvider } from '@/components/McpRoutingProvider';
import { SignInOptionsProvider } from '@/components/SignInOptionsProvider';
import { readMcpEnvFromProcess } from '@/lib/mcp/registry';
import { buildProviders } from '@/lib/auth-providers';
import { toSignInOptions } from '@/lib/auth-provider-options';
import {
  getBrandAccent,
  getBrandAttribution,
  getBrandName,
  getBrandRepoUrl,
  getBrandTagline,
} from '@/lib/brand-config';
import {
  COMMUNITY_DIRECTORY_SUBMIT_URL,
  getDirectorySource,
  getInstanceAttribution,
  getRoadmapSource,
} from '@/lib/site-config';
import { resolveRobotsMetadata } from '@/lib/site-indexing';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

/**
 * `SITE_NOINDEX` (#258 E1): `undefined` (the default — indexable) omits the
 * `robots` key from the metadata object entirely, so no `<meta
 * name="robots">` tag renders at all; set truthy, it carries `index: false,
 * follow: false`. Shared with `src/app/robots.ts` via `site-indexing.ts` so
 * the two surfaces cannot disagree. Statically prerendered pages bake this
 * at `next build` — same build-time-plus-runtime caveat as the
 * `SITE_BRAND_*` chrome set (docs/deploy.md's Branding and theming
 * section); set it in the build environment too when it matters at build.
 */
const robotsMetadata = resolveRobotsMetadata(process.env);

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

/**
 * ROOT metadata — the defaults every surface in BOTH route groups inherits,
 * so nothing reference-specific may live here (#259 P4, D6).
 *
 * WHAT WAS ACTUALLY LEAKING, measured rather than assumed. Per-page `title`
 * overrides already worked: every `(app)` page sets its own, so `/ask`
 * rendered "Ask - …" and never the root string. What every page inherited,
 * having no override anywhere in the tree, was the `description` and the
 * `openGraph`/`twitter` title+description pairs — which carried the
 * "- MCP Demo" suffix and the with-and-without-MCP comparison copy onto an
 * operator instance's gated app pages.
 *
 * The demo framing did not disappear; it moved DOWN to
 * `(marketing)/layout.tsx`, where it describes the page it was written for
 * and travels with the route group. That is also the liftability shape: a
 * later extraction of the marketing site takes its own metadata with it, and
 * the root keeps nothing that names one deployment.
 *
 * What remains here is instance config only — `SITE_BRAND_NAME` and
 * `SITE_BRAND_TAGLINE`, both omitted entirely when unset rather than
 * defaulted, so an unnamed instance emits no `<title>` and no description
 * instead of somebody else's.
 */
const rootBrandName = getBrandName();
const rootBrandTagline = getBrandTagline();

export const metadata: Metadata = {
  ...(rootBrandName !== null ? { title: rootBrandName } : {}),
  ...(rootBrandTagline !== null ? { description: rootBrandTagline } : {}),
  ...(robotsMetadata ? { robots: robotsMetadata } : {}),
  openGraph: {
    ...(rootBrandName !== null ? { title: rootBrandName } : {}),
    ...(rootBrandTagline !== null ? { description: rootBrandTagline } : {}),
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    ...(rootBrandName !== null ? { title: rootBrandName } : {}),
    ...(rootBrandTagline !== null ? { description: rootBrandTagline } : {}),
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
   * above. Since #259 P4 the two NAMING knobs resolve to `null` when unset
   * and every consumer below omits rather than substitutes — an instance
   * that has not named itself must not render the reference deployment's
   * name in its header, titles or footer.
   *
   * The accent override writes the four accent-family custom properties as
   * an inline style on <html> — inline beats the stylesheet's `:root` block,
   * so every `var(--accent…)` reference follows the configured color.
   * `null` (unset or invalid) writes NO style attribute at all: the
   * stylesheet defaults render, a zero-byte delta.
   */
  const brandName = getBrandName();
  const brandTagline = getBrandTagline();
  const brandAttribution = getBrandAttribution();
  const brandRepoUrl = getBrandRepoUrl();
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

  /**
   * Whether the footer's "Suggest a Server" funnel renders (#259 P4, D7).
   *
   * Two conditions, both about whether the link would be honest here:
   * `marketingOrigin !== null` says this instance serves a `/directory` page
   * at all (P3's `instanceServesMarketing`, read through the same host-links
   * derivation the sibling footer links use), and the community provenance
   * says the list on that page is the shared community index rather than the
   * operator's own. An app-only instance has no directory, and an instance
   * curating `DIRECTORY_DATA_URL` has its own — neither should be sending
   * its users into another project's issue tracker.
   */
  const showCommunitySubmitLink =
    hostLinks.marketingOrigin !== null && getDirectorySource().provenance === 'community';
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
          {/* Instance attribution identity for the unreachable client
              surfaces (#227, #258 A2) — the PUBLISHER_* set (origin, host
              label, display name), so its own provider rather than a rider
              on the chrome-brand one. Null members mean "not configured";
              the client surfaces then omit attribution. */}
          <EvidenceOriginProvider value={getInstanceAttribution()}>
          {/* Server-resolved Socrata MCP endpoint for the client surfaces
              that mention it (#258 C5) — one configured value reaches server
              and client; null means "not configured" and the surfaces omit
              the host mention. Routing, not identity or chrome, so its own
              provider. */}
          <McpRoutingProvider value={readMcpEnvFromProcess().socrataUrl ?? null}>
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
                {/* Footer identity lines. EVERY line in this block is now
                    instance config (#259 P4) — the tagline and attribution
                    were already (#217); the repo funnel, the directory
                    submission link and the sponsor line joined them, because
                    this footer renders on the `(app)` surfaces too and an
                    instance with no marketing site of its own was still
                    showing the reference project's contribution funnels and
                    the reference deployment's own byline. Nothing here
                    renders unless this deployment declared it. */}
                {brandTagline !== null && (
                  <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0 }}>
                    {brandTagline}
                  </p>
                )}
                {/* The whole link row, or nothing: with no repo, no
                    marketing face and no community directory there is no
                    row, and an empty <p> would still take its margin. */}
                {(brandRepoUrl !== null ||
                  hostLinks.marketingOrigin !== null ||
                  showCommunitySubmitLink) && (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '8px 0 0 0' }}>
                    {/* Source repo (D7): this instance's own, or no link. It
                        pointed at the reference project's hub repo for every
                        deployment — a contribution funnel into somebody else's
                        tracker, rendered in an operator's footer. */}
                    {brandRepoUrl !== null && (
                      <a href={brandRepoUrl} target="_blank" rel="noopener noreferrer">GitHub</a>
                    )}
                    {/* Marketing routes (P4c): prefixed with the marketing
                        origin on a split host so they resolve from the app
                        host too, exactly relative when nothing is configured,
                        and omitted entirely on an app-only instance \u2014 which
                        has no marketing site for them to point at. */}
                    {hostLinks.marketingOrigin !== null && (
                      <>
                        {brandRepoUrl !== null && ' \u00b7 '}
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
                    {/* Suggest a Server (D7): a funnel into the COMMUNITY
                        index, shown only by an instance that actually serves
                        that index on a /directory page of its own. */}
                    {showCommunitySubmitLink && (
                      <>
                        {(brandRepoUrl !== null || hostLinks.marketingOrigin !== null) && ' \u00b7 '}
                        <a href={COMMUNITY_DIRECTORY_SUBMIT_URL} target="_blank" rel="noopener noreferrer">Suggest a Server</a>
                      </>
                    )}
                  </p>
                )}
                {/* Attribution (A2): who runs THIS deployment, or nothing.
                    The unset branch used to render the reference
                    deployment's own authored byline on every surface of
                    every instance; there is no neutral markup for "who runs
                    this", so unset now renders no line at all. */}
                {brandAttribution !== null && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0 0', opacity: 0.8 }}>
                    {brandAttribution}
                  </p>
                )}
                <SponsorLine style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0 0', opacity: 0.8 }} />
              </div>
            </footer>
          </div>
          </SignInOptionsProvider>
          </McpRoutingProvider>
          </EvidenceOriginProvider>
          </BrandProvider>
          </HostLinksProvider>
        </Providers>
      </body>
    </html>
  );
}
