'use client';

/**
 * The first-consent card (R6 W3, #632 anchor W3 item 2; design §4.4): shown
 * before the first question on a fresh session, and whenever a route answers
 * `consent_required`. **Allow** stores the defaults of D6 and the surface then
 * sends the question; **Not now** sends nothing. The two are equal in size and
 * style (D4 = A), and the analytics line and the cookie sentence sit below
 * them.
 *
 * A decision layer (R9 P3, #660; D2 = A of the UX pass). Above the buttons,
 * the short layer only (`@/lib/sources/copy`): the data flow, the timing, the
 * recipients counted and named from the flows statement this instance serves,
 * the pointer to the recipients, the local-only offer, where states are set and
 * consent withdrawn, the privacy page's link, and the two answers' effects. No
 * kept-by line renders above the buttons. The recipients and what each says
 * it keeps sit below, in a disclosure closed by default (design principle 8)
 * whose summary carries the count: the scope line, the base recipients each
 * as a line, the definition of "sandbox" where a source runs in one, and one
 * line per data source grouping its recipients, the sandbox host's kept-by
 * line given in full once.
 *
 * Every sentence that is true only on some instances renders only there:
 * "on your account" with a database, the analytics line with analytics, the
 * operator's endpoint statement with `SITE_OPERATOR_STATES_NO_TRAINING`, the
 * sandbox definition with a source that runs in this site's sandbox.
 */

import { useState, type CSSProperties } from 'react';
import type { FlowsKeptBy, FlowsRecipient, FlowsSource } from '@/lib/flows/statement';
import {
  CARD_ANALYTICS,
  CARD_CONTROLS_WITH_ACCOUNTS,
  CARD_CONTROLS_WITHOUT_ACCOUNTS,
  CARD_COOKIE_WITH_ACCOUNTS,
  CARD_COOKIE_WITHOUT_ACCOUNTS,
  CARD_SANDBOX_DEFINITION,
  CARD_SOURCE_LINE,
  CONSENT_CARD,
  ENDPOINT_NO_TRAINING,
  KEPT_FOR_OPERATOR,
  cardPointerSentence,
  cardReachSentence,
  cardRecipientsSummary,
} from '@/lib/sources/copy';
import { readerSourceName, recipientWhere, roleLabel } from '@/lib/sources/source-name';
import { useSourceConsent } from './useSourceConsent';
import KeptByLine, { KeptByLines } from './KeptByLine';
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
  const where = recipientWhere(recipient);
  const operator = recipient.role === 'model-endpoint' ? recipient.keptBy.find((k) => k.operatorStatement) : undefined;
  // A holder named by the same host the line already names is not named twice.
  const only = recipient.keptBy.length === 1 && recipient.keptBy[0].holder === where && recipient.keptBy[0].keeps === 'operator-states';
  return (
    <li data-recipient={recipient.id} style={{ marginBottom: '4px' }}>
      <strong style={{ fontWeight: 600 }}>{label}</strong>
      {` (${where}): `}
      {/* S2 = A: the operator's statement follows the clause, it does not replace it. */}
      {operator ? `${KEPT_FOR_OPERATOR}. ${ENDPOINT_NO_TRAINING}` : only ? `${KEPT_FOR_OPERATOR}.` : <KeptByLines keptBy={recipient.keptBy} />}
    </li>
  );
}

/** Where a recipient runs: a hosted source's own sandbox. */
const IN_SANDBOX = 'instance-sandbox';

/** A sandbox holder's line, by everything it prints: given in full once across the list. */
function holderKey(k: FlowsKeptBy): string {
  return JSON.stringify([k.holder, k.keeps, k.retention ?? null, k.statementUrl ?? null, k.readOn ?? null]);
}

/**
 * The sandbox holders' lines already given in full by an earlier recipient, in
 * statement order, each by `<recipient id>#<index>`. Computed once from the
 * whole statement, so a line renders the same however often it is rendered.
 */
function repeatedSandboxHolders(sources: readonly FlowsSource[]): ReadonlySet<string> {
  const printed = new Set<string>();
  const repeated = new Set<string>();
  for (const r of sources.flatMap((source) => source.recipients)) {
    if (r.runsAt !== IN_SANDBOX) continue;
    r.keptBy.forEach((k, j) => {
      const key = holderKey(k);
      if (printed.has(key)) repeated.add(`${r.id}#${j}`);
      printed.add(key);
    });
  }
  return repeated;
}

/**
 * One data source's line: its name, then each recipient as "runs in <place>"
 * (its sandbox) or "reaches <host>", each with what its holders say they keep.
 * A sandbox holder given in full on an earlier line is named with "as above".
 */
function SourceLine({ source, repeated }: { source: FlowsSource; repeated: ReadonlySet<string> }) {
  return (
    <li data-recipient-group={source.sourceId} style={{ marginBottom: '4px' }}>
      <strong style={{ fontWeight: 600 }}>{readerSourceName(source)}</strong>
      {': '}
      {source.recipients.map((r, i) => {
        const where = recipientWhere(r);
        const sandbox = r.runsAt === IN_SANDBOX;
        const verb = sandbox ? CARD_SOURCE_LINE.runsIn : CARD_SOURCE_LINE.reaches;
        const only = r.keptBy.length === 1 && r.keptBy[0].holder === where && r.keptBy[0].keeps === 'operator-states';
        const holders = only
          ? KEPT_FOR_OPERATOR
          : r.keptBy.map((k, j) => {
              const again = repeated.has(`${r.id}#${j}`);
              return (
                <span key={`${k.holder}-${j}`}>
                  {j > 0 ? '; ' : ''}
                  {again ? `${k.holder}${CARD_SOURCE_LINE.asAbove}` : <KeptByLine keptBy={k} />}
                </span>
              );
            });
        return (
          <span key={r.id} data-recipient={r.id}>
            {i > 0 ? ' ' : ''}
            {i > 0 ? verb.charAt(0).toUpperCase() + verb.slice(1) : verb}
            {where}
            {CARD_SOURCE_LINE.holders}
            {holders}.
          </span>
        );
      })}
    </li>
  );
}

export default function ConsentCard({ onAllow, onNotNow }: ConsentCardProps) {
  const consent = useSourceConsent();
  const [answering, setAnswering] = useState(false);
  const statement = consent.statement;
  const accounts = consent.status?.accounts === true;
  const analytics = statement?.recipients.some((r) => r.role === 'analytics') ?? false;
  const count = statement ? statement.recipients.length + statement.sources.reduce((n, s) => n + s.recipients.length, 0) : 0;
  const sandboxed = statement?.sources.some((s) => s.recipients.some((r) => r.runsAt === IN_SANDBOX)) ?? false;
  const repeated = statement ? repeatedSandboxHolders(statement.sources) : new Set<string>();

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
      <p style={{ margin: '0 0 8px' }}>
        {CONSENT_CARD.lead.join(' ')}
        {statement && ` ${cardReachSentence(statement.sources.map((source) => readerSourceName(source)))} ${cardPointerSentence(count)}`}
      </p>
      {!statement && <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)' }}>Reading where a question can go…</p>}
      <p style={{ margin: '0 0 8px' }}>
        <LocalOnlyOffer statement={statement} />
      </p>
      <p style={{ margin: '0 0 8px' }}>
        {accounts ? CARD_CONTROLS_WITH_ACCOUNTS : CARD_CONTROLS_WITHOUT_ACCOUNTS}{' '}
        <a href="/privacy">{CONSENT_CARD.fullStatement}</a>
      </p>
      <p style={{ margin: '0 0 12px' }}>{CONSENT_CARD.effect}</p>
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
      {statement && (
        <details data-consent-recipients="" style={{ marginTop: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}>{cardRecipientsSummary(count)}</summary>
          <p style={{ margin: '8px 0' }}>{CONSENT_CARD.disclosureLead}</p>
          <ul style={{ margin: '0 0 8px', paddingLeft: '20px' }}>
            {statement.recipients.map((r) => (
              <RecipientLine key={r.id} recipient={r} label={roleLabel(r.role)} />
            ))}
          </ul>
          {sandboxed && <p data-sandbox-definition="" style={{ margin: '0 0 8px' }}>{CARD_SANDBOX_DEFINITION}</p>}
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            {statement.sources.map((source) => (
              <SourceLine key={source.sourceId} source={source} repeated={repeated} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
