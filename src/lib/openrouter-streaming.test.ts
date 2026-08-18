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
import { queryWithoutMcpStreaming, queryWithMcpStreaming, type StreamCallbacks } from './openrouter-streaming.ts';
import { _resetDefaultModelClientForTests } from './model-client.ts';
import { streamErrorPayload, type StreamErrorCode, type PanelType } from './streaming.ts';

const FAKE_KEY = 'sk-or-test-obviously-fake-key-do-not-use';

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
  await queryWithoutMcpStreaming('test question', 'fake/model', undefined, makeCallbacks(errors));
  const elapsed = Date.now() - t0;

  assert.equal(errors.length, 1);
  assert.equal(errors[0].panel, 'withoutMcp');
  assert.equal(errors[0].code, 'model_not_configured');
  // #154: the wire carries the sanitized payload, not `error.message`. The
  // env-var name survives because the copy for this kind names it on purpose
  // (#178) — the reader of that message is the operator who can fix it.
  assert.equal(errors[0].message, streamErrorPayload('model_not_configured').message);
  assert.match(errors[0].message, /OPENROUTER_API_KEY/);
  assert.ok(elapsed < BOUNDED_MS, `bounded time: took ${elapsed}ms`);
});

test('queryWithMcpStreaming: missing credential yields typed onError in bounded time', async () => {
  const errors: RecordedError[] = [];
  const t0 = Date.now();
  await queryWithMcpStreaming(
    'test question',
    'fake/model',
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
    await queryWithoutMcpStreaming('test question', 'fake/model', undefined, makeCallbacks(errors));
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
      'fake/model',
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
