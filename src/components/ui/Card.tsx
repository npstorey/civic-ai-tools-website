import type { ReactNode } from 'react';

/**
 * P5 · Card (UX-1 P0; design §2 P5). One bordered surface.
 *
 * LEG A STUB: the final props type; the render is a placeholder the fixture
 * test (`Card.test.ts`) fails against. Leg B builds the primitive.
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

export function Card(props: CardProps) {
  void props;
  return <div data-ui-stub="Card" />;
}
