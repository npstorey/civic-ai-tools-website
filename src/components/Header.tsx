'use client';

import { useState, useRef, useEffect } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';

export default function Header() {
  const { data: session, status } = useSession();
  const headerRef = useRef<HTMLElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Publish header height as a CSS variable so other components can offset below it
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--header-height',
        `${el.offsetHeight}px`,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      ref={headerRef}
      className="border-b"
      style={{
        borderColor: 'var(--border-color)',
        backgroundColor: 'var(--background)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
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
              href="/explore"
              className="no-link-style"
              style={{
                color: 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '16px',
              }}
            >
              Explore
            </Link>
            <Link
              href="/directory"
              className="no-link-style"
              style={{
                color: 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '16px',
              }}
            >
              Directory
            </Link>
            <Link
              href="/learn"
              className="no-link-style"
              style={{
                color: 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '16px',
              }}
            >
              Learn
            </Link>
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
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {/* Mobile hamburger */}
          <button
            className="sm:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            style={{
              background: 'none',
              border: 'none',
              padding: '4px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: '24px',
              lineHeight: 1,
            }}
          >
            {mobileMenuOpen ? '\u2715' : '\u2630'}
          </button>
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

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div
          className="sm:hidden"
          style={{
            borderTop: '1px solid var(--border-color)',
            padding: '12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <Link
            href="/explore"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
            }}
          >
            Explore
          </Link>
          <Link
            href="/directory"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
            }}
          >
            Directory
          </Link>
          <Link
            href="/learn"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
            }}
          >
            Learn
          </Link>
          <Link
            href="/about"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
            }}
          >
            About
          </Link>
        </div>
      )}
    </header>
  );
}
