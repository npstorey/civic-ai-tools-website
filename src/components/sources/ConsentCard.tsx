'use client';

/**
 * The first-consent card (R6 W3, #632 anchor W3 item 2; design §4.4): shown
 * before the first question on a fresh session, and whenever a route answers
 * `consent_required`. The owner's text (a candidate until R6 G7,
 * `@/lib/sources/copy`) with the recipient list derived from the flows
 * statement this instance serves: each recipient with what its holder says
 * it keeps, the page it said so on and the date that page was read, or "not
 * stated". **Allow** stores the defaults of D6 and the surface then sends
 * the question; **Not now** sends nothing. The two are equal in size and
 * style (D4 = A), and the analytics line and the cookie sentence sit below
 * them.
 *
 * Every sentence that is true only on some instances renders only there:
 * "on your account" with a database, the analytics line with analytics, the
 * operator's endpoint statement with `SITE_OPERATOR_STATES_NO_TRAINING`.
 */

import { useState, type CSSProperties } from 'react';
import type { FlowsRecipient } from '@/lib/flows/statement';
import {
  CARD_ANALYTICS,
  CARD_COOKIE_WITH_ACCOUNTS,
  CARD_COOKIE_WITHOUT_ACCOUNTS,
  CONSENT_CARD,
  ENDPOINT_NO_TRAINING,
  WITHDRAW_WITH_ACCOUNTS,
  WITHDRAW_WITHOUT_ACCOUNTS,
} from '@/lib/sources/copy';
import { readerSourceName, recipientWhere, roleLabel } from '@/lib/sources/source-name';
import { useSourceConsent } from './useSourceConsent';
import { KeptByLines } from './KeptByLine';
import LocalOnlyOffer from './LocalOnlyOffer';

interface ConsentCardProps {
  /** Called after Allow has stored the consent; the surface then sends the question. */
  onAllow?: () => void;
  /** Called on Not now; nothing has been sent or stored. */
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

function RecipientLine({ recipient, label }: { recipient: FlowsRecipient; label: string }) {
  const operator = recipient.role === 'model-endpoint' ? recipient.keptBy.find((k) => k.operatorStatement) : undefined;
  return (
    <li data-recipient={recipient.id} style={{ marginBottom: '4px' }}>
      <strong style={{ fontWeight: 600 }}>{label}</strong>
      {` (${recipientWhere(recipient)}): `}
      {operator ? `${operator.holder}: ${ENDPOINT_NO_TRAINING}` : <KeptByLines keptBy={recipient.keptBy} />}
    </li>
  );
}

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
      <p style={{ margin: '0 0 8px' }}>{CONSENT_CARD.beforeList.join(' ')}</p>
      {statement ? (
        <ul style={{ margin: '0 0 8px', paddingLeft: '20px' }}>
          {statement.recipients.map((r) => (
            <RecipientLine key={r.id} recipient={r} label={roleLabel(r.role)} />
          ))}
          {statement.sources.flatMap((source) =>
            source.recipients.map((r) => <RecipientLine key={r.id} recipient={r} label={readerSourceName(source.displayName)} />),
          )}
        </ul>
      ) : (
        <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)' }}>Reading where a question can go…</p>
      )}
      <p style={{ margin: '0 0 8px' }}>
        {CONSENT_CARD.afterList[0]} {accounts ? WITHDRAW_WITH_ACCOUNTS : WITHDRAW_WITHOUT_ACCOUNTS}{' '}
        <a href="/privacy">{CONSENT_CARD.afterList[1]}</a>
      </p>
      <p style={{ margin: '0 0 12px' }}>
        <LocalOnlyOffer statement={statement} />
      </p>
      <p style={{ margin: '0 0 8px' }}>{CONSENT_CARD.effect}</p>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <button type="button" style={BUTTON} onClick={allow} disabled={answering || !statement}>
          Allow
        </button>
        <button type="button" style={BUTTON} onClick={() => onNotNow?.()} disabled={answering}>
          Not now
        </button>
      </div>
      {analytics && <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)' }}>{CARD_ANALYTICS}</p>}
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{accounts ? CARD_COOKIE_WITH_ACCOUNTS : CARD_COOKIE_WITHOUT_ACCOUNTS}</p>
    </section>
  );
}
