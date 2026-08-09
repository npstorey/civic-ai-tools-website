import type { Metadata } from 'next';
import Script from 'next/script';
import { Space_Grotesk, Noto_Sans } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import Providers from '@/components/Providers';
import Header from '@/components/Header';
import { HostLinksProvider } from '@/components/HostLinksProvider';
import { resolveDashboardHref } from '@/lib/host-routing';
import { resolveHostLinks } from '@/lib/host-links';
import RunningUnsignedBanner from '@/components/RunningUnsignedBanner';
import SponsorLine from '@/components/SponsorLine';
import { BrandProvider } from '@/components/BrandProvider';
import {
  getBrandAccent,
  getBrandAttribution,
  getBrandName,
  getBrandTagline,
} from '@/lib/brand-config';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

const notoSans = Noto_Sans({
  variable: '--font-noto-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
                      {' \u00b7 '}
                      <Link href={`${hostLinks.marketingOrigin}/roadmap`}>Roadmap</Link>
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
          </BrandProvider>
          </HostLinksProvider>
        </Providers>
      </body>
    </html>
  );
}
