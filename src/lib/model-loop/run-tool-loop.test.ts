// Acceptance tests for the shared tool-calling loop (#345 P2).
//
// Everything here drives the REAL loop against a local scripted model server
// (`test-harness.ts`) with an injected tool transport: no live endpoint, no
// credential, no MCP server, and every key value an obviously fake fixture.
//
// Where a claim is about WHAT THE MODEL WAS SENT, it is asserted on the wire —
// against the request bodies the mock server received — rather than on the
// value the loop returned. A truncation that hands the model malformed JSON
// (#331) and a raw parse error reaching a tool message (#349) are both
// invisible from the return value.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/run-tool-loop.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runToolLoop, type ToolLoopOptions, type ToolLoopResult } from './run-tool-loop.ts';
import { startScriptedModelServer, type ScriptedReply } from './test-harness.ts';
import { _resetDefaultModelClientForTests, getModelClient } from '../model-client.ts';
import { describeToolFailureForLlm } from '../streaming.ts';

const FAKE_KEY = 'sk-or-test-obviously-fake-key-do-not-use';

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

const REAL_ANSWER =
  'Across both years the portal recorded 4,812 requests of this type. The median time to close ' +
  'was 9 days, and 71% closed within 14 days (dataset abcd-1234).';

const FETCH_CALL: ScriptedReply = {
  toolCalls: [{ id: 'call_1', name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234' } }],
};

const ONE_ROW = JSON.stringify({ data: [{ request_type: 'A', days_to_close: 9 }], total_rows: 1 });

interface Wire {
  role: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}

/**
 * Drive `runToolLoop` against a scripted endpoint. Only what a case is about
 * is passed in `overrides`; everything else is a neutral default, so a case
 * reads as the one thing it measures.
 */
async function runCore(
  overrides: Partial<ToolLoopOptions>,
  replies: ScriptedReply[],
): Promise<{ result: ToolLoopResult; requests: Record<string, unknown>[] }> {
  const { server, url, requests } = await startScriptedModelServer(replies);
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const result = await runToolLoop({
      client: getModelClient(),
      endpointModel: 'fake/model',
      prompt: 'How long do these requests take to close?',
      tools: [],
      executeToolCall: async () => ONE_ROW,
      ...overrides,
    });
    return { result, requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Every message of every request the endpoint received, flattened. */
function allMessages(requests: Record<string, unknown>[]): Wire[] {
  return requests.flatMap((r) => (r.messages as Wire[] | undefined) ?? []);
}

function toolMessages(requests: Record<string, unknown>[]): Wire[] {
  return allMessages(requests).filter((m) => m.role === 'tool');
}

// --- #331: an oversized envelope must stay readable ------------------------
//
// `truncateToolResult` recognised only a bare JSON array. A paginated envelope
// — `{"data": [...], "total_rows": N}` — is not an array, so an oversized one
// fell through to raw character truncation and was cut mid-record. Measured on
// the issue's own reproduction: 296,028 characters in, 50,042 out, `Bad
// control character in string literal at position 50000`, and no marker at all
// telling the model that anything had been dropped.

/** A Socrata-shaped envelope of `rows` rows — the shape #331 reproduces on. */
function socrataEnvelope(rows: number): string {
  return JSON.stringify({
    data: Array.from({ length: rows }, (_, i) => ({
      unique_key: String(100_000 + i),
      created_date: '2026-01-01T00:00:00.000',
      complaint_type: 'Noise - Residential',
      borough: 'BROOKLYN',
      incident_zip: '11201',
    })),
    total_rows: rows,
  });
}

const ROW_MARKER = /\n\[Truncated: showing (\d+) of (\d+) rows\]$/;

/** The JSON body of a truncated result, with its trailing marker line split off. */
function splitTruncated(content: string): { body: string; kept: number; total: number } {
  const marker = content.match(ROW_MARKER);
  assert.ok(marker, `no row-truncation marker on the result fed to the model:\n…${content.slice(-160)}`);
  return {
    body: content.slice(0, marker.index),
    kept: Number(marker[1]),
    total: Number(marker[2]),
  };
}

test('#331: an oversized Socrata envelope reaches the model as valid JSON carrying the truncation marker', async () => {
  const envelope = socrataEnvelope(2_000);
  assert.ok(envelope.length > 250_000, `fixture must exceed the bound: ${envelope.length}`);

  const { requests } = await runCore(
    { executeToolCall: async () => envelope },
    [FETCH_CALL, { content: REAL_ANSWER }],
  );

  const fed = toolMessages(requests)[0]?.content;
  assert.ok(fed, 'the tool result must reach the model');

  // RED before the fix: there is no marker at all on this path, and the body
  // ends inside a string literal, so this parse throws with `Bad control
  // character in string literal at position 50000`.
  const { body, kept, total } = splitTruncated(fed!);
  const parsed = JSON.parse(body) as { data: unknown[]; total_rows: number };

  assert.ok(Array.isArray(parsed.data), 'the envelope framing must survive truncation');
  assert.equal(parsed.data.length, kept);
  assert.equal(total, 2_000);
  assert.ok(kept > 0 && kept < 2_000, `expected a partial page, kept ${kept}`);
  // `total_rows` is preserved so the model still knows how large the matching
  // set upstream was — the thing raw truncation destroyed.
  assert.equal(parsed.total_rows, 2_000);
  assert.ok(body.length < envelope.length, 'the bound is still enforced');
  assert.ok(body.length < 60_000, `body should sit near the 50k budget, was ${body.length}`);
});

test('#331: a bare array still truncates by whole rows (no regression)', async () => {
  const rows = Array.from({ length: 2_000 }, (_, i) => ({
    id: `row-${i}`,
    name: 'Restaurant Inspections',
    detail: 'x'.repeat(60),
  }));
  const bare = JSON.stringify(rows);
  assert.ok(bare.length > 50_000);

  const { requests } = await runCore(
    { executeToolCall: async () => bare },
    [FETCH_CALL, { content: REAL_ANSWER }],
  );

  const { body, kept, total } = splitTruncated(toolMessages(requests)[0]!.content!);
  const parsed = JSON.parse(body) as unknown[];
  assert.equal(parsed.length, kept);
  assert.equal(total, 2_000);
});

test('#331: a non-JSON result keeps the character-truncation marker', async () => {
  // The fall-through is still there and still says what it did — the bound
  // exists to limit input token growth, and that has not changed.
  const prose = 'x'.repeat(60_000);
  const { requests } = await runCore(
    { executeToolCall: async () => prose },
    [FETCH_CALL, { content: REAL_ANSWER }],
  );
  const fed = toolMessages(requests)[0]!.content!;
  assert.match(fed, /\n\[Truncated: result was 60000 characters\]$/);
  assert.doesNotMatch(fed, ROW_MARKER);
});

test('#331: a result inside the bound is fed back untouched', async () => {
  const { requests } = await runCore({}, [FETCH_CALL, { content: REAL_ANSWER }]);
  assert.equal(toolMessages(requests)[0]!.content, ONE_ROW);
});

// --- #349: a tool call whose arguments will not parse -----------------------
//
// All three loops parsed the endpoint's tool-call arguments with a bare
// `JSON.parse` sitting OUTSIDE the try that wraps tool execution. A malformed
// set therefore bypassed every failure path: on this loop it escaped to the
// outer catch and ended a query that may already have completed several
// successful calls.

const SENTINEL = 'sentinel-must-not-reach-a-tool-message';

/** Arguments the endpoint cut off mid-string — the realistic malformed shape. */
const MALFORMED_ARGUMENTS = `{"type":"query","dataset_id":"${SENTINEL}`;

const MALFORMED_CALL: ScriptedReply = {
  toolCalls: [{ id: 'call_bad', name: 'get_data', args: {}, rawArguments: MALFORMED_ARGUMENTS }],
};

test('#349 (a): a malformed argument set is RECORDED as a failed tool call', async () => {
  const { result } = await runCore({}, [MALFORMED_CALL, { content: REAL_ANSWER }]);

  assert.equal(result.toolCalls.length, 1, 'the call is still recorded — it was attempted');
  assert.equal(result.toolCalls[0].failed, true);
  assert.equal(result.toolCalls[0].failureKind, 'unknown');
  assert.equal(result.toolCalls[0].name, 'get_data');
});

test('#349 (b): the model is told through describeToolFailureForLlm, with no parse-error text on the wire', async () => {
  let executed = 0;
  const { requests } = await runCore(
    { executeToolCall: async () => { executed++; return ONE_ROW; } },
    [MALFORMED_CALL, { content: REAL_ANSWER }],
  );

  assert.equal(executed, 0, 'a call whose arguments would not parse must not be executed');

  const fed = toolMessages(requests).map((m) => m.content ?? '');
  assert.equal(fed.length, 1);
  assert.equal(fed[0], describeToolFailureForLlm('get_data', new Error('any')));
  assert.match(fed[0], /Do not estimate, guess, or fabricate any values/);

  // The parser's own message quotes the malformed bytes back and names an
  // offset. None of it may reach a tool message.
  assert.ok(!fed[0].includes(SENTINEL), `the malformed argument text reached the model:\n${fed[0]}`);
  const wire = JSON.stringify(requests);
  for (const needle of ['in JSON at position', 'Unterminated string', 'SyntaxError', 'Unexpected token']) {
    assert.ok(!wire.includes(needle), `raw parse-error text on the wire: ${needle}`);
  }

  // The ASSISTANT turn legitimately still carries the arguments the endpoint
  // sent — that is the model's own turn, and rewriting it would make the
  // transcript a fiction. The sentinel is expected there and nowhere else.
  const assistantTurns = allMessages(requests).filter((m) => m.role === 'assistant');
  assert.ok(
    assistantTurns.some((m) => JSON.stringify(m.tool_calls ?? []).includes(SENTINEL)),
    'the turn being corrected must stay in the transcript',
  );
});

test('#349 (c): a malformed argument set does NOT end the run — the loop continues and answers', async () => {
  // Two rounds: the first call is unparseable, the second is fine. Before the
  // guard the first threw out of the loop entirely and there was no second.
  const { result, requests } = await runCore({}, [
    MALFORMED_CALL,
    { toolCalls: [{ id: 'call_2', name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234' } }] },
    { content: REAL_ANSWER },
  ]);

  assert.equal(result.content, REAL_ANSWER, 'the query still answers');
  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolCalls[0].failed, true);
  assert.equal(result.toolCalls[1].failed, undefined, 'the good call is not tarred by the bad one');
  assert.deepEqual(result.toolCalls[1].resultSummary, { rows: 1, columns: 2 });
  assert.equal(requests.length, 3);
});

test('#349: JSON that parses but is not an argument set is the same failure', async () => {
  // `null` parses cleanly and then throws on the first property read, one step
  // further along — outside the guard if the guard only watches the parse.
  const { result, requests } = await runCore({}, [
    { toolCalls: [{ id: 'call_null', name: 'get_data', args: {}, rawArguments: 'null' }] },
    { content: REAL_ANSWER },
  ]);

  assert.equal(result.toolCalls[0].failed, true);
  assert.equal(result.toolCalls[0].failureKind, 'unknown');
  assert.deepEqual(result.toolCalls[0].args, {}, 'the record carries an empty set, never null');
  assert.equal(result.content, REAL_ANSWER);
  assert.equal(toolMessages(requests).length, 1);
});

// --- The args-identity constraint ------------------------------------------

test('the args on the record is the SAME object handed to executeToolCall', async () => {
  // Not deep equality — identity. Callers inject fields into `args` inside the
  // tool closure (a portal, most often), and the recorded arguments must show
  // what was actually sent: they reach a signed package, and the replay
  // identity key is computed over `name:args.type:args.dataset_id:args.portal`.
  // A clone or a freeze here changes those keys with nothing in the diff
  // pointing at the cause, which is why this probe checks BOTH the reference
  // and a field injected after the record was made.
  let handed: Record<string, unknown> | undefined;
  const { result } = await runCore(
    {
      executeToolCall: async (_name, args) => {
        handed = args;
        args.portal = 'data.cityofnewyork.us';
        return ONE_ROW;
      },
    },
    [FETCH_CALL, { content: REAL_ANSWER }],
  );

  const recorded = result.toolCalls[0].args;
  assert.ok(handed, 'the tool must have been called');
  assert.equal(recorded, handed, 'the recorded args must BE the object the tool received');
  assert.equal(
    recorded.portal,
    'data.cityofnewyork.us',
    'a field injected in the tool closure must be visible on the record',
  );
});

// --- #343: the output contract, stated once --------------------------------

const CONTRACT_SENTENCE = 'a statement of intent is not an answer';

test('#343: only ONE message states the output contract, on the path that writes an abort note', async () => {
  // The max-iterations path is the one that still writes a note for tool calls
  // the loop never ran. It used to paraphrase the contract ("Please provide a
  // summary based on the data already collected") next to the restatement that
  // replaced that wording — two statements, and editing one gave no reason to
  // look at the other. The note now reports a fact and nothing else.
  const { requests } = await runCore({ maxIterations: 2 }, [FETCH_CALL]);

  const answering = requests[requests.length - 1];
  const messages = answering.messages as Wire[];
  const contractStatements = messages.filter((m) => (m.content ?? '').includes(CONTRACT_SENTENCE));
  assert.equal(contractStatements.length, 1, 'the output contract is stated exactly once');
  assert.equal(contractStatements[0].role, 'user');

  const note = messages.filter((m) => m.role === 'tool').at(-1)!.content!;
  // The paraphrase is the second statement, and it is the one that goes
  // unnoticed: it does not repeat the restatement's words, so counting them
  // will not find it. What identifies it is that it tells the model what to
  // WRITE, which is the restatement's job and no one else's.
  assert.doesNotMatch(note, /provide a summary|summari[sz]e|please provide/i,
    `the abort note is stating the output contract a second time:\n${note}`);
  assert.match(note, /was not run/);
});

test('#343: the token-limit path writes no abort note at all — the state the deleted arm required cannot occur', async () => {
  // The deleted arm could only be selected when the token limit stopped the
  // loop AND the last assistant turn was not already in the transcript —
  // states that cannot both hold, because the break happens after the turn is
  // pushed and its calls answered. This pins the measurement that made it
  // unreachable, so an edit that makes the state occur has to face it.
  const { requests } = await runCore(
    { maxCumulativeTokens: 200_000 },
    [{ ...FETCH_CALL, totalTokens: 250_000 }, { content: REAL_ANSWER }],
  );

  const wire = JSON.stringify(requests);
  assert.ok(!wire.includes('Token budget exceeded'), 'a dead arm cannot be reintroduced quietly');

  const messages = requests[requests.length - 1].messages as Wire[];
  const answered = messages.filter((m) => m.role === 'tool');
  assert.equal(answered.length, 1);
  assert.equal(answered[0].content, ONE_ROW, 'the call the loop DID run keeps its real result');
});

// --- The exit condition is core behaviour, not a caller's option -----------

test('#334: a final turn that announces a query is not returned as the answer', async () => {
  const NARRATION =
    "I now have the counts by request type for both years. Next, I'll query the fraction of " +
    'records that close within 14 and 30 days per type.';

  const { result, requests } = await runCore({}, [
    FETCH_CALL,
    { content: NARRATION },
    { content: REAL_ANSWER },
  ]);

  assert.notEqual(result.content, NARRATION);
  assert.equal(result.content, REAL_ANSWER);
  assert.equal(result.answeringTurnTaken, true);
  assert.equal(requests.length, 3, 'one answering turn, no more');
});

test('#334: a genuine answer costs no extra model call', async () => {
  const { result, requests } = await runCore({}, [FETCH_CALL, { content: REAL_ANSWER }]);
  assert.equal(result.content, REAL_ANSWER);
  assert.equal(result.answeringTurnTaken, false);
  assert.equal(requests.length, 2, 'a good answer must not be re-asked');
});

// --- A failed tool call is one failed call, not a failed query -------------

test('#321: an execution failure is recorded and described, and the run survives it', async () => {
  const { result, requests } = await runCore(
    {
      executeToolCall: async () => {
        throw new Error('ECONNREFUSED db.internal.example:5432');
      },
    },
    [FETCH_CALL, { content: REAL_ANSWER }],
  );

  assert.equal(result.toolCalls[0].failed, true);
  assert.equal(result.toolCalls[0].failureKind, 'unavailable');
  assert.equal(result.content, REAL_ANSWER);

  const wire = JSON.stringify(requests);
  assert.ok(!wire.includes('db.internal.example'), 'no raw error text reaches the model');
});

// --- The parameters a non-streaming caller needs ---------------------------

test('a blocking final turn answers without streaming — the shape a route caller uses', async () => {
  const deltas: string[] = [];
  const { result, requests } = await runCore(
    { finalTurn: 'blocking', onDelta: (d) => deltas.push(d) },
    [FETCH_CALL, { content: '' }, { content: REAL_ANSWER }],
  );

  assert.equal(result.content, REAL_ANSWER);
  assert.equal(result.streamed, false);
  assert.deepEqual(deltas, [], 'a blocking caller receives no deltas');
  assert.equal(requests[requests.length - 1].stream, undefined, 'the answering turn is not a stream');
});

test('maxIterations and maxTokens are caller parameters (the lower pair /api/compare keeps)', async () => {
  // The wave leaves `/api/compare` on 10 iterations and 2000 max_tokens; this
  // is the seam that lets it say so rather than inherit 20/4000.
  const { result, requests } = await runCore(
    { maxIterations: 10, maxTokens: 2_000 },
    [FETCH_CALL],
  );

  assert.equal(result.iterations, 10, 'the cap is the caller’s');
  for (const request of requests.slice(0, -1)) {
    assert.equal(request.max_tokens, 2_000);
  }
  // 10 tool-calling rounds plus the opening call, plus one answering turn.
  assert.equal(requests.length, 12);
});

test('an omitted token budget is unbounded — the default a caller with no budget needs', async () => {
  // `maxCumulativeTokens` absent must not mean zero: a loop that treated it as
  // a budget of 0 would abort every run on its first round.
  const { result, requests } = await runCore({}, [
    { ...FETCH_CALL, totalTokens: 500_000 },
    { content: REAL_ANSWER },
  ]);

  assert.equal(result.tokenLimitExceeded, false);
  assert.equal(result.content, REAL_ANSWER);
  assert.equal(requests.length, 2);
});

test('a token budget, when given, stops the loop and reports itself', async () => {
  const { result } = await runCore(
    { maxCumulativeTokens: 200_000 },
    [{ ...FETCH_CALL, totalTokens: 250_000 }, { content: REAL_ANSWER }],
  );

  assert.equal(result.tokenLimitExceeded, true);
  assert.equal(result.answeringTurnTaken, true);
  assert.equal(result.content, REAL_ANSWER);
});
