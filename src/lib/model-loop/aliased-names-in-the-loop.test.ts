// #599 W3: the loop core reads both spellings of a tool name, and every
// `mcp_tool_call` span states both of the call's names and who answered it.
//
// Since W3 the model is offered `socrata__get_data` where every record before
// it says `get_data`, and a model may still call a bare name (one it read in a
// tool result). The loop keys three things on a tool name, and each must fire
// for either spelling:
//
//   - the portal injection into a Socrata `get_data` that names none (#359);
//   - the one-portal lock's refusal of a `get_data` or `fetch` naming another
//     portal (#436, D7);
//   - the operation type and the "why" phrase it records.
//
// And per ADR-0033 §B each span carries `tool.name` (the name called),
// `tool.upstream_name` (the name on the wire), `mcp.alias` and `mcp.server.id`
// (the answering source's), beside `mcp.source`.
//
// The D6 refusal is driven through the loop too: a transport that routes over
// a FOUR-source registry (a stub source `example` also declares `search`)
// refuses a bare `search`, and the model is sent `describeToolFailureForLlm`'s
// copy, the record says `unknown`, and no raw message is on any of them.
//
// RED at 617b18b (W2): the injection and the lock key on the literal
// `get_data`/`fetch`; the spans carry none of the three attributes; the
// aliased names derive no operation type; `routeToolCall` does not exist.
//
// No live endpoint, no credential, no MCP server: the model is an in-process
// function, the transport a closure.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import {
  CIVIC_MANIFEST,
  createCivicRouter,
  type CivicManifestEntry,
} from '@typedstandards/civic-typed-router';
import { runToolLoop, type LoopEvent, type ToolCallRecord, type ToolLoopOptions } from './run-tool-loop.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from '../evidence/trace.ts';
import * as registryModule from '../mcp/registry.ts';
import { buildMcpRegistry, buildToolIndex, routedSourceId, type McpRegistry, type McpRegistryEnv, type McpServerConfig } from '../mcp/registry.ts';
import { describeToolFailureForLlm } from '../streaming.ts';

const PORTAL = 'data.cityofnewyork.us';
const OTHER_PORTAL = 'data.cityofchicago.org';
const ONE_ROW = JSON.stringify({ data: [{ n: 1 }], total_rows: 1 });
const FULL: McpRegistryEnv = {
  socrataUrl: 'https://socrata.invalid',
  dataCommonsUrl: 'https://data-commons.invalid/mcp',
  bostonOpencontextUrl: 'https://opencontext.invalid/mcp',
};

interface StubToolCall { id: string; name: string; args: Record<string, unknown> }

/** An in-process model: one turn of tool calls, then a final answer. Records
 *  every message list it is sent. */
function stubClient(toolCalls: StubToolCall[], sent: unknown[][]): OpenAI {
  let served = 0;
  return {
    chat: {
      completions: {
        create: async (params: { messages: unknown[] }) => {
          sent.push(JSON.parse(JSON.stringify(params.messages)) as unknown[]);
          const first = served++ === 0;
          return {
            id: 'chatcmpl-w3-stub',
            object: 'chat.completion',
            created: 1,
            model: 'fake/model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: first ? null : 'The answer, from the data above: 1 record.',
                ...(first
                  ? { tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }
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

interface Span { name: string; attributes: Array<{ key: string; value: { stringValue?: string } }> }

function spansOf(trace: Record<string, unknown>): Span[] {
  const resourceSpans = trace.resourceSpans as { scopeSpans: { spans: Span[] }[] }[];
  return resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)).filter((s) => s.name === 'mcp_tool_call');
}

const attr = (span: Span, key: string) => span.attributes.find((a) => a.key === key)?.value?.stringValue;

async function run(
  toolCalls: StubToolCall[],
  extra: Partial<ToolLoopOptions> = {},
  executeToolCall: ToolLoopOptions['executeToolCall'] = async () => ONE_ROW,
) {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const sent: unknown[][] = [];
  const events: LoopEvent[] = [];
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await runToolLoop({
    client: stubClient(toolCalls, sent),
    endpointModel: 'fake/model',
    requestSettings: undefined,
    prompt: 'How many records?',
    systemPrompt: 'Fixture system prompt.',
    tools: [],
    executeToolCall: async (name, args) => {
      executed.push({ name, args: { ...args } });
      return executeToolCall(name, args);
    },
    onEvent: (event) => events.push(event),
    trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: (name) => routedSourceId(name, FULL) },
    ...extra,
  });
  builder.endRoot();
  const trace = builder.finalize() as unknown as Record<string, unknown>;
  return { result, spans: spansOf(trace), sent, events, executed };
}

// --- The injection and the lock -------------------------------------------------------

test('the portal injection fires for socrata__get_data and for get_data alike', async () => {
  const { result, executed } = await run(
    [
      { id: 'a', name: 'socrata__get_data', args: { type: 'query', dataset_id: 'abcd-1234' } },
      { id: 'b', name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234' } },
      { id: 'c', name: 'data_commons__get_observations', args: { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' } },
    ],
    { portal: PORTAL },
  );
  const [aliased, bare, other] = result.toolCalls;
  assert.equal(aliased.args.portal, PORTAL, 'socrata__get_data was not given the run\'s portal');
  assert.equal(bare.args.portal, PORTAL);
  assert.equal(other.args.portal, undefined, 'a Data Commons call was given a Socrata portal');
  assert.deepEqual(executed.map((e) => e.args.portal), [PORTAL, PORTAL, undefined]);
});

test('the one-portal lock refuses socrata__get_data and socrata__fetch naming another portal, as it does get_data and fetch', async () => {
  const { result, executed } = await run(
    [
      { id: 'a', name: 'socrata__get_data', args: { type: 'query', dataset_id: 'abcd-1234', portal: OTHER_PORTAL } },
      { id: 'b', name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234', portal: OTHER_PORTAL } },
      { id: 'c', name: 'socrata__fetch', args: { id: `record:${OTHER_PORTAL}:abcd-1234:1` } },
      { id: 'd', name: 'socrata__get_data', args: { type: 'query', dataset_id: 'abcd-1234', portal: PORTAL } },
    ],
    { portal: PORTAL, lockedPortal: PORTAL },
  );
  assert.deepEqual(result.toolCalls.map((c) => c.failed === true), [true, true, true, false]);
  assert.deepEqual(executed.map((e) => e.name), ['socrata__get_data'], 'a call naming another portal was sent');
});

// --- What the record and the span state -----------------------------------------------

test('both spellings record the same operation type and the same reason, and the reason never shows an alias', async () => {
  const calls: StubToolCall[] = [
    { id: 'a', name: 'socrata__search', args: { query: 'noise' } },
    { id: 'b', name: 'search', args: { query: 'noise' } },
    { id: 'c', name: 'data_commons__search_indicators', args: { query: 'income' } },
    { id: 'd', name: 'search_indicators', args: { query: 'income' } },
    { id: 'e', name: 'boston__ckan__get_schema', args: { resource_id: 'r' } },
    { id: 'f', name: 'ckan__get_schema', args: { resource_id: 'r' } },
    { id: 'g', name: 'socrata__fetch', args: { id: 'abcd-1234' } },
    { id: 'h', name: 'fetch', args: { id: 'abcd-1234' } },
  ];
  const { result } = await run(calls);
  const pairs = (records: ToolCallRecord[]) => records.map((r) => [r.operationType, r.reason]);
  const recorded = pairs(result.toolCalls);
  for (let i = 0; i < recorded.length; i += 2) {
    assert.deepEqual(recorded[i], recorded[i + 1], `${calls[i].name} and ${calls[i + 1].name} recorded differently`);
  }
  assert.deepEqual(recorded.map(([op]) => op), ['search', 'search', 'search', 'search', 'metadata', 'metadata', undefined, undefined]);
  for (const record of result.toolCalls) {
    assert.ok(!/(socrata|data_commons|boston)__/.test(record.reason ?? ''), `the reason names an alias: ${record.reason}`);
  }
  // The record keeps the name the model called.
  assert.deepEqual(result.toolCalls.map((r) => r.name), calls.map((c) => c.name));
});

test('every mcp_tool_call span states mcp.source, tool.upstream_name, mcp.alias and mcp.server.id', async () => {
  const calls: StubToolCall[] = [
    { id: 'a', name: 'socrata__get_data', args: { type: 'catalog', query: 'noise' } },
    { id: 'b', name: 'data_commons__get_observations', args: { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' } },
    { id: 'c', name: 'boston__ckan__search_datasets', args: { query: '311' } },
    { id: 'd', name: 'get_data', args: { type: 'catalog', query: 'noise' } },
    { id: 'e', name: 'no_such_tool', args: {} },
  ];
  const { spans } = await run(calls, {}, async (name) => {
    if (name === 'no_such_tool') throw new Error(`No MCP server registered for tool "${name}"`);
    return ONE_ROW;
  });
  assert.equal(spans.length, calls.length);
  const stated = spans.map((s) => ['tool.name', 'tool.upstream_name', 'mcp.source', 'mcp.alias', 'mcp.server.id'].map((k) => attr(s, k)));
  const id = (sourceId: string) => CIVIC_MANIFEST.find((e) => e.sourceId === sourceId)!.id;
  assert.deepEqual(stated, [
    ['socrata__get_data', 'get_data', 'socrata', 'socrata', id('socrata')],
    ['data_commons__get_observations', 'get_observations', 'data-commons', 'data_commons', id('data-commons')],
    ['boston__ckan__search_datasets', 'ckan__search_datasets', 'boston-opencontext', 'boston', id('boston-opencontext')],
    ['get_data', 'get_data', 'socrata', 'socrata', id('socrata')],
    ['no_such_tool', 'no_such_tool', 'unknown', 'unknown', 'unknown'],
  ]);
});

// --- The D6 refusal, through the loop ---------------------------------------------------

const EXAMPLE_ENTRY: CivicManifestEntry = {
  id: 'example-mcp@https://example.org/mcp',
  alias: 'example',
  sourceId: 'example',
  displayName: 'Example Records Server',
  description: 'Example records: synthetic test records for one fictional town. Cannot answer about any real place.',
  freshness: 'Static: a fixed test set.',
  configuration: { addressVariable: 'EXAMPLE_MCP_URL', requirement: 'required' },
  tools: [{ type: 'function', function: { name: 'search', description: 'Search the example records.', parameters: { type: 'object', properties: {} } } }],
  toolNames: ['search'],
  guidance: { async fetchText() { return ''; } },
  // Router 0.4.0's two required fields (#632 D11, D6): a remote source with
  // one variant, On in a first consent. The router reads neither.
  hostings: [{ variant: 'remote', kind: 'remote', runsAt: 'other', logging: [] }],
  consentDefault: 'on',
};

test('a bare name two offered sources share is refused before any request, and reaches the model and the record only as the app words it', async () => {
  const routeToolCall = (registryModule as Record<string, unknown>).routeToolCall as
    | ((registry: McpRegistry, name: string, map?: unknown) => { server: McpServerConfig; upstreamName: string })
    | undefined;
  assert.equal(typeof routeToolCall, 'function', 'registry.ts exports no routeToolCall');
  const four = createCivicRouter([...CIVIC_MANIFEST, EXAMPLE_ENTRY]);
  const base = buildMcpRegistry(FULL);
  const servers = {
    ...base.servers,
    example: { sourceId: 'example', label: 'Example', endpointUrl: 'https://example.invalid/mcp', tools: ['search'], alias: 'example', serverId: EXAMPLE_ENTRY.id },
  } as unknown as Record<string, McpServerConfig>;
  const registry = {
    servers,
    toolIndex: buildToolIndex(servers),
    unconfiguredTools: {},
    offeredSources: ['socrata', 'data-commons', 'boston-opencontext', 'example'],
  } as unknown as McpRegistry;

  const wire: string[] = [];
  let refusal: unknown;
  const { result, sent, events, executed } = await run(
    [{ id: 'a', name: 'search', args: { query: 'noise' } }],
    {},
    async (name) => {
      try {
        const routed = routeToolCall!(registry, name, four.dispatchMap);
        wire.push(routed.upstreamName);
        return ONE_ROW;
      } catch (error) {
        refusal = error;
        throw error;
      }
    },
  );
  assert.equal(executed.length, 1, 'the transport was not asked');
  assert.deepEqual(wire, [], 'a request went out for an ambiguous name');
  assert.ok(refusal instanceof Error, 'the bare name was routed');

  const [record] = result.toolCalls;
  assert.equal(record.failed, true);
  assert.equal(record.failureKind, 'unknown');
  const failed = events.find((e) => e.type === 'tool_failed');
  assert.ok(failed && failed.type === 'tool_failed' && failed.failureKind === 'unknown');

  // What the model was sent for the call is exactly the app's copy.
  const toolMessage = (sent[1] as Array<{ role: string; content?: string }>).find((m) => m.role === 'tool');
  assert.equal(toolMessage?.content, describeToolFailureForLlm('search', refusal));
  assert.ok(toolMessage!.content!.includes('"socrata__search"') && toolMessage!.content!.includes('"example__search"'));
  assert.ok(!toolMessage!.content!.includes((refusal as Error).message), 'the raw message reached the model');
});
