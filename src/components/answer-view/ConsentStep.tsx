'use client';

/**
 * The consent step (#644 W2, C3; design §1.6): a load of a source the reader
 * set to Ask first has stopped to ask. Shown as a step of its own in a run's
 * steps (`ProgressLog` on the comparison surfaces and `/explore`,
 * `StepsPartView`'s step view on the executed run), and in the Sources
 * panel's row for that source while the question waits, so a reader who
 * scrolled can answer there. Never a part of its own, never inside the
 * disclosure.
 *
 * WHAT IT SAYS, in the Sources panel's own form (R6 PL): the source by its
 * reader name, never a tool's exposed name; what it is and whose connector
 * reaches it, running where (`sourceRowLines`); who holds its logs, as
 * `KeptByLines` renders them, each with its date or "not stated"; the hosts
 * it would reach; the privacy page, and the deployment guide or the sentence
 * that says this site names none (R6's D10). Then Allow and Not now, equal in
 * size and style, what each does, and how long the question waits.
 *
 * Every fact comes from the pause the server sent (`ConsentPausePayload`):
 * the flows statement's entry for the source, as the panel renders it, and
 * the hosts its hosting variant may reach. The answer is posted with the
 * pause's own key (`decideConsentPause`), and once given, the card shows it.
 * A pause that does not hold (no store, or the run's holds spent) shows no
 * buttons: it says the source was not used, and how to turn it On.
 */

import type { CSSProperties } from 'react';
import type { FlowsStatement } from '@/lib/flows/statement';
import type { ConsentPausePayload } from '@/lib/streaming';
import { PANEL_PRIVACY_LINK } from '@/lib/sources/copy';
import { readerSourceName, sourceRowLines } from '@/lib/sources/source-name';
import { KeptByLines } from '@/components/sources/KeptByLine';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import { decideConsentPause, useSourceConsent } from '@/components/sources/useSourceConsent';

/** The card's own sentences, each checked against the consent-wording research. */
export const CONSENT_STEP_TEXT = {
  heading: (name: string) => `${name} is set to Ask first.`,
  asked: 'The AI asked to use it for this question. Nothing has been sent to it yet.',
  cannotAsk: 'This question cannot stop to ask you, so it was not used.',
  nextQuestion: 'You can turn it On in the panel for your next question.',
  choices: 'Allow: the question may use it, and it stays On for later questions. Not now: nothing is sent to it.',
  change: 'You can change this in the panel at any time.',
  wait: 'The question waits up to a minute for your answer.',
  reach: (hosts: readonly string[]) => (hosts.length > 0 ? `It would reach: ${hosts.join(', ')}.` : 'It would reach no host beyond where it runs.'),
  allowed: 'You chose Allow. It is On now.',
  declined: 'You chose Not now. Nothing is sent to it for this question.',
  ended: 'The question went on without your answer, so it did not use this source.',
  gone: 'This question is no longer waiting for an answer.',
  decided: 'An answer was already given for this question.',
  failed: 'Your answer could not be saved. You can set this source in the panel.',
} as const;

const CARD: CSSProperties = {
  border: '1px solid var(--accent)',
  borderRadius: '6px',
  padding: '10px 14px',
  margin: '8px 0',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--card-background)',
};

const BUTTON: CSSProperties = {
  flex: '1 1 0',
  minWidth: '120px',
  padding: '8px 14px',
  fontSize: '14px',
  fontWeight: 600,
  borderRadius: '6px',
  border: '1px solid var(--accent)',
  backgroundColor: 'var(--white)',
  color: 'var(--accent)',
  cursor: 'pointer',
};

/** The hosts a source would reach: its variant's outbound hosts, else the address it is reached at. */
function hostsOf(pause: ConsentPausePayload): string[] {
  if (pause.outbound.length > 0) return pause.outbound;
  return pause.source.host ? [pause.source.host] : [];
}

export default function ConsentStep({ pause, ended = false }: { pause: ConsentPausePayload; ended?: boolean }) {
  const consent = useSourceConsent({ load: false });
  const slot = pause.key !== undefined && consent.pause?.payload.key === pause.key ? consent.pause : null;
  const source = pause.source;
  const name = readerSourceName(source);
  const lines = sourceRowLines(source);
  // LocalOnlyOffer reads the statement's links alone.
  const linksOnly: FlowsStatement = { version: '', date: '', recipients: [], sources: [], links: pause.links };

  const outcome = slot?.decision === 'allow'
    ? CONSENT_STEP_TEXT.allowed
    : slot?.decision === 'not-now'
      ? CONSENT_STEP_TEXT.declined
      : slot?.failure === 'gone'
        ? CONSENT_STEP_TEXT.gone
        : slot?.failure === 'decided'
          ? CONSENT_STEP_TEXT.decided
          : slot?.failure === 'other'
            ? CONSENT_STEP_TEXT.failed
            : pause.holds && (ended || slot?.ended)
              ? CONSENT_STEP_TEXT.ended
              : null;
  const waiting = pause.holds && pause.key !== undefined && outcome === null;
  const key = pause.key;

  return (
    <div data-part="consent-step" data-consent-source={source.sourceId} role="group" aria-label={CONSENT_STEP_TEXT.heading(name)} style={CARD}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--text-primary)' }}>{CONSENT_STEP_TEXT.heading(name)}</p>
      <p style={{ margin: '0 0 6px' }}>{pause.holds ? CONSENT_STEP_TEXT.asked : CONSENT_STEP_TEXT.cannotAsk}</p>
      {lines.what !== null && <div>{lines.what.charAt(0).toUpperCase() + lines.what.slice(1)}</div>}
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
      <div>{CONSENT_STEP_TEXT.reach(hostsOf(pause))}</div>
      <div>
        <a href={pause.links.privacy}>{PANEL_PRIVACY_LINK}</a>
      </div>
      <div>
        <LocalOnlyOffer statement={linksOnly} />
      </div>
      {!pause.holds && <p style={{ margin: '6px 0 0' }}>{CONSENT_STEP_TEXT.nextQuestion}</p>}
      {waiting && key !== undefined && (
        <>
          <p style={{ margin: '6px 0 0' }}>{CONSENT_STEP_TEXT.choices}</p>
          <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.change}</p>
          <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.wait}</p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button type="button" style={BUTTON} disabled={slot?.deciding === true} onClick={() => { void decideConsentPause(key, 'allow'); }}>
              Allow
            </button>
            <button type="button" style={BUTTON} disabled={slot?.deciding === true} onClick={() => { void decideConsentPause(key, 'not-now'); }}>
              Not now
            </button>
          </div>
        </>
      )}
      {outcome !== null && (
        <p data-part="consent-outcome" style={{ margin: '6px 0 0', fontWeight: 600, color: 'var(--text-primary)' }}>
          {outcome}
        </p>
      )}
    </div>
  );
}
