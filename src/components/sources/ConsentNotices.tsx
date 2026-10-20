'use client';

/**
 * The notice (R6 W3, #632 D2 = A): for a reader whose consent is kept on
 * the account, one line per change since the statement the row holds that
 * asks nothing — a recipient removed, or one that now says it keeps less.
 * Dated by the row's `updatedAt` (never `consentedAt`, which a re-consent
 * keeps). Dismissing saves the statement in force on the row; nothing is
 * asked. A change that needs the reader's answer again is never a notice:
 * it is the card. The Sources panel and the dashboard's Sources tab show it.
 */

import { NOTICE_DISMISS, NOTICE_LEAD } from '@/lib/sources/copy';
import { useSourceConsent } from './useSourceConsent';

export default function ConsentNotices() {
  const consent = useSourceConsent();
  const notices = consent.status?.notices ?? [];
  if (notices.length === 0) return null;
  const date = consent.status?.updatedAt ? String(consent.status.updatedAt).slice(0, 10) : '';
  return (
    <div role="status" data-consent-notices="" style={{ margin: '0 0 8px', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--white)' }}>
      <p style={{ margin: '0 0 4px', color: 'var(--text-primary)' }}>
        {NOTICE_LEAD} {date}:
      </p>
      <ul style={{ margin: '0 0 6px', paddingLeft: '20px' }}>
        {notices.map((notice, i) => (
          <li key={`${notice.rule}-${i}`} data-notice={notice.rule}>
            {notice.text}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          void consent.dismiss();
        }}
        disabled={consent.writing}
        style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--white)', color: 'var(--text-primary)', cursor: 'pointer' }}
      >
        {NOTICE_DISMISS}
      </button>
    </div>
  );
}
