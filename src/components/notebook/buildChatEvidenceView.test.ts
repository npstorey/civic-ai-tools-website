// Phase 2a1 — mapper tests. Run with: npm test
//
// Exercise the synthesis-cell extraction + summary derivation against the
// real Phase 1 synthesizer output so any structural drift between the
// synthesizer and the chat-output mapper is caught at test time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatEvidenceView } from './buildChatEvidenceView.ts';
import { stampExecutedNotebook } from '../../lib/notebook-author/phase-d.ts';
import { synthesizeNotebook } from '../../lib/notebook-author/synthesize.ts';

const SYNTH_INPUTS = {
  query: 'Top 5 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  finalAnswer:
    'Noise — Residential was the top complaint at 1,234 cases over the past 30 days. Illegal Parking and Blocked Driveway followed.',
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

function makeNotebook() {
  const synth = synthesizeNotebook({ ...SYNTH_INPUTS });
  stampExecutedNotebook(
    synth.notebook,
    {
      executedAt: '2026-05-21T14:23:45.000Z',
      executionDuration_ms: 12340,
      sandboxId: 'vrcl-sbx-abc',
    },
    synth.dataFrameVariables,
  );
  return synth.notebook;
}

test('buildChatEvidenceView: extracts synthesis markdown and a one-line summary', () => {
  const notebook = makeNotebook();
  const view = buildChatEvidenceView({
    notebook,
    prompt: SYNTH_INPUTS.query,
    model: SYNTH_INPUTS.modelName,
    portal: SYNTH_INPUTS.defaultPortal,
    toolCalls: [
      { name: 'get_data', operationType: 'query', reason: 'aggregate', resultSummary: { rows: 5, columns: 2 } },
    ],
  });

  assert.match(view.synthesisMarkdown, /Noise — Residential was the top complaint/);
  assert.ok(view.summary.length > 0, 'summary should be non-empty');
  assert.ok(view.summary.length <= 240, `summary too long: ${view.summary.length}`);
  assert.match(view.summary, /Noise — Residential/);
});

test('buildChatEvidenceView: surfaces the execution extension', () => {
  const notebook = makeNotebook();
  const view = buildChatEvidenceView({
    notebook,
    prompt: SYNTH_INPUTS.query,
    model: SYNTH_INPUTS.modelName,
    portal: SYNTH_INPUTS.defaultPortal,
    toolCalls: [],
  });

  assert.equal(view.executedAt, '2026-05-21T14:23:45.000Z');
  assert.equal(view.executionDurationMs, 12340);
  assert.equal(view.sandboxId, 'vrcl-sbx-abc');
  assert.equal(view.environment?.python, '3.13');
  assert.ok(view.environment?.libraries?.pandas);
});

test('buildChatEvidenceView: empty synthesis yields empty summary', () => {
  const notebook = makeNotebook();
  // Wipe the synthesis cell content.
  for (const cell of notebook.cells) {
    if (cell.cell_type === 'markdown') {
      const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source as string);
      if (/^##\s+Synthesis\b/m.test(src)) {
        cell.source = ['## Synthesis\n', '\n'];
      }
    }
  }
  const view = buildChatEvidenceView({
    notebook,
    prompt: SYNTH_INPUTS.query,
    model: SYNTH_INPUTS.modelName,
    portal: SYNTH_INPUTS.defaultPortal,
    toolCalls: [],
  });
  assert.equal(view.synthesisMarkdown, '');
  assert.equal(view.summary, '');
});
