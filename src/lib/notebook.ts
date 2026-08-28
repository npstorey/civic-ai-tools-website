import type { ToolCall } from '@/hooks/useStreamingComparison';
// Instance attribution is THREADED IN (#258 A2), never read from env here:
// this module is bundled into CLIENT components (the notebook Download
// button and the publish dialog's skeleton notebook), where non-NEXT_PUBLIC
// env never arrives — the old in-module getters silently returned reference
// defaults in the browser regardless of server config. Client callers read
// the server-resolved values from `EvidenceOriginProvider`
// (`useInstanceAttribution()`); server callers resolve them via
// `getInstanceAttribution()`. Null members mean "not configured" and the
// attribution lines are honestly omitted. Type-only import — erased at
// compile time, so no env read rides into the client bundle.
import type { InstanceAttribution } from './site-config.ts';
// The sniff that decides what a `query` argument means is a fact about the data
// source, not about either renderer, and it already exists exactly once —
// `SOQL_QUERY_SNIFF`, pinned against the service's own regex by
// `tool-to-cell.test.ts` and mirrored by `helpers/fetch_socrata.py`. A fourth
// copy that drifts is precisely the defect this is fixing, so this module
// imports the rule rather than restating it. The import is value-level and
// this module ships in client bundles: `tool-to-cell.ts` reaches only
// `cells.ts`, both pure string builders with no env read and no Node API, so
// nothing server-only rides in behind it.
import { isFullSoqlQuery } from './notebook-author/tool-to-cell.ts';

export type { InstanceAttribution };

interface NotebookCell {
  cell_type: 'code' | 'markdown';
  metadata: Record<string, unknown>;
  source: string[];
  outputs?: unknown[];
  execution_count?: number | null;
}

interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info: {
      name: string;
      version: string;
    };
  };
  cells: NotebookCell[];
}

function markdownCell(lines: string[]): NotebookCell {
  return {
    cell_type: 'markdown',
    metadata: {},
    source: lines.map((l, i) => (i < lines.length - 1 ? l + '\n' : l)),
  };
}

function codeCell(lines: string[]): NotebookCell {
  return {
    cell_type: 'code',
    metadata: {},
    source: lines.map((l, i) => (i < lines.length - 1 ? l + '\n' : l)),
    outputs: [],
    execution_count: null,
  };
}

/**
 * Socrata query-string parameters this builder emits — the args it can express
 * in a URL, in the order it writes them.
 *
 * This is this module's own parameter list, the analogue of
 * `notebook-author/tool-to-cell.ts`'s `FETCH_SOCRATA_PARAMS`: what the target
 * can receive bounds what may be written. An arg outside it is disclosed in
 * the cell rather than invented as a `$parameter` the portal would ignore.
 */
const SOCRATA_URL_CLAUSES = ['select', 'where', 'group', 'order', 'limit', 'offset'] as const;

/**
 * Args consumed by the URL's path, or by call routing, rather than by its query
 * string — so they are neither written as parameters nor reported as dropped.
 * `type` selects which operation ran (and has already selected this renderer);
 * `portal` and `dataset_id` are the path; `query` is handled by the precedence
 * rule below.
 */
const SOCRATA_URL_STRUCTURAL_ARGS = ['type', 'portal', 'dataset_id', 'query'] as const;

/** An arg the call actually carried — `limit: 0` is a limit, `''` is not a clause. */
function carriesArg(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  return value !== undefined && value !== null && value !== '';
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * A value that can become a Socrata query-string parameter, or `null`.
 *
 * Every clause `get_data` advertises is typed `string` or `number`, so anything
 * else is a value this builder cannot express. `String()`-ing it would write
 * `$where=%5Bobject%20Object%5D` — a parameter with no effect on the rows, which
 * is exactly what the URL may not contain. It is reported as an argument this
 * URL has no parameter for instead.
 */
function urlParamValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** One analysis step, planned before any cell is written. */
type QueryStep =
  | {
      kind: 'socrata';
      url: string;
      /** Generated comment lines that make the URL's arguments legible. */
      comments: string[];
      datasetId: string;
      portal: string;
    }
  | {
      kind: 'not-reproduced';
      /** Markdown explaining why this step has no URL. */
      note: string;
    };

/**
 * Why a step gets no URL, in the reader's language.
 *
 * The step filter is `operationType === 'query'`, and since `operation-types.ts`
 * that admits `get_observations`, `ckan__query_data`, `ckan__execute_sql` and
 * `ckan__aggregate_data` as well as Socrata's `get_data`. None of those carry a
 * portal or a dataset id, and this builder addresses one thing: a Socrata
 * dataset over HTTP. Interpolating them anyway produced
 * `https://undefined/resource/undefined.json` under the original step's row
 * count — a cell that runs clean and reads nothing, in a notebook that goes
 * into a signed record package.
 *
 * The step is still WRITTEN. Dropping it would make the document claim the
 * analysis rested on fewer sources than it did, which is the same false
 * precision pointing the other way (docs/design-principles.md Principle 3, and
 * Principle 2's persistent source marking). What it must not do is name a
 * source it did not read — so it says what ran and stops there.
 */
function notReproducedNote(toolName: string): string {
  return (
    `*Not reproduced below.* This step called \`${toolName}\`, and the cells in this ` +
    'notebook fetch Socrata datasets by URL. This call named no Socrata portal and ' +
    'dataset, so no URL is written for it — one written here would name a source the ' +
    'step did not read. The original result is described above.'
  );
}

/**
 * The comment lines that make a `query` argument's effect legible.
 *
 * Two things a reader cannot see from the URL alone, and both change how they
 * should read the numbers: which clauses the data source did NOT apply (so
 * their absence from the URL is deliberate rather than a loss), and what bounds
 * the row count once `$limit` is gone.
 *
 * Deliberately the same explanation `notebook-author/tool-to-cell.ts` gives for
 * the executed notebook: it is the same fact about the same data source, and
 * two surfaces explaining one behaviour differently is how they drift.
 */
function queryPrecedenceComment(soql: boolean, superseded: readonly string[]): string[] {
  if (!soql) {
    return [
      '# `query` here is a search phrase rather than a SoQL statement, so the data',
      '# source runs it as a full-text search within the data ($q) and applies the',
      '# clauses below alongside it.',
    ];
  }
  const lines = [
    '# `query` here is a full SoQL statement, so the data source applies it as the',
    '# whole query ($query): select / where / group / order — and limit / offset —',
    '# are not sent alongside it. They are omitted from the URL rather than written',
    '# as parameters that would have no effect on the rows this cell returns.',
  ];
  if (superseded.length > 0) {
    lines.push(`# Superseded on this call, for that reason: ${superseded.join(', ')}.`);
  }
  lines.push(
    '# The row count is therefore bounded by the statement\'s own LIMIT, or by the',
    '# portal\'s default page size when the statement carries none.',
  );
  return lines;
}

/**
 * Plan one analysis step: a Socrata URL that carries every argument affecting
 * its result, or an honest note that this notebook cannot address the call.
 *
 * The URL is emitted only for a `get_data` call naming both a portal and a
 * dataset. The gate is deliberately stricter than "portal and dataset present":
 * the shape being built is Socrata's REST API, so the tool that speaks it is
 * what makes the URL meaningful. Anything else degrades to a note, which is
 * false about nothing.
 */
function planQueryStep(tool: ToolCall): QueryStep {
  const args = tool.args;
  const portal = nonEmptyString(args.portal);
  const datasetId = nonEmptyString(args.dataset_id);
  if (tool.name !== 'get_data' || !portal || !datasetId) {
    return { kind: 'not-reproduced', note: notReproducedNote(tool.name) };
  }

  const rawQuery = nonEmptyString(args.query);
  // The precedence the data source itself applies, through the one sniff this
  // repository owns (`notebook-author/tool-to-cell.ts`): a `query` that is a
  // full SoQL statement becomes `$query` and supersedes the clauses, and no
  // `$limit`/`$offset` is sent with it.
  const soql = rawQuery !== null && isFullSoqlQuery(rawQuery);

  // Args this cell accounts for, either by writing them or by explaining their
  // absence. Accumulated rather than assumed, so a clause whose value could not
  // be written falls through to the disclosure below instead of vanishing.
  const accountedFor = new Set<string>(SOCRATA_URL_STRUCTURAL_ARGS);
  const params: string[] = [];
  const superseded: string[] = [];
  if (soql) {
    params.push(`$query=${encodeURIComponent(rawQuery)}`);
    for (const clause of SOCRATA_URL_CLAUSES) {
      if (!carriesArg(args, clause)) continue;
      superseded.push(clause);
      accountedFor.add(clause);
    }
  } else {
    if (rawQuery !== null) params.push(`$q=${encodeURIComponent(rawQuery)}`);
    for (const clause of SOCRATA_URL_CLAUSES) {
      if (!carriesArg(args, clause)) continue;
      const value = urlParamValue(args[clause]);
      if (value === null) continue;
      params.push(`$${clause}=${encodeURIComponent(value)}`);
      accountedFor.add(clause);
    }
  }

  // Anything this URL has no parameter for is named in the cell. Nothing the
  // call carried is silently absent from the reader's view of it.
  const undisclosed = Object.keys(args)
    .filter(key => carriesArg(args, key) && !accountedFor.has(key))
    .sort();

  const comments: string[] = [];
  if (rawQuery !== null) comments.push(...queryPrecedenceComment(soql, superseded));
  if (undisclosed.length > 0) {
    comments.push(
      `# The original call also passed ${undisclosed.join(', ')}, which this URL has no`,
      '# parameter for; named here rather than dropped without a trace.',
    );
  }

  const search = params.length > 0 ? '?' + params.join('&') : '';
  return {
    kind: 'socrata',
    url: `https://${portal}/resource/${datasetId}.json${search}`,
    comments,
    datasetId,
    portal,
  };
}

export function generateNotebook(
  query: string,
  portal: string,
  toolsCalled: ToolCall[],
  responseContent: string,
  /** The instance's attribution identity, threaded from the server (#258
   *  A2). Required so no call site silently drops a configured identity —
   *  pass `useInstanceAttribution()` (client) or `getInstanceAttribution()`
   *  (server). Null members omit their attribution lines. */
  attribution: InstanceAttribution,
): Notebook {
  const cells: NotebookCell[] = [];
  const now = new Date().toISOString().split('T')[0];

  // Collect unique portals from tool calls
  const portalSet = new Set<string>();
  for (const tool of toolsCalled) {
    const p = tool.args.portal as string | undefined;
    if (p) portalSet.add(p);
  }
  const uniquePortals = [...portalSet];
  const displayPortal = uniquePortals.length > 1
    ? uniquePortals.join(', ')
    : uniquePortals[0] || portal;

  // Title cell. Attribution ("via [host](origin)") renders only when the
  // instance has declared an identity — honest omission otherwise (#258 A2).
  const viaSuffix =
    attribution.host && attribution.origin
      ? ` via [${attribution.host}](${attribution.origin})`
      : '';
  // #324: the same conditional, one line up. The heading hardcoded the
  // reference deployment's name on every instance, inside a file readers
  // download — an instance that has declared no identity gets the description
  // without the name, never a borrowed one.
  const title = attribution.platformTitle
    ? `# ${attribution.platformTitle} Data Analysis`
    : '# Data Analysis';
  cells.push(markdownCell([
    title,
    '',
    `**Query:** ${query}  `,
    `**Portal${uniquePortals.length > 1 ? 's' : ''}:** ${displayPortal}  `,
    `**Generated:** ${now}${viaSuffix}`,
  ]));

  // Setup cell
  cells.push(codeCell([
    '# Install dependencies (run once)',
    '# !pip install requests pandas',
    '',
    'import requests',
    'import pandas as pd',
  ]));

  // Filter to query tool calls only. NOTE that this admits every tool whose
  // operation type is `query`, not only Socrata's — see `planQueryStep`.
  const queryTools = toolsCalled.filter(t => t.operationType === 'query');

  // Datasets this notebook actually addressed, in the order it addressed them.
  // Built from the planned steps rather than from the raw args, so the "Data
  // sources" list below cites only what a cell in this document fetches. It
  // used to read `dataset_id` off any query call and fall back to the run's
  // selected portal for the link, which could publish a portal the call never
  // named.
  const datasetPortalMap = new Map<string, string>();

  for (let i = 0; i < queryTools.length; i++) {
    const tool = queryTools[i];
    const reason = tool.reason || `Query ${i + 1}`;
    const step = planQueryStep(tool);

    // Description cell
    const descLines = [`## Step ${i + 1}: ${reason}`];
    if (tool.resultSummary) {
      descLines.push(
        '',
        `*Original query returned ${tool.resultSummary.rows} rows, ${tool.resultSummary.columns} columns.*`,
      );
    }

    if (step.kind === 'not-reproduced') {
      // The step keeps its number and its result summary; it gets no code cell,
      // because there is no URL this notebook can honestly write for it.
      descLines.push('', step.note);
      cells.push(markdownCell(descLines));
      continue;
    }

    cells.push(markdownCell(descLines));

    if (!datasetPortalMap.has(step.datasetId)) {
      datasetPortalMap.set(step.datasetId, step.portal);
    }

    // Code cell
    cells.push(codeCell([
      ...step.comments,
      `url = "${step.url}"`,
      '',
      'response = requests.get(url)',
      'response.raise_for_status()',
      'data = response.json()',
      '',
      'df = pd.DataFrame(data)',
      'print(f"Rows: {len(df)}, Columns: {len(df.columns)}")',
      'df.head(10)',
    ]));
  }

  // Analysis cell
  if (responseContent) {
    cells.push(markdownCell([
      '## AI Analysis',
      '',
      responseContent,
    ]));
  }

  // Attribution cell — every dataset a cell above fetches, linked on the portal
  // that cell fetches it from (collected in the step loop).
  const attrLines = ['---', '', '**Data sources:**'];
  for (const [id, p] of datasetPortalMap) {
    attrLines.push(`- [${id}](https://${p}/d/${id})`);
  }
  // "Generated by …" only when the instance has declared an identity (#258).
  if (attribution.platformTitle && attribution.origin) {
    attrLines.push(
      '',
      `Generated by [${attribution.platformTitle}](${attribution.origin}) on ${now}`,
    );
  }
  cells.push(markdownCell(attrLines));

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.10.0',
      },
    },
    cells,
  };
}

export function downloadNotebook(notebook: Notebook): void {
  const json = JSON.stringify(notebook, null, 2);
  const blob = new Blob([json], { type: 'application/x-ipynb+json' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `civic-ai-query-${timestamp}.ipynb`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
