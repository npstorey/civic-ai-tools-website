'use client';

/**
 * One configured source's row (R6 PL; R9 P2, #661), as the Sources panel has
 * rendered it inline since R6, extracted for its second surface, the Settings
 * overlay's Data sources sub-page (UX-2 P4b): composition, not a second copy.
 * Its name, what the source is and its three-state control; the Ask-first line
 * under the panel's own condition (item 54 only in loop with the decision
 * store, where "here" names this row); "More about this source" with the reach,
 * the logs and the currency lines; and the pause card while a question waits
 * on this source. One `<li>` element, so the panel's element tree is the one it
 * had inline.
 */

import { ASK_FIRST_MEANS, ASK_FIRST_MEANS_WITH_PAUSE, PANEL_ROW_MORE } from '@/lib/sources/copy';
import type { FlowsSource } from '@/lib/flows/statement';
import { sourceRowLines } from '@/lib/sources/source-name';
import { KeptByLines } from './KeptByLine';
import { SourceStateConfirmation, SourceStateRadios, type SourceStateControlProps } from './SourceStateControl';
import type { PendingPause } from './useSourceConsent';
import ConsentStep from '../answer-view/ConsentStep';

export interface SourceRowProps {
  source: FlowsSource;
  /** The row's control, as `SourceStateControl.tsx` takes it. */
  control: SourceStateControlProps;
  /** What the row reads from the consent bus: the routing mode, the store, and the pauses. */
  consent: { routing: 'in-loop' | 'all-sources' | null; store: boolean | null; pauses: Record<string, PendingPause> };
}

export default function SourceRow({ source, control, consent }: SourceRowProps) {
  const lines = sourceRowLines(source);
  const { name, state } = control;
  return (
    <li data-source={source.sourceId} style={{ padding: '8px 0', borderTop: '1px solid var(--border-color)' }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
      {lines.what !== null && <div>{lines.what.charAt(0).toUpperCase() + lines.what.slice(1)}</div>}
      <SourceStateRadios {...control} />
      <SourceStateConfirmation {...control} />
      {/* A question stops to ask only in loop and with the decision store (R9 P1, #666): the pause words only then. */}
      {state === 'ask-first' && <div>{consent.routing === 'in-loop' && consent.store === true ? ASK_FIRST_MEANS_WITH_PAUSE : ASK_FIRST_MEANS}</div>}
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
