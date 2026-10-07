'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Carries whether this instance runs notebooks (`EXECUTOR_DRIVER=none`, #547,
 * resolved on the server by `notebooksOffered()` in
 * src/lib/notebook-availability.ts) to the query form, on every mount that
 * renders it.
 *
 * WHY A CONTEXT AND NOT A PROP, the reason `DefaultPortalProvider` gives: the
 * form renders inside `QuerySurface`, and one of its two mounts, the home
 * page, is a client component with no server ancestor to thread a prop from.
 * Mounted in the root layout beside the default-portal and sign-in providers,
 * so `/ask` and the home page read the same value. The home page is
 * prerendered, so it follows the value `next build` saw; `/ask` renders per
 * request and follows the running server's (docs/deploy.md, executor settings).
 *
 * Its own context, not a field on another provider: whether notebooks run is
 * not a statement about portals, sign-in or branding, and an instance sets it
 * independently of all three.
 *
 * Outside the provider, and with nothing passed, it reads `true`: the form an
 * instance had before the value existed. The route refuses under `none`
 * whatever a form renders.
 */
const NotebooksOfferedContext = createContext<boolean>(true);

export function NotebookModeProvider({
  offered = true,
  children,
}: {
  /** `notebooksOffered()` as the server resolved it; omitted = notebooks run. */
  offered?: boolean;
  children: ReactNode;
}) {
  return <NotebooksOfferedContext.Provider value={offered}>{children}</NotebooksOfferedContext.Provider>;
}

/** False only when this instance runs no notebooks. Safe outside the provider (true). */
export function useNotebooksOffered(): boolean {
  return useContext(NotebooksOfferedContext);
}
