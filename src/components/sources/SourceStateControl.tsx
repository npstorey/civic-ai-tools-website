'use client';

/**
 * One source's state control (UX-1 PC, #719 leg 1): the three-state radio
 * group and the status line that confirms a change, as the Sources panel has
 * shown them since R6 PL and the UX pass's row 5. The panel and the
 * dashboard's Sources tab both mount this one implementation.
 *
 * THE CONTROL is a radio group, named for the source, of three native radios:
 * arrow keys move within it, the checked choice is what a screen reader
 * announces, and the group's label names the source. A choice goes through
 * the consent hook's `setState`: with a consent in force it is written
 * through the consent endpoint; before one it is kept on the page and nothing
 * is confirmed (R9 P2). While a write is in flight every radio is held.
 *
 * THE CONFIRMATION is one `role="status"` line, after a write that
 * succeeded, built from `PANEL_STATE_CHANGED`. Which change is confirmed is
 * held by the surface (`confirmed`), so a change in one row clears the line
 * in another. With `sinceLine` (the panel), the row also reads "Set <State>
 * since <date>." under the control; the tab passes `sinceLine={false}`,
 * because its own line already carries the date.
 *
 * TWO COMPONENTS, ONE PROPS OBJECT. A surface mounts `SourceStateRadios` and
 * then `SourceStateConfirmation`, both with the same props, as siblings in the
 * row. Each renders one element (or none), so the row's children are what they
 * were when the panel wrote them inline: its markup and its element tree are
 * unchanged.
 */

import { PANEL_STATE_CHANGED } from '@/lib/sources/copy';
import type { SourceStateValue } from './useSourceConsent';

/** The three states, in the order the control offers them, with their labels. */
export const STATES: Array<{ value: SourceStateValue; label: string }> = [
  { value: 'on', label: 'On' },
  { value: 'ask-first', label: 'Ask first' },
  { value: 'off', label: 'Off' },
];

/** The last change whose write succeeded, if any. */
export type ConfirmedChange = { sourceId: string; state: SourceStateValue } | null;

export interface SourceStateControlProps {
  sourceId: string;
  /** The source's reader name (`readerSourceName`). */
  name: string;
  /** The state the surface shows for this source. */
  state: SourceStateValue;
  /** The date the stored state was set, if any. */
  since: string | undefined;
  /** Whether a consent is in force: only then is a choice written and confirmed. */
  inForce: boolean;
  /** A consent write is in flight. */
  writing: boolean;
  /** The consent hook's `setState`. */
  setState: (sourceId: string, state: SourceStateValue) => Promise<boolean>;
  confirmed: ConfirmedChange;
  setConfirmed: (change: ConfirmedChange) => void;
  /** Show "Set <State> since <date>." under the control (default true). */
  sinceLine?: boolean;
}

/** The radio group: the row's control. */
export function SourceStateRadios({ sourceId, name, state, inForce, writing, setState, setConfirmed }: SourceStateControlProps) {
  return (
    <div role="radiogroup" aria-label={`${name}: On, Ask first or Off`} style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
      {STATES.map((choice) => (
        <label key={choice.value} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
          <input
            type="radio"
            name={`source-state-${sourceId}`}
            value={choice.value}
            checked={state === choice.value}
            disabled={writing}
            onChange={() => {
              setConfirmed(null);
              // Before a consent the choice is kept, not written: nothing to confirm (R9 P2).
              const writes = inForce;
              void setState(sourceId, choice.value).then((ok) => {
                if (ok && writes) setConfirmed({ sourceId, state: choice.value });
              });
            }}
          />
          {choice.label}
        </label>
      ))}
    </div>
  );
}

/** The line under the control: the confirmation of a change (a status line), else the since line, else nothing. */
export function SourceStateConfirmation({ sourceId, name, state, since, inForce, confirmed, sinceLine = true }: SourceStateControlProps) {
  const label = STATES.find((c) => c.value === state)?.label;
  const setSince = sinceLine && inForce && since ? `Set ${label} since ${since}.` : null;
  if (inForce && confirmed?.sourceId === sourceId && confirmed.state === state) {
    const changed = `${name}${PANEL_STATE_CHANGED.middle}${label}${PANEL_STATE_CHANGED.end}`;
    return <div role="status">{setSince ? `${changed} ${setSince}` : changed}</div>;
  }
  return setSince ? <div>{setSince}</div> : null;
}
