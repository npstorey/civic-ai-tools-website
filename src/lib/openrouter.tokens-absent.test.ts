// Acceptance test for #374 (Wave N9 P1 stage 3): `queryWithoutMcp`
// (`openrouter.ts`), the A-side of `/api/compare` — the non-streaming sibling
// of `queryWithoutMcpStreaming` in `openrouter-streaming.ts` — reports
// `tokens_used: 0` today when the endpoint's JSON reply carries no `usage`
// object at all, indistinguishable from a call that genuinely used zero
// tokens. Same property as `openrouter-streaming.tokens-absent.test.ts`, one
// call layer over: a token count is present when the endpoint reported one
// and absent, as an absent key, when it did not.
//
// A sibling file rather than an addition to another test file: this module
// has no `.test.ts` of its own today, and the mock this test drives (a
// single, non-streaming `chat.completion` JSON reply) is a different shape
// from the SSE mock in `openrouter-streaming.tokens-absent.test.ts`.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/openrouter.tokens-absent.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { queryWithoutMcp, type CompletionResult } from './openrouter.ts';
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
 * A single-turn, non-streaming chat-completions server. `includeUsage`
 * governs whether a `usage` field appears in the JSON body at all,
 * independent of what was requested — matching the real case this test is
 * about: an endpoint that does not report usage does not send the field.
 */
function startNonStreamingServer(opts: {
  content: string;
  includeUsage: boolean;
  totalTokens?: number;
}): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-test-tokens-absent-nonstreaming',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'fake/model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: opts.content },
          finish_reason: 'stop',
        }],
        ...(opts.includeUsage
          ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: opts.totalTokens ?? 15 } }
          : {}),
      }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/v1` });
    });
  });
}

async function runQueryWithoutMcp(opts: { content: string; includeUsage: boolean; totalTokens?: number }): Promise<CompletionResult> {
  const { server, url } = await startNonStreamingServer(opts);
  try {
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    return await queryWithoutMcp('test question', FAKE_MODEL, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('#374: queryWithoutMcp — tokens_used is absent from the result when the endpoint reported no usage', async () => {
  const result = await runQueryWithoutMcp({ content: 'Hello.', includeUsage: false });
  assert.equal(
    Object.hasOwn(result, 'tokens_used'),
    false,
    `tokens_used must be absent from the result, not present: ${JSON.stringify(result)}`,
  );
});

test('#374: queryWithoutMcp — tokens_used carries the endpoint-reported total when usage IS present (control, green today and after)', async () => {
  const result = await runQueryWithoutMcp({ content: 'Hello.', includeUsage: true, totalTokens: 42 });
  assert.equal(result.tokens_used, 42);
});
