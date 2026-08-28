// Acceptance tests for the replay path on the shared loop core (#345 P3).
//
// WHAT IS UNDER TEST, and why it is this and not the route. `replay/route.ts`
// is a Next route handler: `node --test` cannot invoke one. So the loop
// configuration was moved OUT of the route into `replayLoopOptions`, and these
// tests drive the real `runToolLoop` with the real options factory against a
// local scripted model server. The only thing substituted is the tool
// transport — one level BELOW the loop — so no case here restates a cap, a
// budget, a tool set or the portal injection. Change replay's configuration
// and these tests change with it; that is the point of the seam.
//
// A source-drift guard at the bottom closes the remaining gap: it asserts the
// route actually obtains its options from this factory and supplies no
// transport of its own. Between that and `model-call-registry.test.ts` (which
// fails if the route calls the model at all), "the route runs this" is
// measured rather than assumed.
//
// Every claim about what the model was SENT is asserted against the request
// bodies the mock server received, because that is where the claims live: a
// truncation that hands the model malformed JSON (#331), a raw error string in
// a `tool` message (#338), and a duplicated assistant turn (#347) are all
// invisible from the return value.
//
// No live endpoint, no credential, no MCP server. Every key value is an
// obviously fake fixture and the address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/replay-loop.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runToolLoop, type ToolCallRecord } from './run-tool-loop.ts';
import {
  replayLoopOptions,
  REPLAY_MAX_ITERATIONS,
  REPLAY_MAX_TOKENS,
  REPLAY_MAX_CUMULATIVE_TOKENS,
  REPLAY_MAX_TOOL_RESULT_CHARS,
  type ReplayToolTransport,
} from './replay-loop.ts';
import { startScriptedModelServer, type ScriptedReply } from './test-harness.ts';
import { createModelClient } from '../model-client.ts';

const FIXTURE_KEY = 'not-a-real-key-p3-replay-fixture';
const PORTAL = 'data.cityofnewyork.us';
const PROMPT = 'How long do these requests take to close?';
const SYSTEM = 'You are a fixture system prompt.';

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['MODEL_API_BASE_URL', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION'];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const REAL_ANSWER =
  'Across both years the portal recorded 4,812 requests of this type. The median time to close ' +
  'was 9 days, and 71% closed within 14 days (dataset abcd-1234).';

/** A `get_data` call carrying NO portal — the injection this caller performs. */
const FETCH_CALL: ScriptedReply = {
  toolCalls: [{ id: 'call_1', name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234' } }],
};

const ONE_ROW = JSON.stringify({ data: [{ request_type: 'A', days_to_close: 9 }], total_rows: 1 });

/**
 * The payload `POST /api/records/:slug/replay` answers with, built exactly as
 * the route builds it from a `ToolLoopResult`. Kept here so a case asserts on
 * what the attestation client actually reads rather than on the loop's own
 * return shape.
 */
interface ReplayPayload {
  toolCalls: ToolCallRecord[];
  output: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
}

interface Wire {
  role: string;
  content?: string;
  tool_call_id?: string;
}

/**
 * Run one replay against a scripted endpoint. `callTool` is the ONLY thing a
 * case supplies beyond the fixtures the route reads off a record — no cap, no
 * budget, no tool list, no portal handling.
 */
async function runReplay(
  replies: ScriptedReply[],
  callTool: ReplayToolTransport,
): Promise<{ payload: ReplayPayload; requests: Record<string, unknown>[] }> {
  const { server, url, requests } = await startScriptedModelServer(replies);
  try {
    process.env.MODEL_API_BASE_URL = url;
    const result = await runToolLoop(
      replayLoopOptions({
        client: createModelClient({ apiKey: FIXTURE_KEY }),
        endpointModel: 'fake/model',
        prompt: PROMPT,
        systemPrompt: SYSTEM,
        portal: PORTAL,
        callTool,
      }),
    );
    return {
      payload: {
        toolCalls: result.toolCalls,
        output: result.content,
        tokenUsage: result.usage,
        durationMs: result.durationMs,
      },
      requests,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const messagesOf = (requests: Record<string, unknown>[]): Wire[] =>
  requests.flatMap((r) => (r.messages as Wire[] | undefined) ?? []);

/**
 * `AttestationDialog.canonicalizeToolCall`, copied verbatim from
 * `src/components/evidence/AttestationDialog.tsx:55-63`. Copied rather than
 * imported on purpose: the component is a client module behind the `@/` alias
 * that `node --test` cannot resolve, and the point of this test is that the
 * KEYS a signed attestation is built from do not move. If the component's
 * function ever changes, this copy going stale is the loud failure — a shared
 * helper would quietly agree with itself.
 */
function canonicalizeToolCall(tc: { name: string; args: Record<string, unknown> }): string {
  return [
    tc.name,
    (tc.args.type as string) || '',
    (tc.args.dataset_id as string) || '',
    (tc.args.portal as string) || '',
  ].join(':');
}

// --- #338: an announcement is not an answer --------------------------------
//
// The route's own loop took any assistant turn carrying content as the answer.
// A turn that announced its next query was therefore returned as `output`, and
// `AttestationDialog` fed it into a consistency score submitted as an
// attestation against a published record. Measured on this fixture through the
// loop at `a9681ab`: `output` WAS the announcement, in two model requests.

test('#338: a final turn that announces a query is not returned as the replay output', async () => {
  const NARRATION =
    "I now have the counts by request type for both years. Next, I'll query the fraction of " +
    'records that close within 14 and 30 days per type.';
  assert.ok(NARRATION.length < 600, 'the fixture must be inside the announcement length bound');

  const { payload, requests } = await runReplay(
    [FETCH_CALL, { content: NARRATION }, { content: REAL_ANSWER }],
    async () => ONE_ROW,
  );

  assert.notEqual(payload.output, NARRATION, 'a statement of intent must not be published as the answer');
  assert.equal(payload.output, REAL_ANSWER);
  assert.equal(requests.length, 3, 'one answering turn, no more');
});

test('#338: a genuine answer is published as written, with no extra model call', async () => {
  const { payload, requests } = await runReplay([FETCH_CALL, { content: REAL_ANSWER }], async () => ONE_ROW);
  assert.equal(payload.output, REAL_ANSWER);
  assert.equal(requests.length, 2, 'a good answer must not be re-asked');
});

// --- #338: no raw error text reaches the model -----------------------------

test('#338: a tool failure reaches the model as guidance, and the record says it failed', async () => {
  const SENTINEL = 'db.internal.example';
  const { payload, requests } = await runReplay(
    [FETCH_CALL, { content: REAL_ANSWER }],
    async () => {
      throw new Error(`ECONNREFUSED ${SENTINEL}:5432`);
    },
  );

  const toolMessages = messagesOf(requests).filter((m) => m.role === 'tool');
  assert.equal(toolMessages.length, 1);
  assert.ok(
    !toolMessages[0].content?.includes(SENTINEL),
    'the host name must not reach the model in a tool message',
  );
  assert.ok(
    !JSON.stringify(requests).includes(SENTINEL),
    'no raw error text anywhere on the wire',
  );

  assert.equal(payload.toolCalls[0].failed, true);
  assert.equal(payload.toolCalls[0].failureKind, 'unavailable');
  assert.equal(payload.output, REAL_ANSWER, 'one failed call is not a failed replay');
});

// --- #347: the token-budget path sends a well-formed transcript ------------
//
// The route pushed each assistant turn before running its tools, and its
// token-budget `break` sat before the next request — so the terminal block
// pushed the SAME turn a second time and answered every `tool_call_id` twice,
// once with the real result and once with a placeholder. Measured through the
// loop at `a9681ab` on this fixture: 2 assistant turns, `call_1` answered
// twice. A malformed request, feeding a signed consistency attestation.

test('#347: the token-budget path carries the assistant turn once and answers each call once', async () => {
  const { requests } = await runReplay(
    [{ ...FETCH_CALL, totalTokens: REPLAY_MAX_CUMULATIVE_TOKENS + 50_000 }, { content: REAL_ANSWER }],
    async () => ONE_ROW,
  );

  const last = (requests[requests.length - 1].messages as Wire[]) ?? [];
  assert.equal(last.filter((m) => m.role === 'assistant').length, 1, 'the assistant turn appears once');

  const answers = last.filter((m) => m.role === 'tool' && m.tool_call_id === 'call_1');
  assert.equal(answers.length, 1, 'each tool_call_id is answered exactly once');
  assert.equal(answers[0].content, ONE_ROW, 'the call the loop DID run keeps its real result');
});

// --- #331: an oversized envelope stays readable ----------------------------
//
// The route carried its own copy of `truncateToolResult`, which recognised
// only a bare JSON array. A paginated envelope fell through to raw character
// truncation and was cut mid-record. Measured through the copy at `a9681ab` on
// the envelope below: 296,028 characters in, 50,042 out, `Unterminated string
// in JSON at position 50000`, and no marker telling the model anything was
// dropped.

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

test('#331: an oversized envelope reaches the model as valid JSON with a row marker', async () => {
  const envelope = socrataEnvelope(2000);
  assert.ok(envelope.length > REPLAY_MAX_TOOL_RESULT_CHARS, 'the fixture must exceed replay’s bound');

  const { requests } = await runReplay([FETCH_CALL, { content: REAL_ANSWER }], async () => envelope);

  const sent = messagesOf(requests).find((m) => m.role === 'tool')?.content;
  assert.ok(sent, 'the tool result must reach the model');
  assert.match(sent, /\n\[Truncated: showing \d+ of 2000 rows\]$/, 'the model is told rows were dropped');

  const body = sent.slice(0, sent.lastIndexOf('\n[Truncated'));
  const parsed = JSON.parse(body) as { data: unknown[]; total_rows: number };
  assert.ok(Array.isArray(parsed.data) && parsed.data.length > 0, 'whole rows, not a fragment');
  assert.equal(parsed.total_rows, 2000, 'the envelope’s other fields survive');
  assert.ok(body.length <= REPLAY_MAX_TOOL_RESULT_CHARS, 'the bound is still enforced on the body');
});

// --- The attestation payload changes only additively -----------------------
//
// `AttestationDialog` keys a replay run on
// `name:args.type:args.dataset_id:args.portal` and derives a consistency score
// from the keys of N runs. The portal in that key is injected by this caller
// INTO THE OBJECT THE CORE ALREADY RECORDED. If the loop ever clones or
// freezes `args`, the injection stops reaching the record, every key changes,
// and nothing in the diff points at the cause. These are the keys, spelled out.

test('the attestation identity keys are unchanged, injected portal included', async () => {
  const { payload } = await runReplay(
    [
      {
        toolCalls: [
          { id: 'call_1', name: 'get_data', args: { type: 'catalog', query: 'noise complaints' } },
          { id: 'call_2', name: 'get_data', args: { type: 'query', dataset_id: 'erm2-nwe9' } },
        ],
      },
      {
        toolCalls: [
          { id: 'call_3', name: 'get_data', args: { type: 'metrics', dataset_id: 'erm2-nwe9', portal: 'data.sfgov.org' } },
          { id: 'call_4', name: 'get_variables', args: { place: 'geoId/36061' } },
        ],
      },
      { content: REAL_ANSWER },
    ],
    async () => ONE_ROW,
  );

  assert.deepEqual(payload.toolCalls.map(canonicalizeToolCall), [
    // portal injected by this caller — absent from what the endpoint sent
    'get_data:catalog::data.cityofnewyork.us',
    'get_data:query:erm2-nwe9:data.cityofnewyork.us',
    // an explicit portal is never overwritten
    'get_data:metrics:erm2-nwe9:data.sfgov.org',
    // a non-Socrata tool gets no portal at all
    'get_variables:::',
  ]);
});

test('the payload still carries output, the three token counts and a duration', async () => {
  const { payload } = await runReplay([FETCH_CALL, { content: REAL_ANSWER }], async () => ONE_ROW);

  assert.equal(typeof payload.output, 'string');
  assert.ok(payload.output.length > 0);
  assert.equal(typeof payload.tokenUsage.promptTokens, 'number');
  assert.equal(typeof payload.tokenUsage.completionTokens, 'number');
  assert.equal(typeof payload.tokenUsage.totalTokens, 'number');
  assert.ok(payload.tokenUsage.totalTokens > 0, 'usage is cumulative across the run, as before');
  assert.equal(typeof payload.durationMs, 'number');

  // Additive only: the two fields the client reads off a record are still
  // there, and nothing it reads has been renamed.
  assert.equal(payload.toolCalls[0].name, 'get_data');
  assert.deepEqual(payload.toolCalls[0].args, {
    type: 'query',
    dataset_id: 'abcd-1234',
    portal: PORTAL,
  });
});

// --- The configuration this factory exists to hold -------------------------

test('replayLoopOptions carries replay’s own caps and the shared tool set', () => {
  const options = replayLoopOptions({
    client: {} as never,
    endpointModel: 'fake/model',
    prompt: PROMPT,
    systemPrompt: SYSTEM,
    portal: PORTAL,
  });

  assert.equal(options.maxIterations, REPLAY_MAX_ITERATIONS);
  assert.equal(options.maxTokens, REPLAY_MAX_TOKENS);
  assert.equal(options.maxCumulativeTokens, REPLAY_MAX_CUMULATIVE_TOKENS);
  assert.equal(options.maxToolResultChars, REPLAY_MAX_TOOL_RESULT_CHARS);
  assert.equal(options.finalTurn, 'blocking', 'a route caller has no stream to write into');
  assert.ok(options.tools.length > 0, 'the replay runs against the instance’s MCP tool set');
  assert.equal(options.systemPrompt, SYSTEM);
  assert.equal(options.prompt, PROMPT);
});

test('a tool call that never settles fails on replay’s own timeout, and the run survives', async () => {
  // Proves the race moved with the configuration rather than being lost with
  // the loop. Driven by rejecting with the timeout's own wording instead of
  // waiting 45 real seconds — the assertion is that a timeout is classified
  // and described, not that `setTimeout` counts.
  const { payload, requests } = await runReplay([FETCH_CALL, { content: REAL_ANSWER }], async (name) => {
    throw new Error(`MCP tool "${name}" timed out after 45s`);
  });

  assert.equal(payload.toolCalls[0].failed, true);
  assert.equal(payload.toolCalls[0].failureKind, 'timeout');
  assert.ok(!JSON.stringify(requests).includes('timed out after 45s'), 'raw timeout text stays off the wire');
  assert.equal(payload.output, REAL_ANSWER);
});

// --- The route runs this, and holds no configuration of its own ------------

test('#345: the replay route obtains its loop options from this factory', () => {
  const route = readFileSync(
    fileURLToPath(new URL('../../app/api/evidence/[slug]/replay/route.ts', import.meta.url)),
    'utf8',
  );

  assert.match(route, /replayLoopOptions\(/, 'the route must build its options here, not inline');
  assert.match(route, /runToolLoop\(/, 'the route must drive the shared core');
  assert.ok(
    !route.includes('callTool'),
    'the route must not supply a tool transport — the seam exists for tests, not for production',
  );
  for (const configuration of ['maxIterations', 'max_tokens', 'maxCumulativeTokens', 'truncateToolResult']) {
    assert.ok(
      !route.includes(configuration),
      `the route must not restate ${configuration}: loop configuration lives in replay-loop.ts`,
    );
  }
});
