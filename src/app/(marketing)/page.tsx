'use client';

import { useState, type CSSProperties } from 'react';
import QuerySurface from '@/components/shared/QuerySurface';
import PositioningBand from '@/components/home/PositioningBand';
import SourceLanding from '@/components/SourceLanding';

/**
 * The first screen before the first question (UX-2-FIX P3, H1 = A): at least the window's height below the sticky
 * header, the block from the headline to the sign-in line centred in it, the link down to the band at its foot. Above
 * the headline sit the surface's own 48 px and this page's 40 px; below the sign-in line, the form's 48 px margin. The
 * 40 px bottom padding evens the two, so the block itself is centred. Taller than the first screen, the block starts
 * below the header as it did.
 */
const FIRST_SCREEN: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  minHeight: 'calc(100svh - var(--header-height, 72px))',
  paddingBottom: '40px',
};

/** From the first send the wrappers take no part in the layout: the page after a question is the run layout. */
const OUT_OF_LAYOUT: CSSProperties = { display: 'contents' };

export default function Home() {
  // The surface docks at the first send that starts a run, for its life (QuerySurface's `onDock`); from then the first
  // screen's centring and its link go. The wrappers stay in the tree, so the surface keeps its state.
  const [asked, setAsked] = useState(false);
  return (
    <>
      {/* "Ask with this source" lands here signed out, with `?source=` (UX-2 P6 + P10, item 7). */}
      <SourceLanding />
      <div style={asked ? OUT_OF_LAYOUT : FIRST_SCREEN}>
        <div style={asked ? OUT_OF_LAYOUT : undefined}>
          {/* Signed out, the harness menu gives way to what signing in adds (UX pass row 7; UX-2 P3b-2, 2C). The box
              reads `q` from the address, for /learn's cards (UX-2 P3b-2, 2H). */}
          {/* Hero Section: the h1 handed to the surface apart from the subtitle, which gives way at the first send
              (UX-2 P3b-1 leg H, A5 = A). */}
          <QuerySurface
            advancedOptions="hidden-signed-out"
            prefillFromAddress
            heading={<h1 style={{ marginBottom: '8px' }}>Explore Open Data with AI</h1>}
            framingStyle={{ textAlign: 'center', marginBottom: '24px', paddingTop: '40px' }}
            onDock={() => setAsked(true)}
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
        </div>
        {/* The link down to the band, at the first screen's foot (UX-2-FIX P3, H1 = A; its words H3 = B). */}
        {!asked && (
          <p style={{ position: 'absolute', left: 0, right: 0, bottom: '16px', margin: 0, textAlign: 'center', fontSize: '13px', lineHeight: '16px' }}>
            <a href="#positioning" style={{ color: 'var(--text-secondary)' }}>
              What is this site? ↓
            </a>
          </p>
        )}
      </div>

      {/* Positioning band: the question box above is the hero; this zooms out */}
      <PositioningBand />
    </>
  );
}
