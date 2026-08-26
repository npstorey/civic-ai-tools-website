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
import { queryWithoutMcpStreaming, queryWithMcpStreaming, type StreamCallbacks, type CompletionResult } from './openrouter-streaming.ts';
import { carriedModelIdentity } from './model-catalog.ts';
import { _resetDefaultModelClientForTests } from './model-client.ts';
import { streamErrorPayload, type StreamErrorCode, type PanelType, type ProgressPhase } from './streaming.ts';

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
