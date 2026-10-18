// Phase 2a1 + 2a2 — mapper tests. Run with: npm test
//
// Exercise the rendering-cell extraction + structured-summary read against the
// real Phase 1 synthesizer output so any structural drift between the
// synthesizer and the chat-output mapper is caught at test time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approximateMcpServers, buildChatEvidenceView } from './buildChatEvidenceView.ts';
import { stampExecutedNotebook } from '../../lib/notebook-author/phase-d.ts';
import { synthesizeNotebook } from '../../lib/notebook-author/synthesize.ts';
import { SYNTHESIS_CELL_ROLE } from '../../lib/notebook-author/prompt.ts';
import { modelAccessPhrase } from '../../lib/model-catalog.ts';

const LLM_STRUCTURED_ANSWER = [
  '```json',
  '{',
  '  "analysisDescription": "Top 5 complaint types in Brooklyn (last 30 days).",',
  '  "headlineFinding": "Noise — Residential led with 1,234 cases."',
  '}',
  '```',
  '',
  '```python',
  'print(f"Noise — Residential led with {df1.iloc[0][\'count\']:,} cases.")',
  'display(Markdown("- Illegal Parking and Blocked Driveway followed."))',
  '```',
].join('\n');

const SYNTH_INPUTS = {
  query: 'Top 5 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  modelAccess: modelAccessPhrase('openai-compatible'),
  finalAnswer: LLM_STRUCTURED_ANSWER,
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

function makeNotebook(opts: { finalAnswer?: string; withExecutedOutputs?: boolean } = {}) {
  const synth = synthesizeNotebook({
    ...SYNTH_INPUTS,
    finalAnswer: opts.finalAnswer ?? SYNTH_INPUTS.finalAnswer,
  });
  if (opts.withExecutedOutputs) {
    // Simulate the sandbox having executed the synthesis cell — attach a
    // display_data output with text/markdown so the mapper's
    // renderingCellOutputs array is non-empty.
    for (const cell of synth.notebook.cells) {
      if (cell.cell_type !== 'code') continue;
      const role = (cell.metadata as Record<string, unknown>)?.role;
      if (role !== SYNTHESIS_CELL_ROLE) continue;
      cell.outputs = [
        { output_type: 'stream', name: 'stdout', text: 'Noise — Residential led with 1,234 cases.\n' },
        {
          output_type: 'display_data',
          data: { 'text/markdown': '- Illegal Parking and Blocked Driveway followed.' },
        },
      ];
      cell.execution_count = 7;
    }
  }
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

test('buildChatEvidenceView: extracts rendering-cell outputs verbatim when synthesis-role code cell is present', () => {
  const notebook = makeNotebook({ withExecutedOutputs: true });
  const view = buildChatEvidenceView({
    notebook,
    prompt: SYNTH_INPUTS.query,
    model: SYNTH_INPUTS.modelName,
    portal: SYNTH_INPUTS.defaultPortal,
    toolCalls: [
      { name: 'get_data', operationType: 'query', reason: 'aggregate', resultSummary: { rows: 5, columns: 2 } },
    ],
  });

  assert.ok(view.renderingCellOutputs, 'rendering-cell outputs should be present');
  assert.equal(view.renderingCellOutputs?.length, 2);
  assert.equal(view.renderingCellOutputs?.[0].output_type, 'stream');
  assert.equal(view.renderingCellOutputs?.[1].output_type, 'display_data');
  // synthesisMarkdown is only populated as a legacy fallback; when the
  // rendering code cell is present, the renderer uses outputs verbatim.
  assert.equal(view.synthesisMarkdown, '');
});

test('buildChatEvidenceView: surfaces the structured summary from notebook root metadata', () => {
  const notebook = makeNotebook({ withExecutedOutputs: true });
  const view = buildChatEvidenceView({
    notebook,
    prompt: SYNTH_INPUTS.query,
    model: SYNTH_INPUTS.modelName,
    portal: SYNTH_INPUTS.defaultPortal,
    toolCalls: [],
  });

  assert.ok(view.structuredSummary, 'structured summary should be present');
  assert.equal(view.structuredSummary?.analysisDescription, 'Top 5 complaint types in Brooklyn (last 30 days).');
  assert.match(view.structuredSummary?.headlineFinding ?? '', /Noise — Residential led with 1,234 cases\./);
});

test('buildChatEvidenceView: surfaces the execution extension + streaming-supplied metadata', () => {
  const notebook = makeNotebook({ withExecutedOutputs: true });
  const view = buildChatEvidenceView({
    notebook,
    prompt: SYNTH_INPUTS.query,
    model: SYNTH_INPUTS.modelName,
    portal: SYNTH_INPUTS.defaultPortal,
    toolCalls: [],
    composedSystemPrompt: 'Some composed prompt text…',
    composedSystemPromptHash: 'deadbeef00000000ffffffff00000000aaaaaaaabbbbbbbbccccccccdddddddd',
    signingKeyId: 'platform:evidence-2026-04',
  });

  assert.equal(view.executedAt, '2026-05-21T14:23:45.000Z');
  assert.equal(view.executionDurationMs, 12340);
  assert.equal(view.sandboxId, 'vrcl-sbx-abc');
  assert.equal(view.environment?.python, '3.13');
  assert.ok(view.environment?.libraries?.pandas);
  assert.equal(view.composedSystemPrompt, 'Some composed prompt text…');
  assert.equal(view.composedSystemPromptHash, 'deadbeef00000000ffffffff00000000aaaaaaaabbbbbbbbccccccccdddddddd');
  assert.equal(view.signingKeyId, 'platform:evidence-2026-04');
});

test('buildChatEvidenceView: fallback path — LLM omits structured blocks → renderingCellOutputs is the empty array (cell exists, no outputs)', () => {
  // Without a ```python``` block, the synthesizer still emits the synthesis
  // code cell (using the display(Markdown(rawAnswer)) fallback), but the
  // cell has no outputs because we didn't simulate execution.
  const notebook = makeNotebook({ finalAnswer: 'Plain LLM prose, no fences here.' });
  const view = buildChatEvidenceView({
    notebook,
    prompt: SYNTH_INPUTS.query,
    model: SYNTH_INPUTS.modelName,
    portal: SYNTH_INPUTS.defaultPortal,
    toolCalls: [],
  });
  // The cell is present; outputs array is empty pre-execution.
  assert.deepEqual(view.renderingCellOutputs, []);
  assert.equal(view.structuredSummary, null);
  // No structured summary present → derivedSummary is empty too (no legacy
  // markdown cell to derive from now that synthesis is a code cell).
  assert.equal(view.derivedSummary, '');
});

test('#258 C5: approximateMcpServers shows the configured host and omits on honest absence', () => {
  // Configured: the host of the SERVER-RESOLVED SOCRATA_MCP_URL (threaded
  // through McpRoutingProvider), never a NEXT_PUBLIC_* twin or a fallback.
  assert.deepEqual(
    approximateMcpServers('data.cityofnewyork.us', 'https://socrata-mcp.example.org'),
    ['socrata-mcp.example.org'],
  );
  // Unconfigured (null): empty list — the "MCP servers" row is omitted
  // rather than showing a host this instance never configured.
  assert.deepEqual(approximateMcpServers('data.cityofnewyork.us', null), []);
  // The all-portals sentinel never lists a server, configured or not.
  assert.deepEqual(approximateMcpServers('__all__', 'https://socrata-mcp.example.org'), []);
  // An unparseable value passes through as-is (still the configured value).
  assert.deepEqual(approximateMcpServers('data.cityofnewyork.us', 'not a url'), ['not a url']);
});
