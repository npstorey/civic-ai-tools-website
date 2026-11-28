'use client';

/**
 * One source's state control (UX-1 PC, #719 leg 1; S4 W2a, npstorey/civic-ai-tools#335) and the status line that
 * confirms a change. Settings and the picker both mount this one implementation, through `SourceRow`, and a group's
 * head mounts the same pair of buttons (`EnableDisableButtons`).
 *
 * THE CONTROL (P-1 = A, C9-L = A; S109, S118). Two equal buttons, Enable and Disable, each keeping its word; the one set
 * is drawn pressed. A source enabled shows Enable pressed, one disabled Disable pressed, and a source not answered yet
 * (stored Ask first, or no stored state) shows neither pressed (DR-8 A).
 *
 * THE ACCESSIBLE STATE (S4-6's question, answered here): toggle buttons, `aria-pressed` on each, in a `role="group"`
 * named by S118, "{name}: Enable or Disable". A screen reader is told, for each stored state:
 *   - enabled: "Enable, toggle button, pressed" and "Disable, toggle button, not pressed";
 *   - disabled: "Enable, not pressed" and "Disable, pressed";
 *   - not answered yet: both "not pressed", with the line under the control (S86) as the group's description.
 * Not a radio group: a radio is checked by the arrow keys, so moving through the group would write a setting, and the
 * row the landing focuses would change one with an arrow key. A pressed button pressed again keeps its state: there
 * is no way back to "not answered yet" (DR-8 A), so the pair departs from ARIA's toggle there, and a click on the
 * pressed button writes nothing.
 *
 * A choice goes through the consent hook's `setState`: with a consent in force it is written through the consent
 * endpoint; before one it is kept on the page and nothing is confirmed (R9 P2). While a write is in flight both
 * buttons are held.
 *
 * THE CONFIRMATION is one `role="status"` line, after a write that succeeded, built from `PANEL_STATE_CHANGED`. Which
 * change is confirmed is held by the surface (`confirmed`), so a change in one row clears the line in another, and a
 * group's line (`group`) shares that one place. With `sinceLine`, the row also reads "Set <State> since <date>." under
 * the control.
 *
 * A REFUSED CHANGE (S4 W1, A2; C4 = A). When the endpoint refuses a change because the signed-out reader's cookie is
 * full, the same line says so, S24 (`COOKIE_FULL_TEXT.refused`), with S25 after it on a site that keeps consents on
 * accounts; the control shows the stored state again and stays live.
 */

import { useId } from 'react';
import { COOKIE_FULL_TEXT, PANEL_STATE_CHANGED, SOURCE_CONTROL_TEXT, STATE_WORDS, sinceLine as sinceLineText } from '@/lib/sources/copy';
import { consentSnapshot, type SourceStateValue } from './useSourceConsent';


/**
 * The last change whose write succeeded, if any; or the last change the endpoint refused because the cookie is full
 * (`refused`, with whether the site keeps consents on accounts). A group's control and "Enable all data sources"
 * confirm under their own head (`group`: the class id, or `all`), with the line they built.
 */
export type ConfirmedChange =
  | { sourceId: string; state: SourceStateValue }
  | { sourceId: string; refused: 'cookie-full'; accounts: boolean }
  | { group: string; line: string }
  | { group: string; refused: 'cookie-full'; accounts: boolean }
  | null;

/** What the line says after a change: confirmed, refused because the cookie is full, or nothing (any other failure). */
export function changeOutcome(ok: boolean, sourceId: string, state: SourceStateValue): ConfirmedChange {
  if (ok) return { sourceId, state };
  const snapshot = consentSnapshot();
  if (snapshot.cookieFull?.target !== sourceId) return null;
  return { sourceId, refused: 'cookie-full', accounts: snapshot.status?.accounts === true };
}

/** The same for a group's control or "Enable all data sources" (`group`: the class id, or `all`). */
export function groupOutcome(ok: boolean, group: string, line: string): ConfirmedChange {
  if (ok) return { group, line };
  const snapshot = consentSnapshot();
  if (snapshot.cookieFull?.target !== (group === 'all' ? 'all' : `group:${group}`)) return null;
  return { group, refused: 'cookie-full', accounts: snapshot.status?.accounts === true };
}

/** The refusal's words (S24, then S25 on a site with accounts). */
export function refusedLine(accounts: boolean): string {
  return accounts ? `${COOKIE_FULL_TEXT.refused} ${COOKIE_FULL_TEXT.signIn}` : COOKIE_FULL_TEXT.refused;
}

export interface EnableDisableProps {
  /** The group's accessible name (S118 for a source, S3 for a group). */
  name: string;
  /** Which button is drawn pressed: `on` Enable, `off` Disable, `null` neither. */
  pressed: 'on' | 'off' | null;
  disabled: boolean;
  /** The ids of the lines that describe the control (S86, the mark, S2, S4), if any. */
  describedBy?: string;
  onChoose: (state: 'on' | 'off') => void;
}

/** The pair of buttons: Enable and Disable, equal, the one set pressed (P-1 = A; C9-L = A). */
export function EnableDisableButtons({ name, pressed, disabled, describedBy, onChoose }: EnableDisableProps) {
  const buttons: Array<['on' | 'off', string]> = [['on', SOURCE_CONTROL_TEXT.enable], ['off', SOURCE_CONTROL_TEXT.disable]];
  return (
    <div role="group" aria-label={name} aria-describedby={describedBy} data-part="enable-disable" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
      {buttons.map(([value, word]) => (
        <button
          key={value}
          type="button"
          className="source-toggle"
          aria-pressed={pressed === value}
          disabled={disabled}
          onClick={() => {
            // The pressed button keeps its state (DR-8 A): nothing to write.
            if (pressed !== value) onChoose(value);
          }}
        >
          {word}
        </button>
      ))}
    </div>
  );
}

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

/** A source's control: the pair of buttons, named S118, writing the source's own state. */
export function SourceStateButtons({ sourceId, name, state, inForce, writing, setState, setConfirmed, describedBy }: SourceStateControlProps & { describedBy?: string }) {
  return (
    <EnableDisableButtons
      name={SOURCE_CONTROL_TEXT.name(name)}
      pressed={state === 'on' ? 'on' : state === 'off' ? 'off' : null}
      disabled={writing}
      describedBy={describedBy}
      onChoose={(choice) => {
        setConfirmed(null);
        // Before a consent the choice is kept, not written: nothing to confirm (R9 P2).
        const writes = inForce;
        void setState(sourceId, choice).then((ok) => {
          if (writes) setConfirmed(changeOutcome(ok, sourceId, choice));
        });
      }}
    />
  );
}

/** A stable id for a line under a control, for `aria-describedby`. */
export function useLineId(part: string): string {
  return `${part}-${useId()}`;
}

/** The line under the control: the confirmation of a change (a status line), else the since line, else nothing. */
export function SourceStateConfirmation({ sourceId, name, state, since, inForce, confirmed, sinceLine = true }: SourceStateControlProps) {
  // S4 W2a fix round 1: the state in words by the ruled pairs ("is now enabled"), and the since line's drafted form.
  const word = STATE_WORDS[state];
  const setSince = sinceLine && inForce && since ? sinceLineText(state, since) : null;
  const mine = confirmed !== null && 'sourceId' in confirmed && confirmed.sourceId === sourceId ? confirmed : null;
  if (mine && 'refused' in mine) return <div role="status">{refusedLine(mine.accounts)}</div>;
  if (inForce && mine && 'state' in mine && mine.state === state) {
    const changed = `${name}${PANEL_STATE_CHANGED.middle}${word}${PANEL_STATE_CHANGED.end}`;
    return <div role="status">{setSince ? `${changed} ${setSince}` : changed}</div>;
  }
  return setSince ? <div>{setSince}</div> : null;
}
