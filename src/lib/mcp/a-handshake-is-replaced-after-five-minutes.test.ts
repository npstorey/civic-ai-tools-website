// S2-B phase 2 (npstorey/civic-ai-tools#309), criteria 6, 6a and 6c, for a base that keeps sessions: a server's
// report is read from a handshake no older than five minutes.
//
// THE RULE. The base check and the reported keys read what a server stated on its handshake. A handshake older
// than the check's five minutes (`BASE_READ_KEPT_MS`) is replaced before the next request: a new session is opened
// and the one it replaces is closed with `DELETE` once no call holds it. Within five minutes no handshake is added.
// A run states a server's keys only from a handshake within the bound. One handshake is in flight per server at a
// time, at first contact too, so concurrent calls share one session and none is left open that the client does not
// hold.
//
// WHAT IS DRIVEN. The real loop core (its own base check), the real MCP client and `withReportedKeys`, against a
// loopback base that keeps every session it opens until `DELETE` and refuses an unknown session as the deployed
// Socrata server does (400). The clock is mocked (`Date` only; the network's timers are real), so five minutes pass
// in a step.
//
// SHAPED TO FAIL. The base's release moves only `serverInfo.version`, with the same schemas, so only a fresh
// handshake can see it; its old sessions stay valid, so nothing but the bound can make the client handshake again.
// The concurrent first calls meet a handshake the base holds open until a second one arrives or 300 ms pass. The
// replaced session carries a call the base holds open across the replace.
//
// Run with: npm test

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { ToolCallRecord } from '../model-loop/run-tool-loop.ts';

const GR = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socrata-tools-at-gr.json'), 'utf8')) as {
  serverInfo: { name: string; version: string };
  tools: Array<Record<string, unknown>>;
};

// --- The base ----------------------------------------------------------------------------------------------

interface Seen { method: string; session: string; dataset?: string }
const base = {
  serverInfo: { ...GR.serverInfo },
  seen: [] as Seen[],
  minted: [] as string[],
  open: new Set<string>(),
  /** Hold the next `initialize` until a second arrives or 300 ms pass. */
  holdInitialize: false,
  /** Hold a `tools/call` whose `dataset_id` is `held` until released. */
  heldCall: undefined as undefined | { arrived: () => void; release: Promise<void> },
};
let initializeWaiter: (() => void) | undefined;

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const session = String(req.headers['mcp-session-id'] ?? '');
  if (req.method === 'DELETE') {
    base.seen.push({ method: 'DELETE', session });
    base.open.delete(session);
    res.writeHead(200);
    res.end();
    return;
  }
  const body = JSON.parse(raw) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  const dataset = body.method === 'tools/call' ? String(body.params?.arguments?.dataset_id ?? '') : undefined;
  base.seen.push({ method: String(body.method), session, ...(dataset !== undefined ? { dataset } : {}) });
  const answer = (status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
  };
  if (body.id === undefined) { res.writeHead(202); res.end(); return; }
  if (body.method === 'server/discover') { answer(400, { error: { code: -32601, message: 'Method not found' } }); return; }
  if (body.method === 'initialize') {
    const reported = { ...base.serverInfo };
    if (initializeWaiter) {
      initializeWaiter();
      initializeWaiter = undefined;
    } else if (base.holdInitialize) {
      base.holdInitialize = false;
      await new Promise<void>((resolve) => {
        initializeWaiter = resolve;
        setTimeout(resolve, 300);
      });
      initializeWaiter = undefined;
    }
    const id = `s-${base.minted.length + 1}`;
    base.minted.push(id);
    base.open.add(id);
    answer(200, { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: reported } }, { 'mcp-session-id': id });
    return;
  }
  if (!base.open.has(session)) { answer(400, { error: { code: -32000, message: 'Bad Request: No valid session ID provided' } }); return; }
  if (body.method === 'tools/list') { answer(200, { result: { tools: GR.tools } }); return; }
  if (dataset === 'held' && base.heldCall) {
    const held = base.heldCall;
    base.heldCall = undefined;
    held.arrived();
    await held.release;
  }
  answer(200, { result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ notice: 'fixture row' }], total_rows: 1 }) }] } });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
server.unref();

for (const k of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/mcp';
process.env.OPENROUTER_API_KEY = 'not-a-credential-s2b-p2';

const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { runToolLoop } = await import('../model-loop/run-tool-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { callMcpTool, startRunServerReads, withReportedKeys } = await import('./client.ts');
const { dispatchTargetOf, readMcpEnvFromProcess } = await import('./registry.ts');

const configured = readMcpEnvFromProcess();
const SOCRATA_ID = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'socrata')!.id;
const T0 = Date.parse('2026-11-15T12:00:00Z');
const MINUTE = 60_000;
const OWN_CALL = (dataset: string) => ({ type: 'query', dataset_id: dataset, portal: 'data.cityofnewyork.us', query: 'SELECT * LIMIT 1' });

interface Outcome<T> { value: T; keys: { id: string; reportedName?: string; reportedVersion?: string }; seen: Seen[] }

/** `work` in a run of its own (a new async context, as a request has), with that run's keys for Socrata. */
function inRun<T>(work: () => Promise<T>): Promise<Outcome<T>> {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {
      try {
        const reads = startRunServerReads();
        const from = base.seen.length;
        const value = await work();
        resolve({ value, keys: withReportedKeys([{ id: SOCRATA_ID }], reads, configured)[0], seen: base.seen.slice(from) });
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** One loop run whose model calls the pack's tool once, through the core's own base check. */
async function packRun(): Promise<ToolCallRecord> {
  const model = await startScriptedModelServer([
    { toolCalls: [{ id: 'p1', name: 'nyc_record__get_data', args: { type: 'query', query: 'SELECT * LIMIT 1' } }] },
    { content: 'An answer.' },
  ]);
  process.env.MODEL_API_BASE_URL = model.url;
  _resetDefaultModelClientForTests();
  const client = getModelClient();
  try {
    const result = await runToolLoop({
      client,
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: 'What did the City Record publish?',
      tools: [],
      executeToolCall: (name, args) => callMcpTool(name, args),
      dispatchTarget: (name) => dispatchTargetOf(name, configured),
    });
    return result.toolCalls[0];
  } finally {
    await new Promise((r) => model.server.close(r));
  }
}

const methods = (seen: Seen[]) => seen.map((s) => s.method);
const count = (seen: Seen[], method: string) => seen.filter((s) => s.method === method).length;
/** How many `DELETE`s `session` has received, waiting up to `waitMs` (real time) for the first. */
async function deletesOf(session: string, waitMs = 2000): Promise<number> {
  const until = performance.now() + waitMs;
  while (performance.now() < until && !base.seen.some((s) => s.method === 'DELETE' && s.session === session)) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return base.seen.filter((s) => s.method === 'DELETE' && s.session === session).length;
}
const lastSession = () => [...base.seen].reverse().find((s) => s.method === 'tools/call' || s.method === 'tools/list')?.session ?? '';

mock.timers.enable({ apis: ['Date'], now: T0 });

// --- 6c: two concurrent first calls, at T0 ---------------------------------------------------------------------

base.holdInitialize = true;
const FIRST = await Promise.all([inRun(() => callMcpTool('socrata__get_data', OWN_CALL('first-a'))), inRun(() => callMcpTool('socrata__get_data', OWN_CALL('first-b')))]);
const AFTER_FIRST = await inRun(() => callMcpTool('socrata__get_data', OWN_CALL('first-c')));
const HELD_AT_FIRST = lastSession();
const OPEN_AT_FIRST = [...base.open];

test('6c: two concurrent first calls to one server make one handshake', () => {
  assert.equal(count(base.seen, 'initialize'), 1, `the base received ${count(base.seen, 'initialize')} handshakes for two concurrent first calls`);
});

test('6c: no session is left open that the client does not hold', () => {
  assert.deepEqual(OPEN_AT_FIRST, [HELD_AT_FIRST], `the base holds ${JSON.stringify(OPEN_AT_FIRST)} open; the client sends on ${HELD_AT_FIRST}`);
  assert.ok(FIRST.every((r) => typeof r.value === 'string') && typeof AFTER_FIRST.value === 'string', 'premise: every call was answered');
});

// --- 6, within five minutes: T0 + 4 min ------------------------------------------------------------------------

mock.timers.setTime(T0 + 4 * MINUTE);
const WITHIN = await inRun(packRun);

test('6: within five minutes of the handshake, a run makes no new handshake and its pack call is sent', () => {
  assert.equal(count(WITHIN.seen, 'initialize'), 0);
  assert.deepEqual(methods(WITHIN.seen), ['tools/list', 'tools/call']);
  assert.notEqual(WITHIN.value.failed, true);
  assert.equal(WITHIN.keys.reportedVersion, GR.serverInfo.version);
});

// --- 6, past five minutes: T0 + 5 min + 1 ms; the base released as 0.9.3, same schemas, sessions kept ------------

base.serverInfo = { ...GR.serverInfo, version: '0.9.3' };
mock.timers.setTime(T0 + 5 * MINUTE + 1);
const REPLACED_AT_PAST = lastSession();
const PAST = await inRun(packRun);
const PAST_DELETES = await deletesOf(REPLACED_AT_PAST);

test('6: more than five minutes after the handshake, a run handshakes again before the check reads the base', () => {
  const m = methods(PAST.seen).filter((x) => x !== 'DELETE');
  assert.deepEqual(m, ['initialize', 'notifications/initialized', 'tools/list'], `the base received ${JSON.stringify(m)}`);
});

test('6: the check refuses a base whose new handshake reports a version no pin names, and nothing is sent', () => {
  assert.equal(count(PAST.seen, 'tools/call'), 0);
  assert.deepEqual({ failed: PAST.value.failed, failureKind: PAST.value.failureKind }, { failed: true, failureKind: 'base_changed' });
});

test('6: the run states the version its new handshake read', () => {
  assert.equal(PAST.keys.reportedVersion, '0.9.3');
});

test('6: the replaced session is closed with DELETE, once', () => {
  assert.equal(PAST_DELETES, 1);
});

// --- 6a: a call in flight on the session another run replaces ---------------------------------------------------

base.serverInfo = { ...GR.serverInfo };
mock.timers.setTime(T0 + 9 * MINUTE);
let arrived!: () => void;
const heldArrived = new Promise<void>((r) => { arrived = r; });
let release!: () => void;
base.heldCall = { arrived, release: new Promise<void>((r) => { release = r; }) };
const IN_FLIGHT = inRun(() => callMcpTool('socrata__get_data', OWN_CALL('held')));
await heldArrived;
const HELD_SESSION = base.seen.find((s) => s.dataset === 'held')!.session;
base.serverInfo = { ...GR.serverInfo, version: '0.9.3' };
mock.timers.setTime(T0 + 10 * MINUTE + 2);
const REPLACERS = await Promise.all([inRun(packRun), inRun(packRun)]);
const DELETES_WHILE_HELD = base.seen.filter((s) => s.method === 'DELETE' && s.session === HELD_SESSION).length;
release();
const HELD = await IN_FLIGHT;
const HELD_DELETES = await deletesOf(HELD_SESSION);

test('6a: two runs past the bound, together, make one new handshake, and each is refused by the check', () => {
  const both = [...REPLACERS[0].seen, ...REPLACERS[1].seen];
  assert.equal(count(base.seen.slice(base.seen.findIndex((s) => s.dataset === 'held')), 'initialize'), 1);
  assert.equal(count(both, 'tools/call'), 0, 'a replacing run sent its pack call');
  for (const r of REPLACERS) assert.deepEqual({ failed: r.value.failed, failureKind: r.value.failureKind }, { failed: true, failureKind: 'base_changed' });
});

test('6a: the replaced session is not closed while a call holds it', () => {
  assert.equal(DELETES_WHILE_HELD, 0);
});

test('6a: the call in flight completes on its own session, sent once', () => {
  assert.equal(typeof HELD.value, 'string');
  assert.deepEqual(base.seen.filter((s) => s.dataset === 'held').map((s) => s.session), [HELD_SESSION]);
});

test('6a: the run whose call completed on a handshake past the bound states no keys for that server', () => {
  assert.deepEqual(HELD.keys, { id: SOCRATA_ID });
});

test('6a: once the call is answered, the replaced session is closed with DELETE, once', () => {
  assert.equal(HELD_DELETES, 1);
});

mock.timers.reset();
