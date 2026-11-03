import type { ReactNode } from 'react';

/**
 * P5 · Card (UX-1 P0; design §2 P5). One bordered surface, radius 6 px.
 *
 * - `plain`: `--white`, border `--border-color`.
 * - `tinted`: a wash of its tone, `rgba(var(--<tone>-rgb), α)`.
 * - `selectable`: a radio or link card. The caller puts the radio or link
 *   inside. Its border is 1.5 px, and its selected border takes the tone's token.
 *
 * States: idle; hover (selectable only, CSS); selected; disabled-with-reason
 * (muted, `aria-disabled`, with the reason as its last line). Padding is
 * `--space-sm`, or 12 px when `compact` (a literal until a token exists).
 *
 * Every word is the caller's.
 */

/** `plain`: white with a border. `tinted`: a wash of its tone. `selectable`: a radio or link card. */
export type CardVariant = 'plain' | 'tinted' | 'selectable';

/** The tone of a `tinted` wash or a `selectable` card's selected border. */
export type CardTone = 'accent' | 'info' | 'caution' | 'error' | 'success';

export interface CardProps {
  children: ReactNode;
  /** Default `plain`. */
  variant?: CardVariant;
  /** Default `accent`. Read by `tinted` and `selectable`. */
  tone?: CardTone;
  /** 12 px padding instead of `--space-sm`. */
  compact?: boolean;
  /** `selectable` only. */
  selected?: boolean;
  /** Disabled-with-reason: the card is muted and this line says why. */
  disabledReason?: ReactNode;
  /** Default `div`. */
  as?: 'div' | 'section' | 'article' | 'li' | 'label';
  id?: string;
}

// Full class names, never built from a template: the class guard
// (`src/app/ui-class-names.test.ts`) reads string literals.
const VARIANT_CLASS: Record<CardVariant, string> = {
  plain: 'ui-card--plain',
  tinted: 'ui-card--tinted',
  selectable: 'ui-card--selectable',
};

const TONE_CLASS: Record<CardTone, string> = {
  accent: 'ui-card--tone-accent',
  info: 'ui-card--tone-info',
  caution: 'ui-card--tone-caution',
  error: 'ui-card--tone-error',
  success: 'ui-card--tone-success',
};

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Card({
  children,
  variant = 'plain',
  tone = 'accent',
  compact = false,
  selected = false,
  disabledReason,
  as: Tag = 'div',
  id,
}: CardProps) {
  const disabled = present(disabledReason);
  const className = [
    'ui-card',
    VARIANT_CLASS[variant],
    variant === 'plain' ? '' : TONE_CLASS[tone],
    compact ? 'ui-card--compact' : '',
    variant === 'selectable' && selected ? 'ui-card--selected' : '',
    disabled ? 'ui-card--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag id={id} className={className} aria-disabled={disabled || undefined}>
      {children}
      {disabled ? <p className="ui-card-reason">{disabledReason}</p> : null}
    </Tag>
  );
}
