'use client';

/**
 * The dashboard's Sources tab (R6 W3, #632 anchor W3 item 3): for a signed-in
 * account whose consent is kept on the account, every source's state and the
 * date it was given, the date the consent was given, the base version of
 * the statement it refers to with that statement's date (S3), the notices (D2 = A), and
 * a control that withdraws the consent (`DELETE /api/sources/consent`). The
 * states themselves are set in the Sources panel beside the question box;
 * the panel links here.
 */

import { SOURCES_TAB_NO_CONSENT } from '@/lib/sources/copy';
import { readerSourceName } from '@/lib/sources/source-name';
import ConsentNotices from '@/components/sources/ConsentNotices';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import { currentStates, useSourceConsent } from '@/components/sources/useSourceConsent';

const LABEL: Record<string, string> = { on: 'On', 'ask-first': 'Ask first', off: 'Off' };

export default function SourcesTab() {
  const consent = useSourceConsent();
  const status = consent.status;
  const statement = consent.statement;
  const inForce = status?.inForce === true;
  const ids = statement?.sources.map((s) => s.sourceId) ?? [];
  const states = currentStates(status, ids);

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
            Given {status?.consentedAt ? String(status.consentedAt).slice(0, 10) : 'on a date not recorded'}.
            {' '}It refers to the statement of where a question can go, version {status?.consentedBaseVersion?.slice(0, 12) ?? 'not recorded'}, dated {status?.consentedFlowsDate ?? 'not recorded'}.
          </p>
          <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
            {(statement?.sources ?? []).map((source) => (
              <li key={source.sourceId} data-source={source.sourceId} style={{ padding: '6px 0', borderTop: '1px solid var(--border-color)' }}>
                <strong style={{ fontWeight: 600 }}>{readerSourceName(source)}</strong>
                {`: ${LABEL[states[source.sourceId]] ?? 'Ask first'}`}
                {status?.states?.[source.sourceId]?.since ? `, since ${status.states[source.sourceId].since}` : ''}
              </li>
            ))}
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
