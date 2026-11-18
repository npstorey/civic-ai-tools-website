'use client';

/**
 * UX-2 P6 + P10 (#729; contract p6p10.md item 7, PQ10 = (a), 0d item 9): where "Ask with this source" lands.
 *
 * A directory row's action opens the home page (signed out) or `/ask` (signed in) with `?source=<sourceId>`. Mounted
 * on both, this reads that parameter the way `QueryForm` reads `q` (`readAddressQuestion`): a snapshot of
 * `window.location.search` after hydration, `null` on the server, never `useSearchParams`, so the prerendered home
 * page stays prerendered. When this instance's statement offers that source it opens the Settings overlay on Data
 * sources with a client navigation to `/settings?source=<id>`: the root `@modal` slot intercepts it and keeps the query
 * (measured in Chrome at stage 1), and the overlay brings that source's row into view (`SettingsOverlay.tsx`).
 *
 * An unknown or unoffered id opens nothing. IT WRITES NO STATE: a navigation, no consent, no cookie, no pick. The
 * parameter stays in the address after the landing (0d item 9), so a reload lands again.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useSourceConsent } from '@/components/sources/useSourceConsent';
import { SETTINGS_HREF } from '@/lib/sources/copy';

/** The address's `source`, read once the page is hydrated; `null` on the server or with none. */
export function readAddressSource(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const source = new URLSearchParams(window.location.search ?? '').get('source');
  return source !== null && source.trim() !== '' ? source : null;
}
const noSubscription = () => () => {};
const noSource = () => null;

export default function SourceLanding(): null {
  const router = useRouter();
  const source = useSyncExternalStore(noSubscription, readAddressSource, noSource);
  // The page's surface loads the consent store; the landing reads the statement it holds.
  const consent = useSourceConsent({ load: false });
  const offered = source !== null && (consent.statement?.sources ?? []).some((s) => s.sourceId === source);
  const landed = useRef(false);
  useEffect(() => {
    if (!offered || source === null || landed.current) return;
    // #790 (P2 fix round 1, F1): a page rendered during a client navigation reads the address before the router has
    // written the new one (it does so in an insertion effect of the same commit, before this effect runs). Closing
    // Settings' page mount pushes `/`, and the home page first rendered at `/settings?source=<id>`, so it landed again
    // and Close never closed. Land only when the committed address still names the source the render read.
    if (readAddressSource() !== source) return;
    landed.current = true;
    router.push(`${SETTINGS_HREF}?source=${encodeURIComponent(source)}`);
  }, [offered, source, router]);
  return null;
}
