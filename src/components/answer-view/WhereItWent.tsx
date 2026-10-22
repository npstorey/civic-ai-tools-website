/**
 * "Where this question went" (R6 W4, #632): the answer view's part that says
 * who a run or a record sent something to. It renders the model
 * `src/lib/flows/where-it-went.ts` builds and decides no fact of its own
 * (design P1: it discloses, it does not validate).
 *
 * STAGE C (the owner's G8 review; ruling (b) = (i)). A disclosure, closed by
 * default, as the view's other disclosure is: its summary, "Where this question
 * went: the model and N data source(s).", is the only text shown closed, and
 * counts the sources reached without naming one. Open, two levels: each
 * reached row, then its recipients, in the words the site already uses:
 *   - the model row: "The model service (<host>)", then "The model: <name>"
 *     (`formatModelName`, the name the answer prints);
 *   - a source's recipient labelled by the source's name as the consent card
 *     labels it, "<name> (<place>)", an upstream host "<name>, upstream
 *     (<host>)"; the row reads "<name>, N tool call(s)";
 *   - "Receives: <receives>", the statement's words in its own tense;
 *   - "Who holds its logs: " and the panel's kept-by lines with how long
 *     (`KeptByLines`), the model row by the consent card's rule
 *     (`KEPT_FOR_OPERATOR`, then the operator's statement when it is made).
 * A record with no matching statement says once that it does not say what
 * each one received or keeps, then (D1) links "where a question can go". The
 * sources not reached are not rendered (ruling (i)); the model keeps them.
 *
 * The builder is imported for its types only: it reads the statement module,
 * which is server-only.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { WhereItWentModel, WhereReachedRow, WhereRecipientRow } from '../../lib/flows/where-it-went.ts';
import { KeptByLines } from '@/components/sources/KeptByLine';
import { ENDPOINT_NO_TRAINING, KEPT_FOR_OPERATOR } from '@/lib/sources/copy';
import { formatModelName } from '@/lib/models';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM-DD` as "20 October 2026"; anything else as it is. */
function dateWords(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : date;
}

const toolCalls = (n: number) => (n === 1 ? '1 tool call' : `${n} tool calls`);
const dataSources = (n: number) => (n === 0 ? 'no data source' : n === 1 ? '1 data source' : `${n} data sources`);

/** Shown on a record whose statement this site does not serve, once, under the rows. */
const RECORD_DOES_NOT_SAY = 'This record does not say what each one received or keeps.';

const ROWS: CSSProperties = { margin: '8px 0 0', paddingLeft: '18px' };
const RECIPIENTS: CSSProperties = { margin: '2px 0 0', paddingLeft: '18px' };

/** The model row's holders, by the consent card's rule (`ConsentCard.tsx`, `RecipientLine`). */
function ModelLogs({ recipient }: { recipient: WhereRecipientRow }) {
  const keptBy = recipient.keptBy ?? [];
  const operator = keptBy.find((k) => k.operatorStatement);
  // A holder named by the same host the line already names is not named twice.
  const only = keptBy.length === 1 && keptBy[0].holder === recipient.place && keptBy[0].keeps === 'operator-states';
  if (operator) return <>{`${KEPT_FOR_OPERATOR}. ${ENDPOINT_NO_TRAINING}`}</>;
  if (only) return <>{`${KEPT_FOR_OPERATOR}.`}</>;
  return <><KeptByLines keptBy={keptBy} />.</>;
}

/** What a recipient receives and who holds its logs; nothing when the record does not say. */
function Facts({ recipient, logs }: { recipient: WhereRecipientRow; logs: ReactNode }) {
  return (
    <>
      {recipient.got !== undefined && <div>{`Receives: ${recipient.got}`}</div>}
      {recipient.keptBy !== undefined && <div>Who holds its logs: {logs}</div>}
    </>
  );
}

const logsOf = (recipient: WhereRecipientRow) => <><KeptByLines keptBy={recipient.keptBy ?? []} retention />.</>;

function ReachedRow({ row }: { row: WhereReachedRow }) {
  if (row.kind === 'model') {
    const [recipient] = row.recipients;
    return (
      <li data-part="where-it-went-row" style={{ marginBottom: '8px' }}>
        <strong style={{ color: 'var(--text-primary)' }}>{`The model service (${recipient?.place ?? 'not recorded'})`}</strong>
        <ul style={RECIPIENTS}>
          <li>
            {row.model !== null && <div>{`The model: ${formatModelName(row.model)}`}</div>}
            {recipient && <Facts recipient={recipient} logs={<ModelLogs recipient={recipient} />} />}
          </li>
        </ul>
      </li>
    );
  }
  if (row.kind === 'notebook') {
    const [recipient] = row.recipients;
    return (
      <li data-part="where-it-went-row" style={{ marginBottom: '8px' }}>
        <strong style={{ color: 'var(--text-primary)' }}>{`${row.name} (${recipient?.place ?? 'not recorded'})`}</strong>
        {recipient && (recipient.got !== undefined || recipient.keptBy !== undefined) && (
          <ul style={RECIPIENTS}>
            <li><Facts recipient={recipient} logs={logsOf(recipient)} /></li>
          </ul>
        )}
      </li>
    );
  }
  return (
    <li data-part="where-it-went-row" style={{ marginBottom: '8px' }}>
      <strong style={{ color: 'var(--text-primary)' }}>{`${row.name}, ${toolCalls(row.calls)}`}</strong>
      <ul style={RECIPIENTS}>
        {row.recipients.map((r, i) => (
          <li key={i}>
            <div>{r.upstream ? `${row.name}, upstream (${r.place})` : `${row.name} (${r.place})`}</div>
            <Facts recipient={r} logs={logsOf(r)} />
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function WhereItWent({ model }: { model: WhereItWentModel }) {
  const sources = model.reached.filter((row) => row.kind === 'source').length;
  return (
    <details data-part="where-it-went" style={{
      borderLeft: '3px solid var(--border-color)', padding: '6px 10px', marginTop: '16px',
      fontSize: '13px', color: 'var(--text-secondary)', borderRadius: '0 4px 4px 0',
    }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)' }}>
        {`Where this question went: the model and ${dataSources(sources)}.`}
      </summary>
      <ul style={ROWS}>
        {model.reached.map((row, i) => <ReachedRow key={i} row={row} />)}
      </ul>
      {model.statement.kind !== 'in-force' && <p style={{ margin: '6px 0' }}>{RECORD_DOES_NOT_SAY}</p>}
      {model.statement.kind === 'reference' && (
        <p style={{ margin: '6px 0' }}>
          What each one keeps:{' '}
          <a href={model.statement.url} target="_blank" rel="noopener noreferrer">where a question can go</a>
          {`, as of ${dateWords(model.statement.date)}.`}
        </p>
      )}
    </details>
  );
}
