// Phase B synthesis tests — exercise the deterministic notebook-assembly
// path the executed-notebook pipeline (ADR-0005 §1) runs before sandbox
// execution. No Vercel Sandbox calls; pure-function output validation.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeNotebook } from './synthesize.ts';
import {
  NOTEBOOK_EXTENSION_KEY,
  PYTHON_RUNTIME_VERSION,
  SUMMARY_EXTENSION_KEY,
  SYNTHESIS_CELL_ROLE,
} from './prompt.ts';

const BROOKLYN_311_FIXTURE = {
  query: 'Show me top 5 311 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  generatedAt: '2026-05-21T14:23:45.000Z',
  finalAnswer: 'In Brooklyn over the past 30 days, the top 311 complaint types were Noise — Residential (1,234), Illegal Parking, ...',
  toolCalls: [
    {
      name: 'get_data',
      operationType: 'catalog',
      args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: '311 complaints' },
      reason: 'to find datasets about "311 complaints"',
    },
    {
      name: 'get_data',
      operationType: 'metadata',
      args: { type: 'metadata', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
      reason: 'to understand 311 Service Requests structure',
    },
    {
      name: 'get_data',
      operationType: 'query',
      args: {
        type: 'query',
        portal: 'data.cityofnewyork.us',
        dataset_id: 'erm2-nwe9',
        select: 'complaint_type, count(*) as count',
        where: "borough = 'BROOKLYN' AND created_date >= '2026-04-21T00:00:00.000'",
        group: 'complaint_type',
        order: 'count DESC',
        limit: 5,
      },
      reason: 'to aggregate 311 Service Requests by complaint_type',
      resultSummary: { rows: 5, columns: 2 },
    },
  ],
} as const;

test('synthesizeNotebook: produces an executed-flavor notebook with the expected cell structure', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  const cells = out.notebook.cells;

  // Cell 0: title
  assert.equal(cells[0].cell_type, 'markdown');
  const cell0Source = cells[0].source.join('');
  assert.match(cell0Source, /Civic AI Data Analysis/);
  assert.match(cell0Source, /Show me top 5 311 complaint types/);
  assert.match(cell0Source, /data\.cityofnewyork\.us/);

  // Cell 1: env setup
  assert.equal(cells[1].cell_type, 'code');
  const cell1Source = cells[1].source.join('');
  assert.match(cell1Source, /pip install/);
  assert.match(cell1Source, /pandas==2\.2\.3/);

  // Cell 2: imports
  assert.equal(cells[2].cell_type, 'code');
  assert.match(cells[2].source.join(''), /import pandas as pd/);

  // Cell 3: helpers — fetch_socrata embedded inline
  assert.equal(cells[3].cell_type, 'code');
  const cell3Source = cells[3].source.join('');
  assert.match(cell3Source, /def fetch_socrata/);
  assert.match(cell3Source, /\$select/);
});

test('synthesizeNotebook: discovery-only tool calls collapse into a single summary cell', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  const md = out.notebook.cells.filter(c => c.cell_type === 'markdown').map(c => c.source.join(''));
  const discovery = md.find(t => t.startsWith('### Discovery'));
  assert.ok(discovery, 'expected a "### Discovery" cell summarizing catalog+metadata calls');
  assert.match(discovery!, /catalog/);
  assert.match(discovery!, /metadata/);
});

test('synthesizeNotebook: each fetching call yields a (markdown explainer + code) pair', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  // There is one query tool call; expect exactly one df-producing code cell.
  const codeCells = out.notebook.cells.filter(c => c.cell_type === 'code');
  // env setup + imports + helpers + (fetching cell) + metric-capture + synthesis (Phase 2a2)
  assert.equal(codeCells.length, 6);
  const fetchCell = codeCells[3].source.join('');
  assert.match(fetchCell, /df1 = fetch_socrata\(/);
  assert.match(fetchCell, /portal="data\.cityofnewyork\.us"/);
  assert.match(fetchCell, /dataset_id="erm2-nwe9"/);
  assert.match(fetchCell, /select="complaint_type, count\(\*\) as count"/);
  assert.match(fetchCell, /group="complaint_type"/);
  assert.deepEqual(out.dataFrameVariables, ['df1']);
});

test('synthesizeNotebook: metric-capture cell precedes the synthesis code cell (role marker)', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  const cellTexts = out.notebook.cells.map(c => c.source.join(''));
  const captureIdx = cellTexts.findIndex(t => t.includes('_civic_capture'));
  const synthIdx = out.notebook.cells.findIndex(
    c => c.cell_type === 'code' && (c.metadata as Record<string, unknown>)?.role === SYNTHESIS_CELL_ROLE,
  );
  assert.ok(captureIdx > 0, 'metric-capture cell missing');
  assert.ok(synthIdx > captureIdx, 'synthesis code cell must follow metric-capture');
  // Phase 2a2: synthesis cell is a code cell that produces rendered outputs,
  // not a markdown cell with a `## Synthesis` heading.
  assert.equal(out.notebook.cells[synthIdx].cell_type, 'code');
  const synthSource = out.notebook.cells[synthIdx].source.join('');
  assert.match(synthSource, /from IPython\.display import display, Markdown/);
});

test('synthesizeNotebook: footer carries the dataset citation', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  const footer = out.notebook.cells[out.notebook.cells.length - 1].source.join('');
  assert.match(footer, /## Citations/);
  assert.match(footer, /erm2-nwe9/);
  assert.match(footer, /data\.cityofnewyork\.us\/d\/erm2-nwe9/);
  assert.match(footer, /Python 3\.13/);
  assert.match(footer, /anthropic\/claude-sonnet-4-6/);
});

test('synthesizeNotebook: metadata.extensions stamps notebookProvenance = "executed"', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  const ext = (out.notebook.metadata.extensions as Record<string, unknown>)[NOTEBOOK_EXTENSION_KEY];
  assert.ok(ext && typeof ext === 'object');
  assert.equal((ext as Record<string, unknown>).provenance, 'executed');
});

test('synthesizeNotebook: notebook kernelspec is python3.13', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  assert.equal(out.notebook.metadata.language_info.version, PYTHON_RUNTIME_VERSION);
});

test('synthesizeNotebook: parses LLM ```json``` summary block + ```python``` synthesis block', () => {
  const llmAnswer = [
    '```json',
    '{',
    '  "analysisDescription": "Top 311 complaints in Brooklyn over the past 30 days.",',
    '  "headlineFinding": "Illegal Parking led with 51,438 instances (23%)."',
    '}',
    '```',
    '',
    'And the synthesis cell body:',
    '',
    '```python',
    'print(f"Illegal Parking led with {df1.iloc[0][\'count\']:,} instances.")',
    'display(Markdown("- See `df1` above for the full distribution."))',
    '```',
  ].join('\n');
  const out = synthesizeNotebook({
    ...BROOKLYN_311_FIXTURE,
    finalAnswer: llmAnswer,
  });

  assert.ok(out.summary, 'parsed summary should be present');
  assert.equal(out.summary?.analysisDescription, 'Top 311 complaints in Brooklyn over the past 30 days.');
  assert.match(out.summary?.headlineFinding ?? '', /Illegal Parking led with 51,438 instances/);

  const summaryExt = (out.notebook.metadata.extensions as Record<string, unknown>)[SUMMARY_EXTENSION_KEY];
  assert.ok(summaryExt, 'org.civicaitools.summary should be stamped on metadata');
  assert.equal((summaryExt as Record<string, unknown>).headlineFinding, out.summary?.headlineFinding);

  const synthCell = out.notebook.cells.find(
    c => c.cell_type === 'code' && (c.metadata as Record<string, unknown>)?.role === SYNTHESIS_CELL_ROLE,
  );
  const synthSource = synthCell?.source.join('') ?? '';
  assert.match(synthSource, /print\(f"Illegal Parking led with \{df1\.iloc\[0\]\['count'\]:,\} instances\."\)/);
  assert.match(synthSource, /display\(Markdown\("- See `df1` above for the full distribution\."\)\)/);
});

test('synthesizeNotebook: synthesis cell falls back to display(Markdown(...)) wrapping raw answer when LLM omits ```python``` block', () => {
  const out = synthesizeNotebook({
    ...BROOKLYN_311_FIXTURE,
    finalAnswer: 'Noise was the top complaint at 1,234 cases.',
  });
  const synthCell = out.notebook.cells.find(
    c => c.cell_type === 'code' && (c.metadata as Record<string, unknown>)?.role === SYNTHESIS_CELL_ROLE,
  );
  assert.ok(synthCell, 'synthesis cell must be emitted even in fallback mode');
  const synthSource = synthCell!.source.join('');
  assert.match(synthSource, /display\(Markdown\("Noise was the top complaint at 1,234 cases\.".*\)\)/);
  // No structured summary should be stamped when the LLM didn't emit one.
  assert.equal(out.summary, null);
  const exts = out.notebook.metadata.extensions as Record<string, unknown>;
  assert.equal(exts[SUMMARY_EXTENSION_KEY], undefined);
});
