'use client';

import type { ReactNode } from 'react';
import { TIER_META, type TrustTier, type TrustIconName } from '@/lib/evidence/trust-signal';

/**
 * Presentational trust-signal row (civic-ai-tools-website#110, Wave 0).
 *
 * Renders one `{ tier, icon, plain-language one-liner }` signal — the shared
 * primitive that the verify panel and provenance surfaces will consume (#111+).
 * It is NOT yet imported by any live panel; this is the standalone foundation.
 *
 * Severity is conveyed three ways so it never depends on color alone (WCAG /
 * design-principles accessibility): a distinct icon SILHOUETTE per tier, the
 * tier color, and an `aria-label` on the glyph announcing the tier to screen
 * readers. The four glyphs are in-house inline SVGs (no icon dependency, no DTPR
 * assets). They are stroke-outline rather than the filled house download glyph:
 * a filled set with inner i/! marks needs even-odd knock-out paths, whereas four
 * stroked silhouettes (check / circle / triangle / octagon) are hand-authored,
 * coherent, and distinct without color. See docs/trust-signal-vocabulary.md.
 *
 * Tier color, default glyph, and aria label come from `TIER_META` — the single
 * source of truth in trust-signal.ts (a pure-data, client-safe module). Only the
 * SVG path data lives here, because JSX cannot live cleanly in that .ts module.
 */

/**
 * The four in-house glyphs. Each is a stroked silhouette (outer shape) plus an
 * inner mark where applicable. `currentColor` carries the tier color, set via
 * the wrapping `<svg>`'s `color`. Inner dots override to a solid fill.
 */
const ICON_GLYPHS: Record<TrustIconName, ReactNode> = {
  // Bare checkmark.
  check: <path d="M3.25 8.6 L6.4 11.75 L12.75 4.5" />,
  // Circle + lowercase "i" (dot above a short stem).
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <line x1="8" y1="7.5" x2="8" y2="11.25" />
      <circle cx="8" cy="5" r="0.85" fill="currentColor" stroke="none" />
    </>
  ),
  // Triangle + "!" (stem above a dot).
  warning: (
    <>
      <path d="M8 2.25 L14 13 L2 13 Z" />
      <line x1="8" y1="6.5" x2="8" y2="9.75" />
      <circle cx="8" cy="11.4" r="0.85" fill="currentColor" stroke="none" />
    </>
  ),
  // Octagon + "!" (stem above a dot).
  error: (
    <>
      <path d="M5.4 1.75 L10.6 1.75 L14.25 5.4 L14.25 10.6 L10.6 14.25 L5.4 14.25 L1.75 10.6 L1.75 5.4 Z" />
      <line x1="8" y1="4.75" x2="8" y2="8.75" />
      <circle cx="8" cy="11" r="0.85" fill="currentColor" stroke="none" />
    </>
  ),
};

function TierIcon({
  icon,
  color,
  ariaLabel,
}: {
  icon: TrustIconName;
  color: string;
  ariaLabel: string;
}) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={ariaLabel}
      style={{ color, flexShrink: 0, marginTop: '1px' }}
    >
      {ICON_GLYPHS[icon]}
    </svg>
  );
}

export interface TrustSignalProps {
  /** Severity tier — drives the color and the default glyph. */
  tier: TrustTier;
  /** Glanceable plain-language one-liner (the `label`/`copy` from the
   *  vocabulary). */
  label: string;
  /** Optional expand-on-demand sentence rendered muted beside the label. */
  detail?: string;
  /** Override the tier's default glyph (rare; tier normally drives the icon). */
  icon?: TrustIconName;
}

/**
 * One trust-signal row: `<glyph>  Label  detail`. Matches the layout of the
 * existing inline `VerifyCheck` (EvidenceActions.tsx) so #111 can swap it in.
 */
export default function TrustSignal({ tier, label, detail, icon }: TrustSignalProps) {
  const meta = TIER_META[tier];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        fontSize: '13px',
        marginBottom: '6px',
      }}
    >
      <TierIcon icon={icon ?? meta.icon} color={meta.colorVar} ariaLabel={meta.ariaLabel} />
      <div>
        <span style={{ color: 'var(--text-primary)' }}>{label}</span>
        {detail && (
          <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{detail}</span>
        )}
      </div>
    </div>
  );
}
