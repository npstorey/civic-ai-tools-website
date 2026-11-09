'use client';

import type { ReactNode } from 'react';
import type { FlowsStatement } from '@/lib/flows/statement';

/**
 * The composer (UX-2 P3b-1): the question box, its arrow, the example row,
 * the line under the box and the guard's three slots, one component on three
 * mounts (the home page and `/ask` through `QueryForm`, `/explore` through
 * `TraceControls`).
 *
 * STUB at the red commit: the types are the seam the green builds to, and the
 * component renders nothing, so every test that reads it fails at its
 * assertions, not at load.
 */

/** One example question: a chip fills the box; it does not submit. */
export interface ComposerChip {
  id: string;
  label: string;
  onSelect: () => void;
}

/** The guard's state, held by the mount (`QueryForm`, `TraceControls`); the composer renders its three slots. */
export interface ComposerGuard {
  /** The consent card is shown. */
  cardOpen: boolean;
  onAllow: () => void;
  onNotNow: () => void;
  /** The box holds the question the reader declined: the decline line is shown. */
  declined: boolean;
  /** The statement the decline line's local-only offer reads. */
  statement: FlowsStatement | null;
  /** The last submit found no source On: the no-source-on line is shown. */
  noneOn: boolean;
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on a submit the composer allows (`canSubmit`): the arrow, Enter, or the form's submit. */
  onSubmit: () => void;
  canSubmit: boolean;
  isLoading: boolean;
  /** `form`: the home page's and `/ask`'s column. `wide`: `/explore`'s live panel. Default `form`. */
  placement?: 'form' | 'wide';
  /** Below the results, sticky at the viewport's bottom; the placeholder reads X23. */
  docked?: boolean;
  /** The undocked placeholder. */
  placeholder: string;
  /** The example row; none on `/explore`. */
  chips?: ComposerChip[];
  /** The line under the box (today's "where this question goes"), computed by the mount. */
  line?: ReactNode;
  /** X24's form, or none. */
  firstTimeLine?: 'signed-in' | 'signed-out' | null;
  guard: ComposerGuard;
  /** What the mount renders beneath the composer's own parts (the gear row and its region, in P3b-1). */
  children?: ReactNode;
}

export default function Composer(props: ComposerProps): ReactNode {
  void props;
  return null;
}
