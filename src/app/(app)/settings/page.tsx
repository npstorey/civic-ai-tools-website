import SettingsOverlay from '@/components/settings/SettingsOverlay';

/**
 * `/settings` on a direct load or a reload (UX-2 P4b): the Settings overlay
 * over the site's frame. A typed stub for the red commit.
 */
export default function SettingsPage() {
  return <SettingsOverlay mount="page" />;
}
