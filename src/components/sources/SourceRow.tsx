'use client';

/**
 * One configured source's row (R6 PL; R9 P2, #661), as the Sources panel has
 * rendered it inline since R6, extracted for its second surface, the Settings
 * overlay's Data sources sub-page (UX-2 P4b): composition, not a second copy.
 * Its name, what the source is and its control, two equal buttons (S4 W2a,
 * `SourceStateControl.tsx`); the mark (S10) for a source set on its own in a
 * group; under a source not answered yet, S86 where a question can stop to ask
 * (in loop with the decision store), else `ASK_FIRST_MEANS`; "More about this source" with the reach,
 * the logs and the currency lines; and the pause card while a question waits
 * on this source. One `<li>` element, so the panel's element tree is the one it
 * had inline.
 */

import type { ReactNode } from 'react';
import { ASK_FIRST_MEANS, ASK_FIRST_MEANS_WITH_PAUSE, PANEL_ROW_MORE, SET_ON_ITS_OWN_LINE } from '@/lib/sources/copy';
import type { FlowsSource } from '@/lib/flows/statement';
import { sourceRowLines } from '@/lib/sources/source-name';
import { KeptByLines } from './KeptByLine';
import { SourceStateButtons, SourceStateConfirmation, useLineId, type SourceStateControlProps } from './SourceStateControl';
import { canPauseToAsk, type PendingPause } from './useSourceConsent';
import ConsentStep from '../answer-view/ConsentStep';

export interface SourceRowProps {
  source: FlowsSource;
  /** The row's control, as `SourceStateControl.tsx` takes it. */
  control: SourceStateControlProps;
  /** What the row reads from the consent bus: the routing mode, the store, and the pauses. */
  consent: { routing: 'in-loop' | 'all-sources' | null; store: boolean | null; pauses: Record<string, PendingPause> };
  /** S3-B W1 (D2 = A): the picker's pick control, after the row's own control; absent in Settings. */
  pick?: ReactNode;
  /**
   * S4 W2a (C2 = B): the source is set on its own and in a group of two or more, so the row carries the mark, S10,
   * under its control. A source alone has no group control to leave it as it is, and no mark.
   */
  marked?: boolean;
}

export default function SourceRow({ source, control, consent, pick, marked = false }: SourceRowProps) {
  const lines = sourceRowLines(source);
  const { name, state } = control;
  const markId = useLineId('source-mark');
  const notAnsweredId = useLineId('source-not-answered');
  const notAnswered = state === 'ask-first';
  const describedBy = [notAnswered ? notAnsweredId : null, marked ? markId : null].filter(Boolean).join(' ') || undefined;
  return (
    <li data-source={source.sourceId} style={{ padding: '8px 0', borderTop: '1px solid var(--border-color)' }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
      {lines.what !== null && <div>{lines.what.charAt(0).toUpperCase() + lines.what.slice(1)}</div>}
      <SourceStateButtons {...control} describedBy={describedBy} />
      <SourceStateConfirmation {...control} />
      {marked && <div id={markId} data-part="set-on-its-own">{SET_ON_ITS_OWN_LINE}</div>}
      {pick}
      {/* A question stops to ask only in loop and with the decision store (R9 P1, #666): S86 only then, by the one
          predicate the harness menu reads too (UX-2 P3b-2, v2 ruling 1). */}
      {notAnswered && <div id={notAnsweredId}>{canPauseToAsk(consent) ? ASK_FIRST_MEANS_WITH_PAUSE : ASK_FIRST_MEANS}</div>}
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
}
