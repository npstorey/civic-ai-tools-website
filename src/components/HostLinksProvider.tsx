'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_HOST_LINKS, type HostLinks } from '@/lib/host-links';

/**
 * Carries the server-derived cross-host link targets to client components
 * that props cannot reach (app front-door v0.1.0, P4c).
 *
 * WHY A CONTEXT AND NOT PROP THREADING. Three of the four sign-in
 * affordances live inside `QuerySurface` — in `QueryForm`,
 * `RateLimitBanner`, and `McpResponseDisplay` — and the surface is mounted
 * by `(marketing)/page.tsx`, which is itself a client component. A client
 * component cannot read `process.env`, so no prop chain from a server
 * ancestor exists to extend; threading would mean converting the apex page
 * to a server component, which is precisely the acceptance-protected file
 * this sprint may not disturb. One provider mounted once in the root layout
 * reaches all three without touching a single intermediate component.
 *
 * Components the root layout renders DIRECTLY — `Header`, and the footer
 * inside the layout itself — take their values as props instead, extending
 * P3's `dashboardHref` precedent. The rule: props where the server can
 * reach, context only where the client boundary blocks it.
 *
 * The default value is today's behavior (relative marketing hrefs, sign in
 * place), so a component rendered outside the provider — a test, a future
 * surface that forgets to mount it — degrades to the pre-topology shape
 * rather than to broken links.
 */
const HostLinksContext = createContext<HostLinks>(DEFAULT_HOST_LINKS);

export function HostLinksProvider({
  value,
  children,
}: {
  value: HostLinks;
  children: ReactNode;
}) {
  return <HostLinksContext.Provider value={value}>{children}</HostLinksContext.Provider>;
}

/** Read the cross-host link targets. Safe outside the provider (see above). */
export function useHostLinks(): HostLinks {
  return useContext(HostLinksContext);
}
