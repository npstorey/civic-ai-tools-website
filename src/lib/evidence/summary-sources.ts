/**
 * The data sources the summarizer is told the analysis used (#384 P8, the
 * cold read's F1) — one pure function, so a test can read it and the route
 * cannot drift from it.
 *
 * `api/evidence/generate-summary/route.ts` used to build this list inline
 * from every tool call's `dataset_id` and `portal`, and the dialog that calls
 * it projected each record down to `{ name, args }` first — so a call the
 * loop recorded as rejected listed its dataset under "Data sources used", and
 * for a datHere publish that summary is promoted into canonical JSON. A
 * request the source did not answer used nothing: it contributes no entry
 * here. Absent is absent — a record that carries no `failed` key was not
 * recorded as failed, and is read exactly as before.
 *
 * The rule is otherwise the route's own: one entry per dataset id, keyed on
 * the first call that carried it together with a portal, in first-seen order.
 */

export interface SummarySourceInput {
  name: string;
  args: Record<string, unknown>;
  /** Set when the loop recorded the call as rejected (`ToolCallRecord.failed`). */
  failed?: boolean;
  failureKind?: string;
}

export interface SummarySource {
  portal: string;
  datasetId: string;
}

export function summaryDataSources(toolCalls: readonly SummarySourceInput[]): SummarySource[] {
  const byDataset = new Map<string, SummarySource>();
  for (const tc of toolCalls) {
    if (tc.failed) continue;
    const datasetId = tc.args?.dataset_id;
    const portal = tc.args?.portal;
    if (typeof datasetId !== 'string' || !datasetId) continue;
    if (typeof portal !== 'string' || !portal) continue;
    if (!byDataset.has(datasetId)) byDataset.set(datasetId, { portal, datasetId });
  }
  return [...byDataset.values()];
}

/** The line the summarizer reads, as the route has always written it: `portal / id, …`, or `(none)`. */
export function summaryDataSourcesLine(toolCalls: readonly SummarySourceInput[]): string {
  const list = summaryDataSources(toolCalls);
  return list.length === 0 ? '(none)' : list.map((s) => `${s.portal} / ${s.datasetId}`).join(', ');
}

/**
 * How many requests the loop recorded as rejected. Stated to the summarizer
 * as a count — a limitation of the analysis it is asked to cover — never as
 * a dataset: a request that returned nothing names no source.
 */
export function rejectedRequestCount(toolCalls: readonly SummarySourceInput[]): number {
  return toolCalls.filter((tc) => tc.failed === true).length;
}
