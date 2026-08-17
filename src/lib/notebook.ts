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

function buildSocrataUrl(args: Record<string, unknown>): string {
  const portal = args.portal as string;
  const datasetId = args.dataset_id as string;
  const params: string[] = [];

  if (args.select) params.push(`$select=${encodeURIComponent(args.select as string)}`);
  if (args.where) params.push(`$where=${encodeURIComponent(args.where as string)}`);
  if (args.group) params.push(`$group=${encodeURIComponent(args.group as string)}`);
  if (args.order) params.push(`$order=${encodeURIComponent(args.order as string)}`);
  if (args.limit) params.push(`$limit=${args.limit}`);

  const query = params.length > 0 ? '?' + params.join('&') : '';
  return `https://${portal}/resource/${datasetId}.json${query}`;
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
  cells.push(markdownCell([
    '# Civic AI Data Analysis',
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

  // Filter to query tool calls only
  const queryTools = toolsCalled.filter(t => t.operationType === 'query');

  for (let i = 0; i < queryTools.length; i++) {
    const tool = queryTools[i];
    const reason = tool.reason || `Query ${i + 1}`;
    const url = buildSocrataUrl(tool.args);

    // Description cell
    const descLines = [`## Step ${i + 1}: ${reason}`];
    if (tool.resultSummary) {
      descLines.push(
        '',
        `*Original query returned ${tool.resultSummary.rows} rows, ${tool.resultSummary.columns} columns.*`,
      );
    }
    cells.push(markdownCell(descLines));

    // Code cell
    cells.push(codeCell([
      `url = "${url}"`,
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

  // Attribution cell — use per-dataset portal for correct links
  const datasetPortalMap = new Map<string, string>();
  for (const tool of queryTools) {
    const id = tool.args.dataset_id as string;
    const p = (tool.args.portal as string) || portal;
    if (id && !datasetPortalMap.has(id)) {
      datasetPortalMap.set(id, p);
    }
  }
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
