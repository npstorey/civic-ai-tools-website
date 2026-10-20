'use client';

/**
 * The Sources panel (R6 W3, #632 anchor W3 item 1), beside the question box
 * on the home page, `/ask` and `/explore`. One row per configured source, in
 * manifest order: its name, its publisher, where it runs, who holds its logs
 * and what they say they keep, how current its data is, and the three-state
 * control. An Ask first row says what Ask first means in R6, in literal
 * words (Q1). A footer carries the privacy page, the deployment guide's
 * address or the sentence that says this site names none (D10), the date the
 * consent was given and the control that withdraws it in place, for every
 * session (amendment 1, Q7); a session whose consent is kept on its account
 * also gets a link to the dashboard's Sources tab, and its notices (D2 = A).
 *
 * THE CONTROL is a radio group per source, named for it, of three native
 * radios: arrow keys move within it, the checked choice is what a screen
 * reader announces, and the group's label names the source. A choice is
 * written through the consent endpoint; while the write is in flight every
 * control and the question form's submit are held (the guard's `held`).
 */

import type { CSSProperties } from 'react';
import { ASK_FIRST_MEANS, PANEL_HEADING, PANEL_LEAD, PANEL_NO_CONSENT } from '@/lib/sources/copy';
import { readerSourceName, sourceWhere } from '@/lib/sources/source-name';
import { currentStates, useSourceConsent, type SourceStateValue } from './useSourceConsent';
import { KeptByLines } from './KeptByLine';
import LocalOnlyOffer from './LocalOnlyOffer';
import ConsentNotices from './ConsentNotices';

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
  const states = inForce ? currentStates(status, ids) : Object.fromEntries(ids.map((id) => [id, status?.defaults?.[id] ?? 'ask-first']));
  const onAccount = status?.store === 'row';

  return (
    <section aria-labelledby="sources-panel-heading" style={PANEL}>
      <h2 id="sources-panel-heading" style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)' }}>
        {PANEL_HEADING}
      </h2>
      <p style={{ margin: '0 0 8px' }}>{inForce ? PANEL_LEAD : PANEL_NO_CONSENT}</p>
      {onAccount && inForce && <ConsentNotices />}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {(statement?.sources ?? []).map((source) => {
          const name = readerSourceName(source.displayName);
          const state = states[source.sourceId] ?? 'ask-first';
          const since = status?.states?.[source.sourceId]?.since;
          return (
            <li key={source.sourceId} data-source={source.sourceId} style={{ padding: '8px 0', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
              <div>
                Published by {source.publisher}. Runs at {sourceWhere(source)}.
              </div>
              <div>
                Who holds its logs: <KeptByLines keptBy={source.recipients.flatMap((r) => r.keptBy)} />.
              </div>
              <div>How current its data is: {source.freshness}</div>
              <div role="radiogroup" aria-label={`${name}: On, Ask first or Off`} style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                {STATES.map((choice) => (
                  <label key={choice.value} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name={`source-state-${source.sourceId}`}
                      value={choice.value}
                      checked={state === choice.value}
                      disabled={!inForce || consent.writing}
                      onChange={() => {
                        void consent.setState(source.sourceId, choice.value);
                      }}
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
              {inForce && since ? <div>Set {STATES.find((c) => c.value === state)?.label} since {since}.</div> : null}
              {state === 'ask-first' && <div>{ASK_FIRST_MEANS}</div>}
            </li>
          );
        })}
      </ul>
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px' }}>
        <p style={{ margin: '0 0 6px' }}>
          <a href="/privacy">Where a question goes, in full</a>
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
