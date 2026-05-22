// Phase B synthesis tests — exercise the deterministic notebook-assembly
// path the executed-notebook pipeline (ADR-0005 §1) runs before sandbox
// execution. No Vercel Sandbox calls; pure-function output validation.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeNotebook } from './synthesize.ts';
import { NOTEBOOK_EXTENSION_KEY, PYTHON_RUNTIME_VERSION } from './prompt.ts';

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
  // env setup + imports + helpers + (fetching cell) + metric-capture
  assert.equal(codeCells.length, 5);
  const fetchCell = codeCells[3].source.join('');
  assert.match(fetchCell, /df1 = fetch_socrata\(/);
  assert.match(fetchCell, /portal="data\.cityofnewyork\.us"/);
  assert.match(fetchCell, /dataset_id="erm2-nwe9"/);
  assert.match(fetchCell, /select="complaint_type, count\(\*\) as count"/);
  assert.match(fetchCell, /group="complaint_type"/);
  assert.deepEqual(out.dataFrameVariables, ['df1']);
});

test('synthesizeNotebook: metric-capture cell precedes the synthesis cell', () => {
  const out = synthesizeNotebook({ ...BROOKLYN_311_FIXTURE });
  const cellTexts = out.notebook.cells.map(c => c.source.join(''));
  const captureIdx = cellTexts.findIndex(t => t.includes('_civic_capture'));
  const synthIdx = cellTexts.findIndex(t => t.startsWith('## Synthesis'));
  assert.ok(captureIdx > 0, 'metric-capture cell missing');
  assert.ok(synthIdx > captureIdx, 'synthesis cell must follow metric-capture');
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
