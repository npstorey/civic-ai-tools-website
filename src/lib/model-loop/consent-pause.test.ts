// #644 W2 — the just-in-time pause, driven through the real loop core.
//
// WHAT IS DRIVEN. `runToolLoop` with the options an in-loop run is given
// (`createInLoopRouting`, `src/lib/mcp/routing-mode.ts`) and the pause a
// streaming route hands it (`createConsentPause`, `src/lib/sources/decision.ts`),
// against the scripted model endpoint of `./test-harness.ts` and a fake
// key-value store that follows Redis's rules (`decision-store-for-tests.ts`),
// on a fake clock. The three sources are one loopback MCP server on three
// paths, and every outbound request in the process is counted.
//
// Criterion 1: a load of an Ask-first source writes `consent-decision:<key>`
// (the source id, and a reader code only under a `dbId`; 600 s expiry), then
// the loop emits `consent_pause` with no iteration, the key, the source's
// flows-statement entry, its hosts, the links, `expiresAt` and `holds`, and
// polls every 500 ms. It resolves `loaded` on `allow`, `declined` on
// `not-now`, `no-answer` after 60 s; contacts no source and makes no request
// of any kind during the hold; is not cut by the per-call bound; does not hold
// twice for one source; stops holding at 120 s in all; and ends `no-answer` on
// a failed poll read.
//
// Criterion 4 [A]: with no store, or a store whose write throws, the event
// says `holds: false` and the load records `no-answer` at once, never
// `unavailable`.
//
// Criterion 5, the model's side: after Not now and after no answer, the tool
// message is the stated text with no `{`, and the next request carries no
// tool of that source.
//
// THE FIXTURES ARE SHAPED SO THEY CAN FAIL. The decision arrives at 50 s on
// the fake clock and after more than the per-call bound on the real one; the
// cap legs use three Ask-first sources so a third hold is possible; the
// repeat leg loads the same source twice; each load names a source no other
// call touches.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/consent-pause.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FakeDecisionKv } from '../sources/decision-store-for-tests.ts';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;

// --- The loopback MCP sources, counting every request ------------------------------

const MCP_REQUESTS: Array<{ path: string; method?: string; tool?: string }> = [];
const ONE_ROW = JSON.stringify({ data: [{ count: '512' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }) : {};
  MCP_REQUESTS.push({ path: req.url ?? '', method: msg.method, tool: msg.params?.name });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r8-w2' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r8-w2-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// Every request this process makes, by address: the model endpoint, the MCP
// sources, and anything else (a sandbox call would be one).
const OUTBOUND: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  OUTBOUND.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  return realFetch(input, init);
}) as typeof fetch;

// --- Environment, before any app module loads ----------------------------------------

for (const name of ['DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION', 'SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'SITE_DEPLOYMENT_GUIDE_URL']) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.RATE_LIMIT_SECRET = 'fixture-w2-secret';

const { readMcpEnvFromProcess } = await import('../mcp/registry.ts');
const { buildFlowsStatementFor } = await import('../flows/statement.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, hash } = await import('../evidence/trace.ts');
const routingMode = (await import('../mcp/routing-mode.ts')) as Mod;
const { runToolLoop } = await import('./run-tool-loop.ts');
const { startScriptedModelServer } = await import('./test-harness.ts');
const { createModelClient } = await import('../model-client.ts');

/** The module W2 adds (a specifier typed `string`, so the red commit type-checks). */
const DECISION: string = '../sources/decision.ts';
const decision = (await import(DECISION).catch(() => null)) as Mod | null;

function need(): Mod {
  assert.ok(decision, 'src/lib/sources/decision.ts does not exist: there is no pause to hand the load step');
  return decision!;
}

const configured = readMcpEnvFromProcess();
const statement = buildFlowsStatementFor(null);
const PROMPT = 'How many potholes were reported in 2025?';
const ALL_ASK_FIRST = { socrata: 'ask-first', 'data-commons': 'ask-first', 'boston-opencontext': 'ask-first' };

// --- The fake clock and the drive --------------------------------------------------------

interface Clock { now: () => number; sleep: (ms: number) => Promise<void>; at: Array<{ t: number; act: () => Promise<void> | void }>; t: number }

function clock(): Clock {
  const c: Clock = {
    t: 1_800_000_000_000,
    at: [],
    now: () => c.t,
    // Each 500 ms of fake time costs real time too, so a bound measured in
    // real milliseconds would fire during a long hold.
    sleep: async (ms: number) => {
      c.t += ms;
      for (const due of c.at.filter((a) => a.t <= c.t)) {
        c.at.splice(c.at.indexOf(due), 1);
        await due.act();
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    },
  };
  return c;
}

interface Drive {
  requests: Json[];
  result: Awaited<ReturnType<typeof runToolLoop>>;
  trace: unknown;
  events: Json[];
  pauses: Json[];
  /** The run's clock when each pause was reported. */
  pausedAt: number[];
  kv: FakeDecisionKv;
  clock: Clock;
  outboundDuringHolds: string[][];
  mcpDuringHolds: number[];
  callToolDuringHolds: number[];
}

interface DriveOptions {
  states: Record<string, string>;
  script: Parameters<typeof startScriptedModelServer>[0];
  /** What the reader does, keyed by the pause's order in the run: a decision at a time after the pause, or nothing. */
  decide?: Array<{ afterMs: number; decision: 'allow' | 'not-now' } | null>;
  store?: 'fake' | 'none';
  dbId?: string;
  toolTimeoutMs?: number;
  kvSetup?: (kv: FakeDecisionKv) => void;
}

async function drive(options: DriveOptions): Promise<Drive> {
  const d = need();
  const c = clock();
  const kv = new FakeDecisionKv(c.now);
  options.kvSetup?.(kv);
  const directory = routingMode.directorySet(configured, { enforced: true, states: options.states });
  const selection = Object.entries(options.states).filter(([, s]) => s === 'on').map(([id]) => id);
  let callToolCount = 0;
  const callTool = async (name: string, args: Record<string, unknown>, opts: unknown) => {
    callToolCount += 1;
    const { callMcpTool } = await import('../mcp/client.ts');
    return callMcpTool(name, args, opts as never);
  };
  const outboundDuringHolds: string[][] = [];
  const mcpDuringHolds: number[] = [];
  const callToolDuringHolds: number[] = [];
  const pauses: Json[] = [];
  const pausedAt: number[] = [];
  const pause = d.createConsentPause({
    store: options.store === 'none' ? null : kv,
    statement,
    configured,
    ...(options.dbId ? { dbId: options.dbId } : {}),
    secret: process.env.RATE_LIMIT_SECRET,
    now: c.now,
    sleep: async (ms: number) => {
      const before = { outbound: OUTBOUND.length, mcp: MCP_REQUESTS.length, calls: callToolCount };
      await c.sleep(ms);
      const i = pauses.length - 1;
      outboundDuringHolds[i] = [...(outboundDuringHolds[i] ?? []), ...OUTBOUND.slice(before.outbound)];
      mcpDuringHolds[i] = (mcpDuringHolds[i] ?? 0) + (MCP_REQUESTS.length - before.mcp);
      callToolDuringHolds[i] = (callToolDuringHolds[i] ?? 0) + (callToolCount - before.calls);
    },
  });
  const session = await routingMode.createInLoopRouting({ configured, directory, selection, callTool, pause } as Parameters<typeof routingMode.createInLoopRouting>[0]);
  const scripted = await startScriptedModelServer(options.script);
  process.env.MODEL_API_BASE_URL = scripted.url;
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const events: Json[] = [];
  try {
    const result = await runToolLoop({
      client: createModelClient({ apiKey: 'placeholder-model-key-r8-w2' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: PROMPT,
      systemPrompt: session.firstSystemPrompt,
      tools: session.firstTools,
      executeToolCall: session.executeToolCall,
      loadStep: session.loadStep,
      toolTimeoutMs: options.toolTimeoutMs,
      trace: { builder, parentSpanId: builder.rootSpanId, systemPromptHash: hash(session.firstSystemPrompt), resolveToolSource: session.resolveToolSource },
      onEvent: (event) => {
        const e = event as unknown as Json;
        events.push(e);
        if (e.type !== 'consent_pause') return;
        const payload = e.pause as Json;
        pauses.push(payload);
        pausedAt.push(c.t);
        const plan = options.decide?.[pauses.length - 1];
        if (plan && typeof payload.key === 'string') {
          const name = `${d.DECISION_KEY_PREFIX}${payload.key}`;
          c.at.push({
            t: c.t + plan.afterMs,
            act: async () => {
              // Read off the map, not through \`get\`, so only the pause's own reads are counted.
              const entry = JSON.parse(kv.entries.get(name)!.value) as Json;
              await kv.set(name, { ...entry, decision: plan.decision }, { xx: true, keepTtl: true });
            },
          });
        }
      },
    });
    builder.endRoot();
    return { requests: scripted.requests, result, trace: builder.finalize(), events, pauses, pausedAt, kv, clock: c, outboundDuringHolds, mcpDuringHolds, callToolDuringHolds };
  } finally {
    delete process.env.MODEL_API_BASE_URL;
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

function toolNames(request: Json): string[] {
  return ((request.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
}
function toolMessage(request: Json, id: string): string | undefined {
  return ((request.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: string }>)
    .find((m) => m.role === 'tool' && m.tool_call_id === id)?.content;
}
type Span = { name: string; attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }> };
function loadSpans(trace: unknown): Array<Record<string, string | boolean | undefined>> {
  const spans = (trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
  return spans.filter((s) => s.name === 'mcp_tool_call')
    .map((s) => Object.fromEntries(s.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.boolValue])))
    .filter((a) => a['tool.operation_type'] === 'load_source');
}
const outcomes = (d: Drive) => d.result.toolCalls.filter((c) => c.operationType === 'load_source').map((c) => c.loadOutcome);

const load = (id: string, alias: string) => ({ toolCalls: [{ id, name: 'load_source', args: { alias } }] });
const ANSWER = { content: 'The answer, with what could not be checked.' };

// --- Criterion 1: the entry, then the event, then the hold ---------------------------------

const allowRun = await (async () => {
  try {
    return await drive({
      states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
      script: [load('load-boston', 'boston'), { toolCalls: [{ id: 'q-boston', name: 'boston__ckan__query_data', args: { resource_id: 'r-1', limit: 1 } }] }, ANSWER],
      decide: [{ afterMs: 50_000, decision: 'allow' }],
      toolTimeoutMs: 20,
    });
  } catch (error) {
    return error as Error;
  }
})();

function run(d: Drive | Error): Drive {
  if (d instanceof Error) throw d;
  return d;
}

test('criterion 1: a load of an Ask-first source writes the entry first: its name, the source id and no reader code, 600 s', () => {
  const d = run(allowRun);
  const writes = d.kv.calls.filter((c) => c.op === 'set');
  assert.ok(writes.length >= 1, 'the pause wrote nothing to the store');
  const first = writes[0];
  assert.match(first.key, /^consent-decision:[0-9a-f]{32}$/, 'the entry is not named consent-decision:<128-bit key>');
  assert.deepEqual(first.value, { sourceId: 'boston-opencontext' }, 'an anonymous entry holds the source id and nothing else');
  assert.equal(first.options?.ex, 600);
  assert.equal(need().DECISION_ENTRY_TTL_SECONDS, 600);
  // The write came before the event: the event's key names the entry written.
  assert.equal(`consent-decision:${d.pauses[0]?.key}`, first.key);
  const firstSetIndex = d.kv.calls.indexOf(first);
  const firstGetIndex = d.kv.calls.findIndex((c) => c.op === 'get');
  assert.ok(firstSetIndex < firstGetIndex, 'the store was polled before the entry was written');
});

test('criterion 1: the loop emits consent_pause with no iteration, the key, the source\'s statement entry, its hosts, the links, expiresAt and holds', () => {
  const d = run(allowRun);
  const pauseEvents = d.events.filter((e) => e.type === 'consent_pause');
  assert.equal(pauseEvents.length, 1, 'the loop emitted no consent_pause');
  const event = pauseEvents[0];
  assert.equal(Object.hasOwn(event, 'iteration'), false, 'the pause event carries an iteration');
  const payload = event.pause as Json;
  assert.match(String(payload.key), /^[0-9a-f]{32}$/);
  assert.equal(payload.holds, true);
  assert.deepEqual(payload.source, statement.sources.find((s) => s.sourceId === 'boston-opencontext'));
  assert.deepEqual(payload.links, statement.links);
  assert.deepEqual(payload.outbound, [], 'a remote source carries no manifest outbound hosts');
  // The hold's end: 60 s after the pause began, on the run's clock.
  assert.equal(payload.expiresAt, new Date(d.pausedAt[0] + 60_000).toISOString());
});

test('criterion 1: the hold polls every 500 ms, and resolves loaded on allow; the next request carries the source\'s tools', () => {
  const d = run(allowRun);
  assert.deepEqual(outcomes(d), ['loaded']);
  const reads = d.kv.calls.filter((c) => c.op === 'get' && c.key.startsWith('consent-decision:'));
  // 50 s at 500 ms: a hundred reads, the last one the decision.
  assert.equal(reads.length, 100, `the hold read the store ${reads.length} times`);
  assert.ok(toolNames(d.requests[1]).some((n) => n.startsWith('boston__')), 'after Allow the next request carries none of the source\'s tools');
  assert.deepEqual(loadSpans(d.trace).map((s) => s['tool.load_outcome']), ['loaded']);
});

test('criterion 1: during the hold no source is contacted, no tool is called and no request of any kind leaves', () => {
  const d = run(allowRun);
  assert.deepEqual(d.outboundDuringHolds[0] ?? [], [], 'a request left during the hold');
  assert.equal(d.mcpDuringHolds[0] ?? 0, 0, 'a source was contacted during the hold');
  assert.equal(d.callToolDuringHolds[0] ?? 0, 0, 'a tool call was made during the hold');
  // The instrument sees requests: the call after the load reached Boston.
  assert.ok(MCP_REQUESTS.some((r) => r.path === '/boston/mcp' && r.method === 'tools/call'), 'premise: the counter saw no request at all');
});

test('criterion 1: the hold runs past the per-call bound and is not cut by it', () => {
  const d = run(allowRun);
  // 50 s on the fake clock, and over 200 ms of real time, against a 20 ms bound.
  assert.equal(outcomes(d)[0], 'loaded', 'the per-call bound cut the hold');
  assert.ok(!d.result.toolCalls.some((c) => c.failureKind === 'timeout' && c.operationType === 'load_source'), 'the load was recorded as timed out');
});

test('criterion 1 and 5: Not now resolves declined; the tool message is the stated text with no brace, and the next request carries no tool of that source', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'ask-first', 'boston-opencontext': 'off' },
    script: [load('load-dc', 'data_commons'), ANSWER],
    decide: [{ afterMs: 3_000, decision: 'not-now' }],
  });
  assert.equal(d.pauses.length, 1, 'premise: the run paused');
  assert.deepEqual(outcomes(d), ['declined']);
  const text = toolMessage(d.requests[1], 'load-dc') ?? '';
  assert.equal(text, routingMode.LOAD_RESULT_TEXT.declined('data_commons'));
  assert.ok(!text.includes('{') && !text.includes('\n'), `the text: ${text}`);
  assert.deepEqual(toolNames(d.requests[1]), ['load_source'], 'the next request carries a tool beyond load_source');
});

test('criterion 1 and 5: no decision in 60 s resolves no-answer, with its own text, no brace, and no tool of that source', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'ask-first', 'boston-opencontext': 'off' },
    script: [load('load-dc', 'data_commons'), ANSWER],
  });
  assert.equal(d.pauses.length, 1, 'premise: the run paused');
  assert.deepEqual(outcomes(d), ['no-answer']);
  const reads = d.kv.calls.filter((c) => c.op === 'get' && c.key.startsWith('consent-decision:'));
  assert.equal(reads.length, 120, `a 60 s hold read the store ${reads.length} times`);
  const text = toolMessage(d.requests[1], 'load-dc') ?? '';
  assert.equal(typeof routingMode.LOAD_RESULT_TEXT.noAnswer, 'function', 'routing-mode.ts has no no-answer text');
  assert.equal(text, routingMode.LOAD_RESULT_TEXT.noAnswer('data_commons'));
  assert.notEqual(text, routingMode.LOAD_RESULT_TEXT.declined('data_commons'));
  assert.ok(!text.includes('{') && !text.includes('\n'), `the text: ${text}`);
  assert.match(text, /Do not call load_source for it again/);
  assert.match(text, /say what could not be checked/);
  assert.deepEqual(toolNames(d.requests[1]), ['load_source']);
  assert.deepEqual(loadSpans(d.trace).map((s) => s['tool.load_outcome']), ['no-answer']);
});

test('criterion 1: a second load of the same source does not hold again and repeats the first outcome', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
    script: [load('load-1', 'boston'), load('load-2', 'boston'), ANSWER],
    decide: [{ afterMs: 1_000, decision: 'not-now' }],
  });
  assert.equal(d.pauses.length, 1, `the run paused ${d.pauses.length} times for one source`);
  assert.equal(d.kv.decisionKeys().length, 1, 'a second entry was written');
  assert.deepEqual(outcomes(d), ['declined', 'declined']);
});

test('criterion 1: a run\'s holds stop at 120 s in all: a hold after 90 s lasts 30 s', async () => {
  const d = await drive({
    states: ALL_ASK_FIRST,
    script: [load('l1', 'socrata'), load('l2', 'data_commons'), load('l3', 'boston'), ANSWER],
    decide: [null, { afterMs: 30_000, decision: 'not-now' }, null],
  });
  assert.deepEqual(outcomes(d), ['no-answer', 'declined', 'no-answer']);
  assert.equal(d.pauses.length, 3);
  const third = d.pauses[2];
  assert.equal(third.holds, true);
  const reads = d.kv.calls.filter((c) => c.op === 'get' && c.key === `consent-decision:${third.key}`);
  assert.equal(reads.length, 60, `the third hold read the store ${reads.length} times; 30 s at 500 ms is 60`);
});

test('criterion 1: once a run\'s holds reach 120 s, a further Ask-first load is no-answer with no hold and no entry', async () => {
  const d = await drive({
    states: ALL_ASK_FIRST,
    script: [load('l1', 'socrata'), load('l2', 'data_commons'), load('l3', 'boston'), ANSWER],
  });
  assert.deepEqual(outcomes(d), ['no-answer', 'no-answer', 'no-answer']);
  assert.equal(d.kv.decisionKeys().length, 2, 'the third load wrote an entry after the budget was spent');
  const third = d.pauses[2];
  assert.equal(third?.holds, false, 'the third pause event does not say it holds nothing');
  assert.equal(Object.hasOwn(third ?? {}, 'key'), false, 'a pause that does not hold carries a key');
});

test('criterion 1: a failed poll read ends the hold as no-answer', async () => {
  let reads = 0;
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
    script: [load('load-boston', 'boston'), ANSWER],
    kvSetup: (kv) => {
      const get = kv.get.bind(kv);
      kv.get = async (key: string) => {
        reads += 1;
        if (reads === 3) throw new Error('fake store: the read was refused');
        return get(key);
      };
    },
  });
  assert.deepEqual(outcomes(d), ['no-answer']);
  assert.equal(reads, 3, `the hold kept reading after a failed read (${reads} reads)`);
});

test('criterion 1 [D]: under a dbId the entry also holds the reader code, HMAC-SHA256 under the pause\'s own label', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
    script: [load('load-boston', 'boston'), ANSWER],
    dbId: '11111111-1111-4111-8111-111111111111',
  });
  const first = d.kv.calls.find((c) => c.op === 'set');
  const code = need().readerCode('11111111-1111-4111-8111-111111111111', 'fixture-w2-secret');
  assert.match(code, /^[0-9a-f]{64}$/);
  assert.deepEqual(first?.value, { sourceId: 'boston-opencontext', reader: code });
  assert.ok(!JSON.stringify(first?.value).includes('11111111-1111-4111-8111-111111111111'), 'the raw dbId reached the store');
  const { createHmac } = await import('node:crypto');
  const limiterLike = createHmac('sha256', 'fixture-w2-secret').update('civic-rate-limit-day-key-v1:11111111-1111-4111-8111-111111111111').digest('hex');
  assert.notEqual(code, limiterLike, 'the reader code is keyed under the limiter\'s label');
});

// --- Criterion 4 [A]: no store, or a store that fails --------------------------------------

test('criterion 4: with the pair unset there is no store: holds false, no-answer at once, no entry, no wait', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
    script: [load('load-boston', 'boston'), ANSWER],
    store: 'none',
  });
  assert.equal(need().decisionStoreFromEnv(), null, 'with the pair unset the store is not null');
  assert.deepEqual(outcomes(d), ['no-answer']);
  assert.equal(d.pauses.length, 1, 'no event says the source could not be asked about');
  assert.equal(d.pauses[0].holds, false);
  assert.equal(Object.hasOwn(d.pauses[0], 'key'), false, 'a pause with no store carries a key');
  assert.deepEqual(d.pauses[0].source, statement.sources.find((s) => s.sourceId === 'boston-opencontext'));
  assert.equal(d.kv.calls.length, 0);
  assert.equal(toolMessage(d.requests[1], 'load-boston'), routingMode.LOAD_RESULT_TEXT.noAnswer('boston'));
});

test('criterion 4 [A]: a store whose write throws gives the same no-answer with holds false, never unavailable', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
    script: [load('load-boston', 'boston'), ANSWER],
    kvSetup: (kv) => { kv.failSet = true; },
  });
  assert.deepEqual(outcomes(d), ['no-answer']);
  assert.notEqual(outcomes(d)[0], 'unavailable');
  assert.equal(d.pauses[0]?.holds, false);
  assert.equal(d.kv.calls.filter((c) => c.op === 'get').length, 0, 'a hold polled after its write failed');
});

test('criterion 4 [A]: a store whose read throws mid-hold gives no-answer, never unavailable', async () => {
  let reads = 0;
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
    script: [load('load-boston', 'boston'), ANSWER],
    kvSetup: (kv) => {
      const get = kv.get.bind(kv);
      kv.get = async (key: string) => { reads += 1; if (reads >= 5) throw new Error('down'); return get(key); };
    },
  });
  assert.deepEqual(outcomes(d), ['no-answer']);
  assert.equal(d.pauses[0]?.holds, true);
});

// --- Criterion 7: the event and the load span carry nothing of the pause ------------------

test('criterion 7: the consent_pause event\'s args and message carry no key, and the load span carries the base\'s five attributes only', () => {
  const d = run(allowRun);
  const event = d.events.find((e) => e.type === 'consent_pause')!;
  const key = String((event.pause as Json).key);
  assert.equal(Object.hasOwn(event, 'args'), false);
  assert.equal(Object.hasOwn(event, 'message'), false, 'the loop event carries reader copy');
  const span = loadSpans(d.trace)[0];
  assert.deepEqual(Object.keys(span).sort(), ['tool.arguments', 'tool.duration_ms', 'tool.load_outcome', 'tool.name', 'tool.operation_type']);
  assert.ok(!JSON.stringify(d.trace).includes(key), 'the key reached the trace');
});
