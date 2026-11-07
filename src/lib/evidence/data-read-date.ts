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
// RED STUB (UX-2 P5 leg B): the words are below; the functions are the green's.

/** X6, ruled: one date. */
export const DATA_READ_ON = (date: string): string => `Data read on ${date}`;

/** PENDING (the research check): the range form, used only when the calls fall on two UTC dates. */
export const DATA_READ_RANGE = (first: string, last: string): string => `Data read from ${first} to ${last}`;

/** The distinct UTC days (`YYYY-MM-DD`, ascending) on which a counted call began; empty for a BlobRef trace or none. */
export function dataReadDays(trace: unknown): string[] {
  void trace;
  return [];
}

/** A `YYYY-MM-DD` day in the page's format ("October 16, 2026"), read as UTC. */
export function formatReadDay(day: string): string {
  void day;
  return '';
}

/** The row's text, or `null` when the trace gives no date. */
export function dataReadLine(trace: unknown): string | null {
  void trace;
  return null;
}
