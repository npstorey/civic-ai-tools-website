'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEMO_SITE_ORIGIN } from '@/lib/site-config';

/**
 * Carries the server-resolved evidence site origin (`EVIDENCE_SITE_ORIGIN`,
 * ADR-0020 instance identity — src/lib/site-config.ts) to client components
 * that props cannot reach (#227) — the exact shape of `BrandProvider` and
 * `HostLinksProvider`, and mounted beside them in the root layout.
 *
 * WHY A CONTEXT AND NOT PROP THREADING. The consumer,
 * `ChatCitationPreview`, renders deep inside `ChatNotebookOutput`, a
 * `'use client'` tree with no server ancestor to extend a prop chain from —
 * the same reasoning documented in `BrandProvider`. The rule: props where
 * the server can reach, context only where the client boundary blocks it.
 *
 * WHY NOT `BrandProvider`. The origin is evidence instance identity
 * (`EVIDENCE_*` set), deliberately separate from the `SITE_BRAND_*` chrome
 * seam — brand-config.ts's "CHROME, NOT EVIDENCE" contract says the two
 * families never read each other, so they don't share a context either.
 *
 * The default value is the demo origin, so a component rendered outside the
 * provider — a test, a future surface that forgets to mount it — degrades
 * to today's reference-deployment URL rather than to a broken one.
 */
const EvidenceOriginContext = createContext<string>(DEMO_SITE_ORIGIN);

export function EvidenceOriginProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <EvidenceOriginContext.Provider value={value}>{children}</EvidenceOriginContext.Provider>
  );
}

/** Read the instance's evidence site origin. Safe outside the provider (see above). */
export function useEvidenceSiteOrigin(): string {
  return useContext(EvidenceOriginContext);
}
