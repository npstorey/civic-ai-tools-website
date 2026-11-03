import type { ReactNode } from 'react';

/**
 * P6 · Signal row (UX-1 P0; design §2 P6). A glyph by silhouette, a label, an
 * optional one-line detail and an optional P1 `inline` disclosure. The
 * reference implementation is `src/components/evidence/TrustSignal.tsx`, which
 * stays as it is (live at four mounts); this is built beside it.
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Signal.test.ts`) fails against. Leg B builds the primitive.
 */

/**
 * Glyph and token, never colour alone: `neutral` dot `--text-muted`, `ok`
 * check `--success`, `caution` triangle `--caution`, `problem` cross
 * `--error`, `info` i `--info`.
 */
export type SignalTier = 'neutral' | 'ok' | 'caution' | 'problem' | 'info';

/** `line`: 13 px, in a status area or a row's trailing column. `block`: 14 px label, detail under it. */
export type SignalSize = 'line' | 'block';

export interface SignalProps {
  tier: SignalTier;
  /** The words that carry the meaning; the glyph is decorative (`aria-hidden`). */
  label: ReactNode;
  /** An optional one-line detail. */
  detail?: ReactNode;
  /** Default `line`. */
  size?: SignalSize;
  /** An optional P1 `inline` disclosure under the row. */
  disclosure?: { summary: ReactNode; children: ReactNode };
}

export function Signal(props: SignalProps) {
  void props;
  return <div data-ui-stub="Signal" />;
}
