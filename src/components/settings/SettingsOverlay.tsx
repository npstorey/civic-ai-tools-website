'use client';

/**
 * The Settings overlay at `/settings` (UX-2 P4b): a typed stub for the red
 * commit. It renders nothing; the green leg builds it.
 *
 * `mount` says where it renders: `intercepted` over the page it was opened
 * from (the root `@modal` slot's `(.)settings`), or `page` for a direct load
 * or a reload of `/settings` (`src/app/(app)/settings/page.tsx`).
 */

export interface SettingsOverlayProps {
  mount?: 'intercepted' | 'page';
  /** The sub-page shown first. */
  initialTab?: 'data-sources' | 'about';
}

export default function SettingsOverlay(_props: SettingsOverlayProps) {
  void _props;
  return null;
}
