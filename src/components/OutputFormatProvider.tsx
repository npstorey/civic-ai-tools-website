'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { OfferedOutputFormat } from '@/lib/output-format/registry';

/**
 * Carries the output formats this instance offers (OF2, Sprint OF-1, website #810; `SITE_OUTPUT_FORMAT`, resolved on the
 * server by `offeredOutputFormats()`) to the query form on every mount that renders it.
 *
 * WHY A CONTEXT AND NOT A PROP, the reason `DefaultPortalProvider` gives: the form renders inside `QuerySurface`, and
 * one of its two mounts, the home page, is a client component with no server ancestor to thread a prop from. The home
 * page is prerendered, so it follows the value `next build` saw; `/ask` renders per request and follows the running
 * server's (docs/deploy.md).
 *
 * MOUNTED ONLY WITH THE SETTING ON (`OutputFormatSetting`, the server component the root layout renders). With the
 * setting off nothing is mounted, so the page's tree, and every byte the server sends, is what it was before formats
 * existed. Outside the provider it reads `null`: the setting off, and the menu shows no "Output format" item. The routes
 * refuse a format they do not offer whatever a page sends.
 */
const OutputFormatsContext = createContext<readonly OfferedOutputFormat[] | null>(null);

export function OutputFormatProvider({ value, children }: { value: readonly OfferedOutputFormat[]; children: ReactNode }) {
  return <OutputFormatsContext.Provider value={value}>{children}</OutputFormatsContext.Provider>;
}

/** The formats offered, Auto aside; `null` with the setting off (no item). Safe outside the provider (null). */
export function useOfferedOutputFormats(): readonly OfferedOutputFormat[] | null {
  return useContext(OutputFormatsContext);
}
