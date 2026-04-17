// Multi-source extraction used by the evidence packager (M9.3).
//
// Walks the trace's `mcp_tool_call` spans plus the caller-supplied tool-call
// summary to produce one `dataSources` entry per (source, datasetId) tuple.
// Pure module — no `process.env`, no `crypto`, no upstream dependencies other
// than the static tool-name→source map — so it can be unit-tested in
// isolation via the node test runner.

import { sourceIdForToolName } from '../mcp/operation-types.ts';

// Endpoint URL used to tag Data Commons data-source entries. Kept as a
// module-scoped constant (not read from process.env) so the function stays
// pure. Overriding the hosted endpoint via env is out of scope for M9.3.
const DATA_COMMONS_ENDPOINT = 'https://api.datacommons.org/mcp';

export interface ToolCallSummary {
  name: string;
  args: Record<string, unknown>;
}

export interface DataSourceEntry {
  /** Stable source identifier — matches the registry source ids used in
   *  the routing layer and the PROV-O `civic:sourceId` attribute.
   *  `socrata` or `data-commons` today. */
  sourceId: string;
  catalogType: string;
  portalUrl: string;
  /** Socrata dataset id. Absent for sources that don't expose a per-dataset
   *  URL (e.g. Data Commons, whose query surface is DCIDs). */
  datasetId?: string;
  /** Canonical per-dataset URL. Absent for sources without one. */
  datasetUrl?: string;
  accessTimestamp: string;
}

/** Human-friendly display label for a `sourceId`. Unknown ids fall back to a
 *  capitalised form of the raw id so new sources render sensibly before the
 *  map is updated. */
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  socrata: 'Socrata',
  'data-commons': 'Data Commons',
};

export function displayNameForSource(sourceId: string | undefined | null): string {
  // Pre-M9.3 evidence packages have no `sourceId` field on dataSources entries
  // (dataSources was Socrata-only before the multi-source refactor), so coerce
  // missing ids to `socrata` rather than throwing on an empty string.
  const id = sourceId || 'socrata';
  return (
    SOURCE_DISPLAY_NAMES[id]
    ?? id
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

/** Format a `dataSources` array as a compact, de-duplicated summary string
 *  suitable for the evidence detail page "Data sources" field. Returns `null`
 *  when the array is empty or missing, letting callers render a fallback. */
export function formatDataSourcesSummary(entries: DataSourceEntry[] | undefined): string | null {
  if (!entries || entries.length === 0) return null;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const entry of entries) {
    const name = displayNameForSource(entry.sourceId);
    if (seen.has(name)) continue;
    seen.add(name);
    ordered.push(name);
  }
  return ordered.join(' \u00b7 ');
}

interface TraceSpan {
  name: string;
  attributes?: Array<{ key: string; value?: { stringValue?: string; intValue?: string; boolValue?: boolean } }>;
}

function getToolSpans(trace: Record<string, unknown>): TraceSpan[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spans = (trace as any)?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans;
    if (!Array.isArray(spans)) return [];
    return (spans as TraceSpan[]).filter((s) => s.name === 'mcp_tool_call');
  } catch {
    return [];
  }
}

function spanAttr(span: TraceSpan | undefined, key: string): string | undefined {
  if (!span) return undefined;
  const attr = span.attributes?.find((a) => a.key === key);
  return attr?.value?.stringValue ?? attr?.value?.intValue ?? undefined;
}

/**
 * Resolve the MCP source for a tool call. Prefers the `mcp.source` attribute
 * recorded on the matching `mcp_tool_call` span (the M9.1 source of truth);
 * falls back to the static tool-name mapping for packages written before
 * M9.1 or callers that ship an empty trace (e.g. `/api/evidence/test`).
 *
 * Tool calls are paired to spans by index — `openrouter-streaming.ts` emits
 * one span per call in order, so positional matching is exact in the normal
 * flow. When the counts diverge, the static map still identifies the source.
 */
export function resolveToolSource(
  toolCall: ToolCallSummary,
  span: TraceSpan | undefined,
): string {
  return spanAttr(span, 'mcp.source')
    ?? sourceIdForToolName(toolCall.name)
    ?? 'socrata';
}

/**
 * Build the per-source evidence-package `dataSources` array.
 *
 * Socrata contributes one entry per unique `dataset_id` observed across tool
 * calls. Data Commons contributes a single aggregate entry when any DC tool
 * call was made (its knowledge graph isn't dataset-keyed). Each entry is
 * tagged with `sourceId` so downstream consumers can distinguish provenance.
 */
export function buildDataSources(
  toolCalls: ToolCallSummary[],
  trace: Record<string, unknown>,
  fallbackPortal: string,
  now: string,
): DataSourceEntry[] {
  const toolSpans = getToolSpans(trace);
  const socrataByDataset = new Map<string, { portalUrl: string; datasetId: string }>();
  let dataCommonsAccessed = false;

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const source = resolveToolSource(tc, toolSpans[i]);
    if (source === 'socrata') {
      const datasetId = tc.args.dataset_id as string | undefined;
      const portal = (tc.args.portal as string) || fallbackPortal;
      if (datasetId && !socrataByDataset.has(datasetId)) {
        socrataByDataset.set(datasetId, { portalUrl: `https://${portal}`, datasetId });
      }
    } else if (source === 'data-commons') {
      dataCommonsAccessed = true;
    }
  }

  const entries: DataSourceEntry[] = [];
  for (const { portalUrl, datasetId } of socrataByDataset.values()) {
    entries.push({
      sourceId: 'socrata',
      catalogType: 'socrata',
      portalUrl,
      datasetId,
      datasetUrl: `${portalUrl}/d/${datasetId}`,
      accessTimestamp: now,
    });
  }
  if (dataCommonsAccessed) {
    entries.push({
      sourceId: 'data-commons',
      catalogType: 'data-commons',
      portalUrl: DATA_COMMONS_ENDPOINT,
      accessTimestamp: now,
    });
  }
  return entries;
}
