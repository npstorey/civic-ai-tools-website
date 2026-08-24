// Phase D tests — exercise the post-execution stamping and comparison-cell
// append. Pure-function over executed-notebook JSON; no sandbox calls.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeNotebook } from './synthesize.ts';
import { stampExecutedNotebook, extractCapturedMetrics } from './phase-d.ts';
import { EXECUTION_EXTENSION_KEY, NOTEBOOK_EXTENSION_KEY } from './prompt.ts';
import { modelAccessPhrase } from '../model-catalog.ts';
import { validateExecutedNotebook } from './validate.ts';

const BASE_INPUTS = {
  query: 'Top 5 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  modelAccess: modelAccessPhrase('openai-compatible'),
  generatedAt: '2026-05-21T14:00:00.000Z',
  finalAnswer: 'Noise was the top complaint type.',
  toolCalls: [
    {
      name: 'get_data',
      operationType: 'query',
      args: {
        type: 'query',
        portal: 'data.cityofnewyork.us',
        dataset_id: 'erm2-nwe9',
        select: 'complaint_type, count(*) as count',
        group: 'complaint_type',
        order: 'count DESC',
        limit: 5,
      },
      reason: 'to aggregate by complaint_type',
      resultSummary: { rows: 5, columns: 2 },
    },
  ],
} as const;

function makeExecutedNotebook(captureLine: string) {
  const synth = synthesizeNotebook({ ...BASE_INPUTS });
  // Find the metric-capture cell (the last code cell before synthesis) and
  // pretend the sandbox ran it.
  for (const cell of synth.notebook.cells) {
    if (cell.cell_type !== 'code') continue;
    const src = cell.source.join('');
    if (src.includes('_civic_capture=" + _json.dumps')) {
      cell.outputs = [{ output_type: 'stream', name: 'stdout', text: captureLine }];
      cell.execution_count = 1;
      break;
    }
  }
  return synth;
}

test('extractCapturedMetrics: parses the _civic_capture=… stdout line', () => {
  const captureLine =
    '_civic_capture=' +
    JSON.stringify({
      df1: { rows: 5, head: [{ complaint_type: 'Noise - Residential', count: 1234 }] },
    });
  const { notebook } = makeExecutedNotebook(captureLine);
  const metrics = extractCapturedMetrics(notebook);
  assert.deepEqual(metrics.byDataFrame.df1.rows, 5);
  assert.equal(metrics.byDataFrame.df1.head[0].complaint_type, 'Noise - Residential');
});

test('extractCapturedMetrics: returns empty payload when the capture line is absent', () => {
  const synth = synthesizeNotebook({ ...BASE_INPUTS });
  const metrics = extractCapturedMetrics(synth.notebook);
  assert.deepEqual(metrics.byDataFrame, {});
});

test('stampExecutedNotebook: appends comparison cell + stamps execution extension', () => {
  const captureLine =
    '_civic_capture=' +
    JSON.stringify({
      df1: { rows: 5, head: [{ complaint_type: 'Noise - Residential', count: 1234 }] },
    });
  const { notebook, dataFrameVariables } = makeExecutedNotebook(captureLine);
  const result = stampExecutedNotebook(
    notebook,
    {
      executedAt: '2026-05-21T14:23:45.000Z',
      executionDuration_ms: 12340,
      sandboxId: 'vrcl-sbx-abc123',
    },
    dataFrameVariables,
  );

  // Comparison cell present at the end.
  const lastCell = result.notebook.cells[result.notebook.cells.length - 1];
  const compSrc = lastCell.source.join('');
  assert.match(compSrc, /ORIGINAL VALUES/);
  assert.match(compSrc, /"df1_n_rows": 5/);
  assert.match(compSrc, /"df1_row0_complaint_type": "Noise - Residential"/);
  assert.match(compSrc, /"df1_row0_count": 1234/);
  assert.match(compSrc, /def recompute_key_metrics/);
  assert.ok(result.comparisonCellPresent);

  // Execution extension stamped.
  const ext = (result.notebook.metadata.extensions as Record<string, unknown>)[EXECUTION_EXTENSION_KEY] as Record<string, unknown>;
  assert.equal(ext.executedAt, '2026-05-21T14:23:45.000Z');
  assert.equal(ext.executionDuration_ms, 12340);
  assert.equal(ext.sandboxId, 'vrcl-sbx-abc123');
  assert.equal(ext.comparisonCellPresent, true);
  const env = ext.environment as Record<string, unknown>;
  assert.equal(env.python, '3.13');
  assert.ok((env.libraries as Record<string, string>).pandas);

  // Notebook provenance still set.
  const nbExt = (result.notebook.metadata.extensions as Record<string, unknown>)[NOTEBOOK_EXTENSION_KEY] as Record<string, unknown>;
  assert.equal(nbExt.provenance, 'executed');
});

test('stampExecutedNotebook: empty metric capture still produces a valid comparison cell', () => {
  const synth = synthesizeNotebook({ ...BASE_INPUTS });
  const result = stampExecutedNotebook(
    synth.notebook,
    { executedAt: '2026-05-21T14:23:45.000Z', executionDuration_ms: 5000 },
    synth.dataFrameVariables,
  );
  const compSrc = result.notebook.cells[result.notebook.cells.length - 1].source.join('');
  assert.match(compSrc, /original = \{\}/);
  assert.equal(result.comparisonCellPresent, false);

  const ext = (result.notebook.metadata.extensions as Record<string, unknown>)[EXECUTION_EXTENSION_KEY] as Record<string, unknown>;
  assert.equal(ext.comparisonCellPresent, false);
});

test('validateExecutedNotebook: stamped notebook passes validation', () => {
  const captureLine =
    '_civic_capture=' +
    JSON.stringify({
      df1: { rows: 5, head: [{ complaint_type: 'Noise - Residential', count: 1234 }] },
    });
  const { notebook, dataFrameVariables } = makeExecutedNotebook(captureLine);
  stampExecutedNotebook(
    notebook,
    { executedAt: '2026-05-21T14:23:45.000Z', executionDuration_ms: 12340 },
    dataFrameVariables,
  );
  const result = validateExecutedNotebook(notebook);
  assert.deepEqual(result.issues, [], `unexpected validation issues: ${JSON.stringify(result.issues)}`);
  assert.ok(result.ok);
});

test('validateExecutedNotebook: unstamped notebook fails on the execution extension', () => {
  const { notebook } = synthesizeNotebook({ ...BASE_INPUTS });
  const result = validateExecutedNotebook(notebook);
  assert.equal(result.ok, false);
  const messages = result.issues.map(i => i.message).join(' | ');
  assert.match(messages, /extension missing/);
});
