/**
 * "Where this question went" (R6 W4, #632): the answer view's part that says
 * who a run or a record sent something to. It renders the model
 * `src/lib/flows/where-it-went.ts` builds and decides no fact of its own
 * (design P1: it discloses, it does not validate).
 *
 * STAGE C (the owner's G8 review; ruling (b) = (i)). A disclosure, closed by
 * default, as the view's other disclosure is: its summary, "Where this question
 * went: the model and N data source(s)." (Stage D: "the model, the notebook
 * runner and N …" when there is a runner), is the only text shown closed, and
 * counts the sources reached without naming one. Open, two levels: each
 * reached row, then its recipients, in the words the site already uses:
 *   - the model row: "The model service (<host>)", then "The model: <name>"
 *     (`formatModelName`, the name the answer prints); see `modelServiceLabel`
 *     for the record with no host and for the endpoint's definition (Stage D);
 *   - a source's recipient labelled by the source's name as the consent card
 *     labels it, "<name> (<place>)", an upstream host "The data host for
 *     <name> (<host>)" (Stage D); the row reads "<name>: N tool call(s)" (Stage E);
 *   - "Receives: <receives>", the statement's words in its own tense;
 *   - "Who holds its logs: " and the panel's kept-by lines with how long
 *     (`KeptByLines`); the model row's lines the same way without how long,
 *     "<holder>: <clause>." (Stages D and E), then the operator's statement
 *     when it is made.
 * A record with no matching statement says once that this site cannot show
 * what each one keeps for it, then (D1) links "where a question can go". The
 * sources not reached are not rendered (ruling (i)); the model keeps them.
 *
 * WHAT CHOSE THE SOURCES (R10 P1, #682). When the model carries `chooser`,
 * the first line inside the disclosure says what chose the sources
 * (`chooserLines`, `src/lib/flows/source-chooser.ts`): in-loop, then a line per
 * group; or "not recorded"; or the all-sources sentence. The summary is
 * unchanged, and stays the only text shown closed (Stage C). With no
 * `chooser` (a run whose trace has not arrived) the line waits; nothing is
 * guessed.
 *
 * The builder is imported for its types only: it reads the statement module,
 * which is server-only. `source-chooser.ts` is pure and client-safe.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { WhereItWentModel, WhereReachedRow, WhereRecipientRow } from '../../lib/flows/where-it-went.ts';
import { KeptByLines } from '@/components/sources/KeptByLine';
import { ENDPOINT_NO_TRAINING } from '@/lib/sources/copy';
import { formatModelName } from '@/lib/models';
import { chooserLines, type SourceChooser } from '@/lib/flows/source-chooser';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM-DD` as "20 October 2026"; anything else as it is. */
function dateWords(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : date;
}

/** A model service's reader name, by the id a record states (`gen_ai.system`); an id not here prints as the record names it. */
const SERVICE_READER_NAME: Readonly<Record<string, string>> = { openrouter: 'OpenRouter' };

/** The builder's place for a recipient the record holds no place for (`NOT_RECORDED` in where-it-went.ts). */
const NOT_RECORDED_PLACE = 'not recorded';

const toolCalls = (n: number) => (n === 1 ? '1 tool call' : `${n} tool calls`);
const dataSources = (n: number) => (n === 0 ? 'no data source' : n === 1 ? '1 data source' : `${n} data sources`);

/**
 * Shown on a record whose statement this site does not serve, once, under the rows (Stage D, the seat's
 * finding 1): the record holds each call's arguments (section D), so only what each keeps is out of reach.
 */
const CANNOT_SHOW_KEEPS = 'This site cannot show what each one keeps for this record.';

const ROWS: CSSProperties = { margin: '8px 0 0', paddingLeft: '18px' };
const CHOOSER_GROUPS: CSSProperties = { margin: '2px 0 0', paddingLeft: '18px' };

/** What chose the sources: its first sentence, then, in-loop, one line per group. */
function ChooserLine({ chooser }: { chooser: SourceChooser }) {
  const [first, ...groups] = chooserLines(chooser);
  return (
    <div data-part="where-it-went-chooser" style={{ margin: '8px 0 0' }}>
      <p style={{ margin: 0, color: 'var(--text-primary)' }}>{first}</p>
      {groups.length > 0 && (
        <ul style={CHOOSER_GROUPS}>
          {groups.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}
const RECIPIENTS: CSSProperties = { margin: '2px 0 0', paddingLeft: '18px' };

/**
 * The model row's holders. The label asks who, so every holder is named (Stage D), in the shape every
 * other holder line in the section has, "<holder>: <clause>." (Stage E): the same `KeptByLines` the
 * source and runner rows use, without how long. When the operator makes its no-training statement, the
 * consent card's sentence follows (`ENDPOINT_NO_TRAINING`, unedited, as is the card).
 */
function ModelLogs({ recipient }: { recipient: WhereRecipientRow }) {
  const keptBy = recipient.keptBy ?? [];
  const operator = keptBy.some((k) => k.operatorStatement);
  return <><KeptByLines keptBy={keptBy} />.{operator ? ` ${ENDPOINT_NO_TRAINING}` : ''}</>;
}

/**
 * The model row's label (Stage D, the seat's findings 3 and 4).
 *   - Where the place is known: "The model service (<host>)", and, only when the operator's no-training
 *     sentence renders below it, ", the endpoint this site sends questions to", which defines the term
 *     that sentence uses (`ENDPOINT_NO_TRAINING` itself is the card's and is not edited).
 *   - Where the record holds no host: the service the record names (`gen_ai.system`, contract :25), by
 *     its reader name where the site has one (Stage E), "The model service (OpenRouter, host not
 *     recorded)", any other id as the record names it; never a host guessed from it. With no service
 *     either, "(not recorded)".
 */
function modelServiceLabel(service: string | null, recipient: WhereRecipientRow | undefined): string {
  const place = recipient?.place ?? NOT_RECORDED_PLACE;
  if (place === NOT_RECORDED_PLACE) {
    return service ? `The model service (${SERVICE_READER_NAME[service] ?? service}, host not recorded)` : `The model service (${NOT_RECORDED_PLACE})`;
  }
  const definesEndpoint = recipient?.keptBy?.some((k) => k.operatorStatement) === true;
  return `The model service (${place})${definesEndpoint ? ', the endpoint this site sends questions to' : ''}`;
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
        <strong style={{ color: 'var(--text-primary)' }}>{modelServiceLabel(row.service, recipient)}</strong>
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
      {/* Stage E: the section's own separator, so a comma-bearing name reads as one name. */}
      <strong style={{ color: 'var(--text-primary)' }}>{`${row.name}: ${toolCalls(row.calls)}`}</strong>
      <ul style={RECIPIENTS}>
        {row.recipients.map((r, i) => (
          <li key={i}>
            {/* Stage D (finding 6): the source's data host, never "upstream" (a co-signer's word on this page). */}
            <div>{r.upstream ? `The data host for ${row.name} (${r.place})` : `${row.name} (${r.place})`}</div>
            <Facts recipient={r} logs={logsOf(r)} />
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function WhereItWent({ model }: { model: WhereItWentModel }) {
  const sources = model.reached.filter((row) => row.kind === 'source').length;
  // Stage D (the seat's finding 2): the closed line names every kind of recipient; a notebook runner, when there is one.
  const runner = model.reached.some((row) => row.kind === 'notebook');
  return (
    <details data-part="where-it-went" style={{
      borderLeft: '3px solid var(--border-color)', padding: '6px 10px', marginTop: '16px',
      fontSize: '13px', color: 'var(--text-secondary)', borderRadius: '0 4px 4px 0',
    }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)' }}>
        {`Where this question went: the model${runner ? ', the notebook runner and' : ' and'} ${dataSources(sources)}.`}
      </summary>
      {model.chooser !== undefined && <ChooserLine chooser={model.chooser} />}
      <ul style={ROWS}>
        {model.reached.map((row, i) => <ReachedRow key={i} row={row} />)}
      </ul>
      {model.statement.kind !== 'in-force' && <p style={{ margin: '6px 0' }}>{CANNOT_SHOW_KEEPS}</p>}
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
