'use client';

import { createContext, useContext, type ReactNode } from 'react';

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
 * The default is `null` — "this instance has not named itself" — which is
 * also what a component rendered outside the provider sees (#259 P4, A3). It
 * used to be the reference deployment's own name, so a surface that forgot
 * to mount the provider would silently credit that deployment in citation
 * text it copies to the clipboard. Consumers render the unnamed case
 * honestly instead: no publisher rather than the wrong one.
 */
const BrandNameContext = createContext<string | null>(null);

export function BrandProvider({
  value,
  children,
}: {
  value: string | null;
  children: ReactNode;
}) {
  return <BrandNameContext.Provider value={value}>{children}</BrandNameContext.Provider>;
}

/** Read the instance brand name, or `null` when it has none (see above). */
export function useBrandName(): string | null {
  return useContext(BrandNameContext);
}
