// R6 W1, criteria 1 and 2 (#632): the run's selection reaches the dispatch.
//
// THE RULE. A selection narrows the sources a run is offered (#599 D3). Before
// W1 it reached the composed prompt and the tools array only; the dispatch
// read the configuration alone, so a model that named a tool of a configured
// source the selection left out had that call SENT. From W1 such a call is
// refused before any request, with the tool-failure kind `not_offered`, and
// the span names no source for it (`mcp.source: 'unknown'`, as for any call
// no server took; ADR-0033 §A). The record's reason for that source stays the
// one the composition stated, `not-selected`.
//
// WHAT IS DRIVEN. A loopback fixture stands in for the Socrata and the Data
// Commons servers and counts every request per server. Every outbound `fetch`
// of the file is recorded too, and a non-loopback one is refused unsent. The
// website's REAL client (`callMcpTool`) is driven directly; then the REAL loop
// through `compareLoopOptions` (the `/api/compare` factory, whose default
// transport is the one under test), with the scripted model endpoint and a
// real `TraceBuilder`; then the REAL packager over that run.
//
// WHAT MAKES IT ABLE TO FAIL. Data Commons is CONFIGURED and answering here
// (the control below shows a call reaching it), so only the selection can
// keep the call from being sent. At the base (5a8e975) the client takes no
// selection and the dispatch reads none: the call reaches the fixture, is
// recorded as answered, and its span names `data-commons`.
//
// THE SECOND ARGUMENT SHAPES. `callMcpTool`'s options argument and
// `routedSourceId`'s selection argument are added by the fix; the red commit
// calls them through a typed view so it type-checks at the base, where each
// extra argument is ignored.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { EvidencePackage, ToolCallInput } from '../evidence/packager.ts';

const QUESTION = 'What was the median household income in the Bronx?';
const ANSWER = 'The figure could not be retrieved from the sources used for this question.';
const DC_TOOL = 'data_commons__search_indicators';
const DC_ARGS = { query: 'median household income', places: ['Bronx County'] };
const SELECTION = ['socrata'] as const;

// --- Request census -----------------------------------------------------------

const realFetch = globalThis.fetch;
const OUTBOUND: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  OUTBOUND.push(`${url.host}${url.pathname}`);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

/** Every JSON-RPC request the fixture received, per server path. */
const RECEIVED: Array<{ path: string; method: string }> = [];
const toolCallsTo = (path: string): number => RECEIVED.filter((r) => r.path === path && r.method === 'tools/call').length;
const requestsTo = (path: string): number => RECEIVED.filter((r) => r.path === path).length;

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  RECEIVED.push({ path, method: msg.method ?? '' });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'r6-w1-fixture', version: '0' } } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ value: 41895 }], total_rows: 1 }) }], isError: false } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;
const DC_PATH = '/dc/mcp';

// The registry captures its environment at module load: every app module is
// imported after the configuration is set.
for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'SITE_DEFAULT_PORTAL']) delete process.env[name];
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}${DC_PATH}`;

const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const client = await import('./client.ts');
const registry = await import('./registry.ts');
const { civicRouter } = await import('@typedstandards/civic-typed-router');
const { classifyStreamError } = await import('../streaming.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { compareLoopOptions } = await import('../model-loop/compare-loop.ts');
const { runToolLoop } = await import('../model-loop/run-tool-loop.ts');
const { createModelClient } = await import('../model-client.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, runRecordAttributes } = await import('../evidence/trace.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');

/** The two signatures the fix adds, viewed so the red commit type-checks at the base. */
type Selection = readonly string[] | undefined;
const callMcpTool = client.callMcpTool as unknown as (
  name: string,
  args: Record<string, unknown>,
  options?: { selection?: Selection },
) => Promise<string>;
const routedSourceId = registry.routedSourceId as unknown as (
  toolName: string,
  configured?: ReturnType<typeof registry.readMcpEnvFromProcess>,
  selection?: Selection,
) => string | undefined;

const configured = registry.readMcpEnvFromProcess();

// --- Criterion 1, at the client ----------------------------------------------
//
// Every drive in this file runs at module evaluation, in order, before any
// test is registered: `node:test` starts a registered test while the module
// is still evaluating, and two drives sharing one census must not overlap.

/** One call's census: what reached Data Commons, what left the process, and how it ended. */
async function driveClient(
  name: string,
  args: Record<string, unknown>,
  options?: { selection?: Selection },
): Promise<{ dcRequests: number; dcToolCalls: number; socrataToolCalls: number; outbound: string[]; caught: unknown }> {
  const dcBefore = requestsTo(DC_PATH);
  const dcCallsBefore = toolCallsTo(DC_PATH);
  const socrataBefore = toolCallsTo('/socrata/mcp');
  const outboundBefore = OUTBOUND.length;
  let caught: unknown;
  try {
    await callMcpTool(name, args, options);
  } catch (error) {
    caught = error;
  }
  return {
    dcRequests: requestsTo(DC_PATH) - dcBefore,
    dcToolCalls: toolCallsTo(DC_PATH) - dcCallsBefore,
    socrataToolCalls: toolCallsTo('/socrata/mcp') - socrataBefore,
    outbound: OUTBOUND.slice(outboundBefore),
    caught,
  };
}

const CONTROL = await driveClient(DC_TOOL, DC_ARGS);
const REFUSED = await driveClient(DC_TOOL, DC_ARGS, { selection: SELECTION });
const INSIDE = await driveClient('socrata__get_data', { type: 'query', dataset_id: 'abcd-1234', portal: 'data.example.org' }, { selection: SELECTION });

test('premise: with no selection, the same call reaches the configured Data Commons fixture', () => {
  assert.equal(CONTROL.caught, undefined, `premise: the control call failed: ${String(CONTROL.caught)}`);
  assert.equal(CONTROL.dcToolCalls, 1, 'the census cannot see a call that was sent');
});

test('criterion 1: with selection [socrata], a Data Commons call is refused before any request, as not_offered', () => {
  assert.equal(REFUSED.dcRequests, 0, 'a call to a source the selection leaves out reached that source');
  assert.deepEqual(REFUSED.outbound, [], 'the refused call made an outbound request');
  assert.ok(REFUSED.caught instanceof Error, 'the call outside the selection was answered, not refused');
  assert.equal(classifyStreamError(REFUSED.caught), 'not_offered', 'the refusal does not classify as not_offered');
});

test('criterion 1: a call inside the selection is still sent', () => {
  assert.equal(INSIDE.caught, undefined, `the call inside the selection failed: ${String(INSIDE.caught)}`);
  assert.equal(INSIDE.socrataToolCalls, 1);
});

// --- Criteria 1 and 2, through the real loop and the real packager -------------

const scripted = await startScriptedModelServer([
  { toolCalls: [{ id: 'c1', name: DC_TOOL, args: DC_ARGS }] },
  { content: ANSWER },
]);
process.env.MODEL_API_BASE_URL = scripted.url;

const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
builder.startRoot('analysis', {});
const dcBeforeRun = requestsTo(DC_PATH);
const outboundBeforeRun = OUTBOUND.filter((u) => u.startsWith(`${new URL(MCP_ORIGIN).host}/`)).length;
const options = compareLoopOptions({
  client: createModelClient({ apiKey: 'placeholder-model-key-r6-w1' }),
  endpointModel: 'fake/model',
  requestSettings: undefined,
  prompt: QUESTION,
  systemPrompt: 'You are a fixture system prompt.',
  configured,
  selection: SELECTION,
});
const RUN = await runToolLoop({
  ...options,
  // What the two streaming routes hand the loop for the span's attribution,
  // bound to the same selection.
  trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: (name) => routedSourceId(name, configured, SELECTION) },
});
const RUN_DC_REQUESTS = requestsTo(DC_PATH) - dcBeforeRun;
const RUN_MCP_REQUESTS = OUTBOUND.filter((u) => u.startsWith(`${new URL(MCP_ORIGIN).host}/`)).length - outboundBeforeRun;
builder.endRoot(runRecordAttributes({
  assertedDate: '2026-10-18',
  mcpServers: registry.configuredMcpServers(configured),
  toolDefinitions: options.tools,
  sourcesOffered: civicRouter.sourcesOffered(configured, SELECTION).map(({ sourceId, alias, reason }) => ({ sourceId, alias, reason })),
  components: [],
}));
const TRACE = builder.finalize() as unknown as Record<string, unknown>;
await new Promise<void>((resolve) => scripted.server.close(() => resolve()));

const PKG: EvidencePackage = buildEvidencePackage({
  trace: TRACE,
  prompt: QUESTION,
  output: RUN.content,
  toolCalls: RUN.toolCalls as unknown as ToolCallInput[],
  model: 'fake/model',
  tokenUsage: { promptTokens: 10, completionTokens: 5 },
  promptVisibility: 'full_text',
  title: 'R6 W1 not_offered',
  summary: 'R6 W1 not_offered.',
  captureMethod: 'chat-flow-stream',
}).pkg;

interface OtlpSpan {
  name?: string;
  attributes?: Array<{ key: string; value: { stringValue?: string; boolValue?: boolean } }>;
}
function spansOf(trace: Record<string, unknown>): OtlpSpan[] {
  const spans: OtlpSpan[] = [];
  for (const rs of (trace.resourceSpans ?? []) as Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }>) {
    for (const ss of rs.scopeSpans ?? []) spans.push(...(ss.spans ?? []));
  }
  return spans;
}
const attr = (span: OtlpSpan | undefined, key: string) => span?.attributes?.find((a) => a.key === key)?.value;
const toolSpan = spansOf(TRACE).find((s) => s.name === 'mcp_tool_call' && attr(s, 'tool.name')?.stringValue === DC_TOOL);

test('premise: the model was offered no Data Commons tool, and called one anyway', () => {
  const offered = ((scripted.requests[0]?.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name);
  assert.ok(offered.includes('socrata__get_data'), 'premise: the run offered the Socrata tools');
  assert.ok(!offered.some((name) => name?.startsWith('data_commons__')), 'premise: the selection did not reach the tools array');
  assert.equal(RUN.toolCalls.length, 1);
  assert.equal(RUN.toolCalls[0].name, DC_TOOL);
});

test('criterion 1: through the loop, the call outside the selection makes no request and is recorded failed, not_offered', () => {
  assert.equal(RUN_DC_REQUESTS, 0, 'the loop sent the call to the source the selection left out');
  assert.equal(RUN_MCP_REQUESTS, 0, 'the run made a request to a data source');
  assert.equal(RUN.toolCalls[0].failed, true, 'the call outside the selection was recorded as answered');
  assert.equal(RUN.toolCalls[0].failureKind, 'not_offered');
});

test('criterion 1: the built package\'s queries[] entry marks the call failed, not_offered, and dataSources[] asserts no access', () => {
  const entry = PKG.queries[0] as EvidencePackage['queries'][number] & { failed?: boolean; failureKind?: string };
  assert.equal(entry.tool, DC_TOOL);
  assert.equal(entry.failed, true, 'queries[] states the refused call as answered, in signed bytes');
  assert.equal(entry.failureKind, 'not_offered');
  assert.ok(!JSON.stringify(PKG.dataSources).includes('data-commons'), `dataSources[] asserts access to Data Commons:\n${JSON.stringify(PKG.dataSources)}`);
});

test('criterion 2: the span of the refused call names no source and states the kind', () => {
  assert.ok(toolSpan, 'the trace carries no span for the refused call');
  assert.equal(attr(toolSpan, 'mcp.source')?.stringValue, 'unknown', 'the span attributes the refused call to a source no server took it to');
  assert.equal(attr(toolSpan, 'error')?.boolValue, true);
  assert.equal(attr(toolSpan, 'error.kind')?.stringValue, 'not_offered');
});

test('criterion 2: the record\'s reason for the refused call\'s source stays what the composition stated (green at the base)', () => {
  const composition = (PKG.extensions ?? {})['org.civicaitools.composition'] as { sourcesOffered?: Array<{ sourceId: string; reason: string }> } | undefined;
  const dc = composition?.sourcesOffered?.find((s) => s.sourceId === 'data-commons');
  assert.equal(dc?.reason, 'not-selected', `the composition block states Data Commons as ${dc?.reason}`);
  assert.equal(composition?.sourcesOffered?.find((s) => s.sourceId === 'socrata')?.reason, 'selected');
});
