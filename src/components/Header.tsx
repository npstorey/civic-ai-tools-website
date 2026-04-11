'use client';

import { useState, useRef, useEffect } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';

const NAV_LINK_STYLE: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontWeight: 500,
  fontSize: '16px',
};

export default function Header() {
  const { data: session, status } = useSession();
  const headerRef = useRef<HTMLElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const exploreRef = useRef<HTMLDivElement>(null);

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

  // Close Explore dropdown on outside click
  useEffect(() => {
    if (!exploreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (exploreRef.current && !exploreRef.current.contains(e.target as Node)) {
        setExploreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exploreOpen]);

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
            {/* Explore dropdown */}
            <div ref={exploreRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setExploreOpen(!exploreOpen)}
                className="no-link-style"
                style={{
                  ...NAV_LINK_STYLE,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontFamily: 'inherit',
                }}
              >
                Explore
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>&#9662;</span>
              </button>
              {exploreOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: 0,
                    minWidth: '160px',
                    backgroundColor: 'var(--nyc-white)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 10,
                    padding: '4px 0',
                  }}
                >
                  <Link
                    href="/explore"
                    onClick={() => setExploreOpen(false)}
                    style={{
                      display: 'block',
                      padding: '8px 16px',
                      fontSize: '15px',
                      color: 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Data Flow
                  </Link>
                  <Link
                    href="/directory"
                    onClick={() => setExploreOpen(false)}
                    style={{
                      display: 'block',
                      padding: '8px 16px',
                      fontSize: '15px',
                      color: 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Directory
                  </Link>
                </div>
              )}
            </div>
            <Link
              href="/evidence"
              className="no-link-style"
              style={NAV_LINK_STYLE}
            >
              Evidence
            </Link>
            <Link
              href="/learn"
              className="no-link-style"
              style={NAV_LINK_STYLE}
            >
              Learn
            </Link>
            <Link
              href="/about"
              className="no-link-style"
              style={NAV_LINK_STYLE}
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
          {/* Explore section header */}
          <span
            style={{
              color: 'var(--text-muted)',
              fontWeight: 600,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Explore
          </span>
          <Link
            href="/explore"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
              paddingLeft: '12px',
            }}
          >
            Data Flow
          </Link>
          <Link
            href="/directory"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
              paddingLeft: '12px',
            }}
          >
            Directory
          </Link>
          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
          <Link
            href="/evidence"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
            }}
          >
            Evidence
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
