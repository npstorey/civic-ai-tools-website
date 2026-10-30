'use client';

/**
 * The Sources panel (R6 W3, #632 anchor W3 item 1), beside the question box
 * on the home page, `/ask` and `/explore`. One row per configured source, in
 * manifest order: its name, what the source is, whose connector reaches it
 * (the publisher's name linking to the connector's repository) and where it
 * runs, who holds its logs and what they say they keep, how current its data
 * is, and the three-state control (R6 PL). An Ask first row says what Ask first means in R6, in literal
 * words (Q1). A footer carries the privacy page, the deployment guide's
 * address or the sentence that says this site names none (D10), the date the
 * consent was given and the control that withdraws it in place, for every
 * session (amendment 1, Q7); a session whose consent is kept on its account
 * also gets a link to the dashboard's Sources tab, and its notices (D2 = A).
 *
 * THE CONTROL is a radio group per source, named for it, of three native
 * radios: arrow keys move within it, the checked choice is what a screen
 * reader announces, and the group's label names the source. With a consent
 * in force a choice is written through the consent endpoint; while the write
 * is in flight every control and the question form's submit are held (the
 * guard's `held`).
 *
 * BEFORE A CONSENT (R9 P2, #661) the radios take a choice too, and the store
 * keeps it on the page (`pending`) until Allow writes it with the rest of
 * what the panel shows (`panelStates`). The lead counts those states; no "is
 * now" line is shown, because nothing has been written.
 *
 * EACH ROW (R9 P2, design principle 8) shows its name, what the source is and
 * its control; the reach, logs and currency lines open under "More about
 * this source". The state lines (since when, what Ask first means) and a
 * waiting question stay in view.
 */

import { useState, type CSSProperties } from 'react';
import { ASK_FIRST_MEANS, ASK_FIRST_MEANS_WITH_PAUSE, PANEL_HEADING, PANEL_LEAD, PANEL_PRIVACY_LINK, PANEL_ROW_MORE, PANEL_STATE_CHANGED, panelLeadBeforeConsent } from '@/lib/sources/copy';
import { readerSourceName, sourceRowLines } from '@/lib/sources/source-name';
import { panelStates, useSourceConsent, type SourceStateValue } from './useSourceConsent';
import { KeptByLines } from './KeptByLine';
import LocalOnlyOffer from './LocalOnlyOffer';
import ConsentNotices from './ConsentNotices';
import ConsentStep from '../answer-view/ConsentStep';

const STATES: Array<{ value: SourceStateValue; label: string }> = [
  { value: 'on', label: 'On' },
  { value: 'ask-first', label: 'Ask first' },
  { value: 'off', label: 'Off' },
];

/** The address of the dashboard's Sources tab (Q7). */
export const DASHBOARD_SOURCES_TAB = '/dashboard?tab=sources';

const PANEL: CSSProperties = {
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  padding: '12px 16px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--card-background)',
};

export default function SourcesPanel() {
  const consent = useSourceConsent();
  const statement = consent.statement;
  const status = consent.status;
  const inForce = status?.inForce === true;
  const ids = statement?.sources.map((s) => s.sourceId) ?? [];
  // The states Allow writes (T7): the reader's own before a consent (R9 P2), else the stored ones on a re-ask too,
  // the defaults with nothing stored.
  const states = panelStates(consent, ids);
  const count = (state: SourceStateValue) => ids.filter((id) => states[id] === state).length;
  // Before a consent the lead counts what Allow will use; with no source to count there is none.
  const lead = inForce ? PANEL_LEAD : panelLeadBeforeConsent({ on: count('on'), askFirst: count('ask-first'), off: count('off') });
  const onAccount = status?.store === 'row';
  // The last change whose write succeeded (UX pass row 5): its row says so in a
  // status line. Cleared when another change starts; never set by a failed write.
  const [confirmed, setConfirmed] = useState<{ sourceId: string; state: SourceStateValue } | null>(null);

  return (
    <section aria-labelledby="sources-panel-heading" style={PANEL}>
      <h2 id="sources-panel-heading" style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)' }}>
        {PANEL_HEADING}
      </h2>
      {lead !== '' && <p style={{ margin: '0 0 8px' }}>{lead}</p>}
      {onAccount && inForce && <ConsentNotices />}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {(statement?.sources ?? []).map((source) => {
          const name = readerSourceName(source);
          const state = states[source.sourceId] ?? 'ask-first';
          const since = status?.states?.[source.sourceId]?.since;
          const lines = sourceRowLines(source);
          return (
            <li key={source.sourceId} data-source={source.sourceId} style={{ padding: '8px 0', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
              {lines.what !== null && <div>{lines.what.charAt(0).toUpperCase() + lines.what.slice(1)}</div>}
              <div role="radiogroup" aria-label={`${name}: On, Ask first or Off`} style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                {STATES.map((choice) => (
                  <label key={choice.value} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name={`source-state-${source.sourceId}`}
                      value={choice.value}
                      checked={state === choice.value}
                      disabled={consent.writing}
                      onChange={() => {
                        setConfirmed(null);
                        // Before a consent the choice is kept, not written: nothing to confirm (R9 P2).
                        const writes = inForce;
                        void consent.setState(source.sourceId, choice.value).then((ok) => {
                          if (ok && writes) setConfirmed({ sourceId: source.sourceId, state: choice.value });
                        });
                      }}
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
              {(() => {
                const label = STATES.find((c) => c.value === state)?.label;
                const sinceLine = inForce && since ? `Set ${label} since ${since}.` : null;
                if (inForce && confirmed?.sourceId === source.sourceId && confirmed.state === state) {
                  const changed = `${name}${PANEL_STATE_CHANGED.middle}${label}${PANEL_STATE_CHANGED.end}`;
                  return <div role="status">{sinceLine ? `${changed} ${sinceLine}` : changed}</div>;
                }
                return sinceLine ? <div>{sinceLine}</div> : null;
              })()}
              {/* A question stops to ask only in loop and with the decision store (R9 P1, #666): the pause words only then. */}
              {state === 'ask-first' && <div>{consent.routing === 'in-loop' && consent.store === true ? ASK_FIRST_MEANS_WITH_PAUSE : ASK_FIRST_MEANS}</div>}
              {/* R9 P2 (#661): the row's detail, closed by default (design principle 8). */}
              <details style={{ marginTop: '4px' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>{PANEL_ROW_MORE}</summary>
                <div>
                  {lines.reach.map((part, i) =>
                    typeof part === 'string' ? (
                      part
                    ) : (
                      <a key={i} href={part.link} target="_blank" rel="noopener noreferrer">
                        {part.text}
                      </a>
                    ),
                  )}
                </div>
                <div>
                  Who holds its logs: <KeptByLines keptBy={source.recipients.flatMap((r) => r.keptBy)} retention />.
                </div>
                <div>How current its data is: {source.freshness}</div>
              </details>
              {/* R8 W2 (#644): a question is waiting for an answer about this source; the run's own card is the same. */}
              {(() => {
                // R9 P1 (#669 D2): the latest pause about this source, for its entry's life, not only its hold's:
                // unanswered, or answered after the hold (its confirmation stays here). An answer given during the
                // hold leaves with the hold. An earlier question's pause never comes back in its place.
                const latest = Object.values(consent.pauses).reverse().find((p) => p.payload.source.sourceId === source.sourceId);
                const shown = latest && !latest.expired
                  && (!latest.holdEnded || latest.afterHold === true || (latest.decision === undefined && latest.failure === undefined));
                return latest && shown ? <ConsentStep pause={latest.payload} place="row" /> : null;
              })()}
            </li>
          );
        })}
      </ul>
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px' }}>
        <p style={{ margin: '0 0 6px' }}>
          <a href="/privacy">{PANEL_PRIVACY_LINK}</a>
          {onAccount ? (
            <>
              {' · '}
              <a href={DASHBOARD_SOURCES_TAB}>The Sources tab on your dashboard</a>
            </>
          ) : null}
        </p>
        <p style={{ margin: '0 0 6px' }}>
          <LocalOnlyOffer statement={statement} />
        </p>
        {inForce && (
          <button
            type="button"
            onClick={() => {
              void consent.revoke();
            }}
            disabled={consent.writing}
            style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--white)', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Withdraw consent
          </button>
        )}
      </div>
    </section>
  );
}
