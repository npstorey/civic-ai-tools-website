// #599 W3, for the records published between W3 and W4: each call is
// attributed to its own source.
//
// The pinned harness (0.5.0, until W4) resolves a call's source from the span's
// `mcp.source` attribute first, then from its own tool-name map, which knows
// the eleven BARE names only, and then falls back to Socrata (ADR-0033 §A, the
// fallback W4's harness removes). After W3 the model calls aliased names, so a
// record made between W3 and W4 attributes each call correctly ONLY because the
// loop tags every `mcp_tool_call` span with the routed source.
//
// THE SHAPE THAT COULD FAIL: aliased calls to Data Commons and to Boston
// OpenContext, and NO Socrata call. A Socrata fallback is invisible in a run
// that also called Socrata; here it would put an agent in the graph the run
// never reached.
//
// The record is made the way a query route makes it: the real loop core with
// the routes' `resolveToolSource` (`routedSourceId`), the real trace builder,
// the real packager. The last test shows the instrument can fail: the same
// trace with `mcp.source` dropped from its spans is misattributed to Socrata by
// the pinned harness, which is what the tag prevents.
//
// RED at 617b18b (W2): `routedSourceId` does not know an aliased name, so the
// spans say `unknown`, which the pinned harness attributes to Socrata.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import { runToolLoop } from '../model-loop/run-tool-loop.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { buildEvidencePackage, type ToolCallInput } from './packager.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';
import { routedSourceId, type McpRegistryEnv } from '../mcp/registry.ts';

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const FULL: McpRegistryEnv = {
  socrataUrl: 'https://socrata.invalid',
  dataCommonsUrl: 'https://data-commons.invalid/mcp',
  bostonOpencontextUrl: 'https://opencontext.invalid/mcp',
};

const CALLS = [
  { id: 'a', name: 'data_commons__search_indicators', args: { query: 'median household income' } },
  { id: 'b', name: 'data_commons__get_observations', args: { variable_dcid: 'Median_Income_Household', place_dcid: 'geoId/2507000' } },
  { id: 'c', name: 'boston__ckan__search_datasets', args: { query: '311 potholes' } },
  { id: 'd', name: 'boston__ckan__query_data', args: { resource_id: 'r-1', filters: { type: 'pothole' } } },
];
const SOURCE_OF: Record<string, string> = {
  data_commons__search_indicators: 'data-commons',
  data_commons__get_observations: 'data-commons',
  boston__ckan__search_datasets: 'boston-opencontext',
  boston__ckan__query_data: 'boston-opencontext',
};

function stubClient(): OpenAI {
  let served = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const first = served++ === 0;
          return {
            id: 'chatcmpl-w3-record',
            object: 'chat.completion',
            created: 1,
            model: 'fake/model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: first ? null : 'Median household income is about $80,000, and the city logged 9 pothole requests.',
                ...(first
                  ? { tool_calls: CALLS.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
                  : {}),
              },
              finish_reason: first ? 'tool_calls' : 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

/** One run the way a query route makes it, and its trace. */
async function makeRun() {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const result = await runToolLoop({
    client: stubClient(),
    endpointModel: 'fake/model',
    requestSettings: undefined,
    prompt: 'Median income and potholes in Boston?',
    systemPrompt: 'Fixture system prompt.',
    tools: [],
    executeToolCall: async () => JSON.stringify({ data: [{ n: 1 }], total_rows: 1 }),
    trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: (name) => routedSourceId(name, FULL) },
  });
  builder.endRoot();
  return { result, trace: builder.finalize() as unknown as Record<string, unknown> };
}

interface GraphNode {
  '@id': string;
  '@type': string | string[];
  'civic:sourceId'?: string;
  'dcterms:description'?: string;
  'prov:wasAssociatedWith'?: { '@id': string };
}

function packageOf(toolCalls: ToolCallInput[], trace: Record<string, unknown>) {
  const { pkg } = buildEvidencePackage({
    trace,
    prompt: 'Median income and potholes in Boston?',
    output: 'Median household income is about $80,000, and the city logged 9 pothole requests.',
    toolCalls,
    model: 'fake/model',
    tokenUsage: { promptTokens: 40, completionTokens: 10 },
    promptVisibility: 'full_text',
    title: 'Boston',
    summary: 'Median income and potholes.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  });
  return JSON.parse(JSON.stringify(pkg)) as {
    queries: Array<{ tool: string }>;
    dataSources: Array<{ sourceId: string }>;
    provenance: { '@graph': GraphNode[] };
  };
}

const toolActivities = (graph: GraphNode[]) =>
  graph.filter((n) => n['@type'] === 'prov:Activity' && (n['dcterms:description'] ?? '').startsWith('MCP tool call'));

function withoutSourceTags(trace: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(trace)) as {
    resourceSpans: { scopeSpans: { spans: { name: string; attributes: { key: string }[] }[] }[] }[];
  };
  for (const rs of copy.resourceSpans) for (const ss of rs.scopeSpans) for (const span of ss.spans) {
    if (span.name === 'mcp_tool_call') span.attributes = span.attributes.filter((a) => a.key !== 'mcp.source');
  }
  return copy as unknown as Record<string, unknown>;
}

test('guard: the run calls Data Commons and Boston OpenContext by their aliased names, and never Socrata', async () => {
  const { result } = await makeRun();
  assert.deepEqual(result.toolCalls.map((c) => c.name), CALLS.map((c) => c.name));
  assert.ok(!result.toolCalls.some((c) => /^socrata__|^(get_data|search|fetch)$/.test(c.name)));
});

test('the record carries the aliased names in toolCalls[].name and queries[].tool', async () => {
  const { result, trace } = await makeRun();
  const pkg = packageOf(result.toolCalls as unknown as ToolCallInput[], trace);
  assert.deepEqual(pkg.queries.map((q) => q.tool), CALLS.map((c) => c.name));
});

test('its provenance graph attributes every call to its own source, and names no Socrata agent', async () => {
  const { result, trace } = await makeRun();
  const pkg = packageOf(result.toolCalls as unknown as ToolCallInput[], trace);
  const graph = pkg.provenance['@graph'];
  const activities = toolActivities(graph);
  assert.equal(activities.length, CALLS.length);
  assert.deepEqual(
    activities.map((a) => a['prov:wasAssociatedWith']?.['@id'].split(':').pop()),
    CALLS.map((c) => SOURCE_OF[c.name]),
    'a call is associated with the wrong source agent',
  );
  assert.deepEqual(activities.map((a) => a['civic:sourceId']), CALLS.map((c) => SOURCE_OF[c.name]));
  assert.ok(!graph.some((n) => n['@id'].endsWith('mcp-server:socrata')), 'the graph names a Socrata agent for a run that never called Socrata');
});

test('its dataSources[] names exactly the two sources it called', async () => {
  const { result, trace } = await makeRun();
  const pkg = packageOf(result.toolCalls as unknown as ToolCallInput[], trace);
  assert.deepEqual(pkg.dataSources.map((d) => d.sourceId).sort(), ['boston-opencontext', 'data-commons']);
});

test('the instrument can fail: with mcp.source dropped from the spans, the pinned harness attributes the aliased calls to Socrata', async () => {
  const { result, trace } = await makeRun();
  const pkg = packageOf(result.toolCalls as unknown as ToolCallInput[], withoutSourceTags(trace));
  const activities = toolActivities(pkg.provenance['@graph']);
  assert.ok(
    activities.some((a) => a['prov:wasAssociatedWith']?.['@id'].endsWith('mcp-server:socrata')),
    'without the tag the aliased calls were still attributed correctly, so the attribution tests above do not depend on the tag; ' +
      'if the harness now resolves aliased names itself (W4), this test has done its job and moves with it',
  );
});
