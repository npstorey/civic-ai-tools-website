// "Data read on <date>" (UX-2 P5, X6; relay 13 ruling 4): the date the
// analysis read its data, taken from the signed package's own trace.
//
// `dataSources[].accessTimestamp` is NOT that date: it is the packaging time
// (`packager.ts:556`, `:632`). The date the data was read is the start of each
// call to a data source, stamped when the call began (`run-tool-loop.ts:1084`,
// the harness's `TraceBuilder.startSpan`). A call counts when its
// `mcp_tool_call` span carries `mcp.source` (the load step carries none), a
// `tool.response_hash` (it returned), and no `error` (it was not rejected).
// The date is the UTC date, as `runDateOf` in `PublishEvidenceDialog.tsx`
// takes the run's date, in the page's date format.
//
// A trace stored as a BlobRef gives no date: the page makes no extra read for
// it. Calls on two UTC dates give the range, and only then.
//
// Pure, and safe in a client bundle: it imports nothing.

/** X6, ruled: one date. */
export const DATA_READ_ON = (date: string): string => `Data read on ${date}`;

/** The range form (research check 2, C1, KEEP), used only when the calls fall on two UTC dates. */
export const DATA_READ_RANGE = (first: string, last: string): string => `Data read from ${first} to ${last}`;

interface SpanLike { name?: unknown; startTimeUnixNano?: unknown; attributes?: unknown }
interface AttrLike { key?: unknown; value?: Record<string, unknown> }

function attrs(span: SpanLike): AttrLike[] {
  return Array.isArray(span.attributes) ? (span.attributes as AttrLike[]) : [];
}

function hasAttr(span: SpanLike, key: string): boolean {
  return attrs(span).some((a) => a?.key === key);
}

/** A call that read data: it names its source, it returned, and it was not rejected. */
function counted(span: SpanLike): boolean {
  if (span.name !== 'mcp_tool_call') return false;
  if (!hasAttr(span, 'mcp.source') || !hasAttr(span, 'tool.response_hash')) return false;
  const error = attrs(span).find((a) => a?.key === 'error');
  return !(error && error.value?.boolValue === true);
}

/** The spans of an inline OTel trace; none for a BlobRef or anything else. */
function spansOf(trace: unknown): SpanLike[] {
  if (trace === null || typeof trace !== 'object' || !Array.isArray((trace as { resourceSpans?: unknown }).resourceSpans)) return [];
  const out: SpanLike[] = [];
  for (const resource of (trace as { resourceSpans: Array<{ scopeSpans?: unknown }> }).resourceSpans) {
    if (!Array.isArray(resource?.scopeSpans)) continue;
    for (const scope of resource.scopeSpans as Array<{ spans?: unknown }>) {
      if (Array.isArray(scope?.spans)) out.push(...(scope.spans as SpanLike[]));
    }
  }
  return out;
}

/** The UTC day (`YYYY-MM-DD`) a span began, or null when its start is unreadable. */
function dayOf(span: SpanLike): string | null {
  const start = span.startTimeUnixNano;
  if (typeof start !== 'string' && typeof start !== 'number') return null;
  try {
    const nanos = BigInt(start);
    if (nanos <= BigInt(0)) return null;
    return new Date(Number(nanos / BigInt(1000000))).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/** The distinct UTC days (`YYYY-MM-DD`, ascending) on which a counted call began; empty for a BlobRef trace or none. */
export function dataReadDays(trace: unknown): string[] {
  const days = new Set<string>();
  for (const span of spansOf(trace)) {
    if (!counted(span)) continue;
    const day = dayOf(span);
    if (day !== null) days.add(day);
  }
  return [...days].sort();
}

/** A `YYYY-MM-DD` day in the page's format ("October 16, 2026"), read as UTC. */
export function formatReadDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** The row's text, or `null` when the trace gives no date. */
export function dataReadLine(trace: unknown): string | null {
  const days = dataReadDays(trace);
  if (days.length === 0) return null;
  const first = days[0];
  const last = days[days.length - 1];
  return first === last ? DATA_READ_ON(formatReadDay(first)) : DATA_READ_RANGE(formatReadDay(first), formatReadDay(last));
}
