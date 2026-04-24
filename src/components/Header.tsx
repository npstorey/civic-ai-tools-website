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

const DROPDOWN_ITEM_STYLE: React.CSSProperties = {
  display: 'block',
  padding: '8px 16px',
  fontSize: '15px',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  fontWeight: 500,
};

export default function Header() {
  const { data: session, status } = useSession();
  const headerRef = useRef<HTMLElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const exploreRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // Close dropdowns on outside click
  useEffect(() => {
    if (!exploreOpen && !aboutOpen && !userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (exploreOpen && exploreRef.current && !exploreRef.current.contains(e.target as Node)) {
        setExploreOpen(false);
      }
      if (aboutOpen && aboutRef.current && !aboutRef.current.contains(e.target as Node)) {
        setAboutOpen(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exploreOpen, aboutOpen, userMenuOpen]);

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
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Data Flow
                  </Link>
                  <Link
                    href="/directory"
                    onClick={() => setExploreOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Directory
                  </Link>
                  <Link
                    href="/evidence"
                    onClick={() => setExploreOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Evidence
                  </Link>
                </div>
              )}
            </div>
            <Link
              href="/learn"
              className="no-link-style"
              style={NAV_LINK_STYLE}
            >
              Learn
            </Link>
            {/* About dropdown */}
            <div ref={aboutRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setAboutOpen(!aboutOpen)}
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
                About
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>&#9662;</span>
              </button>
              {aboutOpen && (
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
                    href="/about"
                    onClick={() => setAboutOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    About
                  </Link>
                  <Link
                    href="/roadmap"
                    onClick={() => setAboutOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Roadmap
                  </Link>
                </div>
              )}
            </div>
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
            /* User menu dropdown */
            <div ref={userMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
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
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>&#9662;</span>
              </button>
              {userMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
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
                    href="/dashboard"
                    onClick={() => setUserMenuOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Dashboard
                  </Link>
                  <button
                    onClick={() => { setUserMenuOpen(false); signOut(); }}
                    style={{
                      ...DROPDOWN_ITEM_STYLE,
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Sign out
                  </button>
                </div>
              )}
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
          {/* Explore section */}
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
          <Link
            href="/evidence"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
              paddingLeft: '12px',
            }}
          >
            Evidence
          </Link>
          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
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
          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
          {/* About section */}
          <span
            style={{
              color: 'var(--text-muted)',
              fontWeight: 600,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            About
          </span>
          <Link
            href="/about"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
              paddingLeft: '12px',
            }}
          >
            About
          </Link>
          <Link
            href="/roadmap"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
              paddingLeft: '12px',
            }}
          >
            Roadmap
          </Link>
          {/* Account section (logged in only) */}
          {session && (
            <>
              <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
              <span
                style={{
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  fontSize: '13px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Your account
              </span>
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                  fontSize: '16px',
                  textDecoration: 'none',
                  paddingLeft: '12px',
                }}
              >
                Dashboard
              </Link>
              <button
                onClick={() => { setMobileMenuOpen(false); signOut(); }}
                style={{
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                  fontSize: '16px',
                  textDecoration: 'none',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  padding: 0,
                  paddingLeft: '12px',
                }}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}
