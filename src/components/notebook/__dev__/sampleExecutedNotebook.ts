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
 *
 * THE VERDICT IS COMPUTED, NOT WRITTEN DOWN (#400). Until this file was
 * changed it returned a hand-written verdict of `{ ok: true, issues: [] }`
 * beside a notebook it never ran the validator over — the only fixture feeding
 * the only surface that could show a verdict, shaped so it could never disagree
 * with the validator. A fixture that cannot disagree is not evidence that the
 * surface works. Both builders below run the real `validateExecutedNotebook`
 * over the notebook they just built and carry whatever it returns.
 *
 * AND ONE OF THEM IS REJECTED. The clean fixture's computed verdict happens to
 * be `{ ok: true, issues: [] }` — the same value the literal asserted — so
 * computing it proves nothing on its own. `buildSampleRejectedNotebook` drives
 * the other half through the identical rendering path: the same query with its
 * one data fetch REJECTED, which is a document nothing in it reproduces, and
 * the validator says so.
 *
 * IMPORTS ARE RELATIVE, DELIBERATELY. This file used the `@/lib` path alias,
 * which `node --test --experimental-strip-types` cannot resolve, so no test
 * could import it and the literal above was unreachable by any assertion. The
 * alias is what kept the fixture out of the suite; relative specifiers are what
 * let the suite hold it to the validator.
 */
import type {
  Notebook,
  NotebookCell,
  SynthesisOutputs,
  ValidationResult,
} from '../../../lib/notebook-author/index.ts';
import {
  stampExecutedNotebook,
  synthesizeNotebook,
  validateExecutedNotebook,
} from '../../../lib/notebook-author/index.ts';
import { buildNotebookExtension } from '../../../lib/notebook-author/notebook-extension.ts';
import { modelAccessPhrase } from '../../../lib/model-catalog.ts';

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
 * The one place a fixture becomes a notebook-plus-verdict.
 *
 * The verdict is what `validateExecutedNotebook` returns over the notebook this
 * function just built — never a value written beside it — and it is attached
 * through the same `buildNotebookExtension` the executed pipeline uses, so the
 * preview renders exactly the object a signed package would carry.
 */
function finish(synth: SynthesisOutputs): {
  notebook: Notebook;
  validation: ValidationResult;
} {
  stampExecutedNotebook(
    synth.notebook,
    {
      executedAt: '2026-05-21T14:23:45.000Z',
      executionDuration_ms: 12340,
      sandboxId: 'vrcl-sbx-fixture',
    },
    synth.dataFrameVariables,
  );
  const validation = validateExecutedNotebook(synth.notebook);
  return { notebook: buildNotebookExtension(synth.notebook, validation), validation };
}

/**
 * Build a realistic executed-notebook fixture matching the Phase 1 backend
 * pipeline's output shape, with cell outputs inlined so the renderer
 * exercises every CellOutputs code path.
 */
export function buildSampleExecutedNotebook(): {
  notebook: Notebook;
  validation: ValidationResult;
} {
  const synth = synthesizeNotebook({ ...SYNTH_INPUTS });
  attachMetricCaptureOutput(synth.notebook);
  attachAnalysisOutputs(synth.notebook);
  return finish(synth);
}

/**
 * The same analysis with its one data fetch REJECTED — the fixture the verdict
 * surface exists for.
 *
 * Wave N10's own subject: a call the source refused. Nothing in the resulting
 * notebook re-runs a live request, so `validateReproducedFetches` reports it and
 * the verdict is a rejection with the validator's own sentence attached. Nothing
 * about the document is hand-authored to fail — the pipeline builds it from a
 * run that went that way, and the validator is asked what it thinks.
 */
export function buildSampleRejectedNotebook(): {
  notebook: Notebook;
  validation: ValidationResult;
} {
  const synth = synthesizeNotebook({
    ...SYNTH_INPUTS,
    toolCalls: SYNTH_INPUTS.toolCalls.map((call) => ({
      name: call.name,
      operationType: call.operationType,
      args: call.args,
      reason: call.reason,
      failed: true,
      failureKind: 'timeout' as const,
    })),
  });
  return finish(synth);
}
