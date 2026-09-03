// Acceptance tests for #359 and #352: portal injection and the per-tool-call
// timeout are properties of the LOOP, and every caller gets them.
//
// WHY THIS FILE RANGES OVER CALLERS INSTEAD OF SITTING BESIDE ONE. Both
// defects lived in a class, not in a file. Four callers each carried a copy of
// the injection inside the `executeToolCall` closure the core invokes — which
// runs AFTER the core has built the tool-call record, emitted `tool_start` and
// stringified the arguments onto the `mcp_tool_call` span. So the span
// reported no `tool.portal_domain` on exactly the calls a portal had just been
// injected into, while the signed package and the replay identity key read the
// mutated object and did carry it (#359). The timeout had three shapes across
// those same callers: cleared in a `finally` in one, armed and never cleared
// in two, and absent entirely in the third (#352).
//
// A test scoped to one caller cannot see that. The property is "the span
// agrees with the record, on every caller" and "no timer outlives its call, on
// every caller that has a bound", so the cases below drive `runToolLoop`
// directly, through `compareLoopOptions`, through `replayLoopOptions` and
// through `queryWithMcpStreaming` — the four ways a tool call is made in this
// repository — and a source-drift guard at the bottom closes the two route
// callers, which `node --test` cannot invoke.
//
// The RED baseline, measured at 96c4f76 before the move: with injection in the
// caller's closure, `tool.portal_domain` was absent from the span and
// `tool.arguments` carried `{"type":"query","dataset_id":"abcd-1234"}` while
// the record carried the same object WITH `portal` — the two disagreeing about
// the same call. And `/api/compare-stream` and `/api/query-notebook` each left
// one 45-second timer pending per tool call.
//
// No live endpoint, no credential, no MCP server, no database. Every key value
// is an obviously fake fixture and every address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/injection-and-bound.test.ts)

import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type OpenAI from 'openai';
import { runToolLoop, type LoopEvent, type ToolCallRecord, type ToolLoopOptions } from './run-tool-loop.ts';
import { compareLoopOptions, COMPARE_MCP_TOOL_TIMEOUT_MS } from './compare-loop.ts';
import { replayLoopOptions, REPLAY_MCP_TOOL_TIMEOUT_MS } from './replay-loop.ts';
import { startScriptedModelServer } from './test-harness.ts';
import { queryWithMcpStreaming, type CompletionResult } from '../openrouter-streaming.ts';
import { carriedModelIdentity } from '../model-catalog.ts';
import { _resetDefaultModelClientForTests } from '../model-client.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from '../evidence/trace.ts';
import { canonicalizeToolCall } from '../evidence/tool-call-identity.ts';

const FIXTURE_KEY = 'not-a-real-key-p2-injection-fixture';
const PORTAL = 'data.cityofnewyork.us';
const OTHER_PORTAL = 'data.sfgov.org';
const PROMPT = 'How long do these requests take to close?';
const SYSTEM = 'You are a fixture system prompt.';
const REAL_ANSWER =
  'Across both years the portal recorded 4,812 requests of this type. The median time to close ' +
  'was 9 days, and 71% closed within 14 days (dataset abcd-1234).';
const ONE_ROW = JSON.stringify({ data: [{ request_type: 'A', days_to_close: 9 }], total_rows: 1 });

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL'];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetDefaultModelClientForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetDefaultModelClientForTests();
});

// --- Instruments -----------------------------------------------------------

interface StubToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Sent verbatim instead of `JSON.stringify(args)` — the #349 shape. */
  rawArguments?: string;
}

interface StubReply {
  content?: string | null;
  toolCalls?: StubToolCall[];
}

/**
 * An in-process model client, for the cases that run under fake timers.
 *
 * `test-harness.ts`'s scripted server is the instrument everywhere else in
 * this family, and it stays that way for every claim about WHAT THE MODEL WAS
 * SENT — a wire claim belongs on the wire. It cannot be used here: replacing
 * the global `setTimeout` while an HTTP request is in flight is a hazard, and
 * the claims in the timer cases are about a timer, not about the transcript.
 * So the model is a function call, the timers are the only asynchrony left,
 * and `mock.timers.tick()` advances 45 seconds in microseconds.
 */
function stubClient(replies: StubReply[]): OpenAI {
  let served = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const reply = replies[Math.min(served++, replies.length - 1)];
          return {
            id: 'chatcmpl-p2-stub',
            object: 'chat.completion',
            created: 1,
            model: 'fake/model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: reply.content ?? null,
                ...(reply.toolCalls
                  ? {
                      tool_calls: reply.toolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                          name: tc.name,
                          arguments: tc.rawArguments ?? JSON.stringify(tc.args),
                        },
                      })),
                    }
                  : {}),
              },
              finish_reason: reply.toolCalls ? 'tool_calls' : 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

interface TimerLedger {
  /** Timers created and neither cleared nor fired — the ones that outlive a call. */
  pending: Map<unknown, number>;
  /** Every timer created while the ledger was installed. */
  created: number[];
  /** The delays of every still-pending timer, for an assertion that names one. */
  pendingDelays: () => number[];
  restore: () => void;
}

/**
 * Track every timer armed while this is installed.
 *
 * "Zero pending timers" needs a definition that survives a timer that FIRED:
 * the loop's pass-through delivery arms one per chunk and lets each expire, so
 * a bare created-minus-cleared count is non-zero on a healthy streaming run
 * and would measure the wrong thing. `pending` drops a timer both when it is
 * cleared and when its callback runs, so what is left in it is exactly the set
 * of timers still holding the event loop when the call that armed them is
 * over — the RED state `/api/compare-stream` and `/api/query-notebook` were in.
 *
 * Layers OVER whatever `setTimeout` is current, so it composes with
 * `mock.timers.enable()` (install it after enabling; `mock.timers.reset()`
 * then restores the real globals underneath).
 */
function trackTimers(): TimerLedger {
  const currentSet = globalThis.setTimeout;
  const currentClear = globalThis.clearTimeout;
  const pending = new Map<unknown, number>();
  const created: number[] = [];

  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    // The callback closes over `handle`, which this very statement assigns.
    // Safe because a timer callback cannot run before its own `setTimeout`
    // returns — and it is what lets a timer that FIRED leave `pending` on its
    // own, which is the distinction this ledger exists to draw.
    const handle: unknown = (currentSet as unknown as (...a: unknown[]) => unknown)(
      (...a: unknown[]) => {
        pending.delete(handle);
        return fn(...a);
      },
      ms,
      ...rest,
    );
    pending.set(handle, ms ?? 0);
    created.push(ms ?? 0);
    return handle;
  }) as unknown as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((handle: unknown) => {
    pending.delete(handle);
    return (currentClear as unknown as (h: unknown) => unknown)(handle);
  }) as unknown as typeof globalThis.clearTimeout;

  return {
    pending,
    created,
    pendingDelays: () => [...pending.values()],
    restore() {
      globalThis.setTimeout = currentSet;
      globalThis.clearTimeout = currentClear;
    },
  };
}

/**
 * The suite's own bound on a case that drives a transport which never settles.
 *
 * Built on the clock captured BEFORE `mock.timers.enable()`, so it is a real
 * two seconds no matter what the case has done to the global one. Without it,
 * deleting the race under test does not turn a case red — it hangs the runner,
 * which is a worse failure than the defect. `replay-loop.test.ts` learned this
 * from #357 and uses the same shape.
 *
 * Cancelled on the way out rather than `unref`-ed: an unreferenced guard lets
 * the loop drain and the runner reports "the event loop has already resolved"
 * for the whole file instead of failing the one case that hung.
 */
function hangGuard(clock: RealClock): { promise: Promise<'hung'>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<'hung'>((resolve) => {
    handle = clock.set(() => resolve('hung'), 2_000);
  });
  return { promise, cancel: () => { if (handle) clock.clear(handle); } };
}

interface RealClock {
  set: typeof globalThis.setTimeout;
  clear: typeof globalThis.clearTimeout;
}

/** Capture the real clock before anything replaces it. */
function realClock(): RealClock {
  return { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
}

interface Span {
  name: string;
  attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
}

function spansOf(trace: Record<string, unknown>): Span[] {
  const resourceSpans = trace.resourceSpans as { scopeSpans: { spans: Span[] }[] }[];
  return resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans));
}

function attr(span: Span, key: string): string | undefined {
  const found = span.attributes.find((a) => a.key === key);
  return found?.value?.stringValue ?? found?.value?.intValue;
}

function toolSpans(trace: Record<string, unknown>): Span[] {
  return spansOf(trace).filter((s) => s.name === 'mcp_tool_call');
}

/** Build a trace the way every production caller does. */
function freshTrace(): TraceBuilder {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.portal': PORTAL });
  return builder;
}

function finish(builder: TraceBuilder): Record<string, unknown> {
  builder.endRoot();
  return builder.finalize() as unknown as Record<string, unknown>;
}

/**
 * The property, in one assertion, for whichever caller produced the pair.
 *
 * This is what #359 is: `tool.arguments` is a serialization of the recorded
 * `args`, and `tool.portal_domain` is read off the same object, so the ONLY
 * way they can disagree is if something changed `args` between the span and
 * the reader — which is precisely what a caller-side injection did.
 */
function assertSpanAgreesWithRecord(span: Span, record: ToolCallRecord, expectedPortal: string) {
  assert.equal(record.args.portal, expectedPortal, 'the record must carry the injected portal');
  const spanArgs = JSON.parse(attr(span, 'tool.arguments')!) as Record<string, unknown>;
  assert.deepEqual(
    spanArgs,
    record.args,
    'the span serialized different arguments than the record holds (#359)',
  );
  assert.equal(
    attr(span, 'tool.portal_domain'),
    expectedPortal,
    'the span must report the portal the call was actually made with (#359)',
  );
}

const FETCH_NO_PORTAL: StubToolCall = {
  id: 'call_1',
  name: 'get_data',
  args: { type: 'query', dataset_id: 'abcd-1234' },
};

// --- Criterion 2, at the core ----------------------------------------------

test('#359: the portal reaches the record, the tool_start event AND the span — one injection, above all three', async () => {
  const builder = freshTrace();
  const events: LoopEvent[] = [];
  let handed: Record<string, unknown> | undefined;

  const result = await runToolLoop({
    client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
    endpointModel: 'fake/model',
    prompt: PROMPT,
    tools: [],
    portal: PORTAL,
    executeToolCall: async (_name, args) => {
      handed = args;
      return ONE_ROW;
    },
    onEvent: (event) => events.push(event),
    trace: { builder, parentSpanId: builder.rootSpanId },
  });
  const trace = finish(builder);

  assertSpanAgreesWithRecord(toolSpans(trace)[0], result.toolCalls[0], PORTAL);

  // The `tool_start` event fires between the record and the span and carries
  // the record by reference; a consumer that serializes it synchronously — the
  // notebook route does — saw the un-injected arguments before this moved.
  const started = events.find((e) => e.type === 'tool_start');
  assert.ok(started && started.type === 'tool_start');
  assert.equal(started.call.args.portal, PORTAL, 'tool_start reports the arguments actually sent');

  // The args-identity constraint still holds: the core injected into the very
  // object it recorded and handed on.
  assert.equal(handed, result.toolCalls[0].args, 'the transport receives the object the record holds');
});

test('#359: the guard is the four callers’ guard, unchanged — Socrata get_data only, never an explicit portal', async () => {
  const builder = freshTrace();
  const result = await runToolLoop({
    client: stubClient([
      {
        toolCalls: [
          FETCH_NO_PORTAL,
          { id: 'call_2', name: 'get_data', args: { type: 'query', dataset_id: 'wxyz-9999', portal: OTHER_PORTAL } },
          { id: 'call_3', name: 'get_variables', args: { place: 'geoId/36061' } },
        ],
      },
      { content: REAL_ANSWER },
    ]),
    endpointModel: 'fake/model',
    prompt: PROMPT,
    tools: [],
    portal: PORTAL,
    executeToolCall: async () => ONE_ROW,
    trace: { builder, parentSpanId: builder.rootSpanId },
  });
  const spans = toolSpans(finish(builder));

  assert.equal(result.toolCalls[0].args.portal, PORTAL, 'a Socrata call with no portal gets the caller’s');
  assert.equal(result.toolCalls[1].args.portal, OTHER_PORTAL, 'an explicit portal is never overwritten');
  assert.equal(result.toolCalls[2].args.portal, undefined, 'a non-Socrata tool gets no portal at all');

  assert.equal(attr(spans[0], 'tool.portal_domain'), PORTAL);
  assert.equal(attr(spans[1], 'tool.portal_domain'), OTHER_PORTAL);
  assert.equal(attr(spans[2], 'tool.portal_domain'), undefined, 'and the span agrees on all three');
});

test('a loop given no portal injects nothing — omitted is off, as it was for a caller that wrote no closure', async () => {
  const builder = freshTrace();
  const result = await runToolLoop({
    client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
    endpointModel: 'fake/model',
    prompt: PROMPT,
    tools: [],
    executeToolCall: async () => ONE_ROW,
    trace: { builder, parentSpanId: builder.rootSpanId },
  });

  assert.equal(result.toolCalls[0].args.portal, undefined);
  assert.equal(attr(toolSpans(finish(builder))[0], 'tool.portal_domain'), undefined);
});

// --- Criterion 3: a malformed tool call is never injected into --------------

test('#359: a tool call whose arguments never parsed is NOT given a portal — not on the record, not on the span', async () => {
  // The exposure this closes is created by the move. Before it, a caller's
  // closure could not run on a malformed set, because the core throws
  // `malformedToolArgumentsError()` before it calls the closure. Injection
  // above the record runs earlier than that throw, on the `{}` the failed
  // parse left behind — so without `!argumentsMalformed` in the guard this
  // call would be recorded, spanned and SIGNED carrying a portal that was
  // never sent to anything.
  //
  // RED demonstration, measured by deleting `!argumentsMalformed &&` from the
  // guard: this case fails on the first assertion with
  // `Expected values to be strictly deep-equal: {} !== { portal: 'data.cityofnewyork.us' }`.
  const builder = freshTrace();
  const result = await runToolLoop({
    client: stubClient([
      { toolCalls: [{ id: 'call_bad', name: 'get_data', args: {}, rawArguments: '{"type": "quer' }] },
      { content: REAL_ANSWER },
    ]),
    endpointModel: 'fake/model',
    prompt: PROMPT,
    tools: [],
    portal: PORTAL,
    executeToolCall: async () => assert.fail('a malformed call must never reach the transport'),
    trace: { builder, parentSpanId: builder.rootSpanId },
  });
  const span = toolSpans(finish(builder))[0];

  assert.deepEqual(result.toolCalls[0].args, {}, 'the record carries the empty set, with no portal');
  assert.equal(attr(span, 'tool.arguments'), '{}', 'and the span carries the same empty set');
  assert.equal(attr(span, 'tool.portal_domain'), undefined, 'no portal is asserted for a call never made');

  // And it still fails exactly the way it failed before (#349): one failed
  // tool call, described to the model, run continues.
  assert.equal(result.toolCalls[0].failed, true);
  assert.equal(result.toolCalls[0].failureKind, 'unknown');
  assert.equal(result.content, REAL_ANSWER, 'a malformed call is not a failed run');
});

// --- Criterion 4: no timer outlives its call -------------------------------

test('#352: a tool call that resolves inside its bound leaves ZERO pending timers', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const timers = trackTimers();
  try {
    const result = await runToolLoop({
      client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
      endpointModel: 'fake/model',
      prompt: PROMPT,
      tools: [],
      portal: PORTAL,
      toolTimeoutMs: 45_000,
      executeToolCall: async () => ONE_ROW,
    });

    assert.equal(result.toolCalls[0].failed, undefined, 'the call succeeded well inside the bound');
    assert.deepEqual(timers.created, [45_000], 'exactly one timer was armed, at the bound');
    assert.equal(
      timers.pending.size,
      0,
      'a timer outlived the call it bounded — this is the state /api/compare-stream and ' +
        '/api/query-notebook were in, one per tool call, at 45 seconds each',
    );
  } finally {
    timers.restore();
    mock.timers.reset();
  }
});

test('#352: the bound still fires when the call hangs, and the run survives it', async () => {
  const guard = hangGuard(realClock());
  mock.timers.enable({ apis: ['setTimeout'] });
  const timers = trackTimers();
  let release = () => {};
  try {
    const run = runToolLoop({
      client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
      endpointModel: 'fake/model',
      prompt: PROMPT,
      tools: [],
      portal: PORTAL,
      toolTimeoutMs: 45_000,
      executeToolCall: () =>
        new Promise<string>((resolve) => {
          release = () => resolve(ONE_ROW);
        }),
    });

    // Let the stub client's first reply and the tool call be dispatched, then
    // advance past the bound. Nothing but the timer can end this call.
    await Promise.resolve();
    await new Promise((r) => process.nextTick(r));
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(45_000);

    assert.equal(
      await Promise.race([run.then(() => 'settled' as const), guard.promise]),
      'settled',
      'the run never returned: nothing ended a tool call that never settles',
    );
    const result = await run;
    assert.equal(result.toolCalls[0].failed, true);
    assert.equal(result.toolCalls[0].failureKind, 'timeout', 'the bound is what ended it');
    assert.equal(result.content, REAL_ANSWER, 'one timed-out call is not a failed run');
    assert.equal(timers.pending.size, 0, 'the fired timer is gone and nothing replaced it');
  } finally {
    guard.cancel();
    release();
    timers.restore();
    mock.timers.reset();
  }
});

test('#352: omitting the bound arms no timer at all — unbounded is expressible', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const timers = trackTimers();
  try {
    await runToolLoop({
      client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
      endpointModel: 'fake/model',
      prompt: PROMPT,
      tools: [],
      executeToolCall: async () => ONE_ROW,
    });

    assert.deepEqual(timers.created, [], 'a core default would have made "no bound" unsayable');
  } finally {
    timers.restore();
    mock.timers.reset();
  }
});

// --- Every caller: /api/compare ---------------------------------------------

test('compare: the span agrees with the record on a get_data call that omitted a portal', async () => {
  const builder = freshTrace();
  const result = await runToolLoop({
    ...compareLoopOptions({
      client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
      endpointModel: 'fake/model',
      prompt: PROMPT,
      systemPrompt: SYSTEM,
      portal: PORTAL,
      callTool: async () => ONE_ROW,
    }),
    trace: { builder, parentSpanId: builder.rootSpanId },
  });

  assertSpanAgreesWithRecord(toolSpans(finish(builder))[0], result.toolCalls[0], PORTAL);
});

test('#352: /api/compare now has a tool bound, it is 45s, and it fires', async () => {
  // This caller had NO per-tool-call bound at all: `git grep` for a timer in
  // `compare-loop.ts` returned nothing at 96c4f76. A source that accepted the
  // connection and then stopped answering held a public, rate-limited endpoint
  // open until the platform killed the invocation, and the caller — waiting on
  // one JSON body, with nothing streamed — got a platform error naming no tool.
  assert.equal(COMPARE_MCP_TOOL_TIMEOUT_MS, 45_000, 'the same bound the three other callers use');
  assert.equal(
    compareLoopOptions({
      client: {} as never,
      endpointModel: 'fake/model',
      prompt: PROMPT,
      systemPrompt: SYSTEM,
      portal: PORTAL,
    }).toolTimeoutMs,
    COMPARE_MCP_TOOL_TIMEOUT_MS,
    'and the factory hands it to the core',
  );

  const guard = hangGuard(realClock());
  mock.timers.enable({ apis: ['setTimeout'] });
  const timers = trackTimers();
  let release = () => {};
  try {
    const run = runToolLoop(
      compareLoopOptions({
        client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
        endpointModel: 'fake/model',
        prompt: PROMPT,
        systemPrompt: SYSTEM,
        portal: PORTAL,
        callTool: () =>
          new Promise<string>((resolve) => {
            release = () => resolve(ONE_ROW);
          }),
      }),
    );

    await Promise.resolve();
    await new Promise((r) => process.nextTick(r));
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(COMPARE_MCP_TOOL_TIMEOUT_MS);

    assert.equal(
      await Promise.race([run.then(() => 'settled' as const), guard.promise]),
      'settled',
      'the run never returned: /api/compare has no bound after all',
    );
    const result = await run;
    assert.equal(result.toolCalls[0].failureKind, 'timeout');
    assert.equal(result.content, REAL_ANSWER, 'the comparison still answers from what did come back');
    assert.equal(timers.pending.size, 0, 'and the timer did not outlive the call');
  } finally {
    guard.cancel();
    release();
    timers.restore();
    mock.timers.reset();
  }
});

// --- Every caller: the replay route -----------------------------------------

test('replay: the span agrees with the record, and the recorded args still feed the identity key', async () => {
  const builder = freshTrace();
  const result = await runToolLoop({
    ...replayLoopOptions({
      client: stubClient([{ toolCalls: [FETCH_NO_PORTAL] }, { content: REAL_ANSWER }]),
      endpointModel: 'fake/model',
      prompt: PROMPT,
      systemPrompt: SYSTEM,
      portal: PORTAL,
      callTool: async () => ONE_ROW,
    }),
    trace: { builder, parentSpanId: builder.rootSpanId },
  });
  const record = result.toolCalls[0];

  assertSpanAgreesWithRecord(toolSpans(finish(builder))[0], record, PORTAL);

  // The replay identity key is `canonicalizeToolCall(record)`
  // (`src/lib/evidence/tool-call-identity.ts`) — the tool name plus a
  // canonical JSON serialisation of the WHOLE `args` object, no key format of
  // its own here. It reads the recorded args, so the injected portal must
  // still be there: checked directly on `record.args.portal`, and again by
  // confirming the portal reaches the computed key itself.
  assert.equal(record.args.portal, PORTAL);
  assert.ok(canonicalizeToolCall(record).includes(PORTAL));
});

test('replay keeps its own 45s bound, now as a value rather than a race it performs', async () => {
  assert.equal(REPLAY_MCP_TOOL_TIMEOUT_MS, 45_000);
  const options = replayLoopOptions({
    client: {} as never,
    endpointModel: 'fake/model',
    prompt: PROMPT,
    systemPrompt: SYSTEM,
    portal: PORTAL,
  });
  assert.equal(options.toolTimeoutMs, REPLAY_MCP_TOOL_TIMEOUT_MS);
  assert.equal(options.portal, PORTAL);
});

// --- Every caller: the streaming path ---------------------------------------
//
// `/api/compare-stream` and `/api/query-notebook` both reach the core through
// `queryWithMcpStreaming`, two frames below the closure they used to inject in
// — which is why the fix had to reach this module too. These cases use the
// real scripted HTTP endpoint and real timers: the bound is a parameter now,
// so a small one costs milliseconds, and mocking the global clock underneath
// an in-flight HTTP request buys nothing here.

const FAKE_MODEL = carriedModelIdentity('fake/model');

async function runStreaming(
  toolCallOptions: { portal?: string; toolTimeoutMs?: number },
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<{ completion: CompletionResult; trace: Record<string, unknown> }> {
  const { server, url } = await startScriptedModelServer([
    { toolCalls: [FETCH_NO_PORTAL] },
    { content: REAL_ANSWER },
  ]);
  try {
    process.env.OPENROUTER_API_KEY = FIXTURE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const builder = freshTrace();
    let completion: CompletionResult | undefined;
    await queryWithMcpStreaming(
      PROMPT,
      FAKE_MODEL,
      [],
      executeToolCall,
      SYSTEM,
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, result) => { completion = result; },
        onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
      },
      { builder, parentSpanId: builder.rootSpanId },
      toolCallOptions,
    );
    assert.ok(completion, 'onComplete must fire');
    return { completion: completion!, trace: finish(builder) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('queryWithMcpStreaming: the span agrees with the record — the caller two frames up no longer injects', async () => {
  const { completion, trace } = await runStreaming({ portal: PORTAL }, async () => ONE_ROW);
  const record = (completion.tools_called ?? [])[0];
  assert.ok(record, 'the completion must carry the tool call');
  assertSpanAgreesWithRecord(toolSpans(trace)[0], record, PORTAL);
});

test('#352: the streaming path’s bound fires and leaves no timer behind', async () => {
  const guard = hangGuard(realClock());
  const timers = trackTimers();
  let release = () => {};
  try {
    const running = runStreaming(
      { portal: PORTAL, toolTimeoutMs: 40 },
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve(ONE_ROW);
        }),
    );
    assert.equal(
      await Promise.race([running.then(() => 'settled' as const), guard.promise]),
      'settled',
      'the run never returned: nothing ended a tool call that never settles',
    );
    const { completion } = await running;
    const record = (completion.tools_called ?? [])[0];
    assert.equal(record.failed, true);
    assert.equal(record.failureKind, 'timeout');
    assert.equal(completion.content, REAL_ANSWER, 'one timed-out call is not a failed stream');
    assert.ok(
      !JSON.stringify(completion).includes('timed out after'),
      'the raw timeout text never reaches the reader (#154)',
    );
    assert.deepEqual(
      timers.pendingDelays().filter((ms) => ms === 40),
      [],
      'the fired bound left nothing behind',
    );
  } finally {
    guard.cancel();
    release();
    timers.restore();
  }
});

test('#352: a streaming tool call that resolves inside its bound leaves no timer pending', async () => {
  const timers = trackTimers();
  try {
    const { completion } = await runStreaming(
      { portal: PORTAL, toolTimeoutMs: 45_000 },
      async () => ONE_ROW,
    );
    assert.equal((completion.tools_called ?? [])[0].failed, undefined);
    assert.ok(
      timers.created.includes(45_000),
      'the bound was armed — otherwise this case measures nothing',
    );
    // Named rather than counted, because this path does real HTTP and the
    // client library keeps timers of its own (a request deadline, a socket
    // keep-alive). The claim is about the TOOL bound, so it names the bound:
    // 45_000 pending here is the RED state both route callers were in, one
    // such timer per tool call.
    assert.deepEqual(
      timers.pendingDelays().filter((ms) => ms === 45_000),
      [],
      'the 45s tool bound is still pending after the call it bounded resolved',
    );
  } finally {
    timers.restore();
  }
});

// --- The two route callers, which node --test cannot invoke -----------------

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

test('#359 / #352: no caller in src/ carries an injection or a tool timer of its own', () => {
  const callers: [string, string][] = [
    ['compare-stream/route.ts', sourceOf('../../app/api/compare-stream/route.ts')],
    ['query-notebook/route.ts', sourceOf('../../app/api/query-notebook/route.ts')],
    ['compare-loop.ts', sourceOf('./compare-loop.ts')],
    ['replay-loop.ts', sourceOf('./replay-loop.ts')],
    ['openrouter-streaming.ts', sourceOf('../openrouter-streaming.ts')],
  ];

  for (const [name, source] of callers) {
    assert.doesNotMatch(
      source,
      /(args|toolArgs)\.portal\s*=[^=]/,
      `${name} still injects a portal itself: the span is built before that runs (#359)`,
    );
    assert.ok(
      !source.includes('setTimeout('),
      `${name} still arms a tool timer: the race and its clear live in the core (#352)`,
    );
  }
});

test('#359 / #352: both streaming routes pass the two values down instead of performing them', () => {
  for (const [name, source] of [
    ['compare-stream/route.ts', sourceOf('../../app/api/compare-stream/route.ts')],
    ['query-notebook/route.ts', sourceOf('../../app/api/query-notebook/route.ts')],
  ] as [string, string][]) {
    assert.match(source, /\{ portal, toolTimeoutMs: MCP_TOOL_TIMEOUT_MS \}/, `${name} must forward both`);
    assert.match(source, /MCP_TOOL_TIMEOUT_MS = 45_000/, `${name} still states its own bound`);
    assert.ok(
      !source.includes('Promise.race'),
      `${name} must not race the call itself`,
    );
  }
});

test('the two factories hand the core values, not a closure that does the work', () => {
  for (const [name, source] of [
    ['compare-loop.ts', sourceOf('./compare-loop.ts')],
    ['replay-loop.ts', sourceOf('./replay-loop.ts')],
  ] as [string, string][]) {
    assert.match(source, /executeToolCall: callTool,/, `${name} must hand the transport through unwrapped`);
    assert.match(source, /^\s+portal,$/m, `${name} must pass the portal as an option`);
    assert.match(source, /toolTimeoutMs/, `${name} must pass a bound`);
  }
});

// --- The option surface, stated once ---------------------------------------

test('both options are on ToolLoopOptions and both are optional', () => {
  // A compile-time claim, asserted at runtime so it appears in the suite:
  // omitting either is legal, which is what "omitted = no injection" and
  // "omitted = unbounded" mean.
  const minimal: ToolLoopOptions = {
    client: {} as never,
    endpointModel: 'fake/model',
    prompt: PROMPT,
    tools: [],
    executeToolCall: async () => ONE_ROW,
  };
  assert.equal(minimal.portal, undefined);
  assert.equal(minimal.toolTimeoutMs, undefined);

  const configured: ToolLoopOptions = { ...minimal, portal: PORTAL, toolTimeoutMs: 45_000 };
  assert.equal(configured.portal, PORTAL);
  assert.equal(configured.toolTimeoutMs, 45_000);
});
