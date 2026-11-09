'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TYPED_STANDARDS_URL } from '@/lib/site-config';
import { UNNAMED_WORDMARK } from '@/lib/brand-config';
import {
  DEFAULT_SIGN_IN_OPTIONS,
  resolveSignInAffordance,
  type SignInOption,
} from '@/lib/auth-provider-options';
import { useCrossHostSession } from '@/hooks/useCrossHostSession';
import type { SessionAffordanceTarget } from '@/lib/allowed-origins';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { Sheet } from '@/components/ui/Sheet';
import { SETTINGS_HREF } from '@/lib/sources/copy';

const NAV_LINK_STYLE: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontWeight: 500,
  fontSize: '16px',
};

const DRAWER_LINK_STYLE: React.CSSProperties = {
  display: 'block',
  padding: '6px 0',
  color: 'var(--text-secondary)',
  fontWeight: 500,
  fontSize: '16px',
  textDecoration: 'none',
};

const DRAWER_ITEM_STYLE: React.CSSProperties = { ...DRAWER_LINK_STYLE, paddingLeft: '12px' };

const DRAWER_GROUP_LABEL_STYLE: React.CSSProperties = {
  margin: '12px 0 4px',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: '13px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const ARROW_STYLE: React.CSSProperties = { fontSize: '11px', marginLeft: '4px', color: 'var(--text-muted)' };

interface NavLink {
  id: string;
  label: string;
  href: string;
}

/** One entry of the bar: a link, or a menu of links. The drawer renders the same list. */
type NavEntry =
  | ({ kind: 'link'; external?: boolean } & NavLink)
  | { kind: 'menu'; id: string; label: string; items: NavLink[] };

/**
 * A bar or drawer link: an external one opens a new tab and carries the ↗ glyph. `current` marks the link to the
 * page being shown (`aria-current="page"`, UX-2 P3b-1, #728 line 13).
 */
function renderLink(entry: Extract<NavEntry, { kind: 'link' }>, style: React.CSSProperties, onClick?: () => void, current = false) {
  if (entry.external) {
    return (
      <a
        key={entry.id}
        href={entry.href}
        target="_blank"
        rel="noopener noreferrer"
        className="no-link-style"
        style={style}
        onClick={onClick}
      >
        {entry.label}
        <span aria-hidden="true" style={ARROW_STYLE}>&#8599;</span>
      </a>
    );
  }
  return (
    <Link key={entry.id} href={entry.href} className="no-link-style" style={style} onClick={onClick} aria-current={current ? 'page' : undefined}>
      {entry.label}
    </Link>
  );
}

/*
 * THE BAR (UX-1 P3a; R7 A, R13 A). Left to right: the wordmark; Ask;
 * Analysis (`/records`, dual-served, so it stays relative on both hosts);
 * Explore ▾ (Data Flow, Directory); About ▾ (About, Learn, Roadmap when
 * shown, Talks); Project; Typed Standards ↗. Explore, About and Project are
 * marketing routes, so an instance with no marketing surface
 * (`marketingOrigin: null`) shows none of them — Explore would be a menu
 * with no items. The two menus and the avatar menu are P0's `Menu`; the
 * mobile drawer is P0's `Sheet`, built from the same `entries` list so it
 * holds the bar's grouping in the bar's order. Account items stay in the
 * avatar menu, which renders at every width.
 */

/**
 * Every cross-host target this header needs is env-derived and passed in by
 * the root layout; none of it is computed from the request's host, so the
 * markup is identical on every host and every render.
 *
 * - `dashboardHref` (P3) — the marketing host withholds `/dashboard`, so on a
 *   split-host deployment the signed-in menu points at the app host.
 * - `askHref` (UX-1 P3a; was `AppChrome`'s, #210) — `resolveAskHref`: `/ask`,
 *   or the app origin's `/ask` on a split-host deployment, because `/ask` is
 *   app-private and this header renders on the marketing host too. Signed
 *   out on a split-host deployment, Ask links `/` instead: the header cannot
 *   tell which host it is on, and `/` is right on both — the marketing host
 *   serves its own query surface there, and the app host sends `/` to
 *   `/ask` (`APP_ROOT_ACTION`, src/lib/host-routing.ts).
 * - `publicSiteHref` (UX-1 P3a; was `AppChrome`'s exit link) —
 *   `resolvePublicSiteHref`: the avatar menu's "Public site" item, hidden
 *   when null (an instance that serves no marketing surface).
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
  askHref = '/ask',
  publicSiteHref = null,
  marketingOrigin = '',
  signInHref = null,
  brandName,
  showRoadmap = true,
  signInOptions = DEFAULT_SIGN_IN_OPTIONS,
  sessionProbe = null,
}: {
  dashboardHref?: string;
  askHref?: string;
  publicSiteHref?: string | null;
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
  const drawerId = useId();
  const closeDrawer = () => setMobileMenuOpen(false);

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

  // A non-empty marketing origin means a split-host deployment. Signed out
  // there, Ask is `/` (see `askHref` above).
  const askLink = !session && marketingOrigin ? '/' : askHref;
  // The page being shown (UX-2 P3b-1, #728 line 13), read from the path, never from a link's href: signed out on a
  // split topology Ask links to `/`, and the home page is not Ask's page.
  const pathname = usePathname();
  const isCurrent = (id: string): boolean => (id === 'ask' && pathname === '/ask') || (id === 'my-analyses' && pathname === '/dashboard');
  const wordmark = brandName ?? UNNAMED_WORDMARK;

  const entries: NavEntry[] = [
    { kind: 'link', id: 'ask', label: 'Ask', href: askLink },
    // Dual-served by design (P3): stays relative on both hosts.
    { kind: 'link', id: 'analysis', label: 'Analysis', href: '/records' },
  ];
  if (showMarketingNav) {
    entries.push(
      {
        kind: 'menu',
        id: 'explore',
        label: 'Explore',
        items: [
          { id: 'data-flow', label: 'Data Flow', href: mkt('/explore') },
          { id: 'directory', label: 'Directory', href: mkt('/directory') },
        ],
      },
      {
        kind: 'menu',
        id: 'about',
        label: 'About',
        items: [
          { id: 'about', label: 'About', href: mkt('/about') },
          { id: 'learn', label: 'Learn', href: mkt('/learn') },
          // Roadmap: only for an instance that has one (#241).
          ...(showRoadmap ? [{ id: 'roadmap', label: 'Roadmap', href: mkt('/roadmap') }] : []),
          { id: 'talks', label: 'Talks', href: mkt('/talks') },
        ],
      },
      { kind: 'link', id: 'project', label: 'Project', href: mkt('/project') },
    );
  }
  entries.push({ kind: 'link', id: 'typed-standards', label: 'Typed Standards', href: TYPED_STANDARDS_URL, external: true });

  // The account's identity, as the app surface's strip stated it before
  // UX-1 P3a removed that strip: the name, else the email.
  const identity = session?.user?.name || session?.user?.email || null;
  const accountItems: MenuItem[] = [
    { id: 'my-analyses', label: 'My analyses', href: dashboardHref, ...(isCurrent('my-analyses') ? { current: true } : {}) },
    // UX-2 P4b: the Settings overlay, a text item with no icon; relative, since `/settings` is served on both hosts.
    { id: 'settings', label: 'Settings', href: SETTINGS_HREF },
    ...(publicSiteHref !== null
      ? [{
          id: 'public-site',
          label: (
            <>
              Public site
              <span aria-hidden="true" style={ARROW_STYLE}>&#8599;</span>
            </>
          ),
          href: publicSiteHref,
        }]
      : []),
    { id: 'sign-out', label: 'Sign out' },
  ];

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
            {wordmark}
          </Link>
          <nav className="hidden lg:flex items-center gap-6">
            {entries.map((entry) =>
              entry.kind === 'menu' ? (
                <Menu key={entry.id} trigger={entry.label} items={entry.items} />
              ) : (
                renderLink(entry, NAV_LINK_STYLE, undefined, isCurrent(entry.id))
              ),
            )}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {/* Mobile menu: opens the drawer */}
          <button
            type="button"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
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
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
          {status === 'loading' ? (
            <div
              className="h-10 w-24 rounded animate-pulse"
              style={{ backgroundColor: 'var(--skeleton-color)' }}
            />
          ) : session ? (
            <Menu
              trigger={
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {session.user?.image && (
                    <Image
                      src={session.user.image}
                      alt={identity || 'User'}
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
                    {identity}
                  </span>
                </span>
              }
              triggerLabel={identity ?? undefined}
              items={accountItems}
              align="end"
              onSelect={(id) => {
                if (id === 'sign-out') signOut();
              }}
            />
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

      {/* The mobile drawer: the bar's grouping, in the bar's order. */}
      <Sheet open={mobileMenuOpen} onClose={closeDrawer} title={wordmark}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {entries.map((entry) =>
            entry.kind === 'menu' ? (
              <div key={entry.id} role="group" aria-labelledby={`${drawerId}-${entry.id}`}>
                <p id={`${drawerId}-${entry.id}`} style={DRAWER_GROUP_LABEL_STYLE}>
                  {entry.label}
                </p>
                {entry.items.map((item) => (
                  <Link key={item.id} href={item.href} className="no-link-style" style={DRAWER_ITEM_STYLE} onClick={closeDrawer}>
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : (
              renderLink(entry, DRAWER_LINK_STYLE, closeDrawer, isCurrent(entry.id))
            ),
          )}
          {/* UX-2 P4b: signed in only; the drawer does not hold the account menu, so Settings is its own entry here. */}
          {session && (
            <Link href={SETTINGS_HREF} className="no-link-style" style={DRAWER_LINK_STYLE} onClick={closeDrawer}>
              Settings
            </Link>
          )}
        </div>
      </Sheet>
    </header>
  );
}
