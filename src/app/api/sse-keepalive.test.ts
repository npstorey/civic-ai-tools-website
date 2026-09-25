// The keep-alive on the two streaming routes, driven at the route.
//
// Both routes answer with Server-Sent Events and both go silent while the work
// behind them runs: `/api/query-notebook` across every model turn that picks a
// tool (those calls are not streamed) and across the whole notebook run, which
// under EXECUTOR_DRIVER=lambda is the session cap plus 15 s, 195 s at the
// defaults; `/api/compare-stream` across the same model turns and each tool
// call. A load balancer closes a connection that carries no bytes for its idle
// timeout (an application load balancer's default is 60 s), and the answer is
// lost with it. So each route writes an SSE comment line every
// SSE_KEEPALIVE_INTERVAL_MS from the moment its stream opens until it closes.
//
// WHAT IS DRIVEN. Each route's real `POST`, its real stream and its real
// encoder, with the work behind it held open by the test: the model loop and
// the executor are stubs that wait on a gate the test releases. `setInterval`
// is mocked (and only it — every other timer is real), so a tick of the mocked
// clock is the only thing that can produce a keep-alive, and the count of
// keep-alives in a silent phase is exact. The captured stream is then fed
// through the app's own client parser (`connectSSE`), the one every consumer
// of these routes reads through: a keep-alive that reached `onEvent` could
// reach a record.
//
// STUBS, and why: `next/headers`, `next-auth`, `@/lib/auth` (no request scope
// or sign-in provider outside Next); `@/lib/rate-limit` (no counter store);
// `@/lib/mcp/socrata-skill` (the real one fetches skill text from the MCP
// servers); `@/lib/openrouter-streaming` and `@/lib/sandbox` (the gates).
// No network, no model endpoint and no sandbox is involved.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/sse-keepalive.test.ts)

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');

/** The interval the routes are held to. Written here, not imported: the test pins it. */
const INTERVAL_MS = 15_000;
/** The notebook run's longest silence under the lambda driver at the defaults. */
const LAMBDA_WAIT_S = 195;

// --- Module hooks -------------------------------------------------------------

const STUB_PREFIX = 'file:///sse-keepalive-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.9' }); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() {}`,
  '@/lib/mcp/socrata-skill': `
    export async function buildSystemPrompt() { return 'fixture system prompt'; }
    export function withPortalLockGuidance(prompt) { return prompt; }`,
  // The model loop: holds until the test opens the gate, then completes with
  // an answer and no tool calls, as a run whose model answered directly does.
  '@/lib/openrouter-streaming': `
    const result = () => ({ content: 'fixture answer', duration_ms: 1, prompt_tokens: 1, completion_tokens: 1, tools_called: [] });
    async function held(panel, callbacks) {
      await globalThis.__sseGates.model.promise;
      callbacks.onComplete(panel, result());
    }
    export async function queryWithMcpStreaming(_q, _m, _t, _c, _s, callbacks) { await held('withMcp', callbacks); }
    export async function queryWithoutMcpStreaming(_q, _m, _s, callbacks) { await held('withoutMcp', callbacks); }`,
  // The executor: holds until the test opens the gate, then returns the
  // notebook it was given as the executed one.
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook(notebook) {
      await globalThis.__sseGates.executor.promise;
      return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`sse-keepalive test hook: cannot resolve ${specifier}`);
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

// A usable model endpoint and a primary data source, so both routes pass their
// configuration guards. Nothing is ever sent to either: the loop is a stub.
process.env.MODEL_API_KEY = 'fixture-not-a-key';
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:9/mcp';

interface Gate { promise: Promise<void>; open: () => void }
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}
const gates = { model: gate(), executor: gate() };
(globalThis as unknown as { __sseGates: typeof gates }).__sseGates = gates;
function resetGates(): void {
  gates.model = gate();
  gates.executor = gate();
}

const { getDefaultModel } = await import('@/lib/model-resolver');
const notebookRoute = await import('./query-notebook/route.ts');
const compareRoute = await import('./compare-stream/route.ts');
const { connectSSE } = await import('../../lib/sse-client.ts');

// --- Reading the stream -------------------------------------------------------

const decoder = new TextDecoder();

/** Reads the response body chunk by chunk, keeping everything it has seen. */
class StreamTap {
  text = '';
  done = false;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Promise<void> | null = null;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  private pull(): Promise<void> {
    if (!this.pending) {
      this.pending = this.reader.read().then(({ done, value }) => {
        if (done) this.done = true;
        else this.text += decoder.decode(value, { stream: true });
        this.pending = null;
      });
    }
    return this.pending;
  }

  /** Reads until `until(text)` holds or the stream ends, bounded by a real timer. */
  async readUntil(until: (text: string) => boolean, what: string, ms = 5_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!until(this.text) && !this.done) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      await Promise.race([this.pull(), new Promise((r) => setTimeout(r, left))]);
    }
    assert.ok(until(this.text), `the stream never showed ${what}; it carried:\n${this.text}`);
  }

  /** Lets every write already queued reach the tap, without advancing the mocked clock. */
  async settle(): Promise<void> {
    for (let i = 0; i < 20 && !this.done; i += 1) {
      await Promise.race([this.pull(), new Promise((r) => setTimeout(r, 5))]);
    }
  }
}

const KEEPALIVE_RE = /^:[^\n]*\n\n/gm;
const keepAlives = (text: string): number => (text.match(KEEPALIVE_RE) ?? []).length;
const dataEvents = (text: string): Record<string, unknown>[] =>
  text.split('\n\n').filter((block) => block.startsWith('data: ')).map((block) => JSON.parse(block.slice(6)));

/** Advances the mocked clock by `ms` and returns how many keep-alives that wrote. */
async function silence(tap: StreamTap, ms: number): Promise<number> {
  const before = keepAlives(tap.text);
  mock.timers.tick(ms);
  await tap.settle();
  return keepAlives(tap.text) - before;
}

/** Every event a consumer of this body would receive, through the app's own parser. */
async function throughClientParser(body: string): Promise<Record<string, unknown>[]> {
  const received: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch;
  try {
    await connectSSE({ url: '/fixture', body: {}, onEvent: (event) => received.push(event) });
  } finally {
    globalThis.fetch = realFetch;
  }
  return received;
}

/** Intervals started under the mocked clock and not yet cleared. */
const liveIntervals = new Set<unknown>();

/** Mocks `setInterval` (only it) and counts the intervals started and cleared under it. */
function mockIntervals(): void {
  mock.timers.enable({ apis: ['setInterval'] });
  liveIntervals.clear();
  const mockedSet = globalThis.setInterval;
  const mockedClear = globalThis.clearInterval;
  globalThis.setInterval = ((fn: () => void, ms?: number) => {
    const id = mockedSet(fn, ms);
    liveIntervals.add(id);
    return id;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id?: Parameters<typeof clearInterval>[0]) => {
    liveIntervals.delete(id);
    mockedClear(id);
  }) as typeof clearInterval;
}

function post(route: string, body: unknown): Request {
  return new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- /api/query-notebook ------------------------------------------------------

test('query-notebook: a keep-alive every interval through the model turn and the whole notebook run, and none reaches a consumer', async () => {
  resetGates();
  mockIntervals();
  try {
    const response = await notebookRoute.POST(post('/api/query-notebook', { query: 'fixture question' }) as never);
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
    const tap = new StreamTap(response.body as ReadableStream<Uint8Array>);
    await tap.readUntil((t) => t.includes('"name":"A"'), 'phase A');

    // Phase A: the model turn is silent. One interval short writes nothing;
    // the interval itself writes exactly one.
    assert.equal(await silence(tap, INTERVAL_MS - 1), 0, 'a keep-alive arrived before the interval had passed');
    assert.equal(await silence(tap, 1), 1, 'no keep-alive at the interval during the silent model turn');
    assert.equal(await silence(tap, 3 * INTERVAL_MS), 3, 'not one keep-alive per interval during the silent model turn');

    gates.model.open();
    await tap.readUntil((t) => t.includes('"name":"C"'), 'phase C');

    // Phase C: the whole notebook run, as long as the lambda driver can take.
    const intervals = Math.ceil((LAMBDA_WAIT_S * 1000) / INTERVAL_MS);
    assert.equal(await silence(tap, intervals * INTERVAL_MS), intervals, `not ${intervals} keep-alives across a ${LAMBDA_WAIT_S} s notebook run`);

    gates.executor.open();
    await tap.readUntil(() => tap.done, 'the end of the stream', 10_000);

    // The run completed as it would have without the keep-alives.
    const events = dataEvents(tap.text);
    const types = events.map((e) => e.type);
    assert.ok(types.includes('notebook') && types.includes('publish_inputs'), `the run did not complete: ${types.join(', ')}`);
    assert.equal(events.find((e) => e.type === 'phase' && e.name === 'complete')?.type, 'phase', 'no complete phase');

    // The route stopped its timer before closing: none is left for a failed
    // write to stop later.
    assert.equal(liveIntervals.size, 0, 'the route closed its stream with its keep-alive timer still running');

    // The consumer's view: exactly the data events, no keep-alive among them.
    const received = await throughClientParser(tap.text);
    assert.deepEqual(received, events, 'the client parser delivered something other than the data events');
    assert.ok(!JSON.stringify(received).includes('keepalive'), 'a keep-alive reached a consumer');
  } finally {
    mock.timers.reset();
  }
});

// --- /api/compare-stream ------------------------------------------------------

test('compare-stream: a keep-alive every interval while both arms are silent, and none reaches a consumer', async () => {
  resetGates();
  mockIntervals();
  try {
    const response = await compareRoute.POST(post('/api/compare-stream', { query: 'fixture question', model: getDefaultModel().id }) as never);
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
    const tap = new StreamTap(response.body as ReadableStream<Uint8Array>);

    assert.equal(await silence(tap, INTERVAL_MS - 1), 0, 'a keep-alive arrived before the interval had passed');
    assert.equal(await silence(tap, 1), 1, 'no keep-alive at the interval while both arms were silent');
    assert.equal(await silence(tap, 5 * INTERVAL_MS), 5, 'not one keep-alive per interval while both arms were silent');

    gates.model.open();
    await tap.readUntil(() => tap.done, 'the end of the stream', 10_000);

    const events = dataEvents(tap.text);
    const types = events.map((e) => e.type);
    assert.deepEqual(types.filter((t) => t === 'complete').length, 2, `both arms did not complete: ${types.join(', ')}`);
    assert.equal(types.at(-1), 'trace', 'the trace is no longer the last event');

    assert.equal(liveIntervals.size, 0, 'the route closed its stream with its keep-alive timer still running');

    const received = await throughClientParser(tap.text);
    assert.deepEqual(received, events, 'the client parser delivered something other than the data events');
    assert.ok(!JSON.stringify(received).includes('keepalive'), 'a keep-alive reached a consumer');
  } finally {
    mock.timers.reset();
  }
});

// --- The parser's side, shown able to fail -------------------------------------

test('the client parser drops a comment block and delivers the data block beside it', async () => {
  const received = await throughClientParser(': keepalive\n\ndata: {"type":"phase","name":"A"}\n\n: keepalive\n\n');
  assert.deepEqual(received, [{ type: 'phase', name: 'A' }]);
});

test('a keep-alive write that fails (the reader has gone) stops the timer', async () => {
  const { startSseKeepAlive } = await import('../../lib/streaming.ts');
  mockIntervals();
  try {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    await stream.readable.cancel();
    startSseKeepAlive(writer);
    assert.equal(liveIntervals.size, 1, 'the keep-alive started no timer');
    mock.timers.tick(INTERVAL_MS);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(liveIntervals.size, 0, 'a failed write left the timer running');
  } finally {
    mock.timers.reset();
  }
});
