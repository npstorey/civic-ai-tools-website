'use client';

/**
 * The first-consent card (R6 W3, #632 anchor W3 item 2; design §4.4): shown
 * before the first question on a fresh session, and whenever a route answers
 * `consent_required`. **Allow** stores the states the Sources panel shows (D6;
 * every source Ask first where the instance can ask, UX-2 P4b Part E) and the
 * surface then sends the question; **Don't allow** sends nothing and stores
 * nothing, and the reader is asked again on the next question (item 11). The
 * two are equal in size and style (D4 = A).
 *
 * A decision layer cut to D6 B (UX-2 P4b; ASK1 = A, ASK2 = B), in order: the
 * heading, the owner's two sentences (`CONSENT_CARD.lead`), what each answer
 * does (`CONSENT_CARD.effect`), ASK1's line, the privacy page's link, the two
 * buttons, the link to Data source settings (the Settings overlay, a
 * client-side link so a page beneath stays mounted), then the analytics line
 * and the cookie sentence. No "Allow all data sources" here (S3): it is the
 * pause's. The recipients and what each says it keeps are the privacy page's,
 * the card's full layer.
 *
 * Every sentence that is true only on some instances renders only there:
 * "on your account" with a database, the analytics line with analytics.
 */

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { CARD_ANALYTICS, CARD_COOKIE_WITH_ACCOUNTS, CARD_COOKIE_WITHOUT_ACCOUNTS, CONSENT_CARD, SETTINGS_HREF } from '@/lib/sources/copy';
import { useSourceConsent } from './useSourceConsent';

interface ConsentCardProps {
  /** Called after Allow has stored the consent; the surface then sends the question. */
  onAllow?: () => void;
  /** Called on "Don't allow"; nothing has been sent or stored. */
  onNotNow?: () => void;
}

const BUTTON: CSSProperties = {
  flex: '1 1 0',
  minWidth: '120px',
  padding: '10px 16px',
  fontSize: '14px',
  fontWeight: 600,
  borderRadius: '6px',
  border: '1px solid var(--accent)',
  backgroundColor: 'var(--white)',
  color: 'var(--accent)',
  cursor: 'pointer',
};

export default function ConsentCard({ onAllow, onNotNow }: ConsentCardProps) {
  const consent = useSourceConsent();
  const [answering, setAnswering] = useState(false);
  const statement = consent.statement;
  const accounts = consent.status?.accounts === true;
  const analytics = statement?.recipients.some((r) => r.role === 'analytics') ?? false;

  const allow = async () => {
    setAnswering(true);
    try {
      if (await consent.allow()) onAllow?.();
    } finally {
      setAnswering(false);
    }
  };

  return (
    <section
      aria-labelledby="consent-card-heading"
      data-consent-card=""
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '16px 20px',
        backgroundColor: 'var(--card-background)',
        fontSize: '14px',
        lineHeight: 1.6,
        color: 'var(--text-primary)',
      }}
    >
      <h2 id="consent-card-heading" style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px' }}>
        {CONSENT_CARD.heading}
      </h2>
      <p style={{ margin: '0 0 8px' }}>{CONSENT_CARD.lead.join(' ')}</p>
      {!statement && <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)' }}>Reading where a question can go…</p>}
      <p style={{ margin: '0 0 8px' }}>{CONSENT_CARD.effect}</p>
      <p style={{ margin: '0 0 8px' }}>{CONSENT_CARD.changeLine}</p>
      <p style={{ margin: '0 0 12px' }}>
        <a href="/privacy">{CONSENT_CARD.fullStatement}</a>
      </p>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <button type="button" style={BUTTON} onClick={allow} disabled={answering || !statement}>
          Allow
        </button>
        <button type="button" style={BUTTON} onClick={() => onNotNow?.()} disabled={answering}>
          {CONSENT_CARD.decline}
        </button>
      </div>
      <p style={{ margin: '0 0 12px' }}>
        <Link href={SETTINGS_HREF}>{CONSENT_CARD.settingsLink}</Link>
      </p>
      {analytics && <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)' }}>{CARD_ANALYTICS}</p>}
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{accounts ? CARD_COOKIE_WITH_ACCOUNTS : CARD_COOKIE_WITHOUT_ACCOUNTS}</p>
    </section>
  );
}
