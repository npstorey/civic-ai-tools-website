// Renderer-side classifier tests. Run with: npm test
//
// These tests verify that the renderer correctly partitions an
// executed-notebook produced by the Phase 1 backend pipeline. Running it
// against the real `synthesizeNotebook` + `stampExecutedNotebook` keeps the
// classifier's structural assumptions tied to the synthesizer's actual
// output shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCells } from './classify-cells.ts';
import { stampExecutedNotebook } from '../../lib/notebook-author/phase-d.ts';
import { synthesizeNotebook } from '../../lib/notebook-author/synthesize.ts';

const SYNTH_INPUTS = {
  query: 'Top 5 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  finalAnswer: 'Noise was the top complaint type.',
  generatedAt: '2026-05-21T14:00:00.000Z',
  toolCalls: [
    {
      name: 'get_data' as const,
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
      reason: 'aggregate by complaint_type',
      resultSummary: { rows: 5, columns: 2 },
    },
  ],
};

function makeStampedNotebook() {
  const synth = synthesizeNotebook({ ...SYNTH_INPUTS });
  for (const cell of synth.notebook.cells) {
    if (cell.cell_type !== 'code') continue;
    const src = cell.source.join('');
    if (src.includes('_civic_capture=" + _json.dumps')) {
      cell.outputs = [{
        output_type: 'stream',
        name: 'stdout',
        text: '_civic_capture=' + JSON.stringify({
          df1: { rows: 5, head: [{ complaint_type: 'Noise - Residential', count: 1234 }] },
        }),
      }];
      cell.execution_count = 1;
    }
  }
  stampExecutedNotebook(
    synth.notebook,
    { executedAt: '2026-05-21T14:23:45.000Z', executionDuration_ms: 12340, sandboxId: 'vrcl-sbx-abc' },
    synth.dataFrameVariables,
  );
  return synth.notebook;
}

test('classifyCells: partitions a stamped executed notebook', () => {
  const notebook = makeStampedNotebook();
  const { setup, analysis, synthesis, footer, comparison } = classifyCells(notebook);

  // Setup region — cell 0 (markdown onboarding) + cells 1-3 (env, imports, helpers).
  assert.equal(setup.length, 4);
  assert.equal(setup[0].cell_type, 'markdown');
  assert.match(setup[0].source.join(''), /Civic AI Data Analysis/);
  assert.equal(setup[1].cell_type, 'code'); // env
  assert.equal(setup[2].cell_type, 'code'); // imports
  assert.equal(setup[3].cell_type, 'code'); // helpers

  // Analysis region begins with the "Data Analysis Pipeline" header.
  assert.ok(analysis.length >= 2, `expected analysis cells, got ${analysis.length}`);
  assert.equal(analysis[0].cell_type, 'markdown');
  assert.match(analysis[0].source.join(''), /Data Analysis Pipeline/);

  // No metric-capture or comparison-header cells slip into the analysis region.
  for (const cell of analysis) {
    const src = cell.source.join('');
    assert.ok(!src.includes('_civic_capture=" + _json.dumps'), 'metric-capture cell leaked into analysis region');
    assert.ok(!/^\s*##\s+Comparison:/m.test(src), 'comparison header markdown leaked into analysis region');
  }

  // Synthesis cell — the "## Synthesis" markdown.
  assert.ok(synthesis !== null, 'synthesis cell not detected');
  assert.match(synthesis!.source.join(''), /## Synthesis/);

  // Footer cell — citations + reproducibility.
  assert.ok(footer !== null, 'footer cell not detected');
  const footerSrc = footer!.source.join('');
  assert.match(footerSrc, /## Citations/);
  assert.match(footerSrc, /## Reproducibility/);

  // Comparison cell — the appended code cell.
  assert.ok(comparison !== null, 'comparison cell not detected');
  const compSrc = comparison!.source.join('');
  assert.match(compSrc, /ORIGINAL VALUES/);
  assert.match(compSrc, /recompute_key_metrics/);
});
