/**
 * Layout for the `(app)` route group — the gated app surface's shell
 * (app front-door v0.1.0, P2).
 *
 * DELIBERATELY NOT AN AUTH BOUNDARY. There is no `getServerSession` call, no
 * redirect, and no blanket enforcement here, and adding one would be a
 * regression rather than a hardening: `/evidence` and `/evidence/[slug]` live
 * in this group and are PUBLIC pages on the apex today, linked from the
 * marketing nav — a layout-level gate would take the published evidence
 * registry offline for everyone who is not signed in. Two other reasons the
 * boundary does not belong here: the sprint's gate is at sign-in
 * (`SIGN_IN_ALLOWLIST` in `callbacks.signIn`), and host separation — which
 * routes are served where — lives in the proxy (`src/proxy.ts`). Routes that
 * DO need a session keep enforcing it themselves, as `/dashboard` already
 * does.
 *
 * A PASSTHROUGH SINCE UX-1 P3a. This layout used to mount `AppChrome`, a
 * signed-in strip above the group's pages carrying the identity line, Ask,
 * Dashboard and "Public site". The site Header now carries each of them on
 * every page: Ask in the bar, the identity on the avatar trigger, and
 * "My analyses" and "Public site" in the avatar menu — each resolved by the
 * root layout from the same host-topology env vars (`resolveAskHref`,
 * `resolveDashboardHref`, `resolvePublicSiteHref`).
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
