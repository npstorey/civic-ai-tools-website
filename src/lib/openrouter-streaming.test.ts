// Acceptance tests for #178: a submitted query must fail fast and typed on
// the streaming request path when the model credential is missing (no
// upstream call at all) or rejected upstream (401/403) — never hang.
//
// The rejected case runs against a local mock HTTP server; no live endpoint
// is ever contacted and all key values are obviously fake fixtures.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/openrouter-streaming.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { queryWithoutMcpStreaming, queryWithMcpStreaming, announcesUnrunWork, type StreamCallbacks, type CompletionResult } from './openrouter-streaming.ts';
import { carriedModelIdentity } from './model-catalog.ts';
import { _resetDefaultModelClientForTests } from './model-client.ts';
import { streamErrorPayload, buildStatsSummary, buildProvenanceLine, type StreamErrorCode, type PanelType, type ProgressPhase } from './streaming.ts';
import { startScriptedModelServer, type ScriptedReply } from './model-loop/test-harness.ts';

const FAKE_KEY = 'sk-or-test-obviously-fake-key-do-not-use';

// website#30 P3: both streaming functions take the wire/record pair rather than
// one string. These cases are about failure classification, not identity, so
// the two halves are the same fixture string.
const FAKE_MODEL = carriedModelIdentity('fake/model');

// A promptly-failing path should resolve well inside this bound; the
// pre-#178 behavior this guards against surfaced no signal at all.
const BOUNDED_MS = 5_000;

interface RecordedError {
  panel: PanelType;
  message: string;
  code?: StreamErrorCode;
}

function makeCallbacks(errors: RecordedError[]): StreamCallbacks {
  return {
    onProgress: () => {},
    onToken: () => {},
    onComplete: () => {
      assert.fail('query must not complete without a working credential');
    },
    onError: (panel, message, code) => {
      errors.push({ panel, message, code });
    },
  };
}

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

// --- Case 1: not configured — fails before any upstream call ---------------

test('queryWithoutMcpStreaming: missing credential yields typed onError in bounded time', async () => {
  const errors: RecordedError[] = [];
  const t0 = Date.now();
  await queryWithoutMcpStreaming('test question', FAKE_MODEL, undefined, makeCallbacks(errors));
  const elapsed = Date.now() - t0;

  assert.equal(errors.length, 1);
  assert.equal(errors[0].panel, 'withoutMcp');
  assert.equal(errors[0].code, 'model_not_configured');
  // #154: the wire carries the sanitized payload, not `error.message`. The
  // env-var name survives because the copy for this kind names it on purpose
  // (#178) — the reader of that message is the operator who can fix it.
  assert.equal(errors[0].message, streamErrorPayload('model_not_configured').message);
  // website#30 P4: the copy names MODEL_API_KEY, the canonical variable since
  // P1. Its prior-era name still works but is not what a fresh instance sets.
  assert.match(errors[0].message, /MODEL_API_KEY/);
  assert.ok(elapsed < BOUNDED_MS, `bounded time: took ${elapsed}ms`);
});

test('queryWithMcpStreaming: missing credential yields typed onError in bounded time', async () => {
  const errors: RecordedError[] = [];
  const t0 = Date.now();
  await queryWithMcpStreaming(
    'test question',
    FAKE_MODEL,
    [],
    async () => {
      assert.fail('no tool call should ever run without a credential');
    },
    undefined,
    makeCallbacks(errors),
  );
  const elapsed = Date.now() - t0;

  assert.equal(errors.length, 1);
  assert.equal(errors[0].panel, 'withMcp');
  assert.equal(errors[0].code, 'model_not_configured');
  assert.ok(elapsed < BOUNDED_MS, `bounded time: took ${elapsed}ms`);
});

// --- Case 2: configured but rejected upstream (mocked 401) ------------------

function startAuthRejectingServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key (test fixture)', code: 401 } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/v1` });
    });
  });
}

test('queryWithoutMcpStreaming: upstream 401 yields typed model_auth_rejected onError', async () => {
  const { server, url } = await startAuthRejectingServer();
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const errors: RecordedError[] = [];
    const t0 = Date.now();
    await queryWithoutMcpStreaming('test question', FAKE_MODEL, undefined, makeCallbacks(errors));
    const elapsed = Date.now() - t0;

    assert.equal(errors.length, 1);
    assert.equal(errors[0].panel, 'withoutMcp');
    assert.equal(errors[0].code, 'model_auth_rejected');
    // #154: the upstream body's text reached the SSE payload before this
    // change; now only the classified kind and its reader-facing copy do. The
    // raw error still goes to the server log.
    assert.equal(errors[0].message, streamErrorPayload('model_auth_rejected').message);
    assert.ok(!errors[0].message.includes('test fixture'), 'no upstream error text on the wire');
    assert.ok(elapsed < BOUNDED_MS, `bounded time: took ${elapsed}ms`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('queryWithMcpStreaming: upstream 401 yields typed model_auth_rejected onError', async () => {
  const { server, url } = await startAuthRejectingServer();
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const errors: RecordedError[] = [];
    await queryWithMcpStreaming(
      'test question',
      FAKE_MODEL,
      [],
      async () => {
        assert.fail('no tool call should run when the credential is rejected');
      },
      undefined,
      makeCallbacks(errors),
    );

    assert.equal(errors.length, 1);
    assert.equal(errors[0].panel, 'withMcp');
    assert.equal(errors[0].code, 'model_auth_rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- Case 3: resultSummary from a real tool-call round trip (#322, website#325 P2) ---
//
// `executeToolCall` is an injected parameter (not an import), so these fixtures
// drive the real tool-calling loop in `queryWithMcpStreaming` end to end with no
// network call to any MCP server and no credential — only a local mock model
// server standing in for the chat-completions endpoint, following the idiom of
// `startAuthRejectingServer` above. The model server always answers with one
// tool call on its first reply and a content-only final answer on its second,
// which is the minimal shape that drives the tool-result parse block at
// `openrouter-streaming.ts` and its narration consumer, `formatToolResult` in
// `streaming.ts` — the two surfaces the anchor calls out.

interface RecordedProgress {
  panel: PanelType;
  message: string;
  phase?: ProgressPhase;
}

function startToolCallModelServer(toolName: string, toolArgs: Record<string, unknown>): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    let callCount = 0;
    const server = createServer((_req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (callCount === 1) {
        res.end(JSON.stringify({
          id: 'chatcmpl-test-tool-call',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'fake/model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(toolArgs) },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      } else {
        res.end(JSON.stringify({
          id: 'chatcmpl-test-final',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'fake/model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Final answer.' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
        }));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/v1` });
    });
  });
}

/**
 * Runs one full tool-call round trip against a local mock model server, with
 * `toolResult` handed back verbatim by the injected `executeToolCall` — the
 * exact string `queryWithMcpStreaming` parses at the site this phase fixes.
 * Returns the completed result and every progress event, so a test can assert
 * both surfaces: the parsed `resultSummary` (`CompletionResult.tools_called`)
 * and the narration line `formatToolResult` produces from it (the
 * `phase: 'tool_result'` progress event).
 */
async function runToolCallRoundTrip(
  toolArgs: Record<string, unknown>,
  toolResult: string,
): Promise<{ result: CompletionResult; progress: RecordedProgress[] }> {
  const { server, url } = await startToolCallModelServer('get_data', toolArgs);
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const progress: RecordedProgress[] = [];
    let result: CompletionResult | undefined;

    await queryWithMcpStreaming(
      'test question',
      FAKE_MODEL,
      [],
      async () => toolResult,
      undefined,
      {
        onProgress: (panel, message, opts) => {
          progress.push({ panel, message, phase: opts?.phase });
        },
        onToken: () => {},
        onComplete: (_panel, completion) => {
          result = completion;
        },
        onError: (_panel, message) => {
          assert.fail(`unexpected onError: ${message}`);
        },
      },
    );

    assert.ok(result, 'onComplete must fire');
    return { result: result!, progress };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function toolResultNarration(progress: RecordedProgress[]): string | undefined {
  return progress.find((p) => p.phase === 'tool_result')?.message;
}

test('queryWithMcpStreaming: a Socrata envelope ({data, total_rows}) populates resultSummary from data.length, not total_rows', async () => {
  // total_rows (100) disagrees with data.length (2) - a capped page. rows
  // must reflect what this call actually delivered, since that is what every
  // downstream reader (narration, the "records analyzed" rollups in
  // streaming.ts) means by "rows".
  const envelope = JSON.stringify({
    data: [
      { unique_key: '1', complaint_type: 'Noise' },
      { unique_key: '2', complaint_type: 'Illegal Parking' },
    ],
    total_rows: 100,
  });

  const { result, progress } = await runToolCallRoundTrip(
    { type: 'query', dataset_id: 'erm2-nwe9' },
    envelope,
  );

  assert.equal(result.tools_called?.length, 1);
  assert.deepEqual(result.tools_called?.[0].resultSummary, { rows: 2, columns: 2 });

  // Second surface: the live-panel narration, `formatToolResult` at
  // openrouter-streaming.ts:339, keyed off the same resultSummary.
  assert.equal(toolResultNarration(progress), 'Retrieved 2 records from 311 Service Requests');
});

test('queryWithMcpStreaming: a bare JSON array still populates resultSummary (no regression)', async () => {
  const bareArray = JSON.stringify([
    { id: 'abcd-1234', name: 'Restaurant Inspections' },
    { id: 'wvxf-dwi5', name: 'Housing Violations' },
    { id: 'vw6y-z8j6', name: '311 Cases' },
  ]);

  const { result, progress } = await runToolCallRoundTrip(
    { type: 'catalog', query: 'inspections' },
    bareArray,
  );

  assert.equal(result.tools_called?.length, 1);
  assert.deepEqual(result.tools_called?.[0].resultSummary, { rows: 3, columns: 2 });
  assert.equal(toolResultNarration(progress), 'Found 3 datasets matching the search');
});

test('queryWithMcpStreaming: a zero-row envelope yields resultSummary {rows: 0, columns: 0}, not null', async () => {
  // Deliberate: a query that legitimately matched nothing is a real, valid
  // answer ("no matching records"), distinct from a result this app could not
  // parse at all. Collapsing both to `resultSummary: undefined` is exactly
  // the always-null failure mode #322 reports - a diagnostic that never fires
  // is worse than one that is simply absent, because P3's replay work reads
  // this field as a failure signal.
  const emptyEnvelope = JSON.stringify({ data: [], total_rows: 0 });

  const { result, progress } = await runToolCallRoundTrip(
    { type: 'query', dataset_id: 'erm2-nwe9' },
    emptyEnvelope,
  );

  assert.equal(result.tools_called?.length, 1);
  assert.deepEqual(result.tools_called?.[0].resultSummary, { rows: 0, columns: 0 });
  assert.equal(toolResultNarration(progress), 'Retrieved 0 records from 311 Service Requests');
});

test('queryWithMcpStreaming: an envelope without a data array leaves resultSummary unset', async () => {
  // Not every Socrata response is a row envelope (metadata/metrics payloads
  // are objects with no `data` array at all). Absent a `data` array to count,
  // resultSummary must stay unset rather than guess - the same "skip" outcome
  // as the pre-existing not-JSON / not-an-array case.
  const notARowEnvelope = JSON.stringify({ total_rows: 5, note: 'no data field' });

  const { result, progress } = await runToolCallRoundTrip(
    { type: 'query', dataset_id: 'erm2-nwe9' },
    notARowEnvelope,
  );

  assert.equal(result.tools_called?.length, 1);
  assert.equal(result.tools_called?.[0].resultSummary, undefined);
  assert.equal(toolResultNarration(progress), 'Query to 311 Service Requests complete');
});

// --- Case 4: the rollups downstream of resultSummary (#322 follow-up) -------
//
// `resultSummary.rows` has two more readers beyond `formatToolResult`, both in
// streaming.ts and both reached from the primary answer surface via
// McpResponseDisplay.tsx (CLAUDE.md's canonical shared component, imported by
// both ResponsePanel and LiveResponsePanel): `buildStatsSummary`'s "N records
// analyzed" and `buildProvenanceLine`'s "N rows returned". Both `reduce` over
// `resultSummary?.rows` across every tool call. Before this phase's fix they
// summed to zero for every Socrata call, because resultSummary was always
// null; after it they carry a real number onto the reader-facing answer. That
// is a newly-activated provenance claim, and it rests on the same
// rows-means-data.length-not-total_rows judgment call as the parse itself: if
// that judgment is ever reversed, this is the test that says why not, by
// making a mismatched, materially wrong total (300) visibly different from
// the correct one (5).

function startMultiToolCallModelServer(
  toolName: string,
  toolArgsList: Record<string, unknown>[],
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    let callCount = 0;
    const server = createServer((_req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (callCount === 1) {
        res.end(JSON.stringify({
          id: 'chatcmpl-test-multi-tool-call',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'fake/model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: toolArgsList.map((args, i) => ({
                id: `call_${i + 1}`,
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(args) },
              })),
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      } else {
        res.end(JSON.stringify({
          id: 'chatcmpl-test-final',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'fake/model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Final answer.' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
        }));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/v1` });
    });
  });
}

test('queryWithMcpStreaming: buildStatsSummary and buildProvenanceLine sum data.length (5) across calls, never total_rows (300) and never 0', async () => {
  const call1Args = { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' };
  const call2Args = { type: 'query', dataset_id: '43nn-pn8j', portal: 'data.cityofnewyork.us' };

  // Both envelopes carry a total_rows far larger than data.length - a capped
  // page, same as production Socrata pagination - so summing the wrong field
  // would produce a visibly different (and false) total.
  const envelope1 = JSON.stringify({
    data: [
      { unique_key: '1', complaint_type: 'Noise' },
      { unique_key: '2', complaint_type: 'Illegal Parking' },
    ],
    total_rows: 100,
  });
  const envelope2 = JSON.stringify({
    data: [
      { camis: 'a', dba: 'Restaurant A' },
      { camis: 'b', dba: 'Restaurant B' },
      { camis: 'c', dba: 'Restaurant C' },
    ],
    total_rows: 200,
  });

  const { server, url } = await startMultiToolCallModelServer('get_data', [call1Args, call2Args]);
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    let result: CompletionResult | undefined;

    await queryWithMcpStreaming(
      'test question',
      FAKE_MODEL,
      [],
      async (_name, args) => (args.dataset_id === 'erm2-nwe9' ? envelope1 : envelope2),
      undefined,
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, completion) => {
          result = completion;
        },
        onError: (_panel, message) => {
          assert.fail(`unexpected onError: ${message}`);
        },
      },
    );

    assert.ok(result, 'onComplete must fire');
    const toolsCalled = result!.tools_called ?? [];
    assert.equal(toolsCalled.length, 2);
    assert.deepEqual(toolsCalled.map((t) => t.resultSummary), [
      { rows: 2, columns: 2 },
      { rows: 3, columns: 2 },
    ]);

    const stats = buildStatsSummary(toolsCalled, result!.duration_ms);
    assert.match(stats, /\b5 records analyzed\b/);
    assert.doesNotMatch(stats, /\b300\b/);
    assert.doesNotMatch(stats, /\b0 records analyzed\b/);

    const provenance = buildProvenanceLine(toolsCalled);
    assert.ok(provenance, 'buildProvenanceLine must return a line for query-type tool calls');
    assert.match(provenance!, /\b5 rows returned\b/);
    assert.doesNotMatch(provenance!, /\b300\b/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- Case 5: a tool call the data source did not answer (#321, website#325 P3) ---
//
// The recorded tool-call entry must carry `failed` + `failureKind`, set at the
// catch site where the rejection is already known. Nothing downstream can
// recover the fact: `toolEntry` is pushed into `toolsCalled` BEFORE the await,
// so without this the notebook synthesizer saw a call indistinguishable from a
// successful one and rendered it as an executable fetch cell that then threw.
//
// Same harness as Case 3 — `executeToolCall` is an injected parameter, so
// these drive the real loop in `queryWithMcpStreaming` with no MCP server and
// no credential. The injected function THROWS instead of returning a payload,
// which is the one difference.

/**
 * One full tool-call round trip whose tool execution throws `error`. The loop
 * is expected to survive it: the catch feeds the model neutral guidance and
 * the run completes with a final answer, so `onError` must never fire.
 */
async function runFailingToolCallRoundTrip(
  toolArgs: Record<string, unknown>,
  error: unknown,
): Promise<CompletionResult> {
  const { server, url } = await startToolCallModelServer('get_data', toolArgs);
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    let result: CompletionResult | undefined;
    await queryWithMcpStreaming(
      'test question',
      FAKE_MODEL,
      [],
      async () => {
        throw error;
      },
      undefined,
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, completion) => {
          result = completion;
        },
        onError: (_panel, message) => {
          assert.fail(`a failed tool call must not fail the whole query: ${message}`);
        },
      },
    );

    assert.ok(result, 'onComplete must fire — one dead tool call is not a dead query');
    return result!;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('#321: a tool call that throws is recorded with failed + failureKind', async () => {
  // RED: revert the two lines in the catch block of openrouter-streaming.ts —
  // `failed` is undefined and this fails.
  const result = await runFailingToolCallRoundTrip(
    { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' },
    new Error('Request to the data source timed out after 60000ms'),
  );

  assert.equal(result.tools_called?.length, 1, 'the call is still recorded — it was attempted');
  const call = result.tools_called![0];
  assert.equal(call.failed, true);
  assert.equal(call.failureKind, 'timeout');
  // The distinction #321 turns on: no summary, but that is NOT what says it
  // failed. A zero-row success has no rows either (see the Case 3 test above).
  assert.equal(call.resultSummary, undefined);
  // The arguments survive, so the notebook's failure note can say what was
  // attempted rather than just that something was.
  assert.equal(call.args.dataset_id, 'erm2-nwe9');
});

test('#321: failureKind narrows honestly — an unreachable source is `unavailable`', async () => {
  const result = await runFailingToolCallRoundTrip(
    { type: 'query', dataset_id: 'erm2-nwe9' },
    new Error('fetch failed'),
  );
  assert.equal(result.tools_called?.[0].failed, true);
  assert.equal(result.tools_called?.[0].failureKind, 'unavailable');
});

test('#321: an unclassifiable failure is `unknown`, never a guessed cause', async () => {
  // design-principles.md Principle 3: an error we cannot classify must not be
  // asserted as a timeout or a refusal. `unknown` is a real member of the
  // vocabulary, not a placeholder.
  const result = await runFailingToolCallRoundTrip(
    { type: 'query', dataset_id: 'erm2-nwe9' },
    new Error('something we have no branch for'),
  );
  assert.equal(result.tools_called?.[0].failed, true);
  assert.equal(result.tools_called?.[0].failureKind, 'unknown');
});

test('#321: a SUCCESSFUL tool call is not marked failed', async () => {
  // The control. Without it, an implementation that sets `failed` on every
  // call would pass every test above — and would suppress the code cell for
  // every fetch in the notebook.
  const { result } = await runToolCallRoundTrip(
    { type: 'query', dataset_id: 'erm2-nwe9' },
    JSON.stringify({ data: [{ unique_key: '1', complaint_type: 'Noise' }], total_rows: 1 }),
  );
  assert.equal(result.tools_called?.[0].failed, undefined);
  assert.equal(result.tools_called?.[0].failureKind, undefined);
  assert.deepEqual(result.tools_called?.[0].resultSummary, { rows: 1, columns: 2 });
});

// --- #319: a final answering turn, and what counts as an answer ------------
//
// The defect, measured on a live portal: eight tool calls completed, then a
// 235-character "answer" ending "...I'll query the fraction of records that
// close within 14 and 30 days per type". It validated. It was publishable. The
// loop had treated the first message carrying no `tool_calls` as the final
// answer, so a statement of intent to run a query that was never run was
// published under the same signature and the same visual treatment as a real
// finding.
//
// These cases drive the REAL loop against a scripted model server, so the
// number of requests that server receives is itself an assertion: it is how
// "no extra model call on a good answer" and "at most one extra answering
// turn" are pinned, neither of which is visible from the completion alone.

// `startScriptedModelServer` used to be defined here. It moved to
// `model-loop/test-harness.ts` when the loop became shared (#345): every
// caller of `runToolLoop` needs the same instrument, and a second copy of a
// mock endpoint is how two callers start disagreeing about what they are
// testing. The cases below are unchanged.

async function runScripted(replies: ScriptedReply[]): Promise<{
  result: CompletionResult;
  requests: Record<string, unknown>[];
}> {
  const { server, url, requests } = await startScriptedModelServer(replies);
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    let result: CompletionResult | undefined;
    await queryWithMcpStreaming(
      'How long do these requests take to close?',
      FAKE_MODEL,
      [],
      async () => JSON.stringify({ data: [{ request_type: 'A', days_to_close: 9 }], total_rows: 1 }),
      undefined,
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, completion) => {
          result = completion;
        },
        onError: (_panel, message) => {
          assert.fail(`unexpected onError: ${message}`);
        },
      },
    );
    assert.ok(result, 'onComplete must fire');
    return { result: result!, requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const FETCH_CALL: ScriptedReply = {
  toolCalls: [{ id: 'call_1', name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234' } }],
};

/**
 * The measured shape of #319, in neutral fixture wording: work reported, then
 * a query announced rather than run.
 */
const NARRATION =
  "I now have the counts by request type for both years. Next, I'll query the fraction of " +
  'records that close within 14 and 30 days per type.';

const REAL_ANSWER =
  'Across both years the portal recorded 4,812 requests of this type. The median time to close ' +
  'was 9 days, and 71% closed within 14 days (dataset abcd-1234).';

// --- Criterion 1: a mid-plan narration does not become the answer ----------

test('#319: a tool_calls-free message that ANNOUNCES the next query is not published as the answer', async () => {
  const { result, requests } = await runScripted([FETCH_CALL, { content: NARRATION }, { content: REAL_ANSWER }]);

  // The whole point. Before the fix this assertion fails: `result.content` IS
  // the narration, because the loop ended on the first message with no
  // `tool_calls` and the content branch shipped it verbatim.
  assert.notEqual(result.content, NARRATION);
  assert.ok(
    !result.content.includes("I'll query"),
    `the announcement reached the published answer:\n${result.content}`,
  );
  assert.equal(result.content, REAL_ANSWER);

  // Three requests: the opening call, the post-tool call that narrated, and
  // exactly one answering turn.
  assert.equal(requests.length, 3, 'one answering turn, no more');
});

// --- Criterion 2: a genuine answer passes through, at no extra cost --------

test('#319: a genuine answer is published untouched, with NO extra model call', async () => {
  const { result, requests } = await runScripted([FETCH_CALL, { content: REAL_ANSWER }]);

  assert.equal(result.content, REAL_ANSWER);
  // The counterweight to criterion 1, and it matters as much: a check that
  // fires on a good answer would put a model call on the front of every query
  // and rewrite answers that were already correct. Two requests, not three.
  assert.equal(requests.length, 2, 'a good answer must not be re-asked');
});

// --- Criterion 3: the re-ask is bounded ------------------------------------

test('#319: at most ONE answering turn — a second unsatisfying answer is not re-asked forever', async () => {
  // The scripted server repeats its last reply, so a model that keeps
  // announcing keeps announcing. An unbounded implementation never stops.
  const { result, requests } = await runScripted([
    FETCH_CALL,
    { content: NARRATION },
    { content: "Let me first compute the 30-day closure rates, then I'll summarize." },
  ]);

  assert.equal(requests.length, 3, `expected exactly one answering turn, saw ${requests.length - 2}`);
  // Documented limitation, asserted so it stays deliberate: the second turn is
  // taken at its word. Streamed tokens have already reached the reader by the
  // time it can be judged, so they cannot be retracted — only appended to.
  assert.match(result.content, /Let me first compute/);
});

// --- Criterion 4: the `!lastMessage?.content` guard ------------------------

test('#319: a token-limit-exceeded run with content asks for a summary instead of shipping that content', async () => {
  // Deliberately NOT an announcement: this content is plain working notes, so
  // the only thing that can route it into an answering turn is the guard fix,
  // not the announcement rule. The two halves of this phase stay separable.
  const MID_RUN_NOTES =
    'Working notes so far: 4,812 rows returned across the two years, and the request-type ' +
    'column has 12 distinct values.';
  assert.equal(
    announcesUnrunWork(MID_RUN_NOTES),
    false,
    'the fixture must not be caught by the announcement rule — that would test the wrong half',
  );

  const { result, requests } = await runScripted([
    // Content AND tool calls on one reply, with usage over the 200k budget:
    // the loop executes the call, then breaks on the token check with a
    // content-bearing message in hand. `!lastMessage?.content` was false, so
    // the answering turn was skipped and these notes were published.
    { content: MID_RUN_NOTES, toolCalls: FETCH_CALL.toolCalls, totalTokens: 250_000 },
    { content: REAL_ANSWER },
  ]);

  assert.notEqual(result.content, MID_RUN_NOTES);
  assert.equal(result.content, REAL_ANSWER);
  assert.equal(requests.length, 2);
  // The content branch never set this, so a truncated run did not even carry
  // the flag its own banner is keyed on.
  assert.equal(result.token_limit_exceeded, true);
});

// --- The answering turn's request, on the wire -----------------------------

test('#319: the answering turn omits tools, restates the contract, and keeps the transcript well-formed', async () => {
  const { requests } = await runScripted([FETCH_CALL, { content: NARRATION }, { content: REAL_ANSWER }]);

  const final = requests[requests.length - 1];
  assert.equal(final.stream, true);
  // Tools omitted: the model cannot answer this turn with another tool call.
  assert.equal('tools' in final, false, 'the answering turn must offer no tools');

  const messages = final.messages as { role: string; content?: string; tool_call_id?: string }[];
  const last = messages[messages.length - 1];
  assert.equal(last.role, 'user');
  assert.match(last.content!, /a statement of intent is not an answer/);
  assert.match(last.content!, /no further tool calls will be made/);

  // The narration stays in the transcript it is being corrected in.
  assert.ok(
    messages.some((m) => m.role === 'assistant' && m.content === NARRATION),
    'the turn being corrected must still be in the history',
  );

  // Every tool call is answered exactly once. The old block pushed the last
  // message and re-answered its tool calls even when the loop had already done
  // both, which duplicates an assistant turn and answers one `tool_call_id`
  // twice.
  const answered = messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  assert.deepEqual(answered, [...new Set(answered)], `a tool_call_id was answered twice: ${answered}`);
});

test('#319: the token-limit answering turn does not duplicate the assistant turn or re-answer its tool call', async () => {
  const { requests } = await runScripted([
    { content: 'Working notes.', toolCalls: FETCH_CALL.toolCalls, totalTokens: 250_000 },
    { content: REAL_ANSWER },
  ]);

  const messages = requests[requests.length - 1].messages as { role: string; content?: string; tool_call_id?: string }[];
  const assistants = messages.filter((m) => m.role === 'assistant' && m.content === 'Working notes.');
  assert.equal(assistants.length, 1, 'the assistant turn the loop already pushed must not be pushed again');
  const answered = messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  assert.deepEqual(answered, ['call_1'], `expected one answer for call_1, saw ${JSON.stringify(answered)}`);
});

// --- The completion's shape, which differs by path on purpose --------------

test('#345 P2: token_limit_exceeded is present on the answering-turn completion and ABSENT on the pass-through one', async () => {
  // Wire-visible on the SSE `complete` event, and the easiest thing in this
  // module for an adapter to flatten: the two completions carry different keys
  // deliberately. A run that took the answering turn is the only one that can
  // have been cut short, so it reports the flag the reader's truncation banner
  // is keyed on; a run the model answered on its own account omits the key
  // rather than asserting `false` on every ordinary query.
  const answering = await runScripted([FETCH_CALL, { content: NARRATION }, { content: REAL_ANSWER }]);
  assert.equal('token_limit_exceeded' in answering.result, true, 'the answering turn reports the flag');
  assert.equal(answering.result.token_limit_exceeded, false);

  const passThrough = await runScripted([FETCH_CALL, { content: REAL_ANSWER }]);
  assert.equal(
    'token_limit_exceeded' in passThrough.result,
    false,
    'the pass-through completion omits the key rather than sending token_limit_exceeded: false',
  );
});

// --- The rule itself: where the line is drawn ------------------------------

test('#319: announcesUnrunWork catches commitment to an unrun data step', () => {
  assert.equal(announcesUnrunWork(NARRATION), true);
  assert.equal(
    announcesUnrunWork("I'll query the fraction of records that close within 14 and 30 days per type."),
    true,
  );
  assert.equal(announcesUnrunWork('Let me check the closure rates for each type.'), true);
  assert.equal(announcesUnrunWork('Now I will run the comparison across both years.'), true);
  assert.equal(announcesUnrunWork('I need to fetch the 2023 rows before I can compare.'), true);
});

test('#319: announcesUnrunWork does NOT fire on a genuine answer, an offer, or a courtesy', () => {
  // The false-positive side, which costs a model call and a rewrite of an
  // answer that was already correct.
  assert.equal(announcesUnrunWork(REAL_ANSWER), false);
  assert.equal(announcesUnrunWork('Around 400,000.'), false);
  // An OFFER of further work, made after answering, is not a commitment to it.
  assert.equal(
    announcesUnrunWork('71% closed within 14 days (dataset abcd-1234). I can pull the 30-day rates too.'),
    false,
  );
  assert.equal(
    announcesUnrunWork('The median was 9 days. Would you like me to compare this against last year?'),
    false,
  );
  assert.equal(
    announcesUnrunWork('The median was 9 days (dataset abcd-1234). Let me know if you want the monthly breakdown.'),
    false,
  );
  // Blank is not an announcement — the call site handles "no answer at all"
  // as its own condition.
  assert.equal(announcesUnrunWork(''), false);
  assert.equal(announcesUnrunWork('   '), false);
  assert.equal(announcesUnrunWork(null), false);
  assert.equal(announcesUnrunWork(undefined), false);
});

test('#319: a long answer that closes with an aside is not re-asked', () => {
  // The length bound is the conservatism in the rule. A message that has
  // already summarized findings at length has answered, whatever it says last.
  const long =
    'Across both years the portal recorded 4,812 requests of this type (dataset abcd-1234). ' +
    'The median time to close was 9 days. '.repeat(14) +
    "Next, I'll query the seasonal breakdown.";
  assert.ok(long.length > 600, 'fixture must exceed the bound to test it');
  assert.equal(announcesUnrunWork(long), false);
});
