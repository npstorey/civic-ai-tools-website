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
  supportedKeys?: readonly string[],
): string {
  const lines: string[] = [];
  const seen = new Set<string>(handledKeys);
  const supported = supportedKeys ? new Set<string>(supportedKeys) : null;
  for (const key of order) {
    // A key the caller has already accounted for is never emitted here, even
    // when it is in `order`: since #340 a renderer can hand a clause to
    // `handledKeys` because the generated comment explains its absence.
    if (seen.has(key)) continue;
    if (args[key] === undefined || args[key] === null) continue;
    lines.push(`    ${key}=${pyRepr(args[key], '    ')},`);
    seen.add(key);
  }
  // Append any extra args we did not enumerate so nothing silently drops —
  // unless the helper has no such parameter, in which case emitting it would
  // make the cell raise `TypeError` on execution and the reader would be told
  // live data could not be fetched (#340). Those keys are reported by
  // `unsupportedArgKeys` and disclosed in the cell instead.
  for (const [key, value] of Object.entries(args)) {
    if (seen.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (supported && !supported.has(key)) continue;
    lines.push(`    ${key}=${pyRepr(value, '    ')},`);
  }
  return lines.join('\n');
}

/**
 * Args this call carried that the target helper has no parameter for, and
 * that the caller has not accounted for by hand — the set `pyKwargs` refuses
 * to emit. Named so a renderer can disclose them in the generated cell:
 * nothing is silently ignored, because nothing ignored is written.
 */
function unsupportedArgKeys(
  args: Record<string, unknown>,
  supportedKeys: readonly string[],
  handledKeys: readonly string[],
): string[] {
  const supported = new Set<string>(supportedKeys);
  const handled = new Set<string>(handledKeys);
  return Object.keys(args)
    .filter(key => args[key] !== undefined && args[key] !== null)
    .filter(key => !supported.has(key) && !handled.has(key))
    .sort();
}

const SOCRATA_QUERY_KWARGS = ['select', 'where', 'group', 'order', 'limit', 'offset'] as const;
const DC_OBS_KWARGS = ['date', 'child_place_type'] as const;

/**
 * Parameters of `helpers/fetch_socrata.py` a generated cell may pass, and the
 * only keys the Socrata renderer will emit. Credential and transport
 * parameters (`app_token`, `timeout_s`) are deliberately absent: a generated
 * cell never writes them.
 *
 * Pinned against the helper's real signature by a test — a parameter added to
 * the .py and not added here would be silently dropped from every cell, and a
 * name here that the .py does not have would put back exactly the `TypeError`
 * #340 is about.
 */
const FETCH_SOCRATA_PARAMS = [
  'portal', 'dataset_id', 'query', 'select', 'where', 'group', 'order', 'limit', 'offset',
] as const;

/** Same contract as `FETCH_SOCRATA_PARAMS`, for `helpers/fetch_data_commons.py`. */
const FETCH_DATA_COMMONS_PARAMS = [
  'variable_dcid', 'place_dcid', 'date', 'child_place_type',
] as const;

/** Test-only view of the helper-parameter constants above. */
export const HELPER_PARAMETERS: Record<string, readonly string[]> = {
  fetch_socrata: FETCH_SOCRATA_PARAMS,
  fetch_data_commons: FETCH_DATA_COMMONS_PARAMS,
};

/**
 * The sniff that decides what a `query` argument on `get_data` means — copied
 * deliberately, because the behaviour it selects belongs to another
 * repository.
 *
 * MIRRORS: `socrata-mcp-server/src/tools/socrata-tools.ts:546`, at commit
 * `116f46ce1e84e3608014599f9b63ea01acfd913a`:
 *
 *     if (queryField && /^\s*select/i.test(queryField)) { … }
 *
 * A `query` that matches becomes the whole SoQL request (`$query`) and the
 * service sets `select`/`where`/`order`/`group`/`having`/`q` aside (`:547-553`);
 * the request it then builds carries `$query` alone — `$limit` and `$offset`
 * are not sent either (`:283-293`). A `query` that does not match becomes a
 * full-text search term (`$q`, `:555-557`) with every other clause preserved.
 *
 * This constant, `helpers/fetch_socrata.py`'s `_is_full_soql_query`, and the
 * service's line above are three copies of one rule. If the service changes
 * its sniff, the fix is an issue on THIS repository so both copies move
 * together — not a silent divergence discovered later in a published notebook.
 * `tool-to-cell.test.ts` carries the service's regex literally and drives a
 * fixture lifted from its own suite.
 */
export const SOQL_QUERY_SNIFF = /^\s*select/i;

/** True when a `query` argument is a full SoQL statement rather than a phrase. */
export function isFullSoqlQuery(query: string): boolean {
  return SOQL_QUERY_SNIFF.test(query);
}

/**
 * Clauses a full SoQL `query` supersedes: the service sets each aside
 * (`socrata-tools.ts:547-553`) and then sends neither `$limit` nor `$offset`
 * with a `$query` (`:283-293`). A cell that wrote any of them beside `query=`
 * would show the reader an argument that had no effect on the numbers below —
 * the false precision docs/design-principles.md Principle 3 forbids.
 */
const SOQL_SUPERSEDED_KWARGS = [
  'select', 'where', 'group', 'order', 'having', 'q', 'limit', 'offset',
] as const;

/**
 * The assignment every fetch cell in this module emits, as a fact about the
 * rendered source: `dfN = fetch_<helper>(`, at any indentation (the fetch sits
 * inside a `try` body). Owned here, beside the renderers that emit it, so a
 * change to the emitted shape is made next to its only detector rather than
 * silently breaking a scan that lives in another file (`validate.ts`).
 */
const REPRODUCED_FETCH_ASSIGNMENT = /^[ \t]*df\d+ = fetch_[a-z_]+\(/m;

/** True when this cell re-runs a data fetch — see `REPRODUCED_FETCH_ASSIGNMENT`. */
export function isReproducedFetchCell(cell: NotebookCell): boolean {
  if (cell.cell_type !== 'code') return false;
  return REPRODUCED_FETCH_ASSIGNMENT.test(cell.source.join(''));
}

/**
 * How many of a notebook's cells re-run a data fetch. Zero means no step in
 * the document rests on data it fetched itself (#341).
 */
export function countReproducedFetchCells(cells: readonly NotebookCell[]): number {
  return cells.filter(isReproducedFetchCell).length;
}

/**
 * How many of this analysis's tool calls will render as a re-runnable fetch —
 * computed from the calls rather than from the cells, so a caller can ask
 * before any cell exists (`synthesize.ts` builds the cover cell first).
 */
export function countReproducibleFetches(calls: readonly PhaseAToolCall[]): number {
  return calls.filter(call => {
    const out = renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal: '' });
    return out !== null && out.producedDataFrame;
  }).length;
}

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

/**
 * The generated comment that makes a `query` argument's effect legible (#340).
 *
 * Two things a reader cannot see from the arguments alone, and both change how
 * they should read the numbers below:
 *
 *   - which clauses the data source did NOT apply, and why they are therefore
 *     absent from the cell (they would be arguments with no effect);
 *   - what bounds the row count once `limit` is gone — the statement's own
 *     LIMIT, or the portal's default page, never the `limit` the original call
 *     carried.
 *
 * Reader-facing text: "data source", never "MCP server" (design-principles.md
 * Principle 9), and no repository paths — the coupling those cite is recorded
 * beside `SOQL_QUERY_SNIFF`, in source a notebook reader never downloads.
 */
function socrataQueryComment(args: Record<string, unknown>, soql: boolean): string[] {
  const lines: string[] = [];
  if (soql) {
    const superseded = SOQL_SUPERSEDED_KWARGS.filter(k => args[k] !== undefined && args[k] !== null);
    lines.push(
      '# `query` here is a full SoQL statement, so the data source applied it as the',
      '# whole query: select / where / group / order — and limit / offset — are not',
      '# sent alongside it. They are omitted below rather than written as arguments',
      '# that would have no effect on the rows this cell returns.',
    );
    if (superseded.length > 0) {
      lines.push(`# Superseded on this call, for that reason: ${superseded.join(', ')}.`);
    }
    lines.push(
      '# The row count is therefore bounded by the statement\'s own LIMIT, or by the',
      '# portal\'s default page size when the statement carries none.',
    );
  } else {
    lines.push(
      '# `query` here is a search phrase rather than a SoQL statement, so the data',
      '# source ran it as a full-text search across the dataset and applied the',
      '# clauses below alongside it.',
    );
  }
  lines.push(
    '# One deliberate difference from the original run: this helper always requires',
    '# an explicit dataset_id and never derives one from `query`.',
  );
  return lines;
}

/**
 * A `type=query` call that named no dataset (#340, rider c).
 *
 * The data source has a third behaviour here: given a `query` that is not a
 * SoQL statement and no `dataset_id`, it treats the query string itself as the
 * dataset id. This notebook does not reproduce that. A dataset id guessed from
 * a search phrase is a guess, and a step that reads a dataset it cannot name
 * is not a reproduction of anything.
 *
 * So the step becomes a markdown note, for the reason `renderFailedToolCell`
 * already records: a cell that always raises is a broken step in a document
 * whose cover text tells the reader it runs.
 */
function renderUnnamedDatasetCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput {
  const portal = (call.args.portal as string) || ctx.defaultPortal;
  const reason = call.reason ? ` ${call.reason}` : '';
  const md = [
    `#### Not reproduced: \`get_data\` on \`${portal}\``,
    '',
    `The original analysis queried a dataset it did not name${reason}. The data source ` +
      'derived one from the search phrase it was given; this notebook does not derive ' +
      'dataset ids, because a dataset id guessed from a phrase is a guess.',
    '',
    'No code cell is generated for it. To reproduce this step, add the dataset ' +
      'identifier to a `fetch_socrata(...)` call of your own.',
  ].join('\n');
  return {
    cells: [markdownCell(md)],
    producedDataFrame: false,
    dataFrameVariable: null,
    // Nothing may be cited: we cannot say which dataset was read.
    citation: null,
  };
}

function renderSocrataQueryCell(
  call: PhaseAToolCall,
  ctx: ToolCellContext,
): ToolCellOutput {
  const portal = (call.args.portal as string) || ctx.defaultPortal;
  const datasetId = typeof call.args.dataset_id === 'string' && call.args.dataset_id
    ? call.args.dataset_id
    : null;
  if (!datasetId) return renderUnnamedDatasetCell(call, ctx);

  const rawQuery = typeof call.args.query === 'string' && call.args.query.length > 0
    ? call.args.query
    : null;
  const soql = rawQuery !== null && isFullSoqlQuery(rawQuery);

  const dfVar = `df${ctx.dataFrameIndex}`;
  const reason = call.reason ? ` ${call.reason}` : '';
  // Under a full SoQL query the superseded clauses are accounted for by the
  // generated comment, so `pyKwargs` must not emit them; they are "handled",
  // exactly as `portal` and `dataset_id` are.
  const handledKeys = soql
    ? ['portal', 'dataset_id', 'type', 'query', ...SOQL_SUPERSEDED_KWARGS]
    : ['portal', 'dataset_id', 'type', 'query'];
  const unsupported = unsupportedArgKeys(call.args, FETCH_SOCRATA_PARAMS, handledKeys);

  const md = [
    `### Step ${ctx.dataFrameIndex}: Query \`${datasetId}\``,
    '',
    `We query the \`${datasetId}\` dataset on \`${portal}\`${reason}.`,
    call.resultSummary
      ? `Original execution returned ${call.resultSummary.rows} rows × ${call.resultSummary.columns} columns.`
      : '',
  ].filter(Boolean).join('\n');

  const commentLines = rawQuery !== null ? socrataQueryComment(call.args, soql) : [];
  if (unsupported.length > 0) {
    commentLines.push(
      `# The original call also passed ${unsupported.join(', ')}, which this helper has`,
      '# no parameter for; disclosed here rather than passed and silently ignored.',
    );
  }

  const code = [
    ...commentLines,
    guardedFetch(dfVar, `Step ${ctx.dataFrameIndex}`, [
      `${dfVar} = fetch_socrata(`,
      `    portal=${JSON.stringify(portal)},`,
      `    dataset_id=${JSON.stringify(datasetId)},`,
      rawQuery !== null ? `    query=${JSON.stringify(rawQuery)},` : '',
      pyKwargs(call.args, SOCRATA_QUERY_KWARGS, handledKeys, FETCH_SOCRATA_PARAMS),
      ')',
    ].filter(Boolean).join('\n')),
  ].join('\n');

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
  // Same bound as the Socrata renderer (#340): a key `fetch_data_commons` has
  // no parameter for is disclosed, never emitted — emitting it would raise
  // `TypeError` and the reader would be told live data could not be fetched.
  const handledKeys = ['variable_dcid', 'place_dcid'];
  const unsupported = unsupportedArgKeys(call.args, FETCH_DATA_COMMONS_PARAMS, handledKeys);
  const commentLines = unsupported.length > 0
    ? [
        `# The original call also passed ${unsupported.join(', ')}, which this helper has`,
        '# no parameter for; disclosed here rather than passed and silently ignored.',
      ]
    : [];
  const code = [
    ...commentLines,
    guardedFetch(dfVar, `Step ${ctx.dataFrameIndex}`, [
      `${dfVar} = fetch_data_commons(`,
      `    variable_dcid=${JSON.stringify(variable)},`,
      `    place_dcid=${JSON.stringify(place)},`,
      pyKwargs(call.args, DC_OBS_KWARGS, handledKeys, FETCH_DATA_COMMONS_PARAMS),
      ')',
    ].filter(Boolean).join('\n')),
  ].join('\n');
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
 *
 * `get_data` dispatches on name AND `args.type` (#342), the way
 * `renderFetchToolCell` does. It used to dispatch on the name alone, so a
 * rejected CATALOG SEARCH was reported to the reader as "tried to query the
 * `unknown` dataset on …" — an operation that never ran, against a dataset
 * that never existed, named by a placeholder. Three false claims in one
 * sentence, in a document a reader downloads to scrutinise.
 *
 * There is no `unknown` here any more, in either direction: a field the call
 * did not carry is left out of the sentence rather than filled with a word
 * that looks like a value (docs/design-principles.md Principle 3). The
 * `metadata` and `metrics` branches read the id from `query` when
 * `dataset_id` is absent because that is what the data source does with it.
 */
function describeAttempt(call: PhaseAToolCall, ctx: ToolCellContext): string {
  if (call.name === 'get_data') {
    const portal = (call.args.portal as string) || ctx.defaultPortal;
    const datasetId = typeof call.args.dataset_id === 'string' && call.args.dataset_id
      ? call.args.dataset_id
      : null;
    const queryArg = typeof call.args.query === 'string' && call.args.query
      ? call.args.query
      : null;
    const type = typeof call.args.type === 'string' ? call.args.type : undefined;
    const namedDataset = datasetId ?? queryArg;
    if (type === 'catalog') {
      return queryArg
        ? `search the \`${portal}\` data catalog for \`${queryArg}\``
        : `search the \`${portal}\` data catalog`;
    }
    if (type === 'metadata') {
      return namedDataset
        ? `look up the description of the \`${namedDataset}\` dataset on \`${portal}\``
        : `look up a dataset description on \`${portal}\``;
    }
    if (type === 'metrics') {
      return namedDataset
        ? `check row counts and update times for the \`${namedDataset}\` dataset on \`${portal}\``
        : `check row counts and update times for a dataset on \`${portal}\``;
    }
    if (type === 'query') {
      return datasetId
        ? `query the \`${datasetId}\` dataset on \`${portal}\``
        : `query a dataset on \`${portal}\``;
    }
    // No `type` at all: say what we know — the portal — and nothing else.
    return `request data from \`${portal}\``;
  }
  if (call.name === 'get_observations') {
    const variable = typeof call.args.variable_dcid === 'string' ? call.args.variable_dcid : null;
    const place = typeof call.args.place_dcid === 'string' ? call.args.place_dcid : null;
    if (variable && place) return `fetch \`${variable}\` for \`${place}\` from Google Data Commons`;
    if (variable) return `fetch \`${variable}\` from Google Data Commons`;
    if (place) return `fetch an indicator for \`${place}\` from Google Data Commons`;
    return 'fetch an indicator from Google Data Commons';
  }
  if (call.name === 'ckan__execute_sql') {
    return 'run the analyst-authored SQL statement against the Boston open-data store';
  }
  if (call.name === 'ckan__query_data') {
    const resourceId = typeof call.args.resource_id === 'string' && call.args.resource_id
      ? call.args.resource_id
      : null;
    return resourceId
      ? `fetch records from Boston open-data resource \`${resourceId}\``
      : 'fetch records from the Boston open-data store';
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
