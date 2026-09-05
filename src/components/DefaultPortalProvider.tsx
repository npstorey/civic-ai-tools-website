'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Carries the server-resolved default portal (`SITE_DEFAULT_PORTAL`, via
 * `getDefaultPortal()` in src/lib/site-config.ts) to client components that
 * props cannot reach (#407) — the exact shape of `McpRoutingProvider`, and
 * mounted beside it in the root layout. ONE configured value reaches server
 * and client alike, so the form, the live-trace diagram and the query routes
 * can never disagree about which portal an unqualified question goes to.
 *
 * WHY A CONTEXT AND NOT PROP THREADING. The consumers — `QueryForm`'s example
 * list and portal selector, `QuerySurface`'s submit handler, `McpFlowDiagram`'s
 * live run, `McpResponseDisplay`'s notebook download — render inside 'use
 * client' trees with no server ancestor to extend a prop chain from. The rule,
 * from `BrandProvider`: props where the server can reach, context only where
 * the client boundary blocks it.
 *
 * WHY NOT `McpRoutingProvider`. That one carries WHICH SERVER a query is
 * routed to (`SOCRATA_MCP_URL`); this one carries WHICH PORTAL that server is
 * asked about when the caller named none. They are set independently — one
 * Socrata MCP endpoint fronts many portals — and an instance may configure
 * either without the other, so folding them into one context would let a
 * surface read a value the operator never tied to it. Separate families,
 * separate providers, matching how the chrome, identity and routing contexts
 * deliberately never read each other.
 *
 * The default value is honest absence (null): a component rendered outside the
 * provider — a test, a future surface that forgets to mount it — carries NO
 * default portal rather than one deployment's city (#407: no portal defaults,
 * anywhere). Absence is a supported run state, not a broken one; the model
 * names its own portal on each call and the record reports what the call
 * carried.
 */
const DefaultPortalContext = createContext<string | null>(null);

export function DefaultPortalProvider({
  value,
  children,
}: {
  value: string | null;
  children: ReactNode;
}) {
  return <DefaultPortalContext.Provider value={value}>{children}</DefaultPortalContext.Provider>;
}

/** Read the instance's configured default portal, or null when it has none
 *  (the run carries no default). Safe outside the provider (see above). */
export function useDefaultPortal(): string | null {
  return useContext(DefaultPortalContext);
}

/**
 * The default portal as the wire value the query routes accept: the configured
 * hostname, or `''` when none is configured.
 *
 * The empty string is what "no portal" has always meant on this wire — it is
 * the `id` of the form's "All portals" entry, and every route reads `portal`
 * as optional and treats an empty one as absent. Callers that hand a portal to
 * an API therefore use this; callers that RENDER one use `useDefaultPortal()`
 * and omit on null, because `''` is not something to show a reader.
 */
export function useDefaultPortalArg(): string {
  return useDefaultPortal() ?? '';
}
