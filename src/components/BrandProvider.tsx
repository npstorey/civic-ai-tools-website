'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEMO_BRAND_NAME } from '@/lib/brand-config';

/**
 * Carries the server-resolved brand name to client components that props
 * cannot reach (instance branding seam, #217) — the exact shape of
 * `HostLinksProvider`, and mounted beside it in the root layout.
 *
 * WHY A CONTEXT AND NOT PROP THREADING. `ChatCitationPreview` renders deep
 * inside `ChatNotebookOutput`, which is a `'use client'` tree with no server
 * ancestor to extend a prop chain from. Components a server component
 * renders directly — `Header` (via the root layout), `EvidenceActions` (via
 * the evidence detail page) — take the name as a prop instead: props where
 * the server can reach, context only where the client boundary blocks it.
 *
 * The default value is the demo brand name, so a component rendered outside
 * the provider — a test, a future surface that forgets to mount it —
 * degrades to today's chrome rather than to a blank label.
 */
const BrandNameContext = createContext<string>(DEMO_BRAND_NAME);

export function BrandProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return <BrandNameContext.Provider value={value}>{children}</BrandNameContext.Provider>;
}

/** Read the instance brand name. Safe outside the provider (see above). */
export function useBrandName(): string {
  return useContext(BrandNameContext);
}
