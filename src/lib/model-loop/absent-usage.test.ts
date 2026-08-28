// Acceptance tests for #312: absent token usage is ABSENT from the trace — on
// every span — and a genuine zero still is not.
//
// WHY THIS IS A PROPERTY OVER SPANS AND NOT A FIX TO FOUR LINES. The trace
// goes inside the signed record package, so a span asserting
// `gen_ai.response.prompt_tokens: 0` for a call the endpoint said nothing
// about is a false statement under a signature. Wave N4 P3 fixed exactly that
// one layer up for `cost.promptTokens` (`packager.ts`: "Zero is not a
// measurement… Absent usage is now absent"), leaving a package that could
// carry `cost` with the counts correctly absent while the span beside it
// claimed zero.
//
// The issue named four sites. There are SIX, across TWO mechanisms, and the
// second is why a grep for the `|| 0` shape could not find it:
//
//   mechanism one — `llm_inference`, both sites: an inline `|| 0` on
//     `response.usage`, coalescing absence to zero at the span;
//   mechanism two — `synthesis`, the answering turn that produces the
//     PUBLISHED answer: two locals initialised to `0` that simply stay `0`
//     when no usage arrives (the streamed path guarded `if (chunk.usage)`,
//     the blocking path used its own `|| 0`). `0` from "never set" and `0`
//     from "the endpoint reported zero" are the same bytes unless something
//     tracks the difference.
//
// So the cases below drive the REAL loop to completion and assert over EVERY
// span the trace finalizes, not over the two lines an issue pointed at. The
// synthesis span gets its own case, with the tool turns REPORTING usage, so
// that a fix addressing only mechanism one goes red here rather than passing.
//
// AND ASSERTED OVER THE CANONICAL FORM, which #312 asks for explicitly. Two
// different traps make a naive presence check the wrong instrument:
//
//   - `produce-core` leaves an `undefined` property present on an object and
//     the JCS canonicalizer drops it, so a `hasOwnProperty` assertion can fail
//     while the behaviour is correct;
//   - and in the OTHER direction, measured here: `TraceBuilder` turns an
//     attribute record into an ARRAY of `{key, value}` pairs via
//     `Object.entries`, so setting an attribute to `undefined` does NOT remove
//     it — it survives canonicalization as
//     `{"key":"gen_ai.response.prompt_tokens","value":{}}`, a valueless
//     attribute inside the signature, which is worse than the zero it
//     replaced.
//
// Every case therefore asserts over `jcs(trace)` — the bytes the signature
// actually covers — as well as over the span structure.
//
// The RED baseline, measured at f117665 before the fix, driving the
// tool-then-silence script with an endpoint that reports no usage at all:
// every `llm_inference` span carried `prompt_tokens` `intValue: "0"` and the
// `synthesis` span carried it too, by the second mechanism. And with a
// falsy-check fix in place of the absence check, the genuine-zero case below
// goes red instead — the same defect pointing the other way.
//
// No live endpoint, no credential, no MCP server, no database. Every key value
// is an obviously fake fixture and every address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/absent-usage.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runToolLoop, type ToolLoopOptions } from './run-tool-loop.ts';
import { _resetDefaultModelClientForTests, getModelClient } from '../model-client.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from '../evidence/trace.ts';
import { jcs } from '../evidence/canonicalization.ts';

const FIXTURE_KEY = 'not-a-real-key-p4b-absent-usage-fixture';
const PROMPT = 'How long do these requests take to close?';
const REAL_ANSWER =
  'Across both years the portal recorded 4,812 requests of this type. The median time to close ' +
  'was 9 days, and 71% closed within 14 days (dataset abcd-1234).';
const ONE_ROW = JSON.stringify({ data: [{ request_type: 'A', days_to_close: 9 }], total_rows: 1 });

const PROMPT_TOKENS = 'gen_ai.response.prompt_tokens';
const COMPLETION_TOKENS = 'gen_ai.response.completion_tokens';

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

// --- The instrument --------------------------------------------------------

/**
 * A scripted endpoint whose `usage` reporting is the variable.
 *
 * `test-harness.ts`'s `startScriptedModelServer` is this family's instrument
 * everywhere else and would be the right home for this, as a `usage` field on
 * `ScriptedReply` — it hardcodes `{prompt_tokens: 10, completion_tokens: 5}`
 * on every reply and offers no way to express "the endpoint reported none",
 * which is the entire subject of this file. That file is outside this phase's
 * blast zone, so the capability lives here and the duplication is flagged
 * rather than taken: see the phase report.
 *
 * Real HTTP and real SSE on purpose. The claim is that the loop records
 * nothing when the ENDPOINT reports nothing, and a hand-built async iterable
 * of chunk objects would assert that about a fixture rather than about the
 * client's own parsing of a response that genuinely omits the field.
 */
interface UsageScript {
  content?: string | null;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  /**
   * The `usage` object the endpoint returns for this reply. Omitted here means
   * omitted on the wire: no `usage` key in the JSON body, and no usage frame
   * in the SSE stream at all — which is what an endpoint that reports nothing
   * actually sends.
   */
  usage?: Record<string, number>;
}

function startUsageScriptedServer(
  replies: UsageScript[],
): Promise<{ server: Server; url: string; requests: number }> {
  return new Promise((resolve) => {
    let served = 0;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        const reply = replies[Math.min(served++, replies.length - 1)];

        if (body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const frame = (payload: Record<string, unknown>) =>
            `data: ${JSON.stringify({
              id: 'chatcmpl-test-p4b',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'fake/model',
              ...payload,
            })}\n\n`;
          res.write(frame({
            choices: [{ index: 0, delta: { content: reply.content ?? '' }, finish_reason: null }],
          }));
          if (reply.usage) res.write(frame({ choices: [], usage: reply.usage }));
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-test-p4b',
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
                      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                    })),
                  }
                : {}),
            },
            finish_reason: reply.toolCalls ? 'tool_calls' : 'stop',
          }],
          ...(reply.usage ? { usage: reply.usage } : {}),
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/v1`, requests: served });
    });
  });
}

interface RawAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean };
}
interface RawSpan {
  name: string;
  attributes: RawAttribute[];
}

function spansOf(trace: Record<string, unknown>): RawSpan[] {
  const resourceSpans = trace.resourceSpans as { scopeSpans: { spans: RawSpan[] }[] }[];
  return resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans));
}

function spansNamed(trace: Record<string, unknown>, name: string): RawSpan[] {
  return spansOf(trace).filter((s) => s.name === name);
}

/** True when the KEY exists on the span at all — regardless of its value. */
function carriesKey(span: RawSpan, key: string): boolean {
  return span.attributes.some((a) => a.key === key);
}

function intAttr(span: RawSpan, key: string): string | undefined {
  return span.attributes.find((a) => a.key === key)?.value?.intValue;
}

/**
 * The criterion, over the bytes the signature covers.
 *
 * Structure and canonical form are both asserted because they fail in
 * different directions: a key whose value is `undefined` is invisible to an
 * assertion on VALUES but plainly visible in the canonical bytes, and a key
 * the canonicalizer drops would be visible in the object but not in the bytes.
 *
 * Canonicalized PER SPAN rather than over the whole trace, because most cases
 * here have some spans that legitimately carry a count and some that must not:
 * a whole-trace `includes` cannot tell those apart, and one written anyway
 * would fail for a reason that has nothing to do with the property. JCS is
 * deterministic per object, so a span's canonical bytes are the bytes that
 * span contributes to the signed document.
 */
function assertNoTokenAttributes(spans: RawSpan[], because: string) {
  assert.ok(spans.length > 0, `${because}: no spans to assert over — the case measures nothing`);
  for (const span of spans) {
    for (const key of [PROMPT_TOKENS, COMPLETION_TOKENS]) {
      assert.equal(
        carriesKey(span, key),
        false,
        `${because}: span "${span.name}" carries ${key} = ` +
          `${JSON.stringify(span.attributes.find((a) => a.key === key)?.value)}`,
      );
      assert.equal(
        jcs(span as unknown as Record<string, unknown>).includes(key),
        false,
        `${because}: ${key} survives into the canonical bytes of span "${span.name}" — ` +
          'the bytes the signature covers',
      );
    }
  }
}

/** The whole signed document mentions neither count, anywhere. */
function assertCanonicalTraceOmitsBoth(trace: Record<string, unknown>, because: string) {
  const canonical = jcs(trace);
  for (const key of [PROMPT_TOKENS, COMPLETION_TOKENS]) {
    assert.equal(
      canonical.includes(key),
      false,
      `${because}: ${key} survives into the canonical bytes the signature covers`,
    );
  }
}

/**
 * Every attribute this trace carries has a value.
 *
 * The regression guard for the omission-by-`undefined` shape, stated over the
 * WHOLE trace rather than over the two keys this issue is about:
 * `attrsFromRecord` maps `Object.entries`, so `{key: undefined}` becomes
 * `{"key":"…","value":{}}` and canonicalizes intact. Nothing in a signed trace
 * should assert a key and then decline to say what it is.
 */
function assertNoValuelessAttributes(trace: Record<string, unknown>) {
  for (const span of spansOf(trace)) {
    for (const a of span.attributes) {
      assert.ok(
        a.value && Object.keys(a.value).length > 0,
        `span "${span.name}" carries attribute "${a.key}" with no value at all — ` +
          'an attribute set to `undefined` rather than omitted',
      );
    }
  }
}

async function runWithScript(
  replies: UsageScript[],
  overrides: Partial<ToolLoopOptions> = {},
): Promise<{ trace: Record<string, unknown>; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const { server, url } = await startUsageScriptedServer(replies);
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis');
  try {
    process.env.OPENROUTER_API_KEY = FIXTURE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const result = await runToolLoop({
      client: getModelClient(),
      endpointModel: 'fake/model',
      prompt: PROMPT,
      tools: [],
      executeToolCall: async () => ONE_ROW,
      trace: { builder, parentSpanId: builder.rootSpanId },
      ...overrides,
    });
    builder.endRoot();
    return {
      trace: builder.finalize() as unknown as Record<string, unknown>,
      usage: result.usage,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const FETCH_CALL = {
  id: 'call_1',
  name: 'get_data',
  args: { type: 'query', dataset_id: 'abcd-1234' },
};

const REPORTED = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const REPORTED_ZERO = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/**
 * Two tool-calling turns and then an answering turn, so ONE run produces all
 * three span sites: `llm_inference` at inference index 0, `llm_inference` at
 * index 1, and `synthesis` from the answering turn. Reply 2 answers nothing,
 * which is what routes the run into the answering turn the synthesis span
 * measures.
 */
function toolThenSilence(usage: UsageScript['usage'], answerUsage: UsageScript['usage']): UsageScript[] {
  return [
    { toolCalls: [FETCH_CALL], usage },
    { content: null, usage },
    { content: REAL_ANSWER, usage: answerUsage },
  ];
}

/** The run really did produce the three spans the cases assert over. */
function assertShape(trace: Record<string, unknown>) {
  const inference = spansNamed(trace, 'llm_inference');
  const synthesis = spansNamed(trace, 'synthesis');
  assert.equal(inference.length, 2, 'expected two llm_inference spans from this script');
  assert.equal(synthesis.length, 1, 'expected one synthesis span from this script');
  assert.ok(
    synthesis[0].attributes.some((a) => a.key === 'output.hash'),
    'the synthesis span must have been ENDED — an unended span would carry no attributes ' +
      'and would pass an absence assertion for the wrong reason',
  );
  return { inference, synthesis: synthesis[0] };
}

// --- Criterion 1: absent usage is absent, on every span --------------------

for (const finalTurn of ['blocking', 'stream'] as const) {
  test(`#312: an endpoint reporting no usage leaves no token attribute on any span (${finalTurn} answering turn)`, async () => {
    const { trace } = await runWithScript(
      toolThenSilence(undefined, undefined),
      { finalTurn },
    );

    assertShape(trace);
    assertNoTokenAttributes(spansOf(trace), 'the endpoint reported no usage');
    assertCanonicalTraceOmitsBoth(trace, 'the endpoint reported no usage');
    assertNoValuelessAttributes(trace);
  });
}

// --- Criterion 2: the synthesis span specifically ---------------------------
//
// The tool turns REPORT usage here and the answering turn does not, so a fix
// that only reaches mechanism one leaves the two `llm_inference` spans correct
// and the synthesis span still asserting `0`. This case is the one that cannot
// be passed by accident.

for (const finalTurn of ['blocking', 'stream'] as const) {
  test(`#312: an answering turn whose endpoint reports no usage leaves the synthesis span with neither count (${finalTurn})`, async () => {
    const { trace } = await runWithScript(
      toolThenSilence(REPORTED, undefined),
      { finalTurn },
    );

    const { inference, synthesis } = assertShape(trace);

    // Mechanism one is untouched: what WAS reported is still recorded.
    for (const span of inference) {
      assert.equal(intAttr(span, PROMPT_TOKENS), '10', 'a reported prompt count must survive');
      assert.equal(intAttr(span, COMPLETION_TOKENS), '5', 'a reported completion count must survive');
    }

    assertNoTokenAttributes([synthesis], 'the answering turn reported no usage');
    assertNoValuelessAttributes(trace);

    // The canonical assertion above is scoped to the synthesis span's keys, so
    // state the whole-trace half explicitly: the strings ARE in the bytes,
    // because the inference spans legitimately carry them.
    const canonical = jcs(trace);
    assert.ok(
      canonical.includes(PROMPT_TOKENS),
      'the inference spans must still put a reported count into the canonical bytes',
    );
  });
}

// --- Criterion 3: a genuine zero is still a measurement ---------------------
//
// The other direction. A falsy check erases an endpoint that truthfully
// reported zero, which is the same class of defect: the trace would say
// nothing was measured when something was.

for (const finalTurn of ['blocking', 'stream'] as const) {
  test(`#312: an endpoint reporting a genuine zero still gets 0 on every span (${finalTurn} answering turn)`, async () => {
    const { trace } = await runWithScript(
      toolThenSilence(REPORTED_ZERO, REPORTED_ZERO),
      { finalTurn },
    );

    const { inference, synthesis } = assertShape(trace);

    for (const span of [...inference, synthesis]) {
      assert.equal(
        intAttr(span, PROMPT_TOKENS),
        '0',
        `span "${span.name}" dropped a prompt count the endpoint truthfully reported as 0`,
      );
      assert.equal(
        intAttr(span, COMPLETION_TOKENS),
        '0',
        `span "${span.name}" dropped a completion count the endpoint truthfully reported as 0`,
      );
    }
    assertNoValuelessAttributes(trace);
  });
}

// --- The two counts are independent ----------------------------------------
//
// An endpoint reporting one count and not the other gets one attribute. A fix
// that gates both on the presence of the `usage` OBJECT passes every case
// above and fails this one.

for (const finalTurn of ['blocking', 'stream'] as const) {
  test(`#312: a partially-reported usage records the count that was reported and omits the one that was not (${finalTurn})`, async () => {
    const partial = { prompt_tokens: 12, total_tokens: 12 };
    const { trace } = await runWithScript(
      toolThenSilence(partial, partial),
      { finalTurn },
    );

    const { inference, synthesis } = assertShape(trace);

    for (const span of [...inference, synthesis]) {
      assert.equal(
        intAttr(span, PROMPT_TOKENS),
        '12',
        `span "${span.name}" dropped the prompt count the endpoint did report`,
      );
      assert.equal(
        carriesKey(span, COMPLETION_TOKENS),
        false,
        `span "${span.name}" asserts a completion count the endpoint never reported`,
      );
    }
    assert.equal(
      jcs(trace).includes(COMPLETION_TOKENS),
      false,
      'an unreported completion count reached the canonical bytes',
    );
    assertNoValuelessAttributes(trace);
  });
}

// --- The pass-through synthesis span ----------------------------------------
//
// A run the model answered on its own account takes NO answering turn, so its
// synthesis span covers delivery rather than a model call and has no token
// counts to report. It is already compliant; pinned so that a later pass
// "completing" the span by copying the cumulative totals onto it — which would
// attribute the whole run's tokens to a call that never happened — goes red.

test('#312: a pass-through run leaves the synthesis span with no token counts, because no model call backs it', async () => {
  const { trace } = await runWithScript([{ content: REAL_ANSWER, usage: REPORTED }]);

  const inference = spansNamed(trace, 'llm_inference');
  const synthesis = spansNamed(trace, 'synthesis');
  assert.equal(inference.length, 1, 'a pass-through run makes exactly one model call');
  assert.equal(synthesis.length, 1);
  assert.equal(intAttr(inference[0], PROMPT_TOKENS), '10', 'the one model call reported usage');

  assertNoTokenAttributes(synthesis, 'no model call backs a pass-through synthesis span');
  assertNoValuelessAttributes(trace);
});

// --- What the RETURNED usage does, stated rather than assumed ---------------
//
// The loop's `usage` is a SUM over the turns, and it stays a number: absent
// contributes nothing to a total. `packager.ts` and `openrouter-streaming.ts`
// each apply their own `|| undefined` at the boundary where absence is
// expressible, so a run with no usage anywhere still produces a package with
// the counts absent. Pinned so the accumulator's semantics are a decision on
// the record rather than an accident — and so that a later phase changing the
// return type has to change this line and say why.

test('#312: with no usage reported anywhere the returned totals are zero, and the counts are omitted at the boundary', async () => {
  const { usage } = await runWithScript(toolThenSilence(undefined, undefined));

  assert.deepEqual(usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  // The idiom both consumers apply — `packager.ts` for the signed `cost`
  // block, `openrouter-streaming.ts` for the wire.
  assert.equal(usage.promptTokens || undefined, undefined);
  assert.equal(usage.completionTokens || undefined, undefined);
});
