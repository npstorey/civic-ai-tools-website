import InterceptedSettings from '@/components/settings/InterceptedSettings';

/**
 * `/settings` reached by a client-side navigation from any page (UX-2 P4b):
 * the overlay in the root `@modal` slot, over the page it was opened from,
 * which stays mounted. A direct load or a reload renders
 * `src/app/(app)/settings/page.tsx` instead. The proxy sees the address
 * `/settings` either way: interception is a rewrite that runs after it.
 */
export default function InterceptedSettingsPage() {
  return <InterceptedSettings />;
}
