'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

/**
 * App-surface chrome — the slim context strip for the `(app)` route group
 * (app front-door v0.1.0, P2).
 *
 * WHAT IT ADDS, and why it is not a second header. `(app)` pages already
 * inherit the full site chrome from the root layout: `Header` (brand, nav,
 * signed-in avatar + user menu with Dashboard and Sign out) and the site
 * footer. Duplicating any of that here would be the "parallel version"
 * mistake the repo conventions call out. This strip composes with it,
 * answering the three questions the app surface owes a signed-in user that
 * the marketing header does not:
 *
 *   1. WHO AM I — identity stated in the page body, not hidden behind an
 *      avatar menu, because on the app surface "which account is this?" is a
 *      question you must be able to answer at a glance before publishing
 *      anything under it.
 *   2. WHERE IS MY WORK — a direct Dashboard link, current-page aware.
 *   3. HOW DO I GET OUT — an explicit exit to the public site.
 *
 * CLIENT COMPONENT ON PURPOSE. It reads the session through `useSession()`
 * (the provider is already mounted in the root layout) rather than
 * `getServerSession()`. A server-side session read in the `(app)` layout
 * would opt every route in the group into dynamic rendering — including the
 * public evidence pages, which are not this phase's to change.
 *
 * SIGNED OUT ⇒ RENDERS NOTHING. This is load-bearing, not a cosmetic choice:
 * `/evidence` and `/evidence/[slug]` live in `(app)` and are public pages on
 * the apex today, linked from the marketing nav. An anonymous visitor to a
 * published evidence page must see exactly what they saw before this phase.
 * All three items above are signed-in concerns anyway — there is no identity
 * to state, and the dashboard would only bounce a signed-out visitor home.
 *
 * NOT A GATE. This component decides what to DISPLAY; it never decides who
 * may READ. The sprint's gate is at sign-in (`SIGN_IN_ALLOWLIST`, checked in
 * `callbacks.signIn`); host separation arrives in P3.
 */
export default function AppChrome() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // `loading` renders nothing too — a strip that flashes in on hydration and
  // out again for anonymous visitors is worse than one that arrives late.
  if (status !== 'authenticated' || !session?.user) return null;

  const displayName = session.user.name || session.user.email || 'your account';
  const onDashboard = pathname === '/dashboard';

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border-color)',
        backgroundColor: 'var(--card-background)',
        padding: '8px 24px',
        fontSize: '13px',
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
      }}
    >
      <div
        className="max-w-6xl mx-auto"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <span>
          Signed in as{' '}
          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{displayName}</strong>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {onDashboard ? (
            <span aria-current="page" style={{ color: 'var(--text-muted)' }}>
              Dashboard
            </span>
          ) : (
            <Link href="/dashboard" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
              Dashboard
            </Link>
          )}
          {/* The way out. Relative on purpose: on a single host `/` is the
              public site, and when P3 splits the hosts this one href is the
              single place that becomes the apex origin. */}
          <Link href="/" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            Public site
            <span aria-hidden="true" style={{ marginLeft: '4px', color: 'var(--text-muted)' }}>
              &#8599;
            </span>
          </Link>
        </span>
      </div>
    </div>
  );
}
