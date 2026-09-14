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
 *
 * `readRefusalsFromTrace` (Wave N11 F-W, ruling D1) is the one reader of a
 * record's TRACE here: for a record whose request list marks no refusal, it
 * states which entries the trace marks refused, from the span's `error` flag
 * alone. Both renderers pass its answer to `describeQueryOutcome`, and
 * `describeUnrecordedOutcomes` reads it for the record-level line.
 */
import {
  FAILURE_REASON,
  TOOL_FAILURE_KINDS,
  type ToolFailureKind,
} from '../notebook-author/tool-to-cell.ts';
import { jcs } from './canonicalization.ts';

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

/** What the record's trace says about this entry, from `readRefusalsFromTrace`. */
export interface QueryOutcomeContext {
  /** True only when the trace was read (not declined) and this entry's span
   *  carries the error flag. Never consulted for an entry that states its own
   *  outcome. */
  refusedInTrace?: boolean;
}

export function describeQueryOutcome(
  entry: QueryOutcomeInput,
  context: QueryOutcomeContext = {},
): QueryOutcome {
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
  if (context.refusedInTrace === true) {
    // Ruling D1. The entry states no outcome; the record's trace marks the
    // call refused. Said as a refusal, with where that is read from, and with
    // no cause: the flag is the only thing read, and the source's own words
    // on an old span are never quoted or classified (seat's rider 1). An
    // elapsed the entry carries is disclosed as on the entry-marked path.
    const elapsed = entry.duration_ms !== undefined
      ? ` The attempt took ${entry.duration_ms.toLocaleString()}ms.`
      : '';
    return {
      kind: 'failed',
      text: `This request did not complete. The record's trace marks it as refused, and no reason is stated.${elapsed}`,
    };
  }
  return { kind: 'unrecorded', text: 'No result summary was recorded for this request.' };
}

/** Why `readRefusalsFromTrace` read nothing from a record's trace. */
export type TraceReadingDecline =
  /** No requests to state anything about. */
  | 'no-requests'
  /** An entry carries `failed`: the request list marks refusals itself, and
   *  it is the authority. The trace is read only for a list that marks none. */
  | 'marked'
  /** No inline trace with a span list — absent, or stored by reference. */
  | 'trace'
  /** The number of tool spans differs from the number of entries. */
  | 'count'
  /** At some position the span names a different tool than the entry. */
  | 'tool'
  /** At some position the span's arguments differ from the entry's, or do not parse. */
  | 'arguments'
  /** At some position the entry states a row count and its span the error flag. */
  | 'outcome';

export interface TraceRefusalReading {
  /** Indices into `queries[]` the trace states as refused. Empty when declined. */
  refused: ReadonlySet<number>;
  /** Null when the trace was read; otherwise why it was not. */
  declined: TraceReadingDecline | null;
}

/** The fields of a stored record the trace reading needs. Any richer package fits. */
export interface RecordTraceInput {
  metadata?: { createdAt?: string };
  queries?: ReadonlyArray<QueryOutcomeInput & { tool?: string; arguments?: unknown }>;
  trace?: unknown;
}

interface SpanAttributeShape { key?: unknown; value?: unknown }
interface SpanShape { name?: unknown; attributes?: unknown }

function attributeValue(span: SpanShape, key: string): Record<string, unknown> | undefined {
  if (!Array.isArray(span.attributes)) return undefined;
  const found = (span.attributes as SpanAttributeShape[]).find((a) => a?.key === key);
  return found && typeof found.value === 'object' && found.value !== null
    ? found.value as Record<string, unknown>
    : undefined;
}

/** Every `mcp_tool_call` span in the trace, in the order the trace lists them,
 *  or null when there is no inline span list to read. */
function toolSpansOf(trace: unknown): SpanShape[] | null {
  if (typeof trace !== 'object' || trace === null) return null;
  const resourceSpans = (trace as { resourceSpans?: unknown }).resourceSpans;
  if (!Array.isArray(resourceSpans)) return null;
  const spans: SpanShape[] = [];
  for (const rs of resourceSpans) {
    const scopeSpans = (rs as { scopeSpans?: unknown })?.scopeSpans;
    if (!Array.isArray(scopeSpans)) return null;
    for (const ss of scopeSpans) {
      const list = (ss as { spans?: unknown })?.spans;
      if (!Array.isArray(list)) return null;
      for (const span of list) {
        if ((span as SpanShape)?.name === 'mcp_tool_call') spans.push(span as SpanShape);
      }
    }
  }
  return spans;
}

const NOTHING: ReadonlySet<number> = new Set();
const declined = (why: TraceReadingDecline): TraceRefusalReading => ({ refused: NOTHING, declined: why });

/**
 * Which of a record's requests its TRACE states as refused (Wave N11 F-W,
 * ruling D1, with the seat's three riders).
 *
 * WHY. Records written before the loop put `failed` on a `queries[]` entry
 * carry a refused call as an entry with no outcome keys — the same shape, at
 * entry level, as an answered metadata or `search` call written today, so no
 * predicate over the entry can separate them. The trace can: the loop opens one
 * `mcp_tool_call` span per entry, in entry order, with the entry's arguments
 * serialized onto it, and ends a refused call's span with `error: true`.
 *
 * THE RULE.
 *   - Read only when NO entry carries `failed`. A list that marks refusals is
 *     the authority for its own record (the current producer writes `failed`
 *     on the entry exactly when it writes `error` on the span).
 *   - The tool spans must pair with the entries one-to-one: the same count,
 *     and at every position the same tool name and the same arguments.
 *     Arguments are compared as canonical JSON (RFC 8785, `jcs`), so key order
 *     is not a disagreement and any value is. An entry stating a row count
 *     whose span carries the error flag is a disagreement too.
 *   - ANY disagreement declines the WHOLE record: no entry of it is stated as
 *     refused from its trace, and every entry reads as its own fields say. A
 *     pairing that failed at one position says nothing trustworthy about the
 *     others.
 *   - An entry is stated refused only when it states no outcome itself and its
 *     span's `error` attribute is the boolean `true`. Nothing else on the span
 *     is read — not `error.message` (the source's raw text on old spans, which
 *     #404 stopped writing), not `error.kind`, not the span status. A span
 *     without the flag leaves its entry "unrecorded", never "answered".
 */
export function readRefusalsFromTrace(pkg: RecordTraceInput): TraceRefusalReading {
  const queries = pkg.queries ?? [];
  if (queries.length === 0) return declined('no-requests');
  if (queries.some((q) => q.failed !== undefined)) return declined('marked');
  const spans = toolSpansOf(pkg.trace);
  if (spans === null) return declined('trace');
  if (spans.length !== queries.length) return declined('count');

  const refused = new Set<number>();
  for (let i = 0; i < queries.length; i++) {
    const entry = queries[i];
    const span = spans[i];
    const name = attributeValue(span, 'tool.name')?.stringValue;
    if (typeof entry.tool !== 'string' || name !== entry.tool) return declined('tool');
    const serialized = attributeValue(span, 'tool.arguments')?.stringValue;
    if (typeof serialized !== 'string') return declined('arguments');
    let spanArguments: unknown;
    try {
      spanArguments = JSON.parse(serialized);
    } catch {
      return declined('arguments');
    }
    if (entry.arguments === undefined || jcs(spanArguments) !== jcs(entry.arguments)) {
      return declined('arguments');
    }
    const flagged = attributeValue(span, 'error')?.boolValue === true;
    if (flagged && entry.resultRows !== undefined) return declined('outcome');
    if (flagged) refused.add(i);
  }
  return { refused, declined: null };
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
 * WHEN THE TRACE STATES REFUSALS (ruling D1). A record whose request list marks
 * no refusal but whose trace marks some (`readRefusalsFromTrace`) gets a
 * different line, whether or not other entries carry row counts: that the
 * list does not mark refusals, that the trace does and how many, and that a
 * request with no result summary is still not stated as answered. Dated the
 * same way, and null without a readable date. A declined reading adds no line;
 * the record then reads exactly as its own entries say.
 *
 * Returns null when there is nothing to state, so a caller renders nothing.
 */
export function describeUnrecordedOutcomes(pkg: RecordOutcomeInput & RecordTraceInput): string | null {
  const queries = pkg.queries ?? [];
  if (queries.length === 0) return null;
  const date = statedDate(pkg.metadata?.createdAt);
  if (date === null) return null;
  const fromTrace = readRefusalsFromTrace(pkg);
  if (fromTrace.refused.size > 0) {
    const n = fromTrace.refused.size;
    const counted = queries.length === 1
      ? 'its one request is'
      : `${n} of its ${queries.length} requests ${n === 1 ? 'is' : 'are'}`;
    return (
      `This record was created on ${date}. Its list of requests does not mark which requests were ` +
      `refused, but its trace does: ${counted} marked there as refused, and stated so below. No ` +
      'reason is stated, and a request with no result summary is not stated as answered.'
    );
  }
  const anyOutcome = queries.some((q) => q.failed !== undefined || q.resultRows !== undefined);
  if (anyOutcome) return null;
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
