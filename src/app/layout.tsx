import type { Metadata } from 'next';
import { Space_Grotesk, Noto_Sans } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import Header from '@/components/Header';

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
    'See the difference MCP (Model Context Protocol) makes when querying civic data. Compare LLM responses with and without live data access.',
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'Civic AI Tools - MCP Demo',
    description:
      'See the difference MCP makes when querying civic data. Compare LLM responses with and without live data access.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Civic AI Tools - MCP Demo',
    description:
      'See the difference MCP makes when querying civic data. Compare LLM responses with and without live data access.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${notoSans.variable}`}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <footer className="border-t py-8 text-center" style={{ borderColor: 'var(--border-color)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '16px' }}>
                Built with{' '}
                <a
                  href="https://github.com/npstorey/civic-ai-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  civic-ai-tools
                </a>{' '}
                and{' '}
                <a
                  href="https://modelcontextprotocol.io"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  MCP
                </a>
              </p>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
