import AppChrome from '@/components/AppChrome';
import { resolvePublicSiteHref } from '@/lib/host-routing';

/**
 * Layout for the `(app)` route group — the gated app surface's shell
 * (app front-door v0.1.0, P2). Was a bare passthrough.
 *
 * DELIBERATELY NOT AN AUTH BOUNDARY. There is no `getServerSession` call, no
 * redirect, and no blanket enforcement here, and adding one would be a
 * regression rather than a hardening: `/evidence` and `/evidence/[slug]` live
 * in this group and are PUBLIC pages on the apex today, linked from the
 * marketing nav — a layout-level gate would take the published evidence
 * registry offline for everyone who is not signed in. Two other reasons the
 * boundary does not belong here: the sprint's gate is at sign-in
 * (`SIGN_IN_ALLOWLIST` in `callbacks.signIn`), and host separation — which
 * routes are served where — arrives with P3's middleware. Routes that DO need
 * a session keep enforcing it themselves, as `/dashboard` already does.
 *
 * So this layout is chrome only: it composes `AppChrome` above the group's
 * pages, on top of the site header and footer the root layout already
 * provides. `AppChrome` renders nothing at all for a signed-out visitor, so
 * the public evidence pages are untouched.
 *
 * The "Public site" exit link is resolved HERE (a server component) from
 * the host-topology env vars and passed down as a plain prop — AppChrome is
 * a client component and non-NEXT_PUBLIC env never reaches the browser
 * bundle. Unset topology resolves to `/`, today's exact link. For routes
 * prerendered at build time the value freezes at build, the same semantics
 * an inlined NEXT_PUBLIC var would have.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <AppChrome publicSiteHref={resolvePublicSiteHref(process.env)} />
      {children}
    </>
  );
}
