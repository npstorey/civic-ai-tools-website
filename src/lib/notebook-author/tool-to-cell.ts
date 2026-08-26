/**
 * Translate Phase A tool calls into (markdown explainer + Python code cell)
 * pairs for the executed-notebook synthesis (Phase B, ADR-0005 §1).
 *
 * Each fetching tool call becomes a code cell that re-invokes the same data
 * fetch through a helper function — so the notebook can be re-executed and
 * reproduce the same DataFrame against live data. Non-fetching discovery
 * calls (catalog search, metadata, schema) collapse into a single discovery
 * markdown cell so the analyst trail is visible without re-running redundant
 * lookups.
 */
import type { NotebookCell } from './cells.ts';
import { codeCell, markdownCell } from './cells.ts';

export interface PhaseAToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
}

/** Python-literal rendering for the JSON-safe values we get from MCP tool args. */
function pyRepr(value: unknown, indent = ''): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'float("nan")';
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = value.map(v => pyRepr(v, indent + '    ')).join(', ');
    return `[${inner}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([k, v]) => `${indent}    ${JSON.stringify(k)}: ${pyRepr(v, indent + '    ')},`);
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * Render `args` as Python keyword-argument lines: `order` first (in that
 * order), then every remaining arg the caller did not enumerate, so a field
 * this renderer doesn't know about yet is still emitted instead of silently
 * dropped.
 *
 * `handledKeys` lists args the caller has already accounted for elsewhere in
 * the generated cell — rendered by hand as explicit kwargs (e.g.
 * `portal=...`), or consumed only as call-routing metadata that never
 * appears in the rendered Python at all (e.g. `type`, which selects which
 * renderer runs and is not itself a `fetch_*` parameter). Either way,
 * `pyKwargs` must not append them a second time — the caller, not a
 * hard-coded list here, owns which keys those are.
 */
function pyKwargs(
  args: Record<string, unknown>,
  order: readonly string[],
  handledKeys: readonly string[] = [],
): string {
  const lines: string[] = [];
  const seen = new Set<string>(handledKeys);
  for (const key of order) {
    if (args[key] === undefined || args[key] === null) continue;
    lines.push(`    ${key}=${pyRepr(args[key], '    ')},`);
    seen.add(key);
  }
  // Append any extra args we did not enumerate so nothing silently drops.
  for (const [key, value] of Object.entries(args)) {
    if (seen.has(key)) continue;
    if (value === undefined || value === null) continue;
    lines.push(`    ${key}=${pyRepr(value, '    ')},`);
  }
  return lines.join('\n');
}

const SOCRATA_QUERY_KWARGS = ['select', 'where', 'group', 'order', 'limit', 'offset'] as const;
const DC_OBS_KWARGS = ['date', 'child_place_type'] as const;

export interface ToolCellOutput {
  /** Cells appended to the notebook for this tool call. */
  cells: NotebookCell[];
  /** Whether this tool call produced a DataFrame variable. */
  producedDataFrame: boolean;
  /** The DataFrame variable name (`df1`, `df2`, …) when one was produced. */
  dataFrameVariable: string | null;
  /** Citation entry for the footer cell (dataset_id + portal/url). */
  citation: { id: string; label: string; url: string } | null;
}

interface ToolCellContext {
  /** Sequential index used to name DataFrames (`df1`, `df2`, …). */
  dataFrameIndex: number;
  /** Default Socrata portal when a tool call omits it. */
  defaultPortal: string;
}

function socrataDatasetUrl(portal: string, datasetId: string): string {
  return `https://${portal}/d/${datasetId}`;
}

function renderSocrataQueryCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput {
  const portal = (call.args.portal as string) || ctx.defaultPortal;
  const datasetId = (call.args.dataset_id as string) || 'unknown';
  const dfVar = `df${ctx.dataFrameIndex}`;
  const reason = call.reason ? ` ${call.reason}` : '';
  const md = [
    `### Step ${ctx.dataFrameIndex}: Query \`${datasetId}\``,
    '',
    `We query the \`${datasetId}\` dataset on \`${portal}\`${reason}.`,
    call.resultSummary
      ? `Original execution returned ${call.resultSummary.rows} rows × ${call.resultSummary.columns} columns.`
      : '',
  ].filter(Boolean).join('\n');
  const code = [
    `${dfVar} = fetch_socrata(`,
    `    portal=${JSON.stringify(portal)},`,
    `    dataset_id=${JSON.stringify(datasetId)},`,
    pyKwargs(call.args, SOCRATA_QUERY_KWARGS, ['portal', 'dataset_id', 'type']),
    ')',
    dfVar,
  ].filter(Boolean).join('\n');
  return {
    cells: [markdownCell(md), codeCell(code)],
    producedDataFrame: true,
    dataFrameVariable: dfVar,
    citation: { id: datasetId, label: datasetId, url: socrataDatasetUrl(portal, datasetId) },
  };
}

function renderDataCommonsObsCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput {
  const dfVar = `df${ctx.dataFrameIndex}`;
  const variable = call.args.variable_dcid as string;
  const place = call.args.place_dcid as string;
  const md = [
    `### Step ${ctx.dataFrameIndex}: Fetch Data Commons observations`,
    '',
    `We fetch \`${variable}\` for \`${place}\` from Google Data Commons.`,
    call.resultSummary
      ? `Original execution returned ${call.resultSummary.rows} observation rows.`
      : '',
  ].filter(Boolean).join('\n');
  const code = [
    `${dfVar} = fetch_data_commons(`,
    `    variable_dcid=${JSON.stringify(variable)},`,
    `    place_dcid=${JSON.stringify(place)},`,
    pyKwargs(call.args, DC_OBS_KWARGS, ['variable_dcid', 'place_dcid']),
    ')',
    dfVar,
  ].filter(Boolean).join('\n');
  return {
    cells: [markdownCell(md), codeCell(code)],
    producedDataFrame: true,
    dataFrameVariable: dfVar,
    citation: { id: variable, label: `${variable} @ ${place}`, url: `https://datacommons.org/place/${place}` },
  };
}

function renderOpenContextSqlCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput {
  const dfVar = `df${ctx.dataFrameIndex}`;
  const sql = call.args.sql as string;
  const md = [
    `### Step ${ctx.dataFrameIndex}: Execute SQL against Boston CKAN`,
    '',
    'We run the analyst-authored SELECT below against the Boston OpenContext DataStore.',
  ].join('\n');
  const code = [
    `_sql = ${JSON.stringify(sql)}`,
    `${dfVar} = fetch_opencontext(sql=_sql)`,
    dfVar,
  ].join('\n');
  return {
    cells: [markdownCell(md), codeCell(code)],
    producedDataFrame: true,
    dataFrameVariable: dfVar,
    citation: { id: 'boston-ckan', label: 'data.boston.gov (CKAN)', url: 'https://data.boston.gov' },
  };
}

function renderOpenContextQueryCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput {
  const dfVar = `df${ctx.dataFrameIndex}`;
  const resourceId = call.args.resource_id as string;
  const filters = call.args.filters as Record<string, unknown> | undefined;
  const limit = (call.args.limit as number | undefined) ?? 1000;
  const md = [
    `### Step ${ctx.dataFrameIndex}: Query Boston CKAN resource`,
    '',
    `We fetch records from CKAN resource \`${resourceId}\`.`,
    call.resultSummary
      ? `Original execution returned ${call.resultSummary.rows} rows.`
      : '',
  ].filter(Boolean).join('\n');
  const codeLines = [
    `${dfVar} = fetch_opencontext(`,
    `    resource_id=${JSON.stringify(resourceId)},`,
  ];
  if (filters && Object.keys(filters).length > 0) {
    codeLines.push(`    filters=${pyRepr(filters, '    ')},`);
  }
  codeLines.push(`    limit=${limit},`);
  codeLines.push(')');
  codeLines.push(dfVar);
  return {
    cells: [markdownCell(md), codeCell(codeLines.join('\n'))],
    producedDataFrame: true,
    dataFrameVariable: dfVar,
    citation: { id: resourceId, label: `data.boston.gov: ${resourceId}`, url: `https://data.boston.gov/dataset/${resourceId}` },
  };
}

/**
 * Render a Phase A tool call as a notebook cell pair. Returns `null` for
 * discovery-only calls that do not produce a DataFrame (catalog search,
 * metadata, schema lookups); those are summarized once in a single
 * discovery markdown cell instead of one cell per call.
 */
export function renderFetchToolCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput | null {
  // Socrata: get_data with type=query is the only fetching variant.
  if (call.name === 'get_data') {
    const type = call.args.type as string | undefined;
    if (type === 'query') return renderSocrataQueryCell(call, ctx);
    return null;
  }
  // Data Commons.
  if (call.name === 'get_observations') return renderDataCommonsObsCell(call, ctx);
  if (call.name === 'search_indicators') return null;
  // Boston OpenContext.
  if (call.name === 'ckan__execute_sql') return renderOpenContextSqlCell(call, ctx);
  if (call.name === 'ckan__query_data') return renderOpenContextQueryCell(call, ctx);
  // ckan__aggregate_data and ckan__get_schema, ckan__search_datasets,
  // ckan__get_dataset are discovery-only for v1 (no helper-side equivalent
  // for aggregate-data; included in the discovery summary instead).
  return null;
}

/**
 * Summarize the discovery-only tool calls in a single markdown cell.
 * Returns null when there were no discovery calls to summarize.
 */
export function renderDiscoverySummaryCell(
  calls: readonly PhaseAToolCall[],
): NotebookCell | null {
  const discoveryCalls = calls.filter(c => renderFetchToolCell(c, { dataFrameIndex: 0, defaultPortal: '' }) === null);
  if (discoveryCalls.length === 0) return null;
  const lines = [
    '### Discovery',
    '',
    'The original analysis ran the following discovery calls before fetching data.',
    'They are not re-executed here — the data fetches below already encode the discoveries.',
    '',
  ];
  for (const call of discoveryCalls) {
    const opType = call.operationType ? ` (${call.operationType})` : '';
    const reason = call.reason ? ` — ${call.reason}` : '';
    lines.push(`- \`${call.name}\`${opType}${reason}`);
  }
  return markdownCell(lines.join('\n'));
}
