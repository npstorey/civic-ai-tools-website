'use client';

import QuerySurface from '@/components/shared/QuerySurface';
import PositioningBand from '@/components/home/PositioningBand';
import SourceLanding from '@/components/SourceLanding';

export default function Home() {
  return (
    <>
      {/* "Ask with this source" lands here signed out, with `?source=` (UX-2 P6 + P10, item 7). */}
      <SourceLanding />
      {/* Signed out, the harness menu gives way to what signing in adds (UX pass row 7; UX-2 P3b-2, 2C). The box reads
          `q` from the address, for /learn's cards (UX-2 P3b-2, 2H). */}
      {/* Hero Section: the h1 handed to the surface apart from the subtitle, which gives way at the first send (UX-2
          P3b-1 leg H, A5 = A). */}
      <QuerySurface
        advancedOptions="hidden-signed-out"
        prefillFromAddress
        heading={<h1 style={{ marginBottom: '8px' }}>Explore Open Data with AI</h1>}
        framingStyle={{ textAlign: 'center', marginBottom: '24px', paddingTop: '40px' }}
      >
        <p
          style={{
            fontSize: '20px',
            lineHeight: '150%',
            color: 'var(--text-secondary)',
            maxWidth: '650px',
            margin: '0 auto',
          }}
        >
          See how AI answers with and without access to real datasets
        </p>
      </QuerySurface>

      {/* Positioning band: the question box above is the hero; this zooms out */}
      <PositioningBand />
    </>
  );
}
