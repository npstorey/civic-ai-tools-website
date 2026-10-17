import { pageTitle } from '@/lib/brand-config';

/**
 * `/privacy` (#516 P7). RED STUB: the route exists and renders its heading;
 * the statements (`src/lib/privacy-facts.ts`) are written in the next commit.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: pageTitle('Privacy'),
};

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ marginBottom: '32px' }}>Privacy</h1>
    </div>
  );
}
