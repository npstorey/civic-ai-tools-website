// Tests for the offered-model resolver's retry/caching policy (website#30
// P7), extracted from McpFlowDiagram.tsx so node:test can exercise it
// directly (that component is JSX, which `--experimental-strip-types`
// cannot parse — see offered-model.ts's header comment).
//
// The defect this pins down: the version of this logic P6 shipped memoized
// the fetch's own PROMISE in a ref, including a REJECTED one, so a single
// failed or empty `/api/models` response at mount poisoned every later
// `/explore` click until a full page reload. `createOfferedModelResolver`
// must cache a success but never a failure.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfferedModelResolver } from './offered-model.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('a failed fetch is not cached: a later call retries and succeeds once the endpoint recovers', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) throw new Error('network error');
    return jsonResponse({ models: [{ id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' }] });
  }) as typeof fetch;

  const resolver = createOfferedModelResolver(fetchImpl);

  const first = await resolver.resolve();
  assert.equal(first, '', 'a rejected fetch resolves to the empty string, not a thrown error');
  assert.equal(calls, 1);

  const second = await resolver.resolve();
  assert.equal(second, 'openai/gpt-4o', 'the retry reaches the network again and returns a usable id');
  assert.equal(calls, 2, 'the failed attempt was not cached — the second call issued a new request');
});

test('a malformed response body (no usable `models` array) is not cached either', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ notModels: [] });
    return jsonResponse({ models: [{ id: 'anthropic/claude-sonnet-4-6', name: 'Claude', provider: 'anthropic' }] });
  }) as typeof fetch;

  const resolver = createOfferedModelResolver(fetchImpl);

  assert.equal(await resolver.resolve(), '');
  assert.equal(await resolver.resolve(), 'anthropic/claude-sonnet-4-6');
  assert.equal(calls, 2);
});

test('an empty catalog is not cached: a later call retries once the catalog is non-empty', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ models: [] });
    return jsonResponse({ models: [{ id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' }] });
  }) as typeof fetch;

  const resolver = createOfferedModelResolver(fetchImpl);

  assert.equal(await resolver.resolve(), '');
  assert.equal(await resolver.resolve(), 'openai/gpt-4o');
  assert.equal(calls, 2);
});

test('a successful resolution IS cached: a later call does not hit the network again', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({ models: [{ id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' }] });
  }) as typeof fetch;

  const resolver = createOfferedModelResolver(fetchImpl);

  assert.equal(await resolver.resolve(), 'openai/gpt-4o');
  assert.equal(await resolver.resolve(), 'openai/gpt-4o');
  assert.equal(calls, 1, 'the second call reused the cached id instead of refetching');
});

test('concurrent calls while a request is in flight share one fetch', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({ models: [{ id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' }] });
  }) as typeof fetch;

  const resolver = createOfferedModelResolver(fetchImpl);

  const [a, b] = await Promise.all([resolver.resolve(), resolver.resolve()]);
  assert.equal(a, 'openai/gpt-4o');
  assert.equal(b, 'openai/gpt-4o');
  assert.equal(calls, 1, 'two calls made before the first settles share one in-flight request');
});
