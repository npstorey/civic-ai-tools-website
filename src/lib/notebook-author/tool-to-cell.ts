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

/**
 * Why a tool call returned no data, as a closed set (#321).
 *
 * Deliberately narrower than `StreamErrorKind` (src/lib/streaming.ts), which
 * classifies whole-query failures across ten kinds — six of them (this app's
 * own rate limit, the model credential kinds, notebook execution) cannot
 * describe a single tool call and would be nonsense in this position. These
 * four are the ones a caller can actually derive from a failed tool call AND
 * that change what a notebook reader should conclude:
 *
 *   - `timeout`         — the source was reached but did not answer in time.
 *   - `unavailable`     — the source could not be reached at all.
 *   - `not_configured`  — this instance has no live source for that request.
 *   - `unknown`         — it failed and we cannot honestly say more.
 *
 * `unknown` is a real member, not a placeholder: claiming a specific cause we
 * did not measure is exactly the false precision docs/design-principles.md
 * Principle 3 forbids. Note in particular that "the source refused this
 * request" (a 4xx on malformed SoQL) is NOT separable today — the classifier
 * has no branch for it — so such a call lands in `unknown` rather than being
 * asserted as a refusal.
 */
export const TOOL_FAILURE_KINDS = ['timeout', 'unavailable', 'not_configured', 'unknown'] as const;

export type ToolFailureKind = (typeof TOOL_FAILURE_KINDS)[number];

export interface PhaseAToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
  /**
   * True when the tool call threw during Phase A — set at the catch site in
   * `openrouter-streaming.ts`, where the rejection is already known (#321).
   *
   * This is a distinct signal from `resultSummary`, and must stay distinct:
   * since website#325 P2 a zero-row SUCCESS carries `{rows: 0, columns: 0}`,
   * so "no rows" and "no summary" are both legitimate outcomes of a call that
   * worked. Having a summary is not evidence a call did not fail, and lacking
   * one is not evidence that it did.
   */
  failed?: boolean;
  /** Why it failed, when `failed` is true. Absent is read as `unknown`. */
  failureKind?: ToolFailureKind;
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

/** Indent every non-empty line of a code block by one Python level. */
function indentBlock(code: string): string {
  return code
    .split('\n')
    .map(line => (line.length > 0 ? `    ${line}` : line))
    .join('\n');
}

/**
 * Wrap a fetch statement in `try`/`except` so one upstream failure at
 * re-execution time does not abort the rest of the notebook (#321).
 *
 * This matters independently of the rejected-call bug: civic data is live.
 * A fetch that succeeded when the analysis ran can fail months later for
 * reasons that have nothing to do with this notebook — a dataset reassigned
 * a new id, a portal rate-limiting an anonymous caller, an outage. Unguarded,
 * the first such failure raises and every later cell — including the analysis
 * and the synthesis — never runs, so a reader loses the whole document to one
 * dead endpoint.
 *
 * Three deliberate choices:
 *
 *   - The fallback is an EMPTY DataFrame, not an unset name, so later cells
 *     get a well-typed empty table instead of `NameError`.
 *   - The failure is PRINTED, so it is visible in the executed output rather
 *     than silently becoming a zero. An empty table that looks like a real
 *     zero is the false-precision failure of design-principles.md Principle 3.
 *   - Only the exception's TYPE is printed, never `str(_err)`. This notebook's
 *     outputs are captured into a published record, so its printed text is a
 *     reader-facing surface and gets the same treatment CLAUDE.md requires of
 *     streaming errors: no raw message text, no status codes, no host names.
 *     The type name is enough to tell a timeout from an HTTP error.
 *
 * `except Exception` (not `BaseException`) so KeyboardInterrupt still
 * interrupts. The bare `dfVar` trailing expression stays OUTSIDE the try, so
 * the cell renders its table on both paths.
 */
function guardedFetch(dfVar: string, stepLabel: string, fetchCode: string): string {
  return [
    'try:',
    indentBlock(fetchCode),
    'except Exception as _err:',
    `    ${dfVar} = pd.DataFrame()`,
    `    print(f"${stepLabel}: live data could not be fetched ({type(_err).__name__}); continuing with an empty table.")`,
    dfVar,
  ].join('\n');
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
  const code = guardedFetch(dfVar, `Step ${ctx.dataFrameIndex}`, [
    `${dfVar} = fetch_socrata(`,
    `    portal=${JSON.stringify(portal)},`,
    `    dataset_id=${JSON.stringify(datasetId)},`,
    pyKwargs(call.args, SOCRATA_QUERY_KWARGS, ['portal', 'dataset_id', 'type']),
    ')',
  ].filter(Boolean).join('\n'));
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
  const code = guardedFetch(dfVar, `Step ${ctx.dataFrameIndex}`, [
    `${dfVar} = fetch_data_commons(`,
    `    variable_dcid=${JSON.stringify(variable)},`,
    `    place_dcid=${JSON.stringify(place)},`,
    pyKwargs(call.args, DC_OBS_KWARGS, ['variable_dcid', 'place_dcid']),
    ')',
  ].filter(Boolean).join('\n'));
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
  // `_sql = …` stays outside the guard: a string literal cannot fail, and
  // keeping it out means the statement is still readable in the notebook when
  // the fetch below did not succeed.
  const code = [
    `_sql = ${JSON.stringify(sql)}`,
    guardedFetch(dfVar, `Step ${ctx.dataFrameIndex}`, `${dfVar} = fetch_opencontext(sql=_sql)`),
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
  const code = guardedFetch(dfVar, `Step ${ctx.dataFrameIndex}`, codeLines.join('\n'));
  return {
    cells: [markdownCell(md), codeCell(code)],
    producedDataFrame: true,
    dataFrameVariable: dfVar,
    citation: { id: resourceId, label: `data.boston.gov: ${resourceId}`, url: `https://data.boston.gov/dataset/${resourceId}` },
  };
}

/**
 * Reader-facing copy for each failure kind. Static per kind and parameterless
 * by construction, so no raw error text, status code or host name can reach a
 * reader through this path — the same discipline `friendlyStreamError()` and
 * `notebookExecutionErrorMessage()` enforce in src/lib/streaming.ts, applied
 * to the notebook surface. "Data source", not "MCP server"
 * (design-principles.md Principle 9).
 */
const FAILURE_REASON: Record<ToolFailureKind, string> = {
  timeout: 'The data source did not respond in time, so the request returned no data.',
  unavailable: 'The data source could not be reached, so the request returned no data.',
  not_configured: 'No live data source was configured for this request, so it returned no data.',
  unknown: 'The request could not be completed, so it returned no data.',
};

/**
 * Plain-language description of what the call was trying to fetch, built from
 * the same args the matching renderer would have used. Falls back to the tool
 * name for a call with no dedicated renderer (a discovery call that failed),
 * which is still more than the reader had before.
 */
function describeAttempt(call: PhaseAToolCall, ctx: ToolCellContext): string {
  if (call.name === 'get_data') {
    const portal = (call.args.portal as string) || ctx.defaultPortal;
    const datasetId = (call.args.dataset_id as string) || 'unknown';
    return `query the \`${datasetId}\` dataset on \`${portal}\``;
  }
  if (call.name === 'get_observations') {
    const variable = (call.args.variable_dcid as string) || 'unknown';
    const place = (call.args.place_dcid as string) || 'unknown';
    return `fetch \`${variable}\` for \`${place}\` from Google Data Commons`;
  }
  if (call.name === 'ckan__execute_sql') {
    return 'run the analyst-authored SQL statement against the Boston open-data store';
  }
  if (call.name === 'ckan__query_data') {
    const resourceId = (call.args.resource_id as string) || 'unknown';
    return `fetch records from Boston open-data resource \`${resourceId}\``;
  }
  return `run the \`${call.name}\` request`;
}

/**
 * Render a tool call that returned no data as MARKDOWN, never as a code cell
 * (#321).
 *
 * The bug this closes: a call the data source rejected during discovery was
 * still rendered as an executable fetch cell, which then threw on execution —
 * inside a notebook whose own cover text tells the reader it is reproducible.
 * An honest note about what was attempted teaches the reader more than a cell
 * that throws, and it does not put a broken step in a document that claims to
 * run.
 *
 * Returning a non-null `ToolCellOutput` here is load-bearing beyond producing
 * the note. `renderDiscoverySummaryCell` below selects discovery calls by
 * `renderFetchToolCell(...) === null`, so a failed call that returned `null`
 * would be swept into the discovery summary and reported to the reader as a
 * completed discovery step — a worse claim than the bug being fixed, and one
 * that would still pass a test asserting only "no code cell was emitted."
 * That exclusion is pinned by a test in tool-to-cell.test.ts.
 */
function renderFailedToolCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput {
  const reason = call.reason ? ` ${call.reason}` : '';
  const md = [
    `#### Not reproduced: \`${call.name}\``,
    '',
    `The original analysis tried to ${describeAttempt(call, ctx)}${reason}. ` +
      `${FAILURE_REASON[call.failureKind ?? 'unknown']}`,
    '',
    'No code cell is generated for it — a request that returned no data cannot be ' +
      'reproduced. The steps below rest only on the requests that did return data.',
  ].join('\n');
  return {
    // Markdown only. No executable cell, by construction rather than by a
    // caller remembering to skip one.
    cells: [markdownCell(md)],
    producedDataFrame: false,
    dataFrameVariable: null,
    // No citation: nothing was retrieved from this source on this call, and
    // listing it in the footer would credit a fetch that never happened.
    citation: null,
  };
}

/**
 * Render a Phase A tool call as a notebook cell pair. Returns `null` for
 * discovery-only calls that do not produce a DataFrame (catalog search,
 * metadata, schema lookups); those are summarized once in a single
 * discovery markdown cell instead of one cell per call.
 *
 * A call that FAILED never returns `null` and never returns a code cell — see
 * `renderFailedToolCell`.
 */
export function renderFetchToolCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput | null {
  // Checked before the name dispatch, so this covers a failed discovery call
  // too: a discovery step that did not complete is not a discovery step that
  // did, and the summary below must not list it as one.
  if (call.failed) return renderFailedToolCell(call, ctx);
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
 *
 * The filter reads "produced no cells of its own", and `null` is the ONLY
 * value that means that. A failed call is deliberately not excluded by a
 * second `!c.failed` guard here: `renderFetchToolCell` already answers
 * non-null for one, and one mechanism that a test pins beats two that can
 * drift apart. If a future change makes the failed branch return `null`
 * again, every failed call silently reappears in this list — described as
 * something the analysis "ran … before fetching data" — which is why that
 * exact regression is what the test in tool-to-cell.test.ts drives.
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
