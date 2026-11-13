// S2-B P3R criterion 3 (npstorey/civic-ai-tools#309; the seat's 6823831237; route-identity C1 = A, C2 = A; the seat's
// rulings 1 to 3 on stage 1; Addendum 1's 3.i to 3.iv): a pack's call is sent only after its base matched a pin.
//
// WHAT IS DRIVEN. The real loop core (`runToolLoop`, with no check passed in, so the core's own), the real MCP
// client (`callMcpTool`, `readServerTools`), the real trace builder and the real packager, against a loopback base
// server that keeps sessions as the deployed Socrata server does. A case changes what the base reports; a new
// generation of sessions makes the client handshake again, so each case's `serverInfo` is read fresh. When the
// base matches, it reports and lists exactly what the deployed server did at the GR read
// (`fixtures/socrata-tools-at-gr.json`).
//
// THE RED (tree 8, the pins moved and no check): every mismatch case below sends the pack's call. The base server
// records a `tools/call` of the pack's tool and no `tools/list` (6823831237: "a pack call is sent with no pin read").
//
// SHAPED TO FAIL. Each mismatch moves one member the check reads (`serverName`, `serverVersion`, a pinned tool's
// schema, a pinned tool absent, a pinned tool listed twice), and two give it an observation it cannot compare
// (3.iii). The match case makes two pack calls so the cache can be seen, and a third past five minutes on an
// injected clock. The decoy's call is the base's own, to the same server, in a run whose base does not match.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { ScriptedToolCall } from '../model-loop/test-harness.ts';
import type { ToolLoopOptions, ToolCallRecord } from '../model-loop/run-tool-loop.ts';
import type { EvidencePackage, PackageInput, ToolCallInput } from '../evidence/packager.ts';

const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] = value;
process.env.PUBLISHER_KEY_ID = 'adopter:p3r-fixture';
process.env.EVIDENCE_KEY_ID = 'adopter:p3r-fixture';

// --- The base server -----------------------------------------------------------------------------------

const GR = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socrata-tools-at-gr.json'), 'utf8')) as {
  serverInfo: { name: string; version: string };
  tools: Array<Record<string, unknown>>;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface BaseMode {
  serverInfo: { name: string; version: string };
  /** The `tools/list` result, or how the read fails. */
  list: { tools?: unknown[] } | { status: number } | { rpcError: true } | { repeat: true };
  delayMs?: number;
}
const MATCH: BaseMode = { serverInfo: GR.serverInfo, list: { tools: GR.tools } };
const base = { mode: MATCH, generation: 0, seen: [] as Array<{ method: string; tool?: string }> };
const sessions = new Set<string>();

const baseServer = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw) as { id?: unknown; method?: string; params?: { name?: string } };
  base.seen.push({ method: String(body.method), ...(body.method === 'tools/call' ? { tool: body.params?.name } : {}) });
  const answer = (status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
  };
  if (body.id === undefined) { res.writeHead(202); res.end(); return; }
  if (body.method === 'server/discover') { answer(400, { error: { code: -32601, message: 'Method not found' } }); return; }
  if (body.method === 'initialize') {
    const id = `g${base.generation}-${sessions.size + 1}`;
    sessions.add(id);
    answer(200, { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: base.mode.serverInfo } }, { 'mcp-session-id': id });
    return;
  }
  const session = String(req.headers['mcp-session-id'] ?? '');
  if (!sessions.has(session) || !session.startsWith(`g${base.generation}-`)) {
    // A session of an earlier case: the client starts a new one, as it must on a 404, and reads the case's report.
    base.seen[base.seen.length - 1].method = `${body.method} (earlier session, refused)`;
    answer(404, { error: { code: -32001, message: 'Session not found' } });
    return;
  }
  if (body.method === 'tools/list') {
    if (base.mode.delayMs) await new Promise((r) => setTimeout(r, base.mode.delayMs));
    const list = base.mode.list;
    if ('status' in list) { answer(list.status, { error: { code: -32603, message: 'fixture failure' } }); return; }
    if ('rpcError' in list) { answer(200, { error: { code: -32603, message: 'fixture: the list could not be built' } }); return; }
    if ('repeat' in list) { answer(200, { result: { tools: [], nextCursor: 'again' } }); return; }
    answer(200, { result: list });
    return;
  }
  answer(200, { result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ notice: 'fixture row' }], total_rows: 1 }) }] } });
});
await new Promise<void>((resolve) => baseServer.listen(0, '127.0.0.1', () => resolve()));
baseServer.unref();

for (const k of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(baseServer.address() as AddressInfo).port}/mcp`;
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/mcp';
process.env.OPENROUTER_API_KEY = 'not-a-credential-p3r';

const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { runToolLoop } = await import('../model-loop/run-tool-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { callMcpTool, readServerTools } = await import('./client.ts');
const { createBaseCheck } = await import('./base-check.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');
const { sourceIdForToolName } = await import('./operation-types.ts');

const PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';
const PACK_CALL = (id: string): ScriptedToolCall => ({ id, name: 'nyc_record__get_data', args: { type: 'query', query: 'SELECT * LIMIT 1' } });
const BASE_CALL = (id: string): ScriptedToolCall => ({ id, name: 'socrata__get_data', args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us', query: 'SELECT * LIMIT 1' } });

/** Revision 4's refusal for the model, in the site's words as the owner ruled them (D3, OA-790), verbatim. */
const R2_LINE =
  'This data request returned no data. Do not estimate, guess, or fabricate any values to fill the gap. This tool belongs to NYC City Record.' +
  " The server that NYC City Record's requests go through does not match what NYC City Record was written for, so this request was not sent." +
  " Do not call NYC City Record's tools again for this question. If the question can be answered from another data source you have tools for, make that request instead;" +
  ' if it cannot, tell the user in plain language that NYC City Record could not be used for this question, and do not include any raw error text, status codes, server names, or system details.';

type Attr = { key: string; value?: { stringValue?: string; boolValue?: boolean; intValue?: number | string; doubleValue?: number } };
type Span = { spanId: string; name: string; attributes?: Attr[] };

interface Run {
  calls: ToolCallRecord[];
  spans: Span[];
  pkg: EvidencePackage;
  seen: Array<{ method: string; tool?: string }>;
  toolMessages: string[];
}

/** One run: each element of `turns` is one model turn's tool calls; the run then answers. */
async function run(mode: BaseMode, turns: ScriptedToolCall[][], overrides: Partial<ToolLoopOptions> = {}, onCall?: (n: number) => void): Promise<Run> {
  base.mode = mode;
  base.generation += 1;
  const seenFrom = base.seen.length;
  const model = await startScriptedModelServer([...turns.map((toolCalls) => ({ toolCalls })), { content: 'An answer.' }]);
  process.env.MODEL_API_BASE_URL = model.url;
  _resetDefaultModelClientForTests();
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  let n = 0;
  try {
    const result = await runToolLoop({
      client: getModelClient(),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: 'What did the City Record publish?',
      tools: [],
      executeToolCall: async (name, args) => {
        try {
          return await callMcpTool(name, args);
        } finally {
          n += 1;
          onCall?.(n);
        }
      },
      trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: sourceIdForToolName },
      ...overrides,
    });
    builder.endRoot();
    const trace = builder.finalize() as unknown as Record<string, unknown>;
    const pkg = buildEvidencePackage({
      trace: trace as unknown as PackageInput['trace'],
      prompt: 'What did the City Record publish?',
      output: result.content,
      toolCalls: result.toolCalls as unknown as ToolCallInput[],
      model: 'fake/model',
      tokenUsage: { promptTokens: 10, completionTokens: 5 },
      promptVisibility: 'full_text',
      title: 'The base check',
      summary: 'Driven fixture for S2-B P3R.',
      type: 'content/analysis/v1',
    }).pkg;
    const spans = ((trace.resourceSpans as Array<{ scopeSpans: Array<{ spans: Span[] }> }>)[0].scopeSpans[0].spans).filter((s) => s.name === 'mcp_tool_call');
    const toolMessages = model.requests.flatMap((r) => ((r.messages as Array<{ role: string; content?: string }>) ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content)));
    return { calls: result.toolCalls, spans, pkg: JSON.parse(JSON.stringify(pkg)) as EvidencePackage, seen: base.seen.slice(seenFrom), toolMessages: [...new Set(toolMessages)] };
  } finally {
    await new Promise((resolve) => model.server.close(resolve));
    _resetDefaultModelClientForTests();
  }
}

const attr = (span: Span, key: string): unknown => {
  const v = span.attributes?.find((a) => a.key === key)?.value;
  return v === undefined ? undefined : v.stringValue ?? v.boolValue ?? v.intValue ?? v.doubleValue;
};
const packSent = (r: Run) => r.seen.filter((s) => s.method === 'tools/call').length;
const lists = (r: Run) => r.seen.filter((s) => s.method === 'tools/list').length;

/** A failed pack call, on the span and in the record, as `kind`. */
function assertRefused(r: Run, index: number, kind: string): void {
  const call = r.calls[index];
  assert.equal(call.failed, true, `call ${index} is not recorded failed`);
  assert.equal(call.failureKind, kind, `call ${index} is recorded ${call.failureKind}, not ${kind}`);
  const span = r.spans[index];
  assert.equal(span.attributes?.find((a) => a.key === 'error')?.value?.boolValue, true, 'the span does not end with the boolean error: true');
  assert.equal(attr(span, 'error.kind'), kind);
  assert.equal(attr(span, 'mcp.pack_id'), PACK_ID);
  assert.ok(Number.isInteger(Number(attr(span, 'tool.duration_ms') ?? NaN)), 'the span carries no tool.duration_ms');
  const query = (r.pkg.queries as unknown as Array<Record<string, unknown>>)[index];
  assert.deepEqual({ failed: query.failed, failureKind: query.failureKind }, { failed: true, failureKind: kind }, 'the record\'s queries[] entry does not state the refusal');
  const graph = ((r.pkg.provenance as unknown as Record<string, unknown>)['@graph']) as Array<Record<string, unknown>>;
  const activity = graph.find((node) => String(node['@id']).endsWith(`:tool-call:${span.spanId}`));
  assert.ok(activity, 'no activity for the refused call');
  assert.deepEqual(
    { failed: activity!['civic:failed'], failureKind: activity!['civic:failureKind'], packId: activity!['civic:packId'] },
    { failed: true, failureKind: kind, packId: PACK_ID },
  );
}

// --- The match ---------------------------------------------------------------------------------------------

let clock = Date.parse('2026-11-13T12:00:00Z');
const MATCHED = await run(MATCH, [[PACK_CALL('m1')], [PACK_CALL('m2')], [PACK_CALL('m3')]], { checkBase: createBaseCheck({ now: () => clock, read: readServerTools }) }, (n) => {
  if (n === 2) clock += 5 * 60_000 + 1;
});

test('a match: the pack\'s calls are sent, and the base\'s list was read once for two calls', () => {
  assert.equal(packSent(MATCHED), 3, 'the matched pack calls were not sent');
  for (const call of MATCHED.calls) assert.notEqual(call.failed, true);
  const methods = MATCHED.seen.map((s) => s.method).filter((m) => m === 'tools/list' || m === 'tools/call');
  assert.deepEqual(methods.slice(0, 3), ['tools/list', 'tools/call', 'tools/call'], 'the list was not read once, before the first of two calls');
});

test('a match: a third pack call more than five minutes after the read (injected clock) reads again', () => {
  assert.equal(lists(MATCHED), 2);
  const methods = MATCHED.seen.map((s) => s.method).filter((m) => m === 'tools/list' || m === 'tools/call');
  assert.deepEqual(methods, ['tools/list', 'tools/call', 'tools/call', 'tools/list', 'tools/call']);
});

// --- Each member the check reports, refused -------------------------------------------------------------------

const withTools = (edit: (tools: Array<Record<string, unknown>>) => Array<Record<string, unknown>>): BaseMode => ({ serverInfo: GR.serverInfo, list: { tools: edit(clone(GR.tools)) } });
const MISMATCHES: Array<[string, BaseMode]> = [
  ['serverName', { serverInfo: { ...GR.serverInfo, name: 'socrata-mcp-server-fork' }, list: { tools: GR.tools }, delayMs: 40 }],
  ['serverVersion', { serverInfo: { ...GR.serverInfo, version: '0.9.3' }, list: { tools: GR.tools } }],
  ['tools.get_data changed', withTools((tools) => tools.map((t) => (t.name === 'get_data' ? { ...t, inputSchema: { ...(t.inputSchema as object), required: ['dataset_id', 'type', 'query'] } } : t)))],
  ['tools.fetch absent', withTools((tools) => tools.filter((t) => t.name !== 'fetch'))],
  ['tools.fetch listed twice', withTools((tools) => [...tools, tools.find((t) => t.name === 'fetch')!])],
  ['3.iii: a listed get_data with no inputSchema (checkBasePins throws)', withTools((tools) => tools.map((t) => (t.name === 'get_data' ? { name: 'get_data', description: t.description } : t)))],
  ['3.iii: a list with no tools array (checkBasePins throws)', { serverInfo: GR.serverInfo, list: {} }],
];

for (const [label, mode] of MISMATCHES) {
  const refused = await run(mode, [[PACK_CALL('x1')], [PACK_CALL('x2')]]);
  test(`a mismatch on ${label}: nothing is sent, and both calls are recorded base_changed with the pack's id`, () => {
    assert.equal(packSent(refused), 0, `the base server received the pack's call (red: the pins moved and no check); it saw ${JSON.stringify(refused.seen.map((s) => s.method))}`);
    assert.equal(lists(refused), 1, 'the base\'s list was not read once (a mismatch is kept for the run, ruling 3)');
    assertRefused(refused, 0, 'base_changed');
    assertRefused(refused, 1, 'base_changed');
  });
  test(`a mismatch on ${label}: the model is told R2's line, verbatim`, () => {
    assert.deepEqual(refused.toolMessages, [R2_LINE]);
  });
  if (label === 'serverName') {
    test('3.iv: an unsent call\'s span is timed to its refusal, which is thrown inside the timed region', () => {
      const ms = Number(attr(refused.spans[0], 'tool.duration_ms'));
      assert.ok(ms >= 30, `the refused call's span took ${ms} ms, less than the base's 40 ms list: the refusal was not timed`);
      assert.equal(refused.calls[0].duration_ms, ms, 'the record and the span state different durations');
    });
  }
}

// --- A failed read (ruling 1) -----------------------------------------------------------------------------------

const FAILED_READS: Array<[string, BaseMode]> = [
  ['an error status', { serverInfo: GR.serverInfo, list: { status: 500 } }],
  ['a JSON-RPC error', { serverInfo: GR.serverInfo, list: { rpcError: true } }],
  ['a repeating cursor', { serverInfo: GR.serverInfo, list: { repeat: true } }],
];
for (const [label, mode] of FAILED_READS) {
  const failed = await run(mode, [[PACK_CALL('f1')], [PACK_CALL('f2')]]);
  test(`a failed read (${label}) is never a match: nothing is sent, the call is recorded unavailable, and the read is not kept`, () => {
    assert.equal(packSent(failed), 0);
    assert.equal(lists(failed) >= 2, true, 'the failed read was kept: the second pack call did not read again');
    assertRefused(failed, 0, 'unavailable');
    assertRefused(failed, 1, 'unavailable');
    assert.equal(failed.toolMessages.length, 1);
    assert.match(failed.toolMessages[0], /The live data source is temporarily unavailable\./, 'the model was not given the existing unavailable line');
  });
}

const TIMED_OUT = await run(MATCH, [[PACK_CALL('t1')]], {
  checkBase: createBaseCheck({ read: async () => { throw new Error('MCP server "socrata" did not respond within 45s — the upstream server may be starting up or unresponsive. Please try again.'); } }),
});
test('a failed read that timed out is recorded unavailable, by its type, not timeout by its words', () => {
  assert.equal(packSent(TIMED_OUT), 0);
  assertRefused(TIMED_OUT, 0, 'unavailable');
});

// --- Decoy: the base's own tools are not checked ----------------------------------------------------------------

const OWN = await run({ serverInfo: { ...GR.serverInfo, version: '0.9.3' }, list: { tools: GR.tools } }, [[BASE_CALL('o1')]]);
test('decoy: a call of the base\'s own tool, in a run whose base does not match, is sent with no read', () => {
  assert.equal(lists(OWN), 0, 'the base\'s own tool was checked');
  assert.deepEqual(OWN.seen.filter((s) => s.method === 'tools/call').map((s) => s.tool), ['get_data']);
  assert.notEqual(OWN.calls[0].failed, true);
});
