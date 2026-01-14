import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import Header from '@/components/Header';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Civic AI Tools - MCP Demo',
  description:
    'See the difference MCP (Model Context Protocol) makes when querying civic data. Compare LLM responses with and without live data access.',
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100`}
      >
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-zinc-200 dark:border-zinc-800 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              <p>
                Built with{' '}
                <a
                  href="https://github.com/npstorey/civic-ai-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  civic-ai-tools
                </a>{' '}
                and{' '}
                <a
                  href="https://modelcontextprotocol.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
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
