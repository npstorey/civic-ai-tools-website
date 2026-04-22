// Tests for the M9.3 PROV-O agent pruning behaviour. Before M9.3 the builder
// always emitted a `mcp-server:socrata` agent whenever a skill was fetched,
// which mislabelled Data-Commons-only analyses with a Socrata source that was
// never actually invoked. These tests lock in the new rule: an MCP agent
// appears in the graph only when at least one tool call in the trace reported
// that source.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProvenanceGraph } from './provenance.ts';

interface SpanStub {
  name: string;
  spanId?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>;
}

function traceOf(spans: SpanStub[]): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        scopeSpans: [{ spans }],
      },
    ],
  };
}

function attrs(map: Record<string, string>): SpanStub['attributes'] {
  return Object.entries(map).map(([key, stringValue]) => ({ key, value: { stringValue } }));
}

function skillSpan(hash: string): SpanStub {
  return {
    name: 'skill_fetch',
    attributes: attrs({
      'skill.text_hash': hash,
      'skill.mcp_server_url': 'https://socrata-mcp.civicaitools.org',
    }),
  };
}

function toolSpan(source: string, toolName: string, spanId: string): SpanStub {
  return {
    name: 'mcp_tool_call',
    spanId,
    startTimeUnixNano: '1700000000000000000',
    endTimeUnixNano: '1700000001000000000',
    attributes: attrs({
      'mcp.source': source,
      'tool.name': toolName,
      'tool.operation_type': 'query',
      'tool.arguments': '{}',
    }),
  };
}

const BASE_INPUT = {
  packageId: 'pkg-123',
  promptHash: 'abc123',
  outputText: 'hello world',
  model: 'openai/gpt-4o',
  portal: 'data.cityofnewyork.us',
};

function mcpAgents(graph: Array<{ '@id': string; [k: string]: unknown }>): string[] {
  return graph
    .filter((node) => typeof node['@id'] === 'string' && node['@id'].startsWith('urn:civic-evidence:mcp-server:'))
    .map((node) => node['@id'] as string);
}

test('Data-Commons-only analysis emits only the data-commons MCP agent', () => {
  const trace = traceOf([skillSpan('skill-hash'), toolSpan('data-commons', 'get_observations', 'span-1')]);
  const graph = buildProvenanceGraph(trace, BASE_INPUT);
  const agents = mcpAgents(graph['@graph']);
  assert.deepEqual(agents, ['urn:civic-evidence:mcp-server:data-commons']);
});

test('Socrata-only analysis emits only the socrata MCP agent', () => {
  const trace = traceOf([skillSpan('skill-hash'), toolSpan('socrata', 'get_data', 'span-1')]);
  const graph = buildProvenanceGraph(trace, BASE_INPUT);
  const agents = mcpAgents(graph['@graph']);
  assert.deepEqual(agents, ['urn:civic-evidence:mcp-server:socrata']);
});

test('Multi-source analysis emits both MCP agents', () => {
  const trace = traceOf([
    skillSpan('skill-hash'),
    toolSpan('socrata', 'get_data', 'span-1'),
    toolSpan('data-commons', 'get_observations', 'span-2'),
  ]);
  const graph = buildProvenanceGraph(trace, BASE_INPUT);
  const agents = mcpAgents(graph['@graph']);
  assert.equal(agents.length, 2);
  assert.ok(agents.includes('urn:civic-evidence:mcp-server:socrata'));
  assert.ok(agents.includes('urn:civic-evidence:mcp-server:data-commons'));
});

test('Boston OpenContext only analysis emits only the boston-opencontext MCP agent with correct title', () => {
  const trace = traceOf([skillSpan('skill-hash'), toolSpan('boston-opencontext', 'ckan__search_datasets', 'span-1')]);
  const graph = buildProvenanceGraph(trace, BASE_INPUT);
  const agents = mcpAgents(graph['@graph']);
  assert.deepEqual(agents, ['urn:civic-evidence:mcp-server:boston-opencontext']);

  const bostonAgentNode = graph['@graph'].find(
    (n) => n['@id'] === 'urn:civic-evidence:mcp-server:boston-opencontext',
  );
  assert.ok(bostonAgentNode, 'expected Boston OpenContext agent node in graph');
  assert.equal(bostonAgentNode!['dcterms:title'], 'Boston OpenContext MCP Server');
  assert.equal(bostonAgentNode!['civic:serverUrl'], 'https://data-mcp.boston.gov/mcp');
  assert.equal(bostonAgentNode!['civic:sourceId'], 'boston-opencontext');
});

test('Three-source analysis emits all three MCP agents, no stray sources', () => {
  const trace = traceOf([
    skillSpan('skill-hash'),
    toolSpan('socrata', 'get_data', 'span-1'),
    toolSpan('data-commons', 'get_observations', 'span-2'),
    toolSpan('boston-opencontext', 'ckan__aggregate_data', 'span-3'),
  ]);
  const graph = buildProvenanceGraph(trace, BASE_INPUT);
  const agents = mcpAgents(graph['@graph']);
  assert.equal(agents.length, 3);
  assert.ok(agents.includes('urn:civic-evidence:mcp-server:socrata'));
  assert.ok(agents.includes('urn:civic-evidence:mcp-server:data-commons'));
  assert.ok(agents.includes('urn:civic-evidence:mcp-server:boston-opencontext'));
});

test('Skill fetched but no tool calls emits no MCP agent', () => {
  // Regression: pre-M9.3 behaviour always added a socrata agent here even
  // though nothing was ever queried. New rule: no tool calls → no MCP agent.
  const trace = traceOf([skillSpan('skill-hash')]);
  const graph = buildProvenanceGraph(trace, BASE_INPUT);
  assert.deepEqual(mcpAgents(graph['@graph']), []);
});

test('Pre-M9.1 Socrata span without mcp.source attribute still emits the socrata agent', () => {
  // Backwards compat: evidence records published before M9.1 have no
  // `mcp.source` attribute on tool spans. The builder should default those
  // to socrata so the graph still has a valid agent for the tool call.
  const legacyToolSpan: SpanStub = {
    name: 'mcp_tool_call',
    spanId: 'legacy-1',
    startTimeUnixNano: '1700000000000000000',
    endTimeUnixNano: '1700000001000000000',
    attributes: attrs({
      'tool.name': 'get_data',
      'tool.operation_type': 'query',
      'tool.arguments': '{}',
    }),
  };
  const trace = traceOf([skillSpan('skill-hash'), legacyToolSpan]);
  const graph = buildProvenanceGraph(trace, BASE_INPUT);
  assert.deepEqual(mcpAgents(graph['@graph']), ['urn:civic-evidence:mcp-server:socrata']);
});
