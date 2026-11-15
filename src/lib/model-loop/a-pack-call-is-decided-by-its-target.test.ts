// S2-B F1 (npstorey/civic-ai-tools#309), criteria 1 to 6: a pack's call is decided once, from the target the
// dispatch sends to.
//
// THE RULE. The loop core applies a pack's filter (its injection and its refusal), names the pack on the span
// (`mcp.pack_id`) and runs the base check for a call whose TARGET is a pack: the target the transport's dispatch
// resolves the called name to, over the selection that transport sends with. The called name's spelling does not
// decide it: a bare upstream name the dispatch resolves to a pack is a pack call, decided exactly as the aliased
// name is.
//
// WHAT IS DRIVEN. The real loop core, the real MCP client and the real trace builder, entered through the three
// entry points this file can reach without a route: `/api/compare`'s factory (`compareLoopOptions`), the replay's
// (`replayLoopOptionsForPackage`, both record shapes), and the streaming loop (`queryWithMcpStreaming`) with an
// in-loop routing as its transport, as the two streaming routes hand it. The streaming routes themselves are driven
// in `src/app/api/a-pack-call-is-decided-by-its-target-routes-driven.test.ts`; the eval harness in
// `scripts/eval-models-pack-call.test.mjs`. The base is a loopback server that keeps sessions as the deployed
// Socrata server does and reports and lists what `fixtures/socrata-tools-at-gr.json` holds, or that with its
// version moved to 0.9.3.
//
// SHAPED TO FAIL. Each refused call's portal and dataset (`data.sfgov.org`, `erm2-nwe9`) and the `fetch`
// identifier are outside City Record's fixed values; no portal lock is set, so no other refusal can stand in for
// the pack's. The check's mismatch is on `serverVersion` alone. The two decoys are shapes in which a wrong decision
// shows: with both sources offered the name must stay refused as ambiguous, and with Socrata alone it must stay the
// base's own call, sent to a base that does not match a pin (a pack decision would refuse it).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { ScriptedToolCall } from './test-harness.ts';
import type { ToolCallRecord, ToolLoopOptions } from './run-tool-loop.ts';
import type { InLoopRouting } from '../mcp/routing-mode.ts';
import type { CompletionResult } from '../openrouter-streaming.ts';

// --- The base server -----------------------------------------------------------------------------------

const GR = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'fixtures', 'socrata-tools-at-gr.json'), 'utf8')) as {
  serverInfo: { name: string; version: string };
  tools: Array<Record<string, unknown>>;
};

interface BaseMode {
  serverInfo: { name: string; version: string };
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
    // A session of an earlier run: the client starts a new one, as it must on a 404, and reads this run's report.
    base.seen[base.seen.length - 1].method = `${body.method} (earlier session, refused)`;
    answer(404, { error: { code: -32001, message: 'Session not found' } });
    return;
  }
  if (body.method === 'tools/list') { answer(200, { result: { tools: GR.tools } }); return; }
  answer(200, { result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ notice: 'fixture row' }], total_rows: 1 }) }] } });
});
await new Promise<void>((resolve) => baseServer.listen(0, '127.0.0.1', () => resolve()));
baseServer.unref();

for (const k of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'SOURCE_ROUTING', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(baseServer.address() as AddressInfo).port}/mcp`;
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/mcp';
process.env.OPENROUTER_API_KEY = 'not-a-credential-s2b-f1';

const { startScriptedModelServer } = await import('./test-harness.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { compareLoopOptions } = await import('./compare-loop.ts');
const { replayLoopOptionsForPackage } = await import('./replay-loop.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { carriedModelIdentity } = await import('../model-catalog.ts');
const { readMcpEnvFromProcess, routedSourceId } = await import('../mcp/registry.ts');
const { createInLoopRouting, directorySet } = await import('../mcp/routing-mode.ts');
const { packFilterOf } = await import('../mcp/pack-filter.ts');
const { packFilterRefusalForLlm } = await import('../streaming.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');

const configured = readMcpEnvFromProcess();
const PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';
const PACK = packFilterOf('nyc_record__get_data')!;
const OUTSIDE = { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.sfgov.org', query: 'SELECT * LIMIT 1' };
const INSIDE_OMITTED = { type: 'query', query: 'SELECT * LIMIT 1' };
const INSIDE_STATED = { type: 'query', dataset_id: 'dg92-zbpx', portal: 'data.cityofnewyork.us', query: 'SELECT * LIMIT 1' };
const FETCH_OUTSIDE = { id: 'dataset:data.sfgov.org:erm2-nwe9' };
const call = (id: string, name: string, args: Record<string, unknown>): ScriptedToolCall => ({ id, name, args: structuredClone(args) });
const LOAD_CITY_RECORD = call('load', 'load_source', { alias: 'nyc_record' });

type Attr = { key: string; value?: { stringValue?: string; boolValue?: boolean; intValue?: number | string } };
type Span = { spanId: string; name: string; attributes?: Attr[] };

interface Run {
  calls: ToolCallRecord[];
  spans: Span[];
  seen: Seen[];
  toolMessages: string[];
  loaded?: string[];
}

type Entry =
  | { via: 'compare'; selection?: string[]; inLoop?: InLoopRouting }
  | { via: 'stream'; inLoop: InLoopRouting }
  | { via: 'replay'; pkg: Record<string, unknown> };

/** One run through one entry point: each element of `turns` is one model turn's tool calls; the run then answers. */
async function run(mode: BaseMode, entry: Entry, turns: ScriptedToolCall[][]): Promise<Run> {
  base.mode = mode;
  base.generation += 1;
  const seenFrom = base.seen.length;
  const model = await startScriptedModelServer([...turns.map((toolCalls) => ({ toolCalls })), { content: 'An answer.' }]);
  process.env.MODEL_API_BASE_URL = model.url;
  _resetDefaultModelClientForTests();
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const prompt = 'What did the City Record publish this week?';
  try {
    let calls: ToolCallRecord[];
    if (entry.via === 'stream') {
      let completion: CompletionResult | undefined;
      await queryWithMcpStreaming(
        prompt,
        carriedModelIdentity('fake/model'),
        entry.inLoop.firstTools,
        entry.inLoop,
        entry.inLoop.firstSystemPrompt,
        {
          onProgress: () => {},
          onToken: () => {},
          onComplete: (_panel, result) => { completion = result; },
          onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
        },
        { builder, parentSpanId: builder.rootSpanId, resolveToolSource: entry.inLoop.resolveToolSource },
      );
      assert.ok(completion, 'the streaming loop did not complete');
      calls = (completion!.tools_called ?? []) as ToolCallRecord[];
    } else {
      let options: ToolLoopOptions;
      if (entry.via === 'compare') {
        const { selection, inLoop } = entry;
        options = {
          ...compareLoopOptions({
            client: getModelClient(),
            endpointModel: 'fake/model',
            requestSettings: undefined,
            prompt,
            systemPrompt: 'A fixture system prompt.',
            configured,
            ...(selection ? { selection } : {}),
            ...(inLoop ? { inLoop } : {}),
          }),
          trace: {
            builder,
            parentSpanId: builder.rootSpanId,
            resolveToolSource: inLoop ? inLoop.resolveToolSource : (name: string) => routedSourceId(name, configured, selection),
          },
        };
      } else {
        options = await replayLoopOptionsForPackage({
          pkg: entry.pkg as unknown as Parameters<typeof replayLoopOptionsForPackage>[0]['pkg'],
          client: getModelClient(),
          endpointModel: 'fake/model',
          requestSettings: undefined,
          prompt,
          composeSystemPrompt: async () => 'A fixture system prompt.',
        });
      }
      calls = (await runToolLoop(options)).toolCalls;
    }
    builder.endRoot();
    const trace = builder.finalize() as unknown as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };
    const spans = trace.resourceSpans[0].scopeSpans[0].spans.filter(
      (s) => s.name === 'mcp_tool_call' && s.attributes?.find((a) => a.key === 'tool.operation_type')?.value?.stringValue !== 'load_source',
    );
    const toolMessages = model.requests.flatMap((r) => ((r.messages as Array<{ role: string; content?: string }>) ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content)));
    return {
      calls: calls.filter((c) => c.operationType !== 'load_source'),
      spans,
      seen: base.seen.slice(seenFrom),
      toolMessages: [...new Set(toolMessages)],
      ...('inLoop' in entry && entry.inLoop ? { loaded: entry.inLoop.loaded() } : {}),
    };
  } finally {
    await new Promise((resolve) => model.server.close(resolve));
    _resetDefaultModelClientForTests();
  }
}

const attr = (span: Span | undefined, key: string): unknown => {
  const v = span?.attributes?.find((a) => a.key === key)?.value;
  return v === undefined ? undefined : v.stringValue ?? v.boolValue ?? v.intValue;
};
const sent = (r: Run) => r.seen.filter((s) => s.method === 'tools/call');
const lists = (r: Run) => r.seen.filter((s) => s.method === 'tools/list').length;
const PARITY_KEYS = ['mcp.source', 'mcp.alias', 'mcp.server.id', 'mcp.pack_id', 'tool.upstream_name', 'tool.arguments', 'error.kind'];
const parityOf = (r: Run) => ({ ...Object.fromEntries(PARITY_KEYS.map((k) => [k, attr(r.spans[0], k)])), failureKind: r.calls[0]?.failureKind });

/** A call refused by the pack's filter before anything was sent, recorded as the aliased call's refusal is. */
function assertPackRefused(r: Run, what: string): void {
  assert.deepEqual(sent(r).map((s) => `${s.tool} ${JSON.stringify(s.args)}`), [], `${what}: the base received the call`);
  assert.equal(lists(r), 0, `${what}: the base's list was read for a call the filter refuses`);
  assert.equal(r.calls[0].failed, true, `${what}: the call is not recorded failed`);
  assert.equal(r.calls[0].failureKind, 'unknown', `${what}: recorded ${r.calls[0].failureKind}`);
  assert.ok(r.toolMessages.includes(packFilterRefusalForLlm(PACK)), `${what}: the model was not told the pack's refusal; it was told ${JSON.stringify(r.toolMessages)}`);
}

// --- Criterion 1: all-sources, the pack offered alone ---------------------------------------------------------

const C1_BARE = await run(MATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('b', 'get_data', OUTSIDE)]]);
const C1_ALIASED = await run(MATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('a', 'nyc_record__get_data', OUTSIDE)]]);

test('a bare name the dispatch resolves to a pack, outside its portal and dataset, is refused before anything is sent', () => {
  assertPackRefused(C1_BARE, 'bare get_data, the pack offered alone');
  assert.equal(attr(C1_BARE.spans[0], 'mcp.pack_id'), PACK_ID);
  assert.equal(attr(C1_BARE.spans[0], 'tool.name'), 'get_data');
});

test('the bare call is recorded as the aliased call with the same arguments is', () => {
  assertPackRefused(C1_ALIASED, 'premise: the aliased call');
  assert.deepEqual(parityOf(C1_BARE), parityOf(C1_ALIASED), 'the bare call is recorded otherwise than the aliased call');
});

// --- Criterion 2: in-loop, Socrata Ask first and City Record On, no pause ---------------------------------------

const inLoopRouting = () =>
  createInLoopRouting({
    configured,
    directory: directorySet(configured, { enforced: true, states: { socrata: 'ask-first', 'nyc-record': 'on', 'data-commons': 'off' } }),
    selection: ['nyc-record'],
  });

for (const via of ['stream', 'compare'] as const) {
  const inLoop = await inLoopRouting();
  const C2 = await run(MATCH, { via, inLoop }, [[LOAD_CITY_RECORD], [call('b', 'get_data', OUTSIDE)]]);
  test(`in loop (${via === 'stream' ? 'the streaming loop' : "/api/compare's factory"}): with City Record loaded alone, a bare get_data outside its values reaches no server`, () => {
    assert.deepEqual(C2.loaded, ['nyc-record'], 'premise: the model loaded City Record alone');
    assertPackRefused(C2, 'in-loop bare get_data');
    assert.equal(attr(C2.spans[0], 'mcp.pack_id'), PACK_ID);
  });
}

// --- Criterion 3: the base check, by the bare name ------------------------------------------------------------

const C3_MISMATCH_BARE = await run(MISMATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('b', 'get_data', INSIDE_OMITTED)]]);
const C3_MISMATCH_ALIASED = await run(MISMATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('a', 'nyc_record__get_data', INSIDE_OMITTED)]]);

test('the check by the bare name: a base reporting 0.9.3 is read, nothing is sent, and the call is recorded base_changed', () => {
  assert.equal(sent(C3_MISMATCH_BARE).length, 0, 'the bare pack call was sent to a base that matches no pin');
  assert.ok(lists(C3_MISMATCH_BARE) >= 1, "the base's list was not read before the bare pack call");
  assert.equal(C3_MISMATCH_BARE.calls[0].failed, true);
  assert.equal(C3_MISMATCH_BARE.calls[0].failureKind, 'base_changed');
  assert.equal(attr(C3_MISMATCH_BARE.spans[0], 'mcp.pack_id'), PACK_ID);
});

test('the check by the bare name: a mismatch is recorded as the aliased call is, but for its name', () => {
  assert.equal(C3_MISMATCH_ALIASED.calls[0].failureKind, 'base_changed', 'premise: the aliased call is refused base_changed');
  assert.deepEqual(parityOf(C3_MISMATCH_BARE), parityOf(C3_MISMATCH_ALIASED), 'the bare call is recorded otherwise than the aliased call');
  assert.notEqual(attr(C3_MISMATCH_BARE.spans[0], 'tool.name'), attr(C3_MISMATCH_ALIASED.spans[0], 'tool.name'));
});

const C3_MATCH_BARE = await run(MATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('b', 'get_data', INSIDE_OMITTED)]]);
const C3_MATCH_ALIASED = await run(MATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('a', 'nyc_record__get_data', INSIDE_OMITTED)]]);
const C3_MATCH_STATED = await run(MATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('s', 'get_data', INSIDE_STATED)]]);

test("the check by the bare name: a matching base is read, then the call is sent with the pack's portal and dataset", () => {
  const calls = sent(C3_MATCH_BARE);
  assert.equal(calls.length, 1, 'the bare pack call was not sent to a matching base');
  assert.equal(calls[0].args?.portal, 'data.cityofnewyork.us', "the pack's portal was not injected");
  assert.equal(calls[0].args?.dataset_id, 'dg92-zbpx', "the pack's dataset was not injected");
  assert.ok(lists(C3_MATCH_BARE) >= 1, "the base's list was not read before the bare pack call");
  assert.notEqual(C3_MATCH_BARE.calls[0].failed, true);
  assert.equal(attr(C3_MATCH_BARE.spans[0], 'mcp.pack_id'), PACK_ID);
});

test("the check by the bare name: a call naming City Record's own portal and dataset is checked and named as the pack's", () => {
  assert.equal(sent(C3_MATCH_STATED).length, 1);
  assert.ok(lists(C3_MATCH_STATED) >= 1, "the base's list was not read before the bare pack call");
  assert.equal(attr(C3_MATCH_STATED.spans[0], 'mcp.pack_id'), PACK_ID);
});

test('the check by the bare name: a match is recorded as the aliased call is, but for its name', () => {
  assert.equal(sent(C3_MATCH_ALIASED).length, 1, 'premise: the aliased call is sent');
  assert.deepEqual(parityOf(C3_MATCH_BARE), parityOf(C3_MATCH_ALIASED), 'the bare call is recorded otherwise than the aliased call');
  assert.deepEqual(sent(C3_MATCH_BARE)[0].args, sent(C3_MATCH_ALIASED)[0].args, 'the two spellings sent different arguments');
});

// --- Criterion 4: a bare fetch --------------------------------------------------------------------------------

const C4 = await run(MATCH, { via: 'compare', selection: ['nyc-record'] }, [[call('f', 'fetch', FETCH_OUTSIDE)]]);
test("a bare fetch the dispatch resolves to a pack, of an identifier outside its pattern, is refused before anything is sent", () => {
  assertPackRefused(C4, 'bare fetch, the pack offered alone');
  assert.equal(attr(C4.spans[0], 'mcp.pack_id'), PACK_ID);
});

// --- Criterion 5: decoys (green before and after) ---------------------------------------------------------------

const C5_BOTH = await run(MATCH, { via: 'compare', selection: ['socrata', 'nyc-record'] }, [[call('b', 'get_data', OUTSIDE)]]);
test('decoy: with Socrata and City Record both offered, a bare get_data is refused as ambiguous, naming both full names', () => {
  assert.equal(sent(C5_BOTH).length, 0);
  assert.equal(C5_BOTH.calls[0].failed, true);
  assert.equal(C5_BOTH.toolMessages.length, 1);
  assert.match(C5_BOTH.toolMessages[0], /socrata__get_data/);
  assert.match(C5_BOTH.toolMessages[0], /nyc_record__get_data/);
});

const C5_SOCRATA = await run(MISMATCH, { via: 'compare', selection: ['socrata'] }, [[call('b', 'get_data', OUTSIDE)]]);
test("decoy: with Socrata offered alone, a bare get_data is the base's own call: sent, no list read, no pack named", () => {
  assert.deepEqual(sent(C5_SOCRATA).map((s) => s.args?.portal), ['data.sfgov.org']);
  assert.equal(lists(C5_SOCRATA), 0);
  assert.notEqual(C5_SOCRATA.calls[0].failed, true);
  assert.equal(attr(C5_SOCRATA.spans[0], 'mcp.pack_id'), undefined);
});

// --- Criterion 6: the replay of a record stating City Record alone ---------------------------------------------

const recordStating = (routing?: 'in-loop') => ({
  queries: [],
  dataSources: [],
  extensions: {
    'org.civicaitools.composition': {
      sourcesOffered: [
        { sourceId: 'socrata', alias: 'socrata', reason: 'reader-off' },
        { sourceId: 'data-commons', alias: 'data_commons', reason: 'reader-off' },
        { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'selected' },
      ],
      ...(routing ? { routing: { method: routing, version: '0.9.0' } } : {}),
    },
  },
});

const C6_ALL = await run(MATCH, { via: 'replay', pkg: recordStating() }, [[call('b', 'get_data', OUTSIDE)]]);
test('replay of an all-sources record stating City Record alone: the bare get_data outside its values is refused', () => {
  assertPackRefused(C6_ALL, 'replay, all-sources record');
});

const C6_IN_LOOP = await run(MATCH, { via: 'replay', pkg: recordStating('in-loop') }, [[LOAD_CITY_RECORD], [call('b', 'get_data', OUTSIDE)]]);
test('replay of an in-loop record stating City Record alone: the bare get_data outside its values is refused', () => {
  assertPackRefused(C6_IN_LOOP, 'replay, in-loop record');
});
