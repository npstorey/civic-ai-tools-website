'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';

export default function Header() {
  const { data: session, status } = useSession();

  return (
    <header
      className="border-b"
      style={{
        borderColor: 'var(--border-color)',
        backgroundColor: 'var(--background)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="no-link-style"
            style={{
              fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif',
              fontWeight: 600,
              fontSize: '24px',
              color: 'var(--text-primary)',
            }}
          >
            Civic AI Tools
          </Link>
          <nav className="hidden sm:flex items-center gap-6">
            <Link
              href="/about"
              className="no-link-style"
              style={{
                color: 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '16px',
              }}
            >
              About
            </Link>
            <a
              href="https://github.com/npstorey/civic-ai-tools"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '16px',
                textDecoration: 'none',
              }}
            >
              GitHub
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {status === 'loading' ? (
            <div
              className="h-10 w-24 rounded animate-pulse"
              style={{ backgroundColor: 'var(--skeleton-color)' }}
            />
          ) : session ? (
            <div className="flex items-center gap-4">
              {session.user?.image && (
                <Image
                  src={session.user.image}
                  alt={session.user.name || 'User'}
                  width={36}
                  height={36}
                  className="rounded-full"
                />
              )}
              <span
                className="hidden sm:inline"
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '16px',
                }}
              >
                {session.user?.name}
              </span>
              <button
                onClick={() => signOut()}
                className="nyc-button nyc-button-secondary"
                style={{ padding: '8px 16px', fontSize: '14px' }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => signIn('github')}
              className="nyc-button nyc-button-primary"
              style={{ padding: '8px 16px', fontSize: '14px' }}
            >
              Sign in with GitHub
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
