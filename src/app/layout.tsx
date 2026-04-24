import type { Metadata } from 'next';
import Script from 'next/script';
import { Space_Grotesk, Noto_Sans } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import Providers from '@/components/Providers';
import Header from '@/components/Header';

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
  title: 'Civic AI Tools - MCP Demo',
  description:
    'See the difference MCP (Model Context Protocol) makes when querying civic data. Compare AI responses with and without live data access.',
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'Civic AI Tools - MCP Demo',
    description:
      'See the difference MCP makes when querying civic data. Compare AI responses with and without live data access.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Civic AI Tools - MCP Demo',
    description:
      'See the difference MCP makes when querying civic data. Compare AI responses with and without live data access.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
          <div className="flex flex-col">
            <Header />
            <main>{children}</main>
            <footer className="border-t py-8 text-center" style={{ borderColor: 'var(--border-color)' }}>
              <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: 0 }}>
                  Open-source tools for AI-powered civic data access
                </p>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '8px 0 0 0' }}>
                  <a href="https://github.com/npstorey/civic-ai-tools" target="_blank" rel="noopener noreferrer">GitHub</a>
                  {' \u00b7 '}
                  <Link href="/learn">Learn</Link>
                  {' \u00b7 '}
                  <Link href="/about">About</Link>
                  {' \u00b7 '}
                  <Link href="/roadmap">Roadmap</Link>
                  {' \u00b7 '}
                  <a href="https://github.com/npstorey/civic-ai-tools/issues/new?template=suggest-server.yml&labels=directory-submission" target="_blank" rel="noopener noreferrer">Suggest a Server</a>
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0 0', opacity: 0.8 }}>
                  By <a href="https://nathanstorey.com" target="_blank" rel="noopener noreferrer">Nathan Storey</a>
                  {' \u00b7 '}Personal project{' \u00b7 '}Not affiliated with any employer.
                </p>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
