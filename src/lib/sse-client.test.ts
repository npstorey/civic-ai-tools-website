// Tests for connectSSE's error contract.
//
// The `onError?` option was removed (it was destructured but never invoked,
// and no caller passed it). These tests pin the REAL error channel that all
// callers rely on: connectSSE rejects on failure, with the HTTP status
// preserved on an SSEError. If a future change tried to swallow errors instead
// of rejecting, these fail.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/sse-client.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSSE, SSEError } from './sse-client.ts';

/** Swap global.fetch for the duration of `fn`, restoring it afterward. */
async function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('rejects with SSEError (status + parsed message preserved) on a non-ok response', async () => {
  const impl = (async () =>
    new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  await withFetch(impl, async () => {
    await assert.rejects(
      connectSSE({ url: '/x', body: {}, onEvent: () => {} }),
      (err: unknown) => {
        assert.ok(err instanceof SSEError, 'rejects with SSEError');
        assert.equal((err as SSEError).status, 429, 'status is preserved');
        assert.equal((err as SSEError).message, 'Rate limit exceeded', 'parsed error message is preserved');
        return true;
      },
    );
  });
});

test('rejects when the response has no body', async () => {
  const impl = (async () => ({ ok: true, body: null }) as unknown as Response) as typeof fetch;
  await withFetch(impl, async () => {
    await assert.rejects(connectSSE({ url: '/x', body: {}, onEvent: () => {} }), /No response body/);
  });
});

test('dispatches each event and calls onComplete on a normal stream', async () => {
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('data: {"type":"progress","message":"hi"}\n\n'));
      controller.enqueue(enc.encode('data: {"type":"complete"}\n\n'));
      controller.close();
    },
  });
  const impl = (async () => new Response(body, { status: 200 })) as typeof fetch;

  const events: Record<string, unknown>[] = [];
  let completed = false;
  await withFetch(impl, async () => {
    await connectSSE({
      url: '/x',
      body: {},
      onEvent: (e) => events.push(e),
      onComplete: () => {
        completed = true;
      },
    });
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'progress');
  assert.equal(events[1].type, 'complete');
  assert.equal(completed, true, 'onComplete fires when the stream ends');
});

test('a malformed event line is swallowed, not thrown — the stream still completes', async () => {
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('data: {not valid json}\n\n'));
      controller.enqueue(enc.encode('data: {"type":"complete"}\n\n'));
      controller.close();
    },
  });
  const impl = (async () => new Response(body, { status: 200 })) as typeof fetch;

  const events: Record<string, unknown>[] = [];
  await withFetch(impl, async () => {
    // Must not reject on the unparseable first event.
    await connectSSE({ url: '/x', body: {}, onEvent: (e) => events.push(e) });
  });
  // Only the valid event is dispatched; the malformed one is skipped.
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'complete');
});
