'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { InstanceAttribution } from '@/lib/site-config';

/**
 * Carries the server-resolved instance attribution identity (`PUBLISHER_*`
 * set, ADR-0020 — src/lib/site-config.ts `getInstanceAttribution()`) to
 * client components that props cannot reach (#227, #258 A2) — the exact
 * shape of `BrandProvider` and `HostLinksProvider`, and mounted beside them
 * in the root layout. Non-NEXT_PUBLIC env never reaches the browser bundle,
 * so this context is HOW a client surface (the notebook Download button, the
 * publish dialog's skeleton notebook, the chat citation preview) learns the
 * instance's origin, host label, and display name.
 *
 * WHY A CONTEXT AND NOT PROP THREADING. The consumers render deep inside
 * 'use client' trees with no server ancestor to extend a prop chain from —
 * the same reasoning documented in `BrandProvider`. The rule: props where
 * the server can reach, context only where the client boundary blocks it.
 *
 * WHY NOT `BrandProvider`. The origin is publisher instance identity
 * (`PUBLISHER_*` set), deliberately separate from the `SITE_BRAND_*` chrome
 * seam — brand-config.ts's "CHROME, NOT PUBLISHER IDENTITY" contract says the two
 * families never read each other, so they don't share a context either.
 *
 * The default value is honest absence (all null): a component rendered
 * outside the provider — a test, a future surface that forgets to mount it —
 * OMITS attribution rather than claiming the reference deployment's
 * identity (#258: no identity defaults, anywhere).
 */
const InstanceAttributionContext = createContext<InstanceAttribution>({
  origin: null,
  host: null,
  platformTitle: null,
});

export function EvidenceOriginProvider({
  value,
  children,
}: {
  value: InstanceAttribution;
  children: ReactNode;
}) {
  return (
    <InstanceAttributionContext.Provider value={value}>
      {children}
    </InstanceAttributionContext.Provider>
  );
}

/** Read the instance's full attribution identity (all members nullable —
 *  null means "not configured"; the surface omits its attribution line). */
export function useInstanceAttribution(): InstanceAttribution {
  return useContext(InstanceAttributionContext);
}

/** Read the instance's evidence site origin, or null when none is declared.
 *  Safe outside the provider (see above). */
export function useEvidenceSiteOrigin(): string | null {
  return useContext(InstanceAttributionContext).origin;
}

/**
 * The origin's host, for surfaces that render a bare host label
 * (`https://example.org` → `example.org`) — the client-side counterpart of
 * `getPublicationHost()`'s derivation in src/lib/site-config.ts. Falls back
 * to the raw value when the origin is not URL-parseable, so an instance that
 * set a bare host still renders something honest rather than nothing; null
 * passes through as null (nothing declared → nothing rendered).
 */
export function toDisplayHost(origin: string | null): string | null {
  if (origin === null) return null;
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
