import type { ReactNode } from 'react';
import { Disclosure } from './Disclosure';

/**
 * P6 · Signal row (UX-1 P0; design §2 P6). The disclosure-not-validation
 * primitive. Its parts:
 *   - a glyph by silhouette;
 *   - a label;
 *   - an optional one-line detail;
 *   - an optional P1 `inline` disclosure.
 *
 * The reference implementation is `src/components/evidence/TrustSignal.tsx`.
 * TrustSignal stays as it is, live at four mounts; this is built beside it,
 * and whether one becomes the other is a later phase's decision.
 *
 * Glyph and token, never colour alone. The glyph is decorative (`aria-hidden`);
 * the caller's label carries the meaning. The label states a process, never a
 * verdict (Principle 1). One row per axis, never a merged chip (Principle 7).
 * An absent signal is an absent row (Principle 3).
 *
 * Every word is the caller's.
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

// Full class names, never built from a template: the class guard
// (`src/app/ui-class-names.test.ts`) reads string literals.
const TIER_CLASS: Record<SignalTier, string> = {
  neutral: 'ui-signal--neutral',
  ok: 'ui-signal--ok',
  caution: 'ui-signal--caution',
  problem: 'ui-signal--problem',
  info: 'ui-signal--info',
};

const SIZE_CLASS: Record<SignalSize, string> = {
  line: 'ui-signal--line',
  block: 'ui-signal--block',
};

/** One silhouette per tier, stroked in `currentColor` (the tier's token, set in globals.css). */
const GLYPHS: Record<SignalTier, { name: string; shape: ReactNode }> = {
  neutral: { name: 'dot', shape: <circle cx="8" cy="8" r="3.25" fill="currentColor" stroke="none" /> },
  ok: { name: 'check', shape: <path d="M3.25 8.6 L6.4 11.75 L12.75 4.5" /> },
  caution: {
    name: 'triangle',
    shape: (
      <>
        <path d="M8 2.25 L14 13 L2 13 Z" />
        <line x1="8" y1="6.5" x2="8" y2="9.75" />
        <circle cx="8" cy="11.4" r="0.85" fill="currentColor" stroke="none" />
      </>
    ),
  },
  problem: { name: 'cross', shape: <path d="M4 4 L12 12 M12 4 L4 12" /> },
  info: {
    name: 'info',
    shape: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <line x1="8" y1="7.5" x2="8" y2="11.25" />
        <circle cx="8" cy="5" r="0.85" fill="currentColor" stroke="none" />
      </>
    ),
  },
};

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Signal({ tier, label, detail, size = 'line', disclosure }: SignalProps) {
  const glyph = GLYPHS[tier];
  return (
    <div className={['ui-signal', TIER_CLASS[tier], SIZE_CLASS[size]].join(' ')}>
      <svg
        className="ui-signal-glyph"
        data-glyph={glyph.name}
        aria-hidden="true"
        focusable="false"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyph.shape}
      </svg>
      <div className="ui-signal-text">
        <span className="ui-signal-label">{label}</span>
        {present(detail) ? <span className="ui-signal-detail">{detail}</span> : null}
        {disclosure ? (
          <Disclosure size="inline" summary={disclosure.summary}>
            {disclosure.children}
          </Disclosure>
        ) : null}
      </div>
    </div>
  );
}
