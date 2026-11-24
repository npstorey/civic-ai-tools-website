import type { ReactNode } from 'react';
import { offeredOutputFormats } from '@/lib/output-format/registry';
import { OutputFormatProvider } from '@/components/OutputFormatProvider';

/**
 * The instance's output-format setting (OF2, Sprint OF-1, website #810; `SITE_OUTPUT_FORMAT`, the seat's S8), resolved
 * on the server for the root layout. A server component, so it adds nothing to what the page is sent: with the setting
 * off it renders its children alone, and the tree is the one the layout had before formats existed; with it on it
 * mounts `OutputFormatProvider` with the formats this instance offers.
 */
export function OutputFormatSetting({ children }: { children: ReactNode }) {
  const offered = offeredOutputFormats();
  return offered ? <OutputFormatProvider value={offered}>{children}</OutputFormatProvider> : <>{children}</>;
}
