'use client';

/**
 * The dashboard's Sources tab (R6 W3, #632 anchor W3 item 3): for a signed-in
 * account whose consent is kept on the account, every source's state and the
 * date it was given, the date the consent was given, the base version of
 * the statement it refers to with that statement's date (S3), the notices (D2 = A), and
 * a control that withdraws the consent (`DELETE /api/sources/consent`). The
 * panel beside the question box links here.
 *
 * THE STATES ARE SET HERE TOO (UX-1 PC, #719; G0-7 (a): the Settings
 * screen's first form). With a consent in force each row carries the Sources
 * panel's own control (`SourceStateControl.tsx`), writing through the same hook, so
 * a choice is written with every configured source's state and the flows
 * version, and its row confirms it in the panel's words. The row's list line
 * already gives the date, so the control's "Set <State> since <date>." line is
 * left out here. With no consent in force there is no control: a choice would
 * be kept on the page and written by nothing this tab shows.
 */

import { useState } from 'react';
import { SOURCES_TAB_NO_CONSENT } from '@/lib/sources/copy';
import { readerSourceName } from '@/lib/sources/source-name';
import ConsentNotices from '@/components/sources/ConsentNotices';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import { STATES, SourceStateConfirmation, SourceStateRadios, type ConfirmedChange, type SourceStateControlProps } from '@/components/sources/SourceStateControl';
import { currentStates, useSourceConsent } from '@/components/sources/useSourceConsent';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A stored date in words, "20 October 2026" (UX pass row 14(a)), read from the
 * value's first ten characters as written (an ISO date or timestamp, UTC), so
 * no time zone moves it a day. Anything else is returned as stored.
 */
function dateInWords(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

export default function SourcesTab() {
  const consent = useSourceConsent();
  const status = consent.status;
  const statement = consent.statement;
  const inForce = status?.inForce === true;
  const ids = statement?.sources.map((s) => s.sourceId) ?? [];
  const states = currentStates(status, ids);
  // The last change whose write succeeded: its row confirms it (the panel's rule, UX pass row 5).
  const [confirmed, setConfirmed] = useState<ConfirmedChange>(null);

  return (
    <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
      {!consent.loaded ? (
        <p style={{ color: 'var(--text-secondary)' }}>Reading your consent…</p>
      ) : !inForce ? (
        <p style={{ color: 'var(--text-secondary)' }}>
          {SOURCES_TAB_NO_CONSENT}
        </p>
      ) : (
        <>
          <ConsentNotices />
          <p style={{ margin: '0 0 8px' }}>
            {/* One string per sentence, so the markup carries no separators between its parts. */}
            {`Given on ${status?.consentedAt ? dateInWords(String(status.consentedAt)) : 'a date not recorded'}.`}
            {` It refers to the statement of where a question can go as it stood on ${status?.consentedFlowsDate ? dateInWords(status.consentedFlowsDate) : 'a date not recorded'} (version ${status?.consentedBaseVersion?.slice(0, 8) ?? 'not recorded'}).`}
          </p>
          <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
            {(statement?.sources ?? []).map((source) => {
              const name = readerSourceName(source);
              const state = states[source.sourceId] ?? 'ask-first';
              const since = status?.states?.[source.sourceId]?.since;
              const control: SourceStateControlProps = { sourceId: source.sourceId, name, state, since, inForce, writing: consent.writing, setState: consent.setState, confirmed, setConfirmed, sinceLine: false };
              return (
                <li key={source.sourceId} data-source={source.sourceId} style={{ padding: '6px 0', borderTop: '1px solid var(--border-color)' }}>
                  <strong style={{ fontWeight: 600 }}>{name}</strong>
                  {`: ${STATES.find((c) => c.value === state)?.label ?? 'Ask first'}`}
                  {since ? `, since ${since}` : ''}
                  <SourceStateRadios {...control} />
                  <SourceStateConfirmation {...control} />
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              void consent.revoke();
            }}
            disabled={consent.writing}
            style={{ padding: '6px 14px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--white)', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Withdraw consent
          </button>
        </>
      )}
      <p style={{ margin: '16px 0 0', color: 'var(--text-secondary)' }}>
        <LocalOnlyOffer statement={statement} />
      </p>
    </div>
  );
}
