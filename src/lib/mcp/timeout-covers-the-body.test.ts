// #590: the client's 45-second limit (`MCP_TIMEOUT_MS`) covers each HTTP
// exchange through its body, not only until the headers arrive.
//
// THE DEFECT. Three exchanges cleared their timer in a `finally` as soon as
// `fetch` resolved, then read the body with no deadline: `postDiscover`,
// `initializeSession` and `makeToolCall`. A source that sends its headers and
// then stalls held the request open for as long as it liked. The loop's own
// 45 s race stopped WAITING for a tool call, but the request stayed open, and
// `getServerInstructions` (prompt composition) had no bound at all.
//
// WHAT IS DRIVEN. The REAL client against three scripted servers on loopback,
// one origin each, the shape `era-changes.test.ts` uses:
//
//   socrata            — modern. Its `server/discover` answer stalls once
//                        (criterion 2), then a `tools/call` answer (criterion 1),
//                        then an ordinary call (criterion 4's timer check).
//   data-commons       — legacy, with instructions. Two `initialize` answers
//                        stall (criterion 3): one under a tool call, one under
//                        `getServerInstructions`; the third is ordinary.
//   boston-opencontext — legacy. An `initialize` answered 400 whose body would
//                        carry -32020 stalls, then a `tools/call` answered 405
//                        whose body stalls (criterion 4).
//
// A stalled answer sends its headers at once and its body after 46 s. Nothing
// waits 46 s: `mock.timers` stands in for `setTimeout` on both sides, and the
// clock is moved by hand — 45 s once the client holds the stalled answer's
// headers, then, when the call is still open (the defect), 46 s at a time until
// it settles. `fetch` is wrapped only to count which requests have their
// headers, so the 45 s step is taken while the client is reading the BODY: a
// step taken before the headers arrive would time out under the old code too,
// and could not fail.
//
// The timer instrument records every `setTimeout` whose call stack runs through
// `client.ts`, and drops it when it is cleared or fires. "Live" is what is left.
// It is measured before any clock step in an ordinary exchange, since a step
// would fire a forgotten timer and hide it.
//
// RED at base: every assertion that needs the call settled at 45 s, the second
// `server/discover`, the second and third `initialize`, the `null` instructions,
// and the single `server/discover` at boston (the base waits for the body, reads
// -32020 and probes again).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/timeout-covers-the-body.test.ts)

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { classifyStreamError } from '../streaming.ts';

const realSetTimeout = globalThis.setTimeout;
const pause = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

/** Wait on the real clock until `condition` holds; false when `limitMs` passes first. */
async function until(condition: () => boolean, limitMs = 5_000): Promise<boolean> {
  const deadline = performance.now() + limitMs;
  while (!condition()) {
    if (performance.now() > deadline) return false;
    await pause(2);
  }
  return true;
}

const ROWS = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });
const INSTRUCTIONS = 'Answer from the observations this source returns.';

// --- Scripted servers -------------------------------------------------------------------

type Payload = Record<string, unknown> | null;
interface Answer { status: number; payload: Payload; stall?: boolean }
interface Stall { method: string; status: number; sent: boolean; closed: boolean }
interface Seen { method: string; status: number }

const stalls: Stall[] = [];
const openStalls = () => stalls.filter((s) => !s.sent && !s.closed).length;

async function bodyOf(req: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    server.unref();
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }));
}

/**
 * A scripted server. Each request takes the next answer queued for its method,
 * or the method's ordinary answer. A stalled answer flushes its headers and
 * sends its body 46 s later, unless the connection closes first.
 */
function scripted(ordinary: (method: string) => Answer) {
  const seen: Seen[] = [];
  const queued: Record<string, Answer[]> = {};
  const server = http.createServer(async (req, res) => {
    const msg = JSON.parse(await bodyOf(req)) as { id?: unknown; method?: string };
    const method = String(msg.method ?? '');
    const answer = msg.id === undefined ? { status: 202, payload: null } : (queued[method]?.shift() ?? ordinary(method));
    seen.push({ method, status: answer.status });
    // One request per connection. Under a mocked `setTimeout`, a third request on a
    // kept-alive connection was measured to hang before reaching the handler.
    res.setHeader('connection', 'close');
    if (answer.payload === null) { res.writeHead(answer.status); res.end(); return; }
    const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, ...answer.payload });
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    if (!answer.stall) { res.end(body); return; }
    res.flushHeaders();
    const stall: Stall = { method, status: answer.status, sent: false, closed: false };
    stalls.push(stall);
    const timer = setTimeout(() => { stall.sent = true; res.end(body); }, 46_000);
    res.on('close', () => {
      if (stall.sent) return;
      stall.closed = true;
      clearTimeout(timer);
    });
  });
  const queue = (method: string, ...answers: Answer[]) => { (queued[method] ??= []).push(...answers); };
  const count = (method: string) => seen.filter((s) => s.method === method).length;
  return { server, seen, queue, count };
}

const rows: Payload = { result: { content: [{ type: 'text', text: ROWS }] } };
const legacyInitialize = (instructions?: string): Payload => ({
  result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'w1-timeout', version: '0' }, ...(instructions ? { instructions } : {}) },
});
const discoverResult: Payload = { result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } };
const notFound: Payload = { error: { code: -32601, message: 'Method not found' } };

const socrata = scripted((method) => (method === 'server/discover' ? { status: 200, payload: discoverResult } : { status: 200, payload: rows }));
const dataCommons = scripted((method) => {
  if (method === 'server/discover') return { status: 404, payload: notFound };
  if (method === 'initialize') return { status: 200, payload: legacyInitialize(INSTRUCTIONS) };
  return { status: 200, payload: rows };
});
const boston = scripted((method) => {
  if (method === 'server/discover') return { status: 404, payload: notFound };
  if (method === 'initialize') return { status: 200, payload: legacyInitialize() };
  return { status: 200, payload: rows };
});

delete process.env.DATA_COMMONS_API_KEY;
process.env.SOCRATA_MCP_URL = `${await listen(socrata.server)}/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${await listen(dataCommons.server)}/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${await listen(boston.server)}/mcp`;

const { callMcpTool, getServerInstructions } = await import('./client.ts');

// --- Instruments: headers received, and the client's live timers ------------------------

let fetchesStarted = 0;
let fetchesWithHeaders = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  fetchesStarted += 1;
  const response = await realFetch(...args);
  fetchesWithHeaders += 1;
  return response;
}) as typeof fetch;

const CLIENT_FRAME = '/src/lib/mcp/client.ts:';
const liveClientTimers = new Set<unknown>();
let clientTimersCreated = 0;

mock.timers.enable({ apis: ['setTimeout'] });
{
  const mockedSet = globalThis.setTimeout;
  const mockedClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (!(new Error().stack ?? '').includes(CLIENT_FRAME)) return mockedSet(callback, ms, ...args);
    clientTimersCreated += 1;
    const handle: unknown = mockedSet(() => {
      liveClientTimers.delete(handle);
      callback(...args);
    }, ms);
    liveClientTimers.add(handle);
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    liveClientTimers.delete(handle);
    mockedClear(handle);
  }) as typeof clearTimeout;
}

// --- The drive ---------------------------------------------------------------------------

interface Driven {
  value?: string | null;
  error?: Error;
  /** The call had settled once the clock reached 45 s past the stalled answer's headers. */
  settledBy45: boolean;
  /** The stalls this call met, as they stood at 45 s. */
  stallsAt45: Stall[];
  /** Client timers created during the call, and still live once it settled. */
  timersCreated: number;
  timersLive: number;
  /** The drive gave up: the call never settled. */
  stuck: boolean;
}

async function drive(run: () => Promise<string | null>): Promise<Driven> {
  let done = false;
  const outcome = run().then(
    (value) => ({ value }),
    (error: unknown) => ({ error: error as Error }),
  ).finally(() => { done = true; });
  const stallsBefore = stalls.length;
  const createdBefore = clientTimersCreated;
  const clientReadingAStall = () => openStalls() > 0 && fetchesWithHeaders === fetchesStarted;

  await until(() => done || clientReadingAStall());
  if (done) {
    // An ordinary exchange: read the timers before any clock step can fire a forgotten one.
    const settled = await outcome;
    return { ...settled, settledBy45: true, stallsAt45: [], timersCreated: clientTimersCreated - createdBefore, timersLive: liveClientTimers.size, stuck: false };
  }

  mock.timers.tick(45_000);
  // The fixed client settles and the server sees the connection close; the old one does neither.
  await until(() => done && openStalls() === 0, 2_000);
  const settledBy45 = done;
  const stallsAt45 = stalls.slice(stallsBefore).map((s) => ({ ...s }));

  for (let step = 0; !done && step < 10; step += 1) {
    await until(() => done || clientReadingAStall());
    if (done) break;
    mock.timers.tick(46_000);
    await until(() => done || !clientReadingAStall(), 2_000);
  }
  if (!done) {
    return { settledBy45, stallsAt45, timersCreated: clientTimersCreated - createdBefore, timersLive: liveClientTimers.size, stuck: true };
  }
  const settled = await outcome;
  await until(() => openStalls() === 0, 2_000);
  return { ...settled, settledBy45, stallsAt45, timersCreated: clientTimersCreated - createdBefore, timersLive: liveClientTimers.size, stuck: false };
}

const getData = () => callMcpTool('get_data', { type: 'query', dataset_id: 'abcd-1234', select: 'count(*)', portal: 'data.example.org' });
const getObservations = () => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/06' });
const searchBoston = () => callMcpTool('ckan__search_datasets', { query: 'permits' });

// Criterion 2: discover stalls, then an ordinary call.
socrata.queue('server/discover', { status: 200, payload: discoverResult, stall: true });
const DISCOVER_STALLED = await drive(getData);
const DISCOVERS_AFTER_STALL = socrata.count('server/discover');
const AFTER_DISCOVER_STALL = await drive(getData);
const DISCOVERS_AFTER_NEXT_CALL = socrata.count('server/discover');

// Criterion 1: a tool call stalls.
socrata.queue('tools/call', { status: 200, payload: rows, stall: true });
const TOOL_CALL_STALLED = await drive(getData);

// Criterion 4, timers: one ordinary successful tool call.
const ORDINARY = await drive(getData);

// Criterion 3: initialize stalls under a tool call, then under getServerInstructions; then ordinary.
dataCommons.queue('initialize', { status: 200, payload: legacyInitialize(INSTRUCTIONS), stall: true }, { status: 200, payload: legacyInitialize(INSTRUCTIONS), stall: true });
const INITIALIZE_STALLED = await drive(getObservations);
const INITIALIZES_AFTER_FIRST = dataCommons.count('initialize');
const INSTRUCTIONS_STALLED = await drive(() => getServerInstructions('data-commons'));
const INITIALIZES_AFTER_SECOND = dataCommons.count('initialize');
const AFTER_INITIALIZE_STALLS = await drive(getObservations);
const INITIALIZES_AFTER_THIRD = dataCommons.count('initialize');
const INSTRUCTIONS_AFTER = await drive(() => getServerInstructions('data-commons'));

// Criterion 4, error paths: an initialize answered 400, then a tool call answered 405, bodies stalled.
boston.queue('initialize', { status: 400, payload: { error: { code: -32020, message: 'Header mismatch' } }, stall: true });
const INITIALIZE_ERROR_STALLED = await drive(searchBoston);
const BOSTON_DISCOVERS = boston.count('server/discover');
boston.queue('tools/call', { status: 405, payload: { error: { code: -32601, message: 'Method not found' } }, stall: true });
const TOOL_CALL_ERROR_STALLED = await drive(searchBoston);

mock.timers.reset();
globalThis.fetch = realFetch;
for (const { server } of [socrata, dataCommons, boston]) {
  server.closeAllConnections();
  server.close();
}

const DID_NOT_RESPOND = (id: string) => `MCP server "${id}" did not respond within 45s — the upstream server may be starting up or unresponsive. Please try again.`;

/** A call that met a stalled answer: it settled by 45 s, and the server saw the connection closed with the body unsent. */
function assertCancelledAt45(driven: Driven, method: string): void {
  assert.equal(driven.stuck, false, 'the call never settled, even after the stalled body was sent');
  const stall = driven.stallsAt45.find((s) => s.method === method);
  assert.ok(stall, `premise: the ${method} answer stalled`);
  assert.equal(driven.settledBy45, true, `the call was still open 45 s after the stalled ${method} answer's headers (it settled ${driven.error ? `with "${driven.error.message}"` : `with ${JSON.stringify(driven.value)}`} only once the body arrived)`);
  assert.equal(stall.closed, true, `the server did not see the ${method} connection closed by 45 s: the request was abandoned, not cancelled`);
  assert.equal(stall.sent, false);
}

test('a tool call whose answer stalls after its headers is cancelled at 45 s, with the existing message and kind', () => {
  assertCancelledAt45(TOOL_CALL_STALLED, 'tools/call');
  assert.ok(TOOL_CALL_STALLED.error, `the call resolved with ${JSON.stringify(TOOL_CALL_STALLED.value)}`);
  assert.equal(TOOL_CALL_STALLED.error.message, 'MCP tool call "get_data" timed out after 45s — the data source may be slow or unresponsive. Try a simpler query.');
  assert.equal(classifyStreamError(TOOL_CALL_STALLED.error), 'mcp_timeout');
});

test('a server/discover answer that stalls after its headers times out at 45 s, and no era is cached', () => {
  assertCancelledAt45(DISCOVER_STALLED, 'server/discover');
  assert.ok(DISCOVER_STALLED.error, `the call resolved with ${JSON.stringify(DISCOVER_STALLED.value)}`);
  assert.equal(DISCOVER_STALLED.error.message, DID_NOT_RESPOND('socrata'));
  assert.equal(classifyStreamError(DISCOVER_STALLED.error), 'mcp_timeout');
  assert.equal(DISCOVERS_AFTER_STALL, 1);
  assert.equal(AFTER_DISCOVER_STALL.value, ROWS, `the following call failed: ${AFTER_DISCOVER_STALL.error?.message}`);
  assert.equal(DISCOVERS_AFTER_NEXT_CALL, 2, 'the following call did not probe again: an era was cached from the stalled answer');
});

test('a legacy initialize answer that stalls after its headers times out at 45 s; the server is not marked initialized and has no instructions', () => {
  assertCancelledAt45(INITIALIZE_STALLED, 'initialize');
  assert.ok(INITIALIZE_STALLED.error, `the call resolved with ${JSON.stringify(INITIALIZE_STALLED.value)}`);
  assert.equal(INITIALIZE_STALLED.error.message, DID_NOT_RESPOND('data-commons'));
  assert.equal(classifyStreamError(INITIALIZE_STALLED.error), 'mcp_timeout');
  assert.equal(INITIALIZES_AFTER_FIRST, 1);

  assertCancelledAt45(INSTRUCTIONS_STALLED, 'initialize');
  assert.equal(INITIALIZES_AFTER_SECOND, 2, 'getServerInstructions did not send initialize again: the server was marked initialized');
  assert.equal(INSTRUCTIONS_STALLED.value, null);

  assert.equal(AFTER_INITIALIZE_STALLS.value, ROWS, `the following call failed: ${AFTER_INITIALIZE_STALLS.error?.message}`);
  assert.equal(INITIALIZES_AFTER_THIRD, 3, 'the following call did not send initialize again');
  assert.equal(INSTRUCTIONS_AFTER.value, INSTRUCTIONS, 'premise: an ordinary initialize yields the instructions');
});

test('a non-ok answer whose body stalls throws the existing HTTP failure by 45 s, read as no JSON-RPC code', () => {
  assertCancelledAt45(INITIALIZE_ERROR_STALLED, 'initialize');
  assert.ok(INITIALIZE_ERROR_STALLED.error, `the call resolved with ${JSON.stringify(INITIALIZE_ERROR_STALLED.value)}`);
  assert.equal(INITIALIZE_ERROR_STALLED.error.message, 'MCP initialization failed for "boston-opencontext": 400');
  assert.equal(classifyStreamError(INITIALIZE_ERROR_STALLED.error), 'mcp_unavailable');
  // The body would have carried -32020, which sends the client to probe again. Read as no code, it does not.
  assert.equal(BOSTON_DISCOVERS, 1, 'the client probed again: the stalled body was read for its JSON-RPC code');

  assertCancelledAt45(TOOL_CALL_ERROR_STALLED, 'tools/call');
  assert.ok(TOOL_CALL_ERROR_STALLED.error, `the call resolved with ${JSON.stringify(TOOL_CALL_ERROR_STALLED.value)}`);
  assert.equal(TOOL_CALL_ERROR_STALLED.error.message, 'MCP server "boston-opencontext" error: 405 Method Not Allowed');
  assert.equal(classifyStreamError(TOOL_CALL_ERROR_STALLED.error), 'mcp_unavailable');
});

test('no timer the client created is live after any exchange, timed out or answered', () => {
  const cases: Record<string, Driven> = {
    DISCOVER_STALLED, AFTER_DISCOVER_STALL, TOOL_CALL_STALLED, ORDINARY,
    INITIALIZE_STALLED, INSTRUCTIONS_STALLED, AFTER_INITIALIZE_STALLS, INSTRUCTIONS_AFTER,
    INITIALIZE_ERROR_STALLED, TOOL_CALL_ERROR_STALLED,
  };
  assert.equal(ORDINARY.value, ROWS, `premise: the ordinary call succeeded: ${ORDINARY.error?.message}`);
  // The instrument sees the client's timers at all: an ordinary call to a modern server makes one.
  assert.equal(ORDINARY.timersCreated, 1, 'premise: the instrument saw the client create its timer');
  for (const [name, driven] of Object.entries(cases)) {
    assert.equal(driven.timersLive, 0, `${name}: ${driven.timersLive} client timer(s) still live`);
  }
});
