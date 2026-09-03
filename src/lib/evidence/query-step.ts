/**
 * How one entry of a record's `queries[]` is stated to a reader (#384, F5).
 *
 * The envelope's tool-call list carries three facts about what a call
 * returned, and a page must never conflate them:
 *
 *   - `failed` (with `failureKind`): the loop recorded the call as rejected
 *     at its catch site — the source did not answer it. Stated as a failure,
 *     with the recorded kind said in the reader's words.
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
    return { kind: 'failed', text: `This request did not complete. ${FAILURE_REASON[kind]}` };
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
