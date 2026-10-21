/**
 * "Where this question went" (R6 W4, #632): the answer view's part that says
 * who a run or a record sent something to, and why each other source got
 * nothing. It renders the model `src/lib/flows/where-it-went.ts` builds and
 * decides no fact of its own (design P1: it discloses, it does not validate).
 *
 * Under "Sent to", each reached row: its name, then each recipient's place,
 * what it got (on a run and on a matched record only) and what each holder
 * keeps. Under a record's reference (D1), one line, in the owner's words,
 * links "where a question can go" to the statement the record names. Under
 * "Not sent to", each other source with its reason.
 *
 * Type-only imports: this is part of the client view, and the builder reads
 * the statement module, which is server-only.
 */
import type { CSSProperties } from 'react';
import type { WhereItWentModel, WhereReachedRow } from '../../lib/flows/where-it-went.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM-DD` as "20 October 2026"; anything else as it is. */
function dateWords(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : date;
}

const callsWords = (n: number) => (n === 1 ? '1 call' : `${n} calls`);

const LIST: CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };
const LABEL: CSSProperties = { fontWeight: 600, color: 'var(--text-primary)', marginTop: '10px', marginBottom: '4px' };

function ReachedRow({ row }: { row: WhereReachedRow }) {
  return (
    <li data-part="where-it-went-row" style={{ marginBottom: '10px' }}>
      <div>
        <strong style={{ color: 'var(--text-primary)' }}>{row.name}</strong>
        {row.kind === 'source' && <span>{`, ${callsWords(row.calls)}`}</span>}
      </div>
      {row.kind === 'model' && (row.model !== null || row.service !== null) && (
        <div>
          {row.model !== null && <span>{`Model: ${row.model}. `}</span>}
          {row.service !== null && <span>{`Service: ${row.service}.`}</span>}
        </div>
      )}
      {row.recipients.map((r, i) => (
        <div key={i} style={{ marginTop: '4px', paddingLeft: '12px' }}>
          <div>{`${r.role}: ${r.place}`}</div>
          {r.got !== undefined && <div>{`What it got: ${r.got}`}</div>}
          <div>What it keeps:</div>
          <ul style={{ ...LIST, paddingLeft: '12px' }}>
            {r.keptBy.map((line, j) => <li key={j}>{line}</li>)}
          </ul>
        </div>
      ))}
    </li>
  );
}

export default function WhereItWent({ model }: { model: WhereItWentModel }) {
  return (
    <div data-part="where-it-went" style={{
      borderLeft: '3px solid var(--border-color)', padding: '6px 10px', marginTop: '16px',
      fontSize: '13px', color: 'var(--text-secondary)', borderRadius: '0 4px 4px 0',
    }}>
      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Where this question went</h3>
      <div style={LABEL}>Sent to</div>
      <ul style={LIST}>
        {model.reached.map((row, i) => <ReachedRow key={i} row={row} />)}
      </ul>
      {model.statement.kind === 'reference' && (
        <p style={{ margin: '6px 0' }}>
          What each one keeps:{' '}
          <a href={model.statement.url} target="_blank" rel="noopener noreferrer">where a question can go</a>
          {`, as of ${dateWords(model.statement.date)}.`}
        </p>
      )}
      {model.notReached.length > 0 && (
        <>
          <div style={LABEL}>Not sent to</div>
          <ul style={LIST}>
            {model.notReached.map((row) => (
              <li key={row.sourceId}>
                <strong style={{ color: 'var(--text-primary)' }}>{row.name}</strong>
                {`: ${row.whyNotSent}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
