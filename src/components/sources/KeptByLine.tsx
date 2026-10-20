'use client';

/**
 * One holder's kept-by line, as the consent card, the Sources panel and the
 * dashboard's Sources tab show it (R6 W3): what the holder says it keeps
 * (`keepsText`), the page it said so on, linked, and the date that page was
 * read; or "not stated" / "not read" as they are. Disclosure, not validation
 * (design principle 1): the line repeats what the holder says, never a check.
 */

import type { FlowsKeptBy } from '@/lib/flows/statement';
import { keepsText } from '@/lib/sources/source-name';

export default function KeptByLine({ keptBy }: { keptBy: FlowsKeptBy }) {
  return (
    <>
      {keepsText(keptBy)}
      {keptBy.statementUrl && (
        <>
          {' ('}
          <a href={keptBy.statementUrl} target="_blank" rel="noopener noreferrer">
            its statement
          </a>
          {keptBy.readOn ? `, read ${keptBy.readOn})` : ')'}
        </>
      )}
    </>
  );
}

/** Several holders' lines, separated as one sentence. */
export function KeptByLines({ keptBy }: { keptBy: readonly FlowsKeptBy[] }) {
  return (
    <>
      {keptBy.map((k, i) => (
        <span key={`${k.holder}-${i}`}>
          {i > 0 ? '; ' : ''}
          <KeptByLine keptBy={k} />
        </span>
      ))}
    </>
  );
}
