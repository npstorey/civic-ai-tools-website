/**
 * Dev-only — build a realistic executed-notebook fixture for the renderer
 * + progress UI to iterate against without burning sandbox executions
 * (~$0.012 each). Composes the real `synthesizeNotebook` and
 * `stampExecutedNotebook` from the Phase 1 pipeline, then inlines the
 * three output shapes the renderer cares about (text/plain, text/html
 * DataFrame, image/png chart) so we exercise every CellOutputs branch.
 *
 * Server-only — the synthesize module reads helper .py files via node:fs.
 * The dev preview page renders this as a server component, then passes the
 * fixture JSON to a client wrapper. No production runtime cost; route is
 * scoped to /dev/*.
 */
import type { Notebook, NotebookCell } from '@/lib/notebook-author';
import {
  stampExecutedNotebook,
  synthesizeNotebook,
} from '@/lib/notebook-author';
import { modelAccessPhrase } from '@/lib/model-catalog';

// 1×1 transparent PNG (base64); placeholder chart for matplotlib visualization.
const PLACEHOLDER_CHART_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEXr6+vP6/aKAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

const DATAFRAME_HTML_TABLE = `
<table class="dataframe" border="1" style="font-size: 13px; border-collapse: collapse;">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>complaint_type</th>
      <th>count</th>
    </tr>
  </thead>
  <tbody>
    <tr><th>0</th><td>Noise - Residential</td><td>1234</td></tr>
    <tr><th>1</th><td>Illegal Parking</td><td>987</td></tr>
    <tr><th>2</th><td>Blocked Driveway</td><td>765</td></tr>
    <tr><th>3</th><td>Loud Music/Party</td><td>654</td></tr>
    <tr><th>4</th><td>Heat/Hot Water</td><td>432</td></tr>
  </tbody>
</table>
`.trim();

const SYNTH_INPUTS = {
  query: 'Show me top 5 311 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  modelAccess: modelAccessPhrase('openai-compatible'),
  finalAnswer: [
    'In the past 30 days, the top 311 complaint types in Brooklyn were:',
    '',
    '1. **Noise - Residential** — 1,234 complaints',
    '2. **Illegal Parking** — 987 complaints',
    '3. **Blocked Driveway** — 765 complaints',
    '4. **Loud Music/Party** — 654 complaints',
    '5. **Heat/Hot Water** — 432 complaints',
    '',
    'Residential noise dominated the dataset, with nearly twice the volume',
    'of the next-most-common type. Parking-related complaints (illegal',
    'parking + blocked driveway combined) were close behind.',
  ].join('\n'),
  generatedAt: '2026-05-21T14:00:00.000Z',
  toolCalls: [
    {
      name: 'get_data' as const,
      operationType: 'query' as const,
      args: {
        type: 'query',
        portal: 'data.cityofnewyork.us',
        dataset_id: 'erm2-nwe9',
        select: 'complaint_type, count(*) as count',
        where: "borough = 'BROOKLYN' AND created_date >= '2026-04-21'",
        group: 'complaint_type',
        order: 'count DESC',
        limit: 5,
      },
      reason: 'aggregate Brooklyn 311 complaints by type for the past 30 days',
      resultSummary: { rows: 5, columns: 2 },
    },
  ],
};

function attachMetricCaptureOutput(notebook: Notebook): void {
  for (const cell of notebook.cells) {
    if (cell.cell_type !== 'code') continue;
    const src = cell.source.join('');
    if (src.includes('_civic_capture=" + _json.dumps')) {
      cell.outputs = [{
        output_type: 'stream',
        name: 'stdout',
        text: '_civic_capture=' + JSON.stringify({
          df1: {
            rows: 5,
            head: [
              { complaint_type: 'Noise - Residential', count: 1234 },
              { complaint_type: 'Illegal Parking', count: 987 },
              { complaint_type: 'Blocked Driveway', count: 765 },
              { complaint_type: 'Loud Music/Party', count: 654 },
              { complaint_type: 'Heat/Hot Water', count: 432 },
            ],
          },
        }),
      }];
      cell.execution_count = 4;
      return;
    }
  }
}

function attachAnalysisOutputs(notebook: Notebook): void {
  const codeCells: NotebookCell[] = [];
  let foundHeader = false;
  for (const cell of notebook.cells) {
    if (!foundHeader) {
      if (cell.cell_type === 'markdown' && /Data Analysis Pipeline/.test(cell.source.join(''))) {
        foundHeader = true;
      }
      continue;
    }
    if (cell.cell_type === 'code' && !cell.source.join('').includes('_civic_capture=')) {
      codeCells.push(cell);
    }
  }
  // First analysis code cell — DataFrame HTML output + plain repr fallback.
  if (codeCells[0]) {
    codeCells[0].outputs = [{
      output_type: 'execute_result',
      execution_count: 5,
      data: {
        'text/html': DATAFRAME_HTML_TABLE,
        'text/plain': [
          '              complaint_type  count\n',
          '0          Noise - Residential   1234\n',
          '1              Illegal Parking    987\n',
          '2            Blocked Driveway    765\n',
          '3            Loud Music/Party    654\n',
          '4              Heat/Hot Water    432',
        ],
      },
      metadata: {},
    }];
    codeCells[0].execution_count = 5;
  }
  // Second analysis code cell — chart image (if Phase A had >1 fetching call,
  // we'd have more cells; for the single-call fixture, attach to the first).
  if (codeCells[1]) {
    codeCells[1].outputs = [{
      output_type: 'display_data',
      data: {
        'image/png': PLACEHOLDER_CHART_PNG_BASE64,
        'text/plain': '<Figure size 640x480 with 1 Axes>',
      },
      metadata: {},
    }];
    codeCells[1].execution_count = 6;
  }
}

/**
 * Build a realistic executed-notebook fixture matching the Phase 1 backend
 * pipeline's output shape, with cell outputs inlined so the renderer
 * exercises every CellOutputs code path.
 */
export function buildSampleExecutedNotebook(): {
  notebook: Notebook;
  validation: { ok: boolean; issues: { path: string; message: string }[] };
} {
  const synth = synthesizeNotebook({ ...SYNTH_INPUTS });
  attachMetricCaptureOutput(synth.notebook);
  attachAnalysisOutputs(synth.notebook);
  stampExecutedNotebook(
    synth.notebook,
    {
      executedAt: '2026-05-21T14:23:45.000Z',
      executionDuration_ms: 12340,
      sandboxId: 'vrcl-sbx-fixture',
    },
    synth.dataFrameVariables,
  );
  return {
    notebook: synth.notebook,
    validation: { ok: true, issues: [] },
  };
}
