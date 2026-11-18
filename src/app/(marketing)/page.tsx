'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import QuerySurface from '@/components/shared/QuerySurface';
import PositioningBand from '@/components/home/PositioningBand';
import SourceLanding from '@/components/SourceLanding';

/**
 * The first screen before the first question (UX-2-FIX P3, H1 = A): from the wrapper's own top to the window's foot,
 * the block from the headline to the sign-in line centred in it, the link down to the band at its foot.
 *
 * Its top is measured, not assumed (fix round 1, #790 S17): whatever the root layout puts above `<main>` counts, the
 * header and also the running-unsigned banner an instance with no signing key shows under it (56 px at 1280 wide on
 * the deployed preview, which the header's height alone left out, so the link sat below the window). Before the
 * measurement lands (the prerendered markup) the header's height stands in.
 *
 * Centred is the block itself: the surface's 48 px above the headline (its framing padding, cancelled by the framing's
 * -48 px) and the form's 48 px below the sign-in line (cancelled by the inner wrapper's -48 px) are taken out of the
 * centring, so the block centres wherever it fits, down to a first screen its own height.
 */
const FIRST_SCREEN: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  minHeight: 'calc(100svh - var(--home-first-screen-top, var(--header-height, 72px)))',
};
const BLOCK: CSSProperties = { marginBottom: '-48px' };

/**
 * The link's layer: the whole first screen, with the link at its foot (16 px up). The link's holder is sticky, so
 * where the first screen is taller than the window (a short window, or a tall block) the link stays 16 px above the
 * window's foot until the first screen's own foot comes into view: the owner's "anchor" (P3-1 step 1).
 */
const LINK_LAYER: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  paddingBottom: '16px',
  pointerEvents: 'none',
};
const LINK_HOLDER: CSSProperties = {
  position: 'sticky',
  bottom: '16px',
  margin: 0,
  textAlign: 'center',
  fontSize: '13px',
  lineHeight: '16px',
  pointerEvents: 'auto',
};

/** From the first send the wrappers take no part in the layout: the page after a question is the run layout. */
const OUT_OF_LAYOUT: CSSProperties = { display: 'contents' };

export default function Home() {
  // The surface docks at the first send that starts a run, for its life (QuerySurface's `onDock`); from then the first
  // screen's centring and its link go. The wrappers stay in the tree, so the surface keeps its state.
  const [asked, setAsked] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  // The first screen's top, in page coordinates, handed to the stylesheet; re-read when the window or anything above
  // `<main>` changes size. A style write, not React state: nothing re-renders.
  useEffect(() => {
    const el = screenRef.current;
    if (!el || asked) return;
    const place = () => el.style.setProperty('--home-first-screen-top', `${el.getBoundingClientRect().top + window.scrollY}px`);
    place();
    const observer = new ResizeObserver(place);
    for (let above = el.closest('main')?.previousElementSibling; above; above = above.previousElementSibling) observer.observe(above);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      el.style.removeProperty('--home-first-screen-top');
    };
  }, [asked]);
  return (
    <>
      {/* "Ask with this source" lands here signed out, with `?source=` (UX-2 P6 + P10, item 7). */}
      <SourceLanding />
      <div ref={screenRef} style={asked ? OUT_OF_LAYOUT : FIRST_SCREEN}>
        <div style={asked ? OUT_OF_LAYOUT : BLOCK}>
          {/* Signed out, the harness menu gives way to what signing in adds (UX pass row 7; UX-2 P3b-2, 2C). The box
              reads `q` from the address, for /learn's cards (UX-2 P3b-2, 2H). */}
          {/* Hero Section: the h1 handed to the surface apart from the subtitle, which gives way at the first send
              (UX-2 P3b-1 leg H, A5 = A). */}
          <QuerySurface
            advancedOptions="hidden-signed-out"
            prefillFromAddress
            heading={<h1 style={{ marginBottom: '8px' }}>Explore Open Data with AI</h1>}
            framingStyle={{ textAlign: 'center', marginBottom: '24px', marginTop: '-48px' }}
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
        {/* The link down to the band, at the first screen's foot and anchored inside the window (UX-2-FIX P3, H1 = A,
            fix round 1; its words H3 = B). */}
        {!asked && (
          <div style={LINK_LAYER}>
            <p style={LINK_HOLDER}>
              <a href="#positioning" style={{ color: 'var(--text-secondary)' }}>
                What is this site? ↓
              </a>
            </p>
          </div>
        )}
      </div>

      {/* Positioning band: the question box above is the hero; this zooms out */}
      <PositioningBand />
    </>
  );
}
