'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Carries the server-resolved Socrata MCP endpoint (`SOCRATA_MCP_URL`, via
 * `readMcpEnvFromProcess()` in src/lib/mcp/registry.ts) to client components
 * that props cannot reach (#258 C5) — the exact shape of `BrandProvider` and
 * `EvidenceOriginProvider`, and mounted beside them in the root layout. This
 * retires the build-time `NEXT_PUBLIC_*` twin that name-split the same
 * setting: ONE configured value now reaches server and client alike, so the
 * two can never disagree about where queries route.
 *
 * WHY A CONTEXT AND NOT PROP THREADING. The consumer (`ChatNotebookOutput`'s
 * environment section) renders deep inside 'use client' trees with no server
 * ancestor to extend a prop chain from — the same reasoning documented in
 * `BrandProvider`. The rule: props where the server can reach, context only
 * where the client boundary blocks it.
 *
 * WHY NOT `EvidenceOriginProvider`. The MCP endpoint is data-source ROUTING,
 * not instance identity (`EVIDENCE_*` set) and not chrome branding
 * (`SITE_BRAND_*`) — a third family, so its own provider, matching how those
 * two deliberately never share a context.
 *
 * The default value is honest absence (null): a component rendered outside
 * the provider — a test, a future surface that forgets to mount it — OMITS
 * its host mention rather than claiming the reference deployment's server
 * (#258: no routing defaults, anywhere).
 */
const SocrataMcpUrlContext = createContext<string | null>(null);

export function McpRoutingProvider({
  value,
  children,
}: {
  value: string | null;
  children: ReactNode;
}) {
  return <SocrataMcpUrlContext.Provider value={value}>{children}</SocrataMcpUrlContext.Provider>;
}

/** Read the instance's configured Socrata MCP URL, or null when none is
 *  configured (the surface omits its host mention). Safe outside the
 *  provider (see above). */
export function useSocrataMcpUrl(): string | null {
  return useContext(SocrataMcpUrlContext);
}
