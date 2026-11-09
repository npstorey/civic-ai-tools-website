'use client';

import { usePathname } from 'next/navigation';
import SettingsOverlay from './SettingsOverlay';
import { SETTINGS_HREF } from '@/lib/sources/copy';

/**
 * The overlay as the root `@modal` slot's `(.)settings` renders it (UX-2 P4b).
 * A slot keeps the page it last rendered across a client-side navigation that
 * matches nothing in it, so a link followed from inside the overlay (the
 * privacy page, say) would leave it standing over the next page. It renders
 * only while the address is `/settings`. (A catch-all slot route would clear
 * it too, but it makes every address a page to the linter's
 * `no-html-link-for-pages`, which then refuses every plain `<a>` in the site.)
 */
export default function InterceptedSettings() {
  const pathname = usePathname();
  if (pathname !== SETTINGS_HREF) return null;
  return <SettingsOverlay mount="intercepted" />;
}
