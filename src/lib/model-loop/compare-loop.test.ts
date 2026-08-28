// Acceptance tests for /api/compare on the shared loop core (#345 P4).
//
// WHAT IS UNDER TEST, and why it is this and not the route. `compare/route.ts`
// is a Next route handler: `node --test` cannot invoke one. So the loop
// configuration was moved OUT of `openrouter.ts` — whose loop was the original
// one this family forked from — into `compareLoopOptions`, and these tests
// drive the real `runToolLoop` with the real options factory against a local
// scripted model server. The only thing substituted is the tool transport, one
// level BELOW the loop, so no case here restates a cap, a bound, a tool set or
// the portal injection. Change compare's configuration and these tests change
// with it; that is the point of the seam.
//
// A source-drift guard at the bottom closes the remaining gap: it asserts the
// route actually obtains its options from this factory and supplies no
// transport and no configuration of its own. Between that and
// `model-call-registry.test.ts` (which fails if the route or `openrouter.ts`
// carries a tool loop at all), "the route runs this" is measured rather than
// assumed.
//
// Every claim about what the model was SENT is asserted against the request
// bodies the mock server received, because that is where those claims live: a
// raw error string in a `tool` message (#344), a cap that silently became the
// core's higher default, and a result handed over untruncated are all invisible
// from the return value.
//
// The RED baseline for each case was measured at 08858a9 by driving the real
// `queryWithMcp` — the loop this replaces — against this same harness. It
// returned the announcement as `content` in 2 requests, put
// `Error executing tool: ECONNREFUSED db.internal.example:5432` on the wire
// verbatim, recorded `{name, args}` with no `failed`/`failureKind`, and threw a
// `SyntaxError` out of the loop on a malformed argument set after 1 request.
//
// No live endpoint, no credential, no MCP server. Every key value is an
// obviously fake fixture and the address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/compare-loop.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runToolLoop } from './run-tool-loop.ts';
import {
  compareLoopOptions,
  compareCompletionResult,
  COMPARE_MAX_ITERATIONS,
  COMPARE_MAX_TOKENS,
  COMPARE_MAX_TOOL_RESULT_CHARS,
  type CompareCompletionResult,
  type CompareToolTransport,
} from './compare-loop.ts';
import { startScriptedModelServer, type ScriptedReply } from './test-harness.ts';
import { createModelClient } from '../model-client.ts';

const FIXTURE_KEY = 'not-a-real-key-p4-compare-fixture';
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

interface Wire {
  role: string;
  content?: string;
  tool_call_id?: string;
}

/**
 * Run the MCP half of one comparison against a scripted endpoint, and return
 * the `withMcp` body the route answers with — built by the same function the
 * route calls, so a case asserts on what an API client actually reads rather
 * than on the loop's own return shape.
 *
 * `callTool` is the ONLY thing a case supplies beyond what the route reads off
 * the request — no cap, no bound, no tool list, no portal handling.
 */
async function runCompare(
  replies: ScriptedReply[],
  callTool: CompareToolTransport,
): Promise<{ withMcp: CompareCompletionResult; requests: Record<string, unknown>[] }> {
  const { server, url, requests } = await startScriptedModelServer(replies);
  try {
    process.env.MODEL_API_BASE_URL = url;
    const result = await runToolLoop(
      compareLoopOptions({
        client: createModelClient({ apiKey: FIXTURE_KEY }),
        endpointModel: 'fake/model',
        prompt: PROMPT,
        systemPrompt: SYSTEM,
        portal: PORTAL,
        callTool,
      }),
    );
    return { withMcp: compareCompletionResult(result), requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const messagesOf = (requests: Record<string, unknown>[]): Wire[] =>
  requests.flatMap((r) => (r.messages as Wire[] | undefined) ?? []);

// --- #344: an announcement is not an answer --------------------------------
//
// The deleted loop exited on `!lastMessage?.content && (...)` — the pre-#334
// condition, keyed on content being ABSENT. A final turn that announced its
// next query carried content, so it was returned as `content` and served as the
// answer to a public API call. Measured through that loop at 08858a9 on this
// fixture: `content` WAS the announcement, in 2 model requests.

test('#344: a final turn that announces a query is not returned as compare’s answer', async () => {
  const NARRATION =
    "I now have the counts by request type for both years. Next, I'll query the fraction of " +
    'records that close within 14 and 30 days per type.';
  assert.ok(NARRATION.length < 600, 'the fixture must be inside the announcement length bound');

  const { withMcp, requests } = await runCompare(
    [FETCH_CALL, { content: NARRATION }, { content: REAL_ANSWER }],
    async () => ONE_ROW,
  );

  assert.notEqual(withMcp.content, NARRATION, 'a statement of intent must not be served as the answer');
  assert.equal(withMcp.content, REAL_ANSWER);
  assert.equal(requests.length, 3, 'one answering turn, no more');
});

test('#344: a genuine answer is returned as written, with no extra model call', async () => {
  const { withMcp, requests } = await runCompare([FETCH_CALL, { content: REAL_ANSWER }], async () => ONE_ROW);
  assert.equal(withMcp.content, REAL_ANSWER);
  assert.equal(requests.length, 2, 'a good answer must not be re-asked');
});

// --- #344: no raw error text reaches the model, and the record says so ------

test('#344: a tool failure reaches the model as guidance, and the record says it failed', async () => {
  const SENTINEL = 'db.internal.example';
  const { withMcp, requests } = await runCompare(
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
  assert.ok(
    !JSON.stringify(requests).includes('Error executing tool'),
    'the deleted loop’s verbatim error wrapper is gone from the wire',
  );

  assert.equal(withMcp.tools_called?.[0].failed, true);
  assert.equal(withMcp.tools_called?.[0].failureKind, 'unavailable');
  assert.equal(withMcp.content, REAL_ANSWER, 'one failed call is not a failed comparison');
});

// --- #349, the last instance: a malformed argument set does not end the run -
//
// The deleted loop parsed `toolCall.function.arguments` with a bare
// `JSON.parse` OUTSIDE the `try` that wrapped execution, so unparseable bytes
// from the endpoint threw straight past every failure path and out of the
// function — a 500 from this route, after any successful calls had been paid
// for. Measured through that loop at 08858a9 on this fixture: a `SyntaxError`
// out of the loop, 1 model request, no result at all.

test('#349: a malformed tool-argument set is one failed call, and the run continues', async () => {
  let transportCalled = false;
  const { withMcp, requests } = await runCompare(
    [
      { toolCalls: [{ id: 'call_1', name: 'get_data', args: {}, rawArguments: '{"type": "query",' }] },
      { content: REAL_ANSWER },
    ],
    async () => {
      transportCalled = true;
      return ONE_ROW;
    },
  );

  assert.equal(withMcp.content, REAL_ANSWER, 'the run reaches an answer rather than throwing');
  assert.equal(requests.length, 2, 'the loop went on to ask the model again');
  assert.equal(transportCalled, false, 'an unreadable argument set never reaches the source');

  assert.equal(withMcp.tools_called?.length, 1, 'the attempt is recorded, not dropped');
  assert.equal(withMcp.tools_called?.[0].failed, true);
  assert.equal(withMcp.tools_called?.[0].failureKind, 'unknown');

  const toolMessages = messagesOf(requests).filter((m) => m.role === 'tool');
  assert.equal(toolMessages.length, 1, 'the model is told the call failed');
  assert.ok(
    !toolMessages[0].content?.includes('{"type": "query",'),
    'the endpoint’s malformed bytes are not quoted back at it',
  );
  // The parser's own message quotes the malformed bytes back and names a
  // position; none of that is the app's to put in front of a model.
  const wire = JSON.stringify(requests);
  for (const parserText of ['in JSON at position', 'Unexpected end of JSON input', 'SyntaxError']) {
    assert.ok(!wire.includes(parserText), `no parser text on the wire: ${parserText}`);
  }
});

// --- The caps this caller keeps, asserted where they land ------------------
//
// Owner ruling: /api/compare keeps 10 iterations and max_tokens 2000 rather
// than adopting the core's 20 and 4000. It is a rate-limited public endpoint
// and the documented operator smoke test, so the higher defaults would double
// the worst-case cost of a call anyone can make. Both halves are asserted ON
// THE WIRE, because a cap that quietly reverted to a default is invisible from
// the return value — and 10 vs 20 is exactly the difference this measures.

test('compareLoopOptions carries compare’s own caps and the shared tool set', () => {
  const options = compareLoopOptions({
    client: {} as never,
    endpointModel: 'fake/model',
    prompt: PROMPT,
    systemPrompt: SYSTEM,
    portal: PORTAL,
  });

  assert.equal(options.maxIterations, COMPARE_MAX_ITERATIONS);
  assert.equal(COMPARE_MAX_ITERATIONS, 10, 'half the core’s default, by owner ruling');
  assert.equal(options.maxTokens, COMPARE_MAX_TOKENS);
  assert.equal(COMPARE_MAX_TOKENS, 2000, 'half the core’s default, by owner ruling');
  assert.equal(options.maxToolResultChars, COMPARE_MAX_TOOL_RESULT_CHARS);
  assert.equal(
    options.maxCumulativeTokens,
    undefined,
    'this caller has never had a cumulative budget; undefined is unbounded in the core',
  );
  assert.equal(options.finalTurn, 'blocking', 'a JSON route has no stream to write into');
  assert.ok(options.tools.length > 0, 'the comparison runs against the instance’s MCP tool set');
  assert.equal(options.systemPrompt, SYSTEM);
  assert.equal(options.prompt, PROMPT);
});

test('every request this caller makes carries max_tokens 2000', async () => {
  const { requests } = await runCompare(
    [FETCH_CALL, { content: REAL_ANSWER }],
    async () => ONE_ROW,
  );
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.max_tokens, COMPARE_MAX_TOKENS, 'the core’s 4000 default must not reach the endpoint');
  }
});

test('the loop stops after ten tool-calling rounds, not the core’s twenty', async () => {
  // The scripted server repeats its LAST reply forever, so a model that never
  // stops calling tools is what bounds this: the request count is the cap made
  // observable. One opening call, `maxIterations` rounds, one answering turn.
  const { withMcp, requests } = await runCompare(
    [{ toolCalls: [{ id: 'call_n', name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234' } }] }],
    async () => ONE_ROW,
  );

  assert.equal(requests.length, COMPARE_MAX_ITERATIONS + 2);
  assert.equal(requests.length, 12, 'the core’s default cap would make this 22');
  assert.equal(withMcp.tools_called?.length, COMPARE_MAX_ITERATIONS);
  // The answering turn is the one request that offers no tools.
  assert.equal(requests.filter((r) => r.tools === undefined).length, 1);
});

// --- The truncation bound this caller gains --------------------------------
//
// The deleted loop pushed a tool result as returned, with no bound at all
// (#344 item 3). It now gets the core's shared bound, and #331's envelope
// handling with it: whole rows and a marker rather than a fragment cut
// mid-record.

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

test('an oversized envelope now reaches the model bounded, as valid JSON with a row marker', async () => {
  const envelope = socrataEnvelope(2000);
  assert.ok(envelope.length > COMPARE_MAX_TOOL_RESULT_CHARS, 'the fixture must exceed compare’s new bound');

  const { requests } = await runCompare([FETCH_CALL, { content: REAL_ANSWER }], async () => envelope);

  const sent = messagesOf(requests).find((m) => m.role === 'tool')?.content;
  assert.ok(sent, 'the tool result must reach the model');
  assert.ok(sent.length < envelope.length, 'the deleted loop sent this whole, unbounded');
  assert.match(sent, /\n\[Truncated: showing \d+ of 2000 rows\]$/, 'the model is told rows were dropped');

  const body = sent.slice(0, sent.lastIndexOf('\n[Truncated'));
  const parsed = JSON.parse(body) as { data: unknown[]; total_rows: number };
  assert.ok(Array.isArray(parsed.data) && parsed.data.length > 0, 'whole rows, not a fragment');
  assert.equal(parsed.total_rows, 2000, 'the envelope’s other fields survive');
  assert.ok(body.length <= COMPARE_MAX_TOOL_RESULT_CHARS, 'the bound is enforced on the body');
});

// --- The documented response body ------------------------------------------
//
// `docs/project-plan.md` documents this body. The four fields, their names and
// their order are unchanged; `tools_called[]` entries are additive, and
// `tokens_used` is now the run's cumulative total rather than its last call's.

test('the withMcp body keeps its four documented fields, tools_called additively', async () => {
  const { withMcp } = await runCompare([FETCH_CALL, { content: REAL_ANSWER }], async () => ONE_ROW);

  assert.deepEqual(Object.keys(withMcp), ['content', 'duration_ms', 'tokens_used', 'tools_called']);
  assert.equal(typeof withMcp.content, 'string');
  assert.equal(typeof withMcp.duration_ms, 'number');
  assert.equal(typeof withMcp.tokens_used, 'number');

  // The two documented fields of a tools_called entry, unchanged.
  assert.equal(withMcp.tools_called?.[0].name, 'get_data');
  assert.deepEqual(withMcp.tools_called?.[0].args, {
    type: 'query',
    dataset_id: 'abcd-1234',
    portal: PORTAL,
  });
  // Additive: the shared record's own fields, which this caller never had.
  assert.equal(withMcp.tools_called?.[0].operationType, 'query');
  assert.deepEqual(withMcp.tools_called?.[0].resultSummary, { rows: 1, columns: 2 });
  assert.equal(typeof withMcp.tools_called?.[0].duration_ms, 'number');
});

test('tokens_used is the run’s cumulative total, not its last call’s', async () => {
  // The harness reports 15 total tokens per response. Two responses, so a
  // last-call reading is 15 and a cumulative one is 30 — the deleted loop
  // reported the former.
  const { withMcp, requests } = await runCompare([FETCH_CALL, { content: REAL_ANSWER }], async () => ONE_ROW);
  assert.equal(requests.length, 2);
  assert.equal(withMcp.tokens_used, 30);
});

test('tools_called is omitted, not empty, when no tool ran', async () => {
  const { withMcp } = await runCompare([{ content: REAL_ANSWER }], async () => ONE_ROW);
  assert.equal(withMcp.tools_called, undefined, 'an API client distinguishing absent from empty sees what it saw');
  assert.deepEqual(Object.keys(withMcp), ['content', 'duration_ms', 'tokens_used', 'tools_called']);
  assert.equal(JSON.parse(JSON.stringify(withMcp)).tools_called, undefined, 'and the field is absent on the wire');
});

// --- The portal injection, and the args object it injects into -------------
//
// The route injected the request's portal into `args` inside its own tool
// closure; that closure moved here whole. The recorded arguments are what
// `tools_called[].args` reports, so the injection must reach THE OBJECT THE
// CORE ALREADY RECORDED — the same object, by reference. If the loop ever
// clones or freezes `args`, the injection stops reaching the record and nothing
// in the diff points at the cause.

test('the request’s portal is injected into Socrata calls, into the recorded object itself', async () => {
  const seen: Record<string, unknown>[] = [];
  const { withMcp } = await runCompare(
    [
      {
        toolCalls: [
          { id: 'call_1', name: 'get_data', args: { type: 'catalog', query: 'noise complaints' } },
          { id: 'call_2', name: 'get_data', args: { type: 'metrics', dataset_id: 'erm2-nwe9', portal: 'data.sfgov.org' } },
          { id: 'call_3', name: 'get_variables', args: { place: 'geoId/36061' } },
        ],
      },
      { content: REAL_ANSWER },
    ],
    async (_name, args) => {
      seen.push(args);
      return ONE_ROW;
    },
  );

  const recorded = withMcp.tools_called ?? [];
  assert.equal(recorded[0].args.portal, PORTAL, 'a Socrata call with no portal gets the request’s');
  assert.equal(recorded[1].args.portal, 'data.sfgov.org', 'an explicit portal is never overwritten');
  assert.equal(recorded[2].args.portal, undefined, 'a non-Socrata tool gets no portal at all');

  for (const [i, args] of seen.entries()) {
    assert.equal(args, recorded[i].args, 'the transport receives the very object the record holds');
  }
});

// --- The route runs this, and holds no configuration of its own ------------

test('#345: the compare route obtains its loop options from this factory', () => {
  const route = readFileSync(
    fileURLToPath(new URL('../../app/api/compare/route.ts', import.meta.url)),
    'utf8',
  );

  assert.match(route, /compareLoopOptions\(/, 'the route must build its options here, not inline');
  assert.match(route, /runToolLoop\(/, 'the route must drive the shared core');
  assert.ok(
    !route.includes('queryWithMcp'),
    'the deleted loop must have no caller left',
  );
  assert.ok(
    !route.includes('callTool'),
    'the route must not supply a tool transport — the seam exists for tests, not for production',
  );
  for (const configuration of ['maxIterations', 'max_tokens', 'maxCumulativeTokens', 'maxToolResultChars', 'truncateToolResult']) {
    assert.ok(
      !route.includes(configuration),
      `the route must not restate ${configuration}: loop configuration lives in compare-loop.ts`,
    );
  }

  // The A-side stays where it is: one call, no tools, nothing to consolidate.
  assert.match(route, /queryWithoutMcp\(/, 'the no-tools half of the comparison is unchanged');
});
