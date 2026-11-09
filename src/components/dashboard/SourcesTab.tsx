'use client';

/**
 * The dashboard's Sources tab (R6 W3, #632 anchor W3 item 3), as UX-2 P4b
 * makes it: a pointer. X22d's sentence, as item 41 re-words it, with "Data
 * source settings" as its link to the Settings overlay at `/settings`, where
 * the states, the consent's date and version, the notices and "Withdraw
 * consent" now live (signed in and out). The tab keeps no control, no dates,
 * no withdrawal and no notice. A client-side link, so the overlay opens over
 * the dashboard.
 */

import Link from 'next/link';
import { SETTINGS_HREF, SETTINGS_TEXT } from '@/lib/sources/copy';

export default function SourcesTab() {
  const [before, after] = SETTINGS_TEXT.tabSentence.split(SETTINGS_TEXT.link);
  return (
    <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
      <p style={{ margin: 0 }}>
        {before}
        <Link href={SETTINGS_HREF}>{SETTINGS_TEXT.link}</Link>
        {after}
      </p>
    </div>
  );
}
