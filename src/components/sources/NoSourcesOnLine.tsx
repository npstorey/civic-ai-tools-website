'use client';

import Link from 'next/link';
import { friendlyStreamError } from '@/lib/streaming';
import { SETTINGS_HREF, SETTINGS_TEXT } from '@/lib/sources/copy';

/**
 * The `no_sources_on` refusal where a surface can carry a link (UX-2 P4b,
 * items 42/50): the sentence `friendlyStreamError` gives, its "Data source
 * settings" a client-side link to the Settings overlay, so the page beneath
 * stays mounted.
 */
export default function NoSourcesOnLine() {
  const text = friendlyStreamError({ code: 'no_sources_on' });
  const at = text.indexOf(SETTINGS_TEXT.link);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href={SETTINGS_HREF}>{SETTINGS_TEXT.link}</Link>
      {text.slice(at + SETTINGS_TEXT.link.length)}
    </>
  );
}
