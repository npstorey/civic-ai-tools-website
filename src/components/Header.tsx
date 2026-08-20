'use client';

import { useState, useRef, useEffect } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { TYPED_STANDARDS_URL } from '@/lib/site-config';
import { UNNAMED_WORDMARK } from '@/lib/brand-config';
import {
  DEFAULT_SIGN_IN_OPTIONS,
  resolveSignInAffordance,
  type SignInOption,
} from '@/lib/auth-provider-options';
import { useCrossHostSession } from '@/hooks/useCrossHostSession';
import type { SessionAffordanceTarget } from '@/lib/allowed-origins';

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

/**
 * Every cross-host target this header needs is env-derived and passed in by
 * the root layout; none of it is computed from the request's host, so the
 * markup is identical on every host and every render.
 *
 * - `dashboardHref` (P3) — the marketing host withholds `/dashboard`, so on a
 *   split-host deployment the signed-in menu points at the app host.
 * - `marketingOrigin` (P4c) — prefix for the nav's marketing routes, which
 *   the APP host withholds. `''` (the default, and unset topology) leaves
 *   every href exactly the relative one it is today; `null` means an
 *   app-only instance with no marketing site, and those items are hidden
 *   rather than pointed at a 404.
 * - `signInHref` (P4c) — where "sign in" should go. On the marketing host an
 *   in-place `signIn()` cannot finish: the OAuth state cookie is written for
 *   the host the click happened on, and the session belongs to the app host,
 *   so the round-trip dies at the provider's redirect warning. Non-null
 *   turns the button into a plain link to the app surface's sign-in panel;
 *   `null` (the default, and unset topology) keeps today's in-place button.
 * - `brandName` (#217) — the wordmark text, resolved by the layout from
 *   `SITE_BRAND_NAME` (src/lib/brand-config.ts). REQUIRED, and nullable:
 *   there is no default (#259 P4, D8). It used to default to the reference
 *   deployment's name — latent, since the one live mount passes the prop,
 *   but a trap set for the next mount, which would have shipped that name
 *   into an operator's header without anyone editing a config file. `null`
 *   means the instance has not named itself and the wordmark falls back to
 *   `UNNAMED_WORDMARK`, a navigation label rather than an identity.
 * - `showRoadmap` (#241) — whether this instance has a roadmap of its own
 *   (`ROADMAP_RAW_URL`). `false` hides the Roadmap nav entries rather than
 *   pointing them at a page that says nothing has been published — the same
 *   treatment `marketingOrigin: null` gives the marketing links. `true` is
 *   the default and today's nav.
 * - `signInOptions` (#229 P1) — the providers this instance actually
 *   configured, derived by the layout from `buildProviders()`. Only the
 *   in-place branch below reads it (the split-host branch links to the `/ask`
 *   panel, which lists the providers itself). The default is today's single
 *   GitHub button.
 * - `sessionProbe` (#229 P3 / Q64) — the app host's session-status URL and
 *   the "Open app →" target, derived by the layout from
 *   `resolveSessionAffordance`. Non-null only on a full split topology;
 *   `null` (the default, and every other configuration) fires no fetch and
 *   renders every affordance unchanged.
 */
export default function Header({
  dashboardHref = '/dashboard',
  marketingOrigin = '',
  signInHref = null,
  brandName,
  showRoadmap = true,
  signInOptions = DEFAULT_SIGN_IN_OPTIONS,
  sessionProbe = null,
}: {
  dashboardHref?: string;
  marketingOrigin?: string | null;
  signInHref?: string | null;
  brandName: string | null;
  showRoadmap?: boolean;
  signInOptions?: SignInOption[];
  sessionProbe?: SessionAffordanceTarget | null;
}) {
  const { data: session, status } = useSession();

  // Cross-host session probe (Q64): only on a split topology
  // (sessionProbe non-null) and only while this browser has no local
  // session. `false` — the mount value, and the value after any probe
  // failure — keeps the sign-in control exactly as it is today.
  const crossHostSignedIn = useCrossHostSession(
    sessionProbe?.statusUrl ?? null,
    !session,
  );
  const headerRef = useRef<HTMLElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const exploreRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Marketing-route href, prefixed with the marketing origin when one is
  // configured. With the default empty prefix this is the identity function
  // on the path — the byte-identity guarantee, in one expression.
  const showMarketingNav = marketingOrigin !== null;
  const mkt = (path: string) => `${marketingOrigin ?? ''}${path}`;

  // The in-place sign-in control, for instances with no app host to send
  // anyone to. One configured provider ⇒ that provider's button (GitHub's, on
  // the reference deployment — today's exact markup); none ⇒ no button; more
  // than one ⇒ a link to the panel that can list them. See
  // resolveSignInAffordance.
  const signInAffordance = resolveSignInAffordance(signInOptions);

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
            {brandName ?? UNNAMED_WORDMARK}
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
                    backgroundColor: 'var(--white)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 10,
                    padding: '4px 0',
                  }}
                >
                  {showMarketingNav && (
                    <>
                  <Link
                    href={mkt('/explore')}
                    onClick={() => setExploreOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Data Flow
                  </Link>
                  <Link
                    href={mkt('/directory')}
                    onClick={() => setExploreOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Directory
                  </Link>
                    </>
                  )}
                  {/* Dual-served by design (P3): stays relative on both hosts. */}
                  <Link
                    href="/records"
                    onClick={() => setExploreOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Records
                  </Link>
                </div>
              )}
            </div>
            {showMarketingNav && (
              <>
            <Link
              href={mkt('/learn')}
              className="no-link-style"
              style={NAV_LINK_STYLE}
            >
              Learn
            </Link>
            <Link
              href={mkt('/project')}
              className="no-link-style"
              style={NAV_LINK_STYLE}
            >
              Project
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
                    backgroundColor: 'var(--white)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 10,
                    padding: '4px 0',
                  }}
                >
                  <Link
                    href={mkt('/about')}
                    onClick={() => setAboutOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    About
                  </Link>
                  {/* Roadmap: only for an instance that has one (#241). */}
                  {showRoadmap && (
                  <Link
                    href={mkt('/roadmap')}
                    onClick={() => setAboutOpen(false)}
                    style={DROPDOWN_ITEM_STYLE}
                    onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Roadmap
                  </Link>
                  )}
                </div>
              )}
            </div>
              </>
            )}
            <a
              href={TYPED_STANDARDS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="no-link-style"
              style={NAV_LINK_STYLE}
            >
              Typed Standards
              <span aria-hidden="true" style={{ fontSize: '11px', marginLeft: '4px', color: 'var(--text-muted)' }}>&#8599;</span>
            </a>
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
                    backgroundColor: 'var(--white)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 10,
                    padding: '4px 0',
                  }}
                >
                  <Link
                    href={dashboardHref}
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
          ) : signInHref !== null && sessionProbe !== null ? (
            /* Full split topology (Q64): the same link as the plain branch
               below, but session-aware — when the cross-host probe finds a
               session on the app host, "Sign in" becomes "Open app →"
               pointing there. CLS-safe by reservation: both labels occupy
               the same grid cell from first paint, so the control's box is
               sized to the wider label and cannot shift at swap time; the
               inactive label is hidden but keeps contributing its width. */
            <a
              href={crossHostSignedIn ? sessionProbe.openAppHref : signInHref}
              className="ui-button ui-button-primary"
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                textDecoration: 'none',
                display: 'inline-grid',
              }}
            >
              <span
                aria-hidden={crossHostSignedIn}
                style={{
                  gridArea: '1 / 1',
                  textAlign: 'center',
                  visibility: crossHostSignedIn ? 'hidden' : 'visible',
                }}
              >
                Sign in
              </span>
              <span
                aria-hidden={!crossHostSignedIn}
                style={{
                  gridArea: '1 / 1',
                  textAlign: 'center',
                  visibility: crossHostSignedIn ? 'visible' : 'hidden',
                }}
              >
                Open app &rarr;
              </span>
            </a>
          ) : signInHref !== null ? (
            /* Split topology: sign-in happens on the app surface, so this is
               a plain link — it works before hydration, and the label drops
               the provider name because the panel it lands on lists whatever
               providers the instance actually configured. */
            <a
              href={signInHref}
              className="ui-button ui-button-primary"
              style={{ padding: '8px 16px', fontSize: '14px', textDecoration: 'none' }}
            >
              Sign in
            </a>
          ) : signInAffordance.kind === 'provider' ? (
            <button
              onClick={() => signIn(signInAffordance.option.id)}
              className="ui-button ui-button-primary"
              style={{ padding: '8px 16px', fontSize: '14px' }}
            >
              Sign in with {signInAffordance.option.name}
            </button>
          ) : signInAffordance.kind === 'panel' ? (
            <a
              href={signInAffordance.href}
              className="ui-button ui-button-primary"
              style={{ padding: '8px 16px', fontSize: '14px', textDecoration: 'none' }}
            >
              Sign in
            </a>
          ) : null}
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
          {showMarketingNav && (
            <>
          <Link
            href={mkt('/explore')}
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
            href={mkt('/directory')}
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
            </>
          )}
          <Link
            href="/records"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
              paddingLeft: '12px',
            }}
          >
            Records
          </Link>
          {showMarketingNav && (
            <>
          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
          <Link
            href={mkt('/learn')}
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
          <Link
            href={mkt('/project')}
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
            }}
          >
            Project
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
            href={mkt('/about')}
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
          {/* Roadmap: only for an instance that has one (#241). */}
          {showRoadmap && (
          <Link
            href={mkt('/roadmap')}
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
          )}
            </>
          )}
          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
          <a
            href={TYPED_STANDARDS_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: '16px',
              textDecoration: 'none',
            }}
          >
            Typed Standards
            <span aria-hidden="true" style={{ fontSize: '11px', marginLeft: '4px', color: 'var(--text-muted)' }}>&#8599;</span>
          </a>
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
                href={dashboardHref}
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
