// Unit tests for the M9.3 multi-source dataSources extraction used by the
// evidence packager. These verify:
//   - A Socrata-only analysis still produces the same-shape dataSources array
//     it produced pre-M9.3, with the additive `sourceId: 'socrata'` field.
//   - A multi-source analysis emits distinct entries tagged with `sourceId`.
//   - Unknown/missing sources on spans fall back via the tool-name map so the
//     provenance chain stays intact.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDataSources,
  resolveToolSource,
  type ToolCallSummary,
} from './data-sources.ts';

interface SpanStub {
  name: string;
  attributes: Array<{ key: string; value: { stringValue?: string } }>;
}

function traceWithToolSpans(spans: SpanStub[]): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        scopeSpans: [{ spans }],
      },
    ],
  };
}

function toolSpan(source: string, attrs: Record<string, string> = {}): SpanStub {
  const allAttrs: Record<string, string> = { 'mcp.source': source, ...attrs };
  return {
    name: 'mcp_tool_call',
    attributes: Object.entries(allAttrs).map(([key, stringValue]) => ({
      key,
      value: { stringValue },
    })),
  };
}

const NOW = '2026-04-16T00:00:00.000Z';

test('Socrata-only: one entry per unique dataset_id, tagged sourceId=socrata', () => {
  const toolCalls: ToolCallSummary[] = [
    {
      name: 'get_data',
      args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
    },
    {
      name: 'get_data',
      args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
    }, // duplicate dataset — should be deduped
    {
      name: 'get_data',
      args: { type: 'metadata', portal: 'data.cityofnewyork.us', dataset_id: '43nn-pn8j' },
    },
  ];
  const trace = traceWithToolSpans([
    toolSpan('socrata', { 'tool.dataset_id': 'erm2-nwe9', 'tool.portal_domain': 'data.cityofnewyork.us' }),
    toolSpan('socrata', { 'tool.dataset_id': 'erm2-nwe9', 'tool.portal_domain': 'data.cityofnewyork.us' }),
    toolSpan('socrata', { 'tool.dataset_id': '43nn-pn8j', 'tool.portal_domain': 'data.cityofnewyork.us' }),
  ]);

  const entries = buildDataSources(toolCalls, trace, 'data.cityofnewyork.us', NOW);

  assert.equal(entries.length, 2);
  const first = entries[0];
  assert.equal(first.sourceId, 'socrata');
  assert.equal(first.catalogType, 'socrata');
  assert.equal(first.portalUrl, 'https://data.cityofnewyork.us');
  assert.equal(first.datasetId, 'erm2-nwe9');
  assert.equal(first.datasetUrl, 'https://data.cityofnewyork.us/d/erm2-nwe9');
  assert.equal(first.accessTimestamp, NOW);
  for (const entry of entries) {
    assert.ok(entry.sourceId, `entry is missing sourceId: ${JSON.stringify(entry)}`);
  }
});

test('Data Commons only: emits a single aggregate entry tagged sourceId=data-commons', () => {
  const toolCalls: ToolCallSummary[] = [
    { name: 'search_indicators', args: { query: 'median household income' } },
    {
      name: 'get_observations',
      args: { variable_dcid: 'Median_Income_Household', place_dcid: 'geoId/36061' },
    },
  ];
  const trace = traceWithToolSpans([toolSpan('data-commons'), toolSpan('data-commons')]);

  const entries = buildDataSources(toolCalls, trace, 'data.cityofnewyork.us', NOW);

  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.sourceId, 'data-commons');
  assert.equal(entry.catalogType, 'data-commons');
  assert.equal(entry.portalUrl, 'https://api.datacommons.org/mcp');
  // No per-dataset identifier for DC — the knowledge graph isn't dataset-keyed.
  assert.equal(entry.datasetId, undefined);
  assert.equal(entry.datasetUrl, undefined);
});

test('Multi-source: Socrata + Data Commons in one analysis produce distinct entries', () => {
  const toolCalls: ToolCallSummary[] = [
    { name: 'search_indicators', args: { query: 'median household income' } },
    {
      name: 'get_observations',
      args: { variable_dcid: 'Median_Income_Household', place_dcid: 'geoId/36061' },
    },
    {
      name: 'get_data',
      args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
    },
  ];
  const trace = traceWithToolSpans([
    toolSpan('data-commons'),
    toolSpan('data-commons'),
    toolSpan('socrata', { 'tool.dataset_id': 'erm2-nwe9', 'tool.portal_domain': 'data.cityofnewyork.us' }),
  ]);

  const entries = buildDataSources(toolCalls, trace, 'data.cityofnewyork.us', NOW);

  assert.equal(entries.length, 2);
  const socrataEntry = entries.find((s) => s.sourceId === 'socrata');
  const dcEntry = entries.find((s) => s.sourceId === 'data-commons');
  assert.ok(socrataEntry, 'missing socrata dataSource entry');
  assert.ok(dcEntry, 'missing data-commons dataSource entry');
  assert.equal(socrataEntry!.datasetId, 'erm2-nwe9');
  assert.equal(dcEntry!.portalUrl, 'https://api.datacommons.org/mcp');
});

test('Empty trace falls back to tool-name source mapping (Socrata)', () => {
  // `/api/evidence/test/route.ts` ships an empty trace. The static tool-name
  // map should still identify `get_data` as Socrata so the existing test
  // scaffolding keeps producing a valid dataSources entry.
  const toolCalls: ToolCallSummary[] = [
    {
      name: 'get_data',
      args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
    },
  ];
  const trace = { resourceSpans: [] };

  const entries = buildDataSources(toolCalls, trace, 'data.cityofnewyork.us', NOW);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceId, 'socrata');
  assert.equal(entries[0].datasetId, 'erm2-nwe9');
});

test('Empty trace falls back to tool-name mapping (Data Commons)', () => {
  const toolCalls: ToolCallSummary[] = [
    {
      name: 'get_observations',
      args: { variable_dcid: 'Count_Person', place_dcid: 'country/USA' },
    },
  ];
  const trace = { resourceSpans: [] };

  const entries = buildDataSources(toolCalls, trace, 'data.cityofnewyork.us', NOW);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceId, 'data-commons');
});

test('Regression: Socrata-only entry shape is backward-compatible (new sourceId is additive)', () => {
  // The shape must contain every field the pre-M9.3 code produced, plus the
  // new additive `sourceId`. Downstream consumers that ignore unknown fields
  // continue to work.
  const toolCalls: ToolCallSummary[] = [
    {
      name: 'get_data',
      args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
    },
  ];
  const trace = traceWithToolSpans([
    toolSpan('socrata', { 'tool.dataset_id': 'erm2-nwe9', 'tool.portal_domain': 'data.cityofnewyork.us' }),
  ]);

  const entries = buildDataSources(toolCalls, trace, 'data.cityofnewyork.us', NOW);

  assert.equal(entries.length, 1);
  const entry = entries[0];
  const expectedKeys = ['sourceId', 'catalogType', 'portalUrl', 'datasetId', 'datasetUrl', 'accessTimestamp'];
  for (const key of expectedKeys) {
    assert.ok(key in entry, `Socrata entry missing expected key: ${key}`);
  }
});

test('Trace span mcp.source wins over tool-name mapping when they disagree', () => {
  // Defensive: if a trace span somehow tags `get_data` as data-commons
  // (should never happen in practice), trust the trace — it's the M9.1 source
  // of truth. This keeps the invariant simple: trace → fallback → fallback.
  const tc: ToolCallSummary = {
    name: 'get_data',
    args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
  };
  const span = toolSpan('data-commons');
  assert.equal(resolveToolSource(tc, span), 'data-commons');
});

test('Unknown tool with no trace span defaults to socrata (pre-M9.1 backward compat)', () => {
  const tc: ToolCallSummary = { name: 'mystery_tool', args: {} };
  assert.equal(resolveToolSource(tc, undefined), 'socrata');
});
