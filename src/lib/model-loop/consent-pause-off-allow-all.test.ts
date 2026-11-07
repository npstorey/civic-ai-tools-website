// UX-2 P4b, criteria 5 and 6 in the run (D7 = C; ASK2 = B with S4; L10),
// driven through the real loop core.
//
//   - `off` ("Don't allow" at the pause): the hold's poll reads it from the
//     entry (`decision.ts:283`) and the load step declines the source, with the
//     declined text, as `not-now` does today. A later run whose directory holds
//     the source Off never asks about it.
//   - `allow-all` ("Allow all data sources"): the load that paused loads the
//     source, and the run is marked: a later load of another Ask-first source
//     in the same run loads with no pause and writes no entry (S4: "no further
//     pause in this run"). The mark sits in `createInLoopRouting`, beside
//     `asked` (`routing-mode.ts:285`), checked where a load reads its entry's
//     state (`:300`); the directory itself is fixed at the run's start.
//
// WHAT IS DRIVEN. `runToolLoop` with the options an in-loop run is given
// (`createInLoopRouting`) and the pause a streaming route hands it
// (`createConsentPause`), against the scripted model endpoint and the fake
// store, on a fake clock, as `consent-pause.test.ts` drives them (its harness
// is copied here, with the decision widened to the new values).
//
// THE SHAPE THAT CAN FAIL. Two distinct sources, both Ask first at the run's
// start, loaded in turn; Allow all is given at the first pause only. THE DECOY:
// the same run with `allow` at the first pause (no run-level mark) pauses on
// the second load, so the instrument reads a second pause when one happens.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the poll does not recognize `off` or
// `allow-all`: each hold runs to its 60 s bound and ends `no-answer`, and the
// second load pauses.
//
// Run with: npm test

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
  decide?: Array<{ afterMs: number; decision: 'allow' | 'not-now' | 'off' | 'allow-all' } | null>;
  store?: 'fake' | 'none';
  dbId?: string;
  toolTimeoutMs?: number;
  kvSetup?: (kv: FakeDecisionKv) => void;
  /** R9 P1: the reader's stream goes this long after the first pause (its signal aborts). */
  goneAfterMs?: number;
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
  const gone = new AbortController();
  const pause = d.createConsentPause({
    gone: gone.signal,
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
        if (options.goneAfterMs !== undefined && pauses.length === 1) c.at.push({ t: c.t + options.goneAfterMs, act: () => gone.abort() });
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
const outcomes = (d: Drive) => d.result.toolCalls.filter((c) => c.operationType === 'load_source').map((c) => c.loadOutcome);

const load = (id: string, alias: string) => ({ toolCalls: [{ id, name: 'load_source', args: { alias } }] });
const ANSWER = { content: 'The answer, with what could not be checked.' };

// --- off ----------------------------------------------------------------------------------------

test('UX-2 P4b criterion 5: off at the pause declines the source in the current run, with the declined text and no tool of that source', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'ask-first', 'boston-opencontext': 'off' },
    script: [load('load-dc', 'data_commons'), ANSWER],
    decide: [{ afterMs: 3_000, decision: 'off' }],
  });
  assert.equal(d.pauses.length, 1, 'premise: the run paused');
  assert.deepEqual(outcomes(d), ['declined'], 'off did not decline the source');
  assert.equal(toolMessage(d.requests[1], 'load-dc'), routingMode.LOAD_RESULT_TEXT.declined('data_commons'));
  assert.deepEqual(toolNames(d.requests[1]), ['load_source'], 'the next request carries a tool of the declined source');
  assert.ok(d.clock.t - d.pausedAt[0] < 60_000, 'the hold ran to its bound: the poll did not read off');
});

test('UX-2 P4b criterion 5 (guard): a later run whose directory holds the source Off lists it nowhere and asks nothing about it', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' },
    script: [load('load-dc', 'data_commons'), ANSWER],
  });
  assert.equal(d.pauses.length, 0, 'the run paused for a source the reader turned Off');
  assert.deepEqual(outcomes(d), ['not-offered']);
});

// --- allow-all ----------------------------------------------------------------------------------

test('UX-2 P4b criterion 6 (S4): Allow all at the first pause loads that source, and the second Ask-first source loads with no pause and no entry', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'ask-first', 'boston-opencontext': 'ask-first' },
    script: [load('load-dc', 'data_commons'), load('load-boston', 'boston'), ANSWER],
    decide: [{ afterMs: 2_000, decision: 'allow-all' }],
  });
  assert.equal(d.pauses.length, 1, `the run paused ${d.pauses.length} times after Allow all`);
  assert.equal(d.kv.decisionKeys().length, 1, 'the second load wrote an entry after Allow all');
  assert.deepEqual(outcomes(d), ['loaded', 'loaded'], 'after Allow all both sources did not load');
  assert.ok(d.clock.t - d.pausedAt[0] < 60_000, 'the first hold ran to its bound: the poll did not read allow-all');
});

test('UX-2 P4b criterion 6 (decoy): the same run with Allow, not Allow all, at the first pause pauses on the second load', async () => {
  const d = await drive({
    states: { socrata: 'on', 'data-commons': 'ask-first', 'boston-opencontext': 'ask-first' },
    script: [load('load-dc', 'data_commons'), load('load-boston', 'boston'), ANSWER],
    decide: [{ afterMs: 2_000, decision: 'allow' }],
  });
  assert.equal(d.pauses.length, 2, 'the decoy did not pause on the second load: the instrument cannot see a second pause');
  assert.deepEqual(outcomes(d), ['loaded', 'no-answer']);
});
