import type { Metadata } from 'next';
import SettingsOverlay from '@/components/settings/SettingsOverlay';

/**
 * `/settings` on a direct load or a reload (UX-2 P4b): the Settings overlay
 * over the site's frame, with no other page beneath it. A client-side
 * navigation to `/settings` from any page is intercepted instead
 * (`src/app/@modal/(.)settings/page.tsx`) and opens the same overlay over that
 * page. Dual-served (`host-routing.ts`, S1).
 */
export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return <SettingsOverlay mount="page" />;
}
