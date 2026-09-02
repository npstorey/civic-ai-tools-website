// Acceptance test for #374 (Wave N9 P1): the tool-free single-turn streaming
// path — `queryWithoutMcpStreaming` in `openrouter-streaming.ts` — reports
// `tokens_used: 0` today when the endpoint's stream carried no `usage` chunk
// at all, indistinguishable on the wire from "the model used zero tokens".
// The property this phase rules: a token count is present on the `complete`
// payload when the endpoint reported one, and ABSENT — not `0`, not
// `undefined`-valued — when it did not.
//
// A sibling file rather than an addition to openrouter-streaming.test.ts: the
// mock this test drives is a single-turn content-only SSE endpoint, a
// different shape from every mock already in that file (missing-credential,
// mocked-401, non-streaming JSON tool-call replies, and the shared scripted
// loop server in model-loop/test-harness.ts, which always emits a usage
// frame). Keeping it separate avoids adding a second, narrower-purpose mock
// into a file that already carries several, and keeps this phase's diff
// confined to one new, self-contained file.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/openrouter-streaming.tokens-absent.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { queryWithoutMcpStreaming, type StreamCallbacks, type CompletionResult } from './openrouter-streaming.ts';
import { carriedModelIdentity } from './model-catalog.ts';
import { _resetDefaultModelClientForTests } from './model-client.ts';

const FAKE_KEY = 'sk-or-test-obviously-fake-key-do-not-use';
const FAKE_MODEL = carriedModelIdentity('fake/model');

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

/**
 * A single-turn SSE model server: a content-delta chunk, an optional usage
 * chunk, then `data: [DONE]` — the same frame shape the scripted loop server
 * in `model-loop/test-harness.ts` uses for its streaming answering turn, cut
 * down to the one round `queryWithoutMcpStreaming` ever drives.
 *
 * `includeUsage` governs whether a `usage` field appears on the wire AT ALL,
 * independent of what the request asked for — this server never even reads
 * the request body. That matches the real-world case this phase is about: an
 * endpoint that does not report usage does not send the field regardless of
 * `stream_options.include_usage`.
 */
function startContentOnlyStreamingServer(opts: {
  content: string;
  includeUsage: boolean;
  totalTokens?: number;
}): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-test-tokens-absent',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'fake/model',
          ...payload,
        })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: opts.content }, finish_reason: null }] }));
      res.write(
        frame(
          opts.includeUsage
            ? { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: opts.totalTokens ?? 15 } }
            : { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ),
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/v1` });
    });
  });
}

async function runQueryWithoutMcp(opts: { content: string; includeUsage: boolean; totalTokens?: number }): Promise<CompletionResult> {
  const { server, url } = await startContentOnlyStreamingServer(opts);
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    let result: CompletionResult | undefined;
    const callbacks: StreamCallbacks = {
      onProgress: () => {},
      onToken: () => {},
      onComplete: (_panel, completion) => {
        result = completion;
      },
      onError: (_panel, message) => {
        assert.fail(`unexpected onError: ${message}`);
      },
    };
    await queryWithoutMcpStreaming('test question', FAKE_MODEL, undefined, callbacks);
    assert.ok(result, 'onComplete must fire');
    return result!;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('#374: tokens_used is absent from the complete payload when the endpoint streamed no usage', async () => {
  const result = await runQueryWithoutMcp({ content: 'Hello.', includeUsage: false });
  // The key itself must be missing — not present with value `undefined`, and
  // not present with value `0` (today's behavior: `let tokensUsed = 0` never
  // gets reassigned when no chunk carries `usage`, so the wire reports a
  // token count of zero for a call that plainly used some).
  assert.equal(
    Object.hasOwn(result, 'tokens_used'),
    false,
    `tokens_used must be absent from the payload, not present: ${JSON.stringify(result)}`,
  );
});

test('#374: tokens_used carries the endpoint-reported total when a usage chunk IS streamed (control, green today and after)', async () => {
  const result = await runQueryWithoutMcp({ content: 'Hello.', includeUsage: true, totalTokens: 42 });
  assert.equal(result.tokens_used, 42);
});
