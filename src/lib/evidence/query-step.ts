/**
 * How one entry of a record's `queries[]` is stated to a reader (#384, F5).
 *
 * The envelope's tool-call list carries three facts about what a call
 * returned, and a page must never conflate them:
 *
 *   - `failed` (with `failureKind`): the loop recorded the call as rejected
 *     at its catch site — the source did not answer it, or answered it with a
 *     failure (a JSON-RPC `error`, or a result carrying `isError: true`,
 *     #429). Stated as a failure, with the recorded kind said in the reader's
 *     words.
 *   - `resultRows` (with `resultColumns`): a row count was recorded. Zero
 *     rows is a returned result — "no matching records" — not a failure.
 *   - neither: no result summary was recorded. This is the ordinary shape of
 *     a call whose response was not tabular (metadata, `search`, `fetch`),
 *     and it is also every entry of a package built before the failure keys
 *     existed — so absence is stated as absence, never as completion and
 *     never as failure.
 *
 * Both renderers of `queries[]` — the record page's deliberative-trace
 * section and `ProvenanceChain` — read this one function, so the two cannot
 * drift apart about the same call. The failure vocabulary is the notebook
 * path's `FAILURE_REASON`, imported rather than restated: one set of words
 * for one fact (docs/design-principles.md, principles 3 and 9).
 *
 * `describeUnrecordedOutcomes` at the foot of this file is the RECORD-level
 * companion (#430 F4, ruling D8): when no entry states an outcome at all, the
 * record says so once, dated, rather than leaving a reader to infer it from N
 * identical per-entry sentences sitting under a sources list that still
 * asserts access. Both renderers read that one too.
 */
import {
  FAILURE_REASON,
  TOOL_FAILURE_KINDS,
  type ToolFailureKind,
} from '../notebook-author/tool-to-cell.ts';

export interface QueryOutcome {
  kind: 'failed' | 'returned' | 'unrecorded';
  /** The reader-facing line for that state. */
  text: string;
}

/** The fields of an envelope `queries[]` entry this reads; any richer entry fits. */
export interface QueryOutcomeInput {
  resultRows?: number;
  resultColumns?: number;
  duration_ms?: number;
  failed?: boolean;
  failureKind?: string;
}

function isToolFailureKind(value: string | undefined): value is ToolFailureKind {
  return value !== undefined && (TOOL_FAILURE_KINDS as readonly string[]).includes(value);
}

export function describeQueryOutcome(entry: QueryOutcomeInput): QueryOutcome {
  if (entry.failed) {
    // A kind this app did not record — absent, or written by another
    // producer — reads as `unknown`: a cause that was not measured is not
    // asserted (design principle 3).
    const kind: ToolFailureKind = isToolFailureKind(entry.failureKind) ? entry.failureKind : 'unknown';
    // #413: a rejected entry may now carry the elapsed the loop measured, and
    // it is stated HERE, in words, rather than left to each renderer's bare
    // number. `ProvenanceChain` used to print "· 1.2s" before this sentence
    // for every entry carrying one; beside "did not complete" that number
    // reads as how long the call took to succeed, which is the one thing it
    // is not. It is the elapsed until the source rejected the call — a real
    // measurement (design principle 3, "tool-call durations are measured"),
    // so it is disclosed, in its own sentence, after the cause. An entry that
    // carries none says nothing: absence stays absence and is never a zero.
    const elapsed = entry.duration_ms !== undefined
      ? ` The attempt took ${entry.duration_ms.toLocaleString()}ms.`
      : '';
    return { kind: 'failed', text: `This request did not complete. ${FAILURE_REASON[kind]}${elapsed}` };
  }
  if (entry.resultRows !== undefined) {
    const rows = `${entry.resultRows.toLocaleString()} ${entry.resultRows === 1 ? 'row' : 'rows'}`;
    const columns = entry.resultColumns !== undefined
      ? ` × ${entry.resultColumns} ${entry.resultColumns === 1 ? 'column' : 'columns'}`
      : '';
    const duration = entry.duration_ms !== undefined ? ` · ${entry.duration_ms}ms` : '';
    return { kind: 'returned', text: `Returned ${rows}${columns}${duration}` };
  }
  return { kind: 'unrecorded', text: 'No result summary was recorded for this request.' };
}

/** Month names, spelled here rather than through `toLocaleDateString`, so the
 *  sentence below reads the same on a runtime built without full ICU as it
 *  does in CI. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The package's own creation date, in UTC, or null when the package carries
 *  nothing readable. Never a date from anywhere else: a record states the date
 *  it carries or states none (#430 F4). */
function statedDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()}`;
}

/** The fields of a stored record this reads. Any richer package fits. */
export interface RecordOutcomeInput {
  metadata?: { createdAt?: string };
  queries?: QueryOutcomeInput[];
}

/**
 * The RECORD-level statement that a package states no outcome for any of its
 * requests (#430 F4, Wave N11 ruling D8: state the absence, dated).
 *
 * WHY IT IS NOT THE PER-ENTRY SENTENCE ABOVE. `describeQueryOutcome({})`
 * already says "No result summary was recorded for this request", once per
 * entry, and it is correctly undated: it is a fact about one request, and the
 * date belongs to the record. What a reader of a pre-outcome-marking package
 * is missing is the whole-record fact — that NOTHING in it says how any
 * request ended, while its `dataSources` list goes on asserting that those
 * datasets were accessed at those timestamps. Those two together are what
 * mislead; the record-level line is what separates them.
 *
 * WHAT IT DOES NOT CLAIM. Not "this record predates outcome marking" — this
 * function cannot know when a producer stopped omitting the fields, and a
 * package written today by a producer that omits them is the same shape. It
 * states what the bytes carry and dates it with the date the bytes carry
 * (`docs/design-principles.md` Principle 3: no false precision). A package
 * with no readable `createdAt` gets NO statement rather than an undated or an
 * invented one.
 *
 * ABSENCE MUST STAY ABSENCE IN BOTH DIRECTIONS. One entry carrying `failed` or
 * `resultRows` means the record DOES state outcomes, and it gains no such
 * line — the per-entry formatter says what is missing for the entries that are
 * missing it. A record with no requests at all gains none either: there is no
 * unstated outcome to disclose.
 *
 * Returns null when there is nothing to state, so a caller renders nothing.
 */
export function describeUnrecordedOutcomes(pkg: RecordOutcomeInput): string | null {
  const queries = pkg.queries ?? [];
  if (queries.length === 0) return null;
  const anyOutcome = queries.some((q) => q.failed !== undefined || q.resultRows !== undefined);
  if (anyOutcome) return null;
  const date = statedDate(pkg.metadata?.createdAt);
  if (date === null) return null;
  // "any of its 1 request" is not English; the singular gets its own clause
  // rather than a pluralised count.
  const subject = queries.length === 1
    ? 'for its one request: whether it'
    : `for any of its ${queries.length} requests: whether each`;
  return (
    `This record was created on ${date} and states no outcome ${subject} returned data, ` +
    'returned none, or was refused is not recorded. Its data sources state which datasets were ' +
    'reached, not what any request returned.'
  );
}
