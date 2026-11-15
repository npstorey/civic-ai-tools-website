// S2-B phase 2 (npstorey/civic-ai-tools#309), criteria 1 to 4, 4b, 9 and 10: a call the dispatch refuses is not a
// pack call.
//
// THE RULE. The loop core decides a pack's call from the target the dispatch sends to. When the dispatch refuses
// the called name (the run's selection leaves the pack out, or an in-loop run has not loaded it), there is no
// target: the call is not a pack call for the filter's refusal or for the base check, and nothing is sent to the
// base for it. The send refuses it as not offered, because a pack is routable when its base is; in loop, a listed
// source the run has not loaded is refused as not loaded. The span still names the pack the called name names
// (`mcp.pack_id`), and the recorded arguments carry that pack's fixed values, as before. A record credits a pack
// only from calls that were sent.
//
// WHAT IS DRIVEN. The real loop core through `/api/compare`'s factory (`compareLoopOptions`), all-sources and in
// loop (`createInLoopRouting`), the real MCP client and the real trace builder, against a loopback base that keeps
// sessions as the deployed Socrata server does and reports and lists `fixtures/socrata-tools-at-gr.json`. The send
// is also read directly (`routeToolCall`) over every selection, and the loop core over every name in the dispatch
// map under every selection, with a transport that sends nothing.
//
// SHAPED TO FAIL. The pack's call is the first contact with the base in its run, so any request the base records
// is the check's. The all-sources mismatch is on `serverVersion` alone, which only the check reads. The credit's
// sequence puts a refused call and a sent call of one pack in one loaded source's group, the one shape in which a
// refused call can withdraw the credit.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { ScriptedToolCall } from './test-harness.ts';
import type { ToolCallRecord, ToolLoopOptions } from './run-tool-loop.ts';
import type { InLoopRouting } from '../mcp/routing-mode.ts';

// --- The base server -----------------------------------------------------------------------------------

const GR = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'fixtures', 'socrata-tools-at-gr.json'), 'utf8')) as {
  serverInfo: { name: string; version: string };
  tools: Array<Record<string, unknown>>;
};

interface BaseMode {
  serverInfo: { name: string; version: string };
  /** How the base answers a `tools/call`. */
  call?: 'rows' | 'status-500' | 'slow';
}
const MATCH: BaseMode = { serverInfo: GR.serverInfo };
const MISMATCH: BaseMode = { serverInfo: { ...GR.serverInfo, version: '0.9.3' } };

interface Seen {
  method: string;
  tool?: string;
  args?: Record<string, unknown>;
}
const base = { mode: MATCH, generation: 0, seen: [] as Seen[] };
const sessions = new Set<string>();

const baseServer = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  base.seen.push({ method: String(body.method), ...(body.method === 'tools/call' ? { tool: body.params?.name, args: body.params?.arguments } : {}) });
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
    // A session of an earlier run: refused as the deployed server refuses an unknown session, so the client starts
    // a new one and reads this run's report.
    base.seen[base.seen.length - 1].method = `${body.method} (earlier session, refused)`;
    answer(400, { error: { code: -32000, message: 'Bad Request: No valid session ID provided' } });
    return;
  }
  if (body.method === 'tools/list') { answer(200, { result: { tools: GR.tools } }); return; }
  if (base.mode.call === 'status-500') { answer(500, { error: { code: -32603, message: 'fixture failure' } }); return; }
  if (base.mode.call === 'slow') await new Promise((r) => setTimeout(r, 400));
  answer(200, { result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ notice: 'fixture row' }], total_rows: 1 }) }] } });
});
await new Promise<void>((resolve) => baseServer.listen(0, '127.0.0.1', () => resolve()));
baseServer.unref();

for (const k of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'SOURCE_ROUTING', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(baseServer.address() as AddressInfo).port}/mcp`;
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/mcp';
process.env.OPENROUTER_API_KEY = 'not-a-credential-s2b-p2';

const { CIVIC_MANIFEST, civicRouter } = await import('@typedstandards/civic-typed-router');
const { startScriptedModelServer } = await import('./test-harness.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { compareLoopOptions } = await import('./compare-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { buildMcpRegistry, dispatchTargetOf, readMcpEnvFromProcess, routeToolCall, routedSourceId, SourceNotOfferedError } = await import('../mcp/registry.ts');
const { createInLoopRouting, directorySet, SourceNotLoadedError } = await import('../mcp/routing-mode.ts');
const { injectPackFilter, packFilterOf } = await import('../mcp/pack-filter.ts');
const { upstreamToolName } = await import('../mcp/operation-types.ts');
const { createBaseCheck } = await import('../mcp/base-check.ts');
const { classifyStreamError, describeToolFailureForLlm } = await import('../streaming.ts');
const { chooserFromTrace } = await import('../flows/source-chooser.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');

const configured = readMcpEnvFromProcess();
const PACK_NAME = 'nyc_record__get_data';
const PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';
const PACK = packFilterOf(PACK_NAME)!;
const OMITTED = { type: 'query', query: 'SELECT * LIMIT 1' };
const WITH_PACK_VALUES = { ...OMITTED, portal: PACK.portal, dataset_id: PACK.datasetId };
const call = (id: string, name: string, args: Record<string, unknown>): ScriptedToolCall => ({ id, name, args: structuredClone(args) });
const LOAD_CITY_RECORD = call('load', 'load_source', { alias: 'nyc_record' });

type Attr = { key: string; value?: { stringValue?: string; boolValue?: boolean; intValue?: number | string } };
type Span = { spanId: string; name: string; parentSpanId?: string; attributes?: Attr[] };

interface Run {
  calls: ToolCallRecord[];
  spans: Span[];
  seen: Seen[];
  toolMessages: string[];
  trace: unknown;
}

type Entry = { selection?: string[] } | { inLoop: InLoopRouting };

/** One run through `/api/compare`'s factory: each element of `turns` is one model turn's tool calls. */
async function run(mode: BaseMode, entry: Entry, turns: ScriptedToolCall[][], overrides: Partial<ToolLoopOptions> = {}): Promise<Run> {
  base.mode = mode;
  base.generation += 1;
  const seenFrom = base.seen.length;
  const model = await startScriptedModelServer([...turns.map((toolCalls) => ({ toolCalls })), { content: 'An answer.' }]);
  process.env.MODEL_API_BASE_URL = model.url;
  _resetDefaultModelClientForTests();
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  try {
    const inLoop = 'inLoop' in entry ? entry.inLoop : undefined;
    const selection = 'selection' in entry ? entry.selection : undefined;
    const options: ToolLoopOptions = {
      ...compareLoopOptions({
        client: getModelClient(),
        endpointModel: 'fake/model',
        requestSettings: undefined,
        prompt: 'What did the City Record publish this week?',
        systemPrompt: inLoop ? inLoop.firstSystemPrompt : 'A fixture system prompt.',
        configured,
        ...(selection ? { selection } : {}),
        ...(inLoop ? { inLoop } : {}),
      }),
      trace: {
        builder,
        parentSpanId: builder.rootSpanId,
        resolveToolSource: inLoop ? inLoop.resolveToolSource : (name: string) => routedSourceId(name, configured, selection),
      },
      ...overrides,
    };
    const calls = (await runToolLoop(options)).toolCalls;
    const record = inLoop?.record();
    builder.endRoot(record && inLoop ? {
      'analysis.routing': JSON.stringify(record.routing),
      'analysis.considered': JSON.stringify(record.considered),
      'analysis.sources_offered': JSON.stringify(inLoop.sourcesOffered),
      'analysis.definition_hash': record.definitionHash,
    } : {});
    const trace = builder.finalize() as unknown as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };
    const spans = trace.resourceSpans[0].scopeSpans[0].spans.filter((s) => s.name === 'mcp_tool_call');
    const toolMessages = model.requests.flatMap((r) => ((r.messages as Array<{ role: string; content?: string }>) ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content)));
    return { calls, spans, seen: base.seen.slice(seenFrom), toolMessages: [...new Set(toolMessages)], trace };
  } finally {
    await new Promise((resolve) => model.server.close(resolve));
    _resetDefaultModelClientForTests();
  }
}

const attr = (span: Span, key: string): unknown => {
  const v = span.attributes?.find((a) => a.key === key)?.value;
  return v === undefined ? undefined : v.stringValue ?? v.boolValue ?? v.intValue;
};
const methods = (r: Run) => r.seen.map((s) => (s.tool ? `${s.method} ${s.tool}` : s.method));
const inLoopRouting = (states: Record<string, 'on' | 'ask-first'>) =>
  createInLoopRouting({ configured, directory: directorySet(configured, { enforced: true, states }), selection: [] });
const notLoadedLine = describeToolFailureForLlm(PACK_NAME, new SourceNotLoadedError(PACK_NAME));
const notOfferedLine = describeToolFailureForLlm(PACK_NAME, new SourceNotOfferedError(PACK_NAME));

// --- Criteria 1 and 3, in loop: every source Ask first, none loaded, no pause ---------------------------

const ASK_FIRST = await run(MATCH, { inLoop: await inLoopRouting({}) }, [[call('c1', PACK_NAME, OMITTED)]]);

test('in loop, every source Ask first and none loaded: a pack call reaches no server', () => {
  assert.deepEqual(methods(ASK_FIRST), [], 'the base received requests for a call the dispatch refused');
});

test('in loop, City Record listed and not loaded: the call is refused as not loaded, and the model is given the load-first line', () => {
  assert.deepEqual({ failed: ASK_FIRST.calls[0].failed, failureKind: ASK_FIRST.calls[0].failureKind }, { failed: true, failureKind: 'not_offered' });
  assert.deepEqual(ASK_FIRST.toolMessages, [notLoadedLine]);
});

test('a refused pack call still names its pack on the span, and its recorded arguments carry that pack\'s values', () => {
  assert.equal(attr(ASK_FIRST.spans[0], 'mcp.pack_id'), PACK_ID);
  assert.equal(attr(ASK_FIRST.spans[0], 'error.kind'), ASK_FIRST.calls[0].failureKind);
  assert.deepEqual(ASK_FIRST.calls[0].args, WITH_PACK_VALUES);
  assert.equal(attr(ASK_FIRST.spans[0], 'tool.arguments'), JSON.stringify(WITH_PACK_VALUES));
});

test('the chooser states no pack clause for a refused call whose source was never loaded', () => {
  const chooser = chooserFromTrace(ASK_FIRST.trace) as { groups?: { loaded: string[]; packs?: unknown } } | null;
  assert.ok(chooser?.groups, 'premise: the trace states the in-loop chooser');
  assert.deepEqual(chooser!.groups!.loaded, []);
  assert.equal(chooser!.groups!.packs, undefined);
});

// --- Criterion 2, all-sources: a selection that leaves the pack and its base out ------------------------

const LEFT_OUT_MATCH = await run(MATCH, { selection: ['data-commons'] }, [[call('a1', PACK_NAME, OMITTED)]]);
// The base is released as 0.9.3 with the same schemas, and its earlier sessions are dropped.
sessions.clear();
const LEFT_OUT_MISMATCH = await run(MISMATCH, { selection: ['data-commons'] }, [[call('a2', PACK_NAME, OMITTED)]]);

test('all-sources, a selection that leaves the pack and its base out: nothing reaches the base, matching or not', () => {
  assert.deepEqual(methods(LEFT_OUT_MATCH), [], 'the base received requests for a call the dispatch refused (base matching)');
  assert.deepEqual(methods(LEFT_OUT_MISMATCH), [], 'the base received requests for a call the dispatch refused (base at 0.9.3)');
});

test('all-sources, a selection that leaves the pack out: the call is recorded not_offered, never base_changed', () => {
  for (const r of [LEFT_OUT_MATCH, LEFT_OUT_MISMATCH]) {
    assert.deepEqual({ failed: r.calls[0].failed, failureKind: r.calls[0].failureKind }, { failed: true, failureKind: 'not_offered' });
  }
});

// --- Criterion 3: the send refuses a pack's tool outside the selection as not offered -------------------

const SOURCE_IDS = CIVIC_MANIFEST.map((entry) => entry.sourceId);
const SELECTIONS: Array<string[] | undefined> = [
  undefined,
  ...Array.from({ length: 2 ** SOURCE_IDS.length }, (_, mask) => SOURCE_IDS.filter((_, bit) => (mask >> bit) & 1)),
];
const PACK_NAMES = [...civicRouter.dispatchMap.values()].filter((t) => t.base !== undefined).map((t) => t.exposedName);

test('the send refuses a pack\'s tool the selection leaves out as not offered, whenever its base is routable', () => {
  const wrong: string[] = [];
  let rows = 0;
  for (const selection of SELECTIONS) {
    if (selection === undefined || selection.includes('nyc-record')) continue;
    for (const name of PACK_NAMES) {
      rows += 1;
      try {
        routeToolCall(buildMcpRegistry(configured, selection), name);
        wrong.push(`${name} under ${JSON.stringify(selection)}: routed`);
      } catch (error) {
        const line = describeToolFailureForLlm(name, error);
        if (!(error instanceof SourceNotOfferedError) || classifyStreamError(error) !== 'not_offered' || line !== describeToolFailureForLlm(name, new SourceNotOfferedError(name))) {
          wrong.push(`${name} under ${JSON.stringify(selection)}: ${(error as Error).name}, ${classifyStreamError(error)}`);
        }
      }
    }
  }
  assert.ok(rows >= 128, `the table cannot fail: ${rows} rows`);
  assert.deepEqual(wrong, []);
});

const BASE_LEFT_IN = await run(MATCH, { selection: ['socrata', 'data-commons'] }, [[call('b1', PACK_NAME, OMITTED)]]);

test('all-sources, the pack left out and its base selected: nothing is sent, recorded not_offered, and the model is given the not-offered line', () => {
  assert.deepEqual(methods(BASE_LEFT_IN), []);
  assert.deepEqual({ failed: BASE_LEFT_IN.calls[0].failed, failureKind: BASE_LEFT_IN.calls[0].failureKind }, { failed: true, failureKind: 'not_offered' });
  assert.deepEqual(BASE_LEFT_IN.toolMessages, [notOfferedLine]);
});

// --- Criterion 4, decoys ---------------------------------------------------------------------------------

test('decoy: a base\'s own tool the selection leaves out keeps its not-offered refusal', () => {
  assert.throws(() => routeToolCall(buildMcpRegistry(configured, ['nyc-record', 'data-commons']), 'socrata__get_data'), SourceNotOfferedError);
});

const SELECTED = await run(MATCH, { selection: ['nyc-record'] }, [[call('s1', PACK_NAME, OMITTED)]]);

test('decoy: a selected pack\'s call is checked, then sent with its pack\'s values and named on its span', () => {
  assert.deepEqual(methods(SELECTED).filter((m) => m === 'tools/list' || m.startsWith('tools/call')), ['tools/list', 'tools/call get_data']);
  assert.deepEqual(SELECTED.seen.find((s) => s.method === 'tools/call')?.args, WITH_PACK_VALUES);
  assert.notEqual(SELECTED.calls[0].failed, true);
  assert.equal(attr(SELECTED.spans[0], 'mcp.pack_id'), PACK_ID);
});

// --- Criterion 9: every name under every selection, through the loop core --------------------------------
//
// One turn calls every name in the dispatch map, both spellings, with arguments that omit the portal and the
// dataset. The transport sends nothing: it answers what the send would (`routeToolCall`). The check reads a base
// that matches, so it never decides a kind here. A row the dispatch refuses is recorded with the arguments the
// called name's pack gives it, exactly as the same call is recorded by a caller that supplies no decision; a row it
// accepts carries its target's pack's values.

const NAMES = [...new Set([...civicRouter.dispatchMap.keys(), ...[...civicRouter.dispatchMap.values()].map((t) => t.upstreamName)])].sort();

async function tableRun(selection: string[] | undefined, decided: boolean): Promise<ToolCallRecord[]> {
  const model = await startScriptedModelServer([{ toolCalls: NAMES.map((name, i) => call(`t${i}`, name, OMITTED)) }, { content: 'An answer.' }]);
  process.env.MODEL_API_BASE_URL = model.url;
  _resetDefaultModelClientForTests();
  try {
    const registry = buildMcpRegistry(configured, selection);
    return (await runToolLoop({
      client: getModelClient(),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: 'Every name.',
      tools: [],
      executeToolCall: async (name) => { routeToolCall(registry, name); return 'fixture answer, nothing sent'; },
      ...(decided ? { dispatchTarget: (name: string) => dispatchTargetOf(name, configured, selection) } : {}),
      checkBase: createBaseCheck({ read: async () => ({ serverInfo: GR.serverInfo, tools: GR.tools }) }),
    })).toolCalls;
  } finally {
    await new Promise((resolve) => model.server.close(resolve));
    _resetDefaultModelClientForTests();
  }
}

const TABLE: Array<{ selection: string[] | undefined; decided: ToolCallRecord[]; undecided: ToolCallRecord[] }> = [];
for (const selection of SELECTIONS) {
  TABLE.push({ selection, decided: await tableRun(selection, true), undecided: await tableRun(selection, false) });
}

/** The refused rows' recorded arguments, as measured on the tree before this change; sha256 of their canonical JSON. */
const REFUSED_ROWS_ARGUMENTS_SHA256 = 'ce8878e6d24d8fd8a44045f4d1dfe44331c59f7b1e126ca61e75fe6d84971e79';

test('every name the dispatch refuses, under every selection: the recorded arguments are the called name\'s, as a caller with no decision records them', () => {
  const parted: string[] = [];
  const refused: Array<[string[] | null, string, Record<string, unknown>]> = [];
  for (const { selection, decided, undecided } of TABLE) {
    for (const [i, name] of NAMES.entries()) {
      if (dispatchTargetOf(name, configured, selection) !== undefined) continue;
      refused.push([selection ?? null, name, decided[i].args]);
      if (JSON.stringify(decided[i].args) !== JSON.stringify(undecided[i].args)) {
        parted.push(`${name} under ${JSON.stringify(selection ?? null)}: ${JSON.stringify(decided[i].args)}, not ${JSON.stringify(undecided[i].args)}`);
      }
    }
  }
  assert.ok(refused.some(([, name, args]) => packFilterOf(name) !== undefined && args.portal === PACK.portal), 'the table cannot fail: no refused row carries a pack\'s values');
  assert.deepEqual(parted, []);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(refused)).digest('hex'), REFUSED_ROWS_ARGUMENTS_SHA256);
});

test('every name the dispatch accepts, under every selection: the injected values are its target\'s pack\'s', () => {
  const parted: string[] = [];
  let packRows = 0;
  for (const { selection, decided } of TABLE) {
    for (const [i, name] of NAMES.entries()) {
      const target = dispatchTargetOf(name, configured, selection);
      if (target === undefined) continue;
      const expected: Record<string, unknown> = structuredClone(OMITTED);
      const pack = packFilterOf(target);
      if (pack) { packRows += 1; injectPackFilter(upstreamToolName(name), expected, pack); }
      if (JSON.stringify(decided[i].args) !== JSON.stringify(expected)) parted.push(`${name} under ${JSON.stringify(selection ?? null)}: ${JSON.stringify(decided[i].args)}`);
    }
  }
  assert.ok(packRows > 0, 'the table cannot fail: no accepted row has a pack target');
  assert.deepEqual(parted, []);
});

// --- Criterion 10: a pack is credited only from calls that were sent --------------------------------------

const packsOf = (r: Run) => (chooserFromTrace(r.trace) as { groups?: { loaded: string[]; packs?: Record<string, { packId: string; base: string }> } } | null)?.groups;

const REFUSED_LOADED_SENT = await run(MATCH, { inLoop: await inLoopRouting({ 'nyc-record': 'on' }) }, [
  [call('r1', PACK_NAME, OMITTED)],
  [LOAD_CITY_RECORD],
  [call('r2', PACK_NAME, OMITTED)],
]);

test('a pack call refused before its source loaded, then the same call sent: the chooser credits the pack', () => {
  assert.equal(REFUSED_LOADED_SENT.calls[0].failed, true, 'premise: the first call was refused');
  assert.notEqual(REFUSED_LOADED_SENT.calls[2].failed, true, 'premise: the call after the load was sent');
  assert.deepEqual(packsOf(REFUSED_LOADED_SENT)?.packs, { 'NYC City Record': { packId: PACK_ID, base: 'Socrata' } });
});

const SENT_UNAVAILABLE = await run({ ...MATCH, call: 'status-500' }, { inLoop: await inLoopRouting({ 'nyc-record': 'on' }) }, [
  [LOAD_CITY_RECORD],
  [call('u1', PACK_NAME, OMITTED)],
]);
const SENT_TIMEOUT = await run({ ...MATCH, call: 'slow' }, { inLoop: await inLoopRouting({ 'nyc-record': 'on' }) }, [
  [LOAD_CITY_RECORD],
  [call('o1', PACK_NAME, OMITTED)],
], { toolTimeoutMs: 100 });

test('decoy: a sent pack call that failed unavailable or timed out still credits the pack', () => {
  assert.equal(SENT_UNAVAILABLE.calls[1].failureKind, 'unavailable', 'premise: the sent call failed unavailable');
  assert.equal(SENT_TIMEOUT.calls[1].failureKind, 'timeout', 'premise: the sent call timed out');
  for (const r of [SENT_UNAVAILABLE, SENT_TIMEOUT]) {
    assert.ok(methods(r).includes('tools/call get_data'), 'premise: the call reached the base');
    assert.deepEqual(packsOf(r)?.packs, { 'NYC City Record': { packId: PACK_ID, base: 'Socrata' } });
  }
});
