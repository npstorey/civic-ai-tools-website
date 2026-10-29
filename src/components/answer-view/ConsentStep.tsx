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
 * WHAT IT SAYS, decision first (fix round 1, item 3), so it is read in
 * well under a minute: the source by its reader name, never a tool's exposed
 * name, and that the AI asked; what Allow and Not now each send, that the
 * choice can be changed, how long the question waits, and the two buttons,
 * equal in size and style. Then, in the Sources panel's own form (R6 PL),
 * what the source is and whose connector reaches it, running where
 * (`sourceRowLines`); who holds its logs, as `KeptByLines` renders them, each
 * with its date or "not stated"; the hosts its variant would reach beyond its
 * address, when it names any; the privacy page, and the deployment guide or
 * the sentence that says this site names none (R6's D10). The outcome, once
 * there is one, is last.
 *
 * Every fact comes from the pause the server sent (`ConsentPausePayload`):
 * the flows statement's entry for the source, as the panel renders it, and
 * the hosts its hosting variant may reach. The answer is posted with the
 * pause's own key (`decideConsentPause`), and once given, the card shows it.
 * A pause that does not hold (no store, or the run's holds spent) shows no
 * buttons: it says the source was not used, and how to turn it On.
 *
 * AFTER THE HOLD (R9 P1, #669 D2). The run waits a minute; the entry lives
 * ten (`entryExpiresAt`). Between the two the card keeps Allow and Not now,
 * equal as before, and says the run went on without the answer and that an
 * answer now applies to the reader's next question; once given, it says so.
 * At the entry's end, on a 404, or on Cancel, the buttons go and the card
 * says the question is no longer waiting. The run's own "moved on" state
 * (`runMovedOn`, the step's `isComplete`) changes the words, never the
 * buttons (the seat's note 4): the bus's entry decides those.
 *
 * IN VIEW (R9 P1, #672). `ConsentPausePrompt`, rendered by the surface that
 * owns the question box (at the top of the answer area on the home page and
 * `/ask`, under the running question on `/explore`), shows the card's
 * heading, what each choice sends and the same two buttons while a hold is
 * open and unanswered, and, once per pause, brings the run's step card into
 * view (`block: 'nearest'`; `behavior: 'auto'` when the reader asked for
 * reduced motion, as `preferredScrollBehavior` says for every scroll the
 * question surface makes).
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import type { FlowsStatement } from '@/lib/flows/statement';
import type { ConsentPausePayload } from '@/lib/streaming';
import { PANEL_PRIVACY_LINK } from '@/lib/sources/copy';
import { readerSourceName, sourceRowLines } from '@/lib/sources/source-name';
import { KeptByLines } from '@/components/sources/KeptByLine';
import LocalOnlyOffer from '@/components/sources/LocalOnlyOffer';
import { decideConsentPause, pauseEntry, useSourceConsent } from '@/components/sources/useSourceConsent';

/** The card's own sentences, each checked against the consent-wording research. */
export const CONSENT_STEP_TEXT = {
  heading: (name: string) => `${name} is set to Ask first.`,
  asked: 'The AI asked to use it for this question. Nothing has been sent to it yet.',
  cannotAsk: 'This question cannot stop to ask you, so it was not used.',
  nextQuestion: 'You can turn it On in the panel for your next question.',
  choices: 'Allow: this question is sent to it, and it is turned On for later questions. Not now: nothing is sent to it for this question.',
  change: 'You can change this in the panel at any time.',
  wait: 'The question waits up to a minute for your answer.',
  reach: (hosts: readonly string[]) => `It would reach: ${hosts.join(', ')}.`,
  allowed: 'You chose Allow. It is On now.',
  /** Allow was saved, and the question uses the source, but its consent could not be turned On (fix round 2, item 2). */
  allowedNotMoved: 'You chose Allow. This question is sent to it, but it could not be turned On for later questions. You can turn it On in the panel.',
  declined: 'You chose Not now. Nothing is sent to it for this question.',
  ended: 'The question went on without your answer, so it did not use this source.',
  gone: 'This question is no longer waiting for an answer.',
  decided: 'An answer was already given for this question.',
  failed: 'Your answer could not be saved. You can set this source in the panel.',
  // After the hold (R9 P1, #669 D2): hypotheses until the research check passes them.
  stillAnswer: 'You can still answer for your next question.',
  afterChoices: 'Allow: it is turned On for later questions. Not now: nothing changes.',
  allowedAfter: 'You chose Allow. It is On for your next question.',
  allowedAfterNotMoved: 'You chose Allow, but it could not be turned On. You can turn it On in the panel.',
  declinedAfter: 'You chose Not now. Nothing has changed.',
} as const;

/** How every scroll the question surface makes moves: at once when the reader asked for reduced motion. */
export function preferredScrollBehavior(): ScrollBehavior {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'smooth';
  }
}

/** Bring the run's step card for `sourceId` into view: the last one, never a Sources panel row's. */
function bringStepCardIntoView(sourceId: string): void {
  if (typeof document === 'undefined' || !/^[A-Za-z0-9_-]+$/.test(sourceId)) return;
  const found = document.querySelectorAll?.(`[data-part="consent-step"][data-consent-place="steps"][data-consent-source="${sourceId}"]`);
  const card = found && found.length > 0 ? found[found.length - 1] : null;
  card?.scrollIntoView({ block: 'nearest', behavior: preferredScrollBehavior() });
}

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

const PROMPT: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px 12px',
  border: '1px solid var(--accent)',
  borderRadius: '6px',
  padding: '8px 12px',
  margin: '0 0 12px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--card-background)',
};

const PROMPT_BUTTON: CSSProperties = { ...BUTTON, flex: '0 0 auto', minWidth: '96px', padding: '6px 12px', fontSize: '13px' };

/**
 * The compact prompt (R9 P1, #672): while a hold is open and unanswered, the
 * card's heading, what each choice sends, and the same two buttons, posting
 * with the pause's own key. Nothing once the hold ends, an answer is given,
 * or no pause is open. Brings the run's step card into view once per pause.
 */
export function ConsentPausePrompt() {
  const consent = useSourceConsent({ load: false });
  const open = Object.entries(consent.pauses).reverse().find(([, p]) => p.payload.holds && !p.holdEnded && !p.expired && p.decision === undefined && p.failure === undefined);
  const key = open?.[0];
  const entry = open?.[1];
  const sourceId = entry?.payload.source.sourceId;
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (key === undefined || sourceId === undefined || scrolled.current === key) return;
    // After the card has rendered, as the results scroll waits for the loading state (QuerySurface).
    const timer = setTimeout(() => {
      scrolled.current = key;
      bringStepCardIntoView(sourceId);
    }, 100);
    return () => clearTimeout(timer);
  }, [key, sourceId]);
  if (key === undefined || entry === undefined) return null;
  const heading = CONSENT_STEP_TEXT.heading(readerSourceName(entry.payload.source));
  return (
    <div data-part="consent-pause-prompt" role="group" aria-label={heading} style={PROMPT}>
      <p style={{ margin: 0, flex: '1 1 260px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{heading}</span> {CONSENT_STEP_TEXT.choices}
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" style={PROMPT_BUTTON} disabled={entry.deciding} onClick={() => { void decideConsentPause(key, 'allow'); }}>
          Allow
        </button>
        <button type="button" style={PROMPT_BUTTON} disabled={entry.deciding} onClick={() => { void decideConsentPause(key, 'not-now'); }}>
          Not now
        </button>
      </div>
    </div>
  );
}

export default function ConsentStep({ pause, runMovedOn = false, place = 'steps' }: {
  pause: ConsentPausePayload;
  /** The run has moved past this step (the step's `isComplete`): the words change, never the buttons (note 4). */
  runMovedOn?: boolean;
  /** Where the card sits: the run's steps, or a Sources panel row. */
  place?: 'steps' | 'row';
}) {
  const consent = useSourceConsent({ load: false });
  // This card's own entry on the bus, by its key: a later pause in the run never takes its answer (fix round 2, item 1).
  const slot = pauseEntry(consent.pauses, pause.key);
  const source = pause.source;
  const name = readerSourceName(source);
  const lines = sourceRowLines(source);
  // LocalOnlyOffer reads the statement's links alone.
  const linksOnly: FlowsStatement = { version: '', date: '', recipients: [], sources: [], links: pause.links };

  const answered = slot?.decision !== undefined || slot?.failure !== undefined;
  const afterHold = slot?.afterHold === true;
  // The hold is over: the bus says so, or the run has moved past this step.
  const holdEnded = pause.holds && (runMovedOn || slot?.holdEnded === true);
  const expired = slot?.expired === true;
  // An answer given while the run waited reads as it always has.
  const answeredInHold = answered && !afterHold;
  const outcome = slot?.decision === 'allow'
    ? (slot.moved === false
      ? (afterHold ? CONSENT_STEP_TEXT.allowedAfterNotMoved : CONSENT_STEP_TEXT.allowedNotMoved)
      : (afterHold ? CONSENT_STEP_TEXT.allowedAfter : CONSENT_STEP_TEXT.allowed))
    : slot?.decision === 'not-now'
      ? (afterHold ? CONSENT_STEP_TEXT.declinedAfter : CONSENT_STEP_TEXT.declined)
      : slot?.failure === 'gone'
        ? CONSENT_STEP_TEXT.gone
        : slot?.failure === 'decided'
          ? CONSENT_STEP_TEXT.decided
          : slot?.failure === 'other'
            ? CONSENT_STEP_TEXT.failed
            : pause.holds && expired
              ? CONSENT_STEP_TEXT.gone
              : null;
  // The buttons stay while the entry takes an answer. With no entry on the bus (none was reported to this
  // page), the run's own state is all the card has, and they go with the hold, as before R9.
  const waiting = pause.holds && pause.key !== undefined && !answered && !expired && (slot !== null || !holdEnded);
  const key = pause.key;

  return (
    <div data-part="consent-step" data-consent-source={source.sourceId} data-consent-place={place} role="group" aria-label={CONSENT_STEP_TEXT.heading(name)} style={CARD}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--text-primary)' }}>{CONSENT_STEP_TEXT.heading(name)}</p>
      {!pause.holds && <p style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.cannotAsk}</p>}
      {pause.holds && ((!holdEnded && !expired) || answeredInHold) && <p style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.asked}</p>}
      {pause.holds && holdEnded && !answeredInHold && <p data-part="consent-hold-ended" style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.ended}</p>}
      {!pause.holds && <p style={{ margin: '0 0 6px' }}>{CONSENT_STEP_TEXT.nextQuestion}</p>}
      {waiting && key !== undefined && (
        <>
          {holdEnded ? (
            <>
              <p style={{ margin: '0' }}>{CONSENT_STEP_TEXT.stillAnswer}</p>
              <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.afterChoices}</p>
            </>
          ) : (
            <p style={{ margin: '0' }}>{CONSENT_STEP_TEXT.choices}</p>
          )}
          <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.change}</p>
          {!holdEnded && <p style={{ margin: '2px 0 0' }}>{CONSENT_STEP_TEXT.wait}</p>}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '8px 0 10px' }}>
            <button type="button" style={BUTTON} disabled={slot?.deciding === true} onClick={() => { void decideConsentPause(key, 'allow'); }}>
              Allow
            </button>
            <button type="button" style={BUTTON} disabled={slot?.deciding === true} onClick={() => { void decideConsentPause(key, 'not-now'); }}>
              Not now
            </button>
          </div>
        </>
      )}
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
      {/* An addressed source's address is the "running at" line above; this line names only the hosts beyond it. */}
      {pause.outbound.length > 0 && <div>{CONSENT_STEP_TEXT.reach(pause.outbound)}</div>}
      <div>
        <a href={pause.links.privacy}>{PANEL_PRIVACY_LINK}</a>
      </div>
      <div>
        <LocalOnlyOffer statement={linksOnly} />
      </div>
      {outcome !== null && (
        <p data-part="consent-outcome" style={{ margin: '6px 0 0', fontWeight: 600, color: 'var(--text-primary)' }}>
          {outcome}
        </p>
      )}
    </div>
  );
}
