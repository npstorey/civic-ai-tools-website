// Sprint 238 P3 (website #537, #467; rulings D4 to D6): against a LEGACY server,
// the dual-era client's exchange is today's exchange, and what it hands its
// callers is today's.
//
// WHAT IS DRIVEN. The REAL client (`callMcpTool`, `callMcpPrompt`,
// `getServerInstructions`) against three scripted MCP servers on loopback, one
// per source, so each has its own origin and its own era:
//
//   socrata         — a STATEFUL legacy server shaped like the hosted Socrata
//                     source: `initialize` mints a session, and any other
//                     request without a known session is refused
//                     `400 -32000 "Bad Request: No valid session ID provided"`
//                     (socrata-mcp-server `src/index.ts` at 9283878, the
//                     `No valid session` branch — `server/discover` meets that
//                     branch, as #537 measured on the live server). Two
//                     scripted expiries answer as the MCP SDK's own stateful
//                     transport does for a session it no longer holds:
//                     `404 -32001 "Session not found"` (`@modelcontextprotocol/
//                     sdk` 1.30.0, `webStandardStreamableHttp.js`,
//                     `validateSession`).
//   data-commons    — the 200 TRAP: a stateless legacy server that answers
//                     EVERY request but `initialize` with 200 and a tool
//                     result, `server/discover` included. The 2026-07-28
//                     versioning page allows it ("or even process an
//                     era-ambiguous method under legacy semantics",
//                     `basic_versioning.mdx:167`), and the six pinned driven
//                     tests in this repository have this shape. A client that
//                     read any 200 as modern would skip `initialize`.
//   boston-opencontext — a stateless legacy server that answers a tool call
//                     404 with no session in play.
//
// D6, SHOWN BY THE SAME CALLS AT BASE AND AT HEAD. `fixtures/legacy-exchange-at-
// base.json` is this file's own recording of the socrata traffic and of every
// call's outcome, made by running THIS FILE, unmodified, against the base
// client (`233c435`):
//
//   git archive 233c435 src | tar -x -C <dir>      # the base tree
//   cp src/lib/mcp/legacy-exchange-is-unchanged.test.ts <dir>/src/lib/mcp/
//   MCP_LEGACY_EXCHANGE_RECORD=<file> node --test --experimental-strip-types \
//     <dir>/src/lib/mcp/legacy-exchange-is-unchanged.test.ts
//
// The recording normalizes one thing, the JSON-RPC `id`, which is
// `Date.now()` (`client.ts` builds every request id from the clock): it is
// replaced by a placeholder, not frozen, so the durations the client logs stay
// real. Headers are compared as the client sets them, in wire order; the ones
// the runtime's `fetch` adds (host, connection, content-length, user-agent,
// accept-language, sec-fetch-mode, accept-encoding) are left out because they
// belong to the Node release, not to the client.
//
// The assertion: remove from head's traffic the probe that opens it, every
// `notifications/initialized`, and every `MCP-Protocol-Version` header, and
// what is left equals base's traffic byte for byte; the three additions are
// each checked for their own shape; the returned strings, and the thrown
// errors' classes and messages, equal base's.
//
// RED at base: everything that needs the probe, the notification, the version
// header or the 404 re-initialize. GREEN at base, and able to go red only on a
// regression: a 404 with no session is not retried (#467's second criterion).
//
// BLIND SPOTS. No live server is reached: the hosted Socrata source and the
// MCP SDK's own servers were driven separately at the phase gate. The error
// objects are compared by class and message, which is what D6 names.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/legacy-exchange-is-unchanged.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(HERE, 'fixtures', 'legacy-exchange-at-base.json');

/** Headers the runtime's `fetch` adds on its own; not the client's to set. */
const TRANSPORT_HEADERS = new Set(['host', 'connection', 'content-length', 'user-agent', 'accept-language', 'sec-fetch-mode', 'accept-encoding']);

interface Wire {
  method: string;
  headers: Array<[string, string]>;
  body: string;
}

function recordOf(req: http.IncomingMessage, body: string): Wire {
  const headers: Array<[string, string]> = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    if (!TRANSPORT_HEADERS.has(name)) headers.push([name, req.rawHeaders[i + 1]]);
  }
  let method = '';
  try { method = String((JSON.parse(body) as { method?: unknown }).method ?? ''); } catch { /* recorded as sent */ }
  return { method, headers, body: body.replace(/"id":\d+/, '"id":"<Date.now()>"') };
}

const headerOf = (w: Wire, name: string): string | undefined => w.headers.find(([n]) => n === name)?.[1];

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

const json = (res: http.ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
};
const sse = (res: http.ServerResponse, payload: unknown) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
};

// --- socrata: the stateful legacy server --------------------------------------

const ROWS = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });
const LEGACY_INSTRUCTIONS = 'Legacy fixture instructions: name the portal on every call.';
const SKILL_TEXT = 'Legacy fixture skill guidance.';

const socrataWire: Wire[] = [];
const sessions = new Set<string>();
let sessionCount = 0;
/** Datasets whose next request finds its session gone — once each. */
const expireOnce = new Set(['expire-400', 'expire-404']);

const NO_SESSION = { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null };
const SESSION_NOT_FOUND = { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null };

const socrata = http.createServer(async (req, res) => {
  const body = await bodyOf(req);
  socrataWire.push(recordOf(req, body));
  const msg = JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  const session = req.headers['mcp-session-id'] as string | undefined;
  if (!session || !sessions.has(session)) {
    if (!session && msg.method === 'initialize') {
      const id = `legacy-session-${++sessionCount}`;
      sessions.add(id);
      json(res, 200, {
        jsonrpc: '2.0',
        id: msg.id,
        result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'p3-legacy', version: '0' }, instructions: LEGACY_INSTRUCTIONS },
      }, { 'mcp-session-id': id });
      return;
    }
    json(res, session ? 404 : 400, session ? SESSION_NOT_FOUND : NO_SESSION);
    return;
  }
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => ({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'prompts/get') {
    switch (msg.params?.name) {
      case 'prompt-rpc-error': sse(res, reply({ error: { code: -32602, message: 'Legacy fixture: no prompt by that name.' } })); return;
      case 'prompt-500': res.writeHead(500); res.end(); return;
      default: sse(res, reply({ result: { messages: [{ role: 'user', content: { type: 'text', text: SKILL_TEXT } }] } })); return;
    }
  }
  const dataset = String(msg.params?.arguments?.dataset_id);
  if (expireOnce.delete(dataset)) {
    sessions.clear();
    if (dataset === 'expire-400') json(res, 400, NO_SESSION);
    else json(res, 404, SESSION_NOT_FOUND);
    return;
  }
  switch (dataset) {
    case 'ok-json': json(res, 200, reply({ result: { content: [{ type: 'text', text: ROWS }] } })); return;
    case 'is-error': sse(res, reply({ result: { content: [{ type: 'text', text: 'Legacy fixture refusal.' }], isError: true } })); return;
    case 'rpc-error-sse': sse(res, reply({ error: { code: -32602, message: 'Legacy fixture: no column by that name.' } })); return;
    case 'rpc-error-json': json(res, 200, reply({ error: { code: -32602, message: 'Legacy fixture: no table by that name.' } })); return;
    case 'http-502': res.writeHead(502); res.end(); return;
    // A decoy for the words the base retry read: its reason phrase says
    // "session" and "400", its status is neither.
    case 'decoy-502': res.writeHead(502, 'session 400'); res.end(); return;
    case 'always-404': json(res, 404, SESSION_NOT_FOUND); return;
    case 'unparseable': res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`event: message\ndata: {"jsonrpc":"2.0","id":${JSON.stringify(msg.id)},"result":\n\n`); return;
    case 'not-json': res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return;
    default: sse(res, reply({ result: { content: [{ type: 'text', text: ROWS }] } }));
  }
});

// --- data-commons: the 200 trap -------------------------------------------------

const trapWire: Wire[] = [];
const trap = http.createServer(async (req, res) => {
  const body = await bodyOf(req);
  trapWire.push(recordOf(req, body));
  const msg = JSON.parse(body) as { id?: unknown; method?: string };
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  if (msg.method === 'initialize') {
    json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3-trap', version: '0' } } });
    return;
  }
  sse(res, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Trap fixture rows.' }] } });
});

// --- boston-opencontext: stateless, a tool call answered 404 --------------------

const statelessWire: Wire[] = [];
const stateless = http.createServer(async (req, res) => {
  const body = await bodyOf(req);
  statelessWire.push(recordOf(req, body));
  const msg = JSON.parse(body) as { id?: unknown; method?: string };
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  if (msg.method === 'initialize') {
    json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3-stateless', version: '0' } } });
    return;
  }
  if (msg.method === 'server/discover') { json(res, 400, NO_SESSION); return; }
  json(res, 404, { jsonrpc: '2.0', error: { code: -32601, message: 'Not found' }, id: null });
});

process.env.SOCRATA_MCP_URL = `${await listen(socrata)}/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${await listen(trap)}/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${await listen(stateless)}/mcp`;
delete process.env.DATA_COMMONS_API_KEY;

// The registry reads its environment at module load.
const { callMcpTool, callMcpPrompt, getServerInstructions } = await import('./client.ts');

// --- The calls, in one order, at base and at head -------------------------------

interface Outcome {
  call: string;
  value?: string | null;
  errorClass?: string;
  message?: string;
}

async function outcomeOf(call: string, run: () => Promise<string | null>): Promise<Outcome> {
  try {
    return { call, value: await run() };
  } catch (error) {
    const e = error as Error;
    return { call, errorClass: e?.constructor?.name, message: e?.message };
  }
}

const tool = (dataset: string) => () => callMcpTool('get_data', { type: 'query', dataset_id: dataset, select: 'count(*)', portal: 'data.example.org' });
const prompt = (name: string) => () => callMcpPrompt(name, { modality: 'web' });

const OUTCOMES: Outcome[] = [];
for (const [call, run] of [
  ['instructions', () => getServerInstructions('socrata')],
  ['tool ok-sse', tool('ok-sse')],
  ['tool ok-json', tool('ok-json')],
  ['tool is-error', tool('is-error')],
  ['tool rpc-error-sse', tool('rpc-error-sse')],
  ['tool rpc-error-json', tool('rpc-error-json')],
  ['tool http-502', tool('http-502')],
  ['tool unparseable', tool('unparseable')],
  ['tool not-json', tool('not-json')],
  ['prompt skill-guidance', prompt('skill-guidance')],
  ['prompt prompt-rpc-error', prompt('prompt-rpc-error')],
  ['prompt prompt-500', prompt('prompt-500')],
  ['tool expire-400', tool('expire-400')],
  ['tool ok-sse after the new session', tool('ok-sse')],
] as Array<[string, () => Promise<string | null>]>) {
  OUTCOMES.push(await outcomeOf(call, run));
}
const COMPARED_WIRE = socrataWire.slice();

if (process.env.MCP_LEGACY_EXCHANGE_RECORD) {
  fs.writeFileSync(process.env.MCP_LEGACY_EXCHANGE_RECORD, `${JSON.stringify({ outcomes: OUTCOMES, wire: COMPARED_WIRE }, null, 2)}\n`);
}

// The #467 drives, after the recorded ones: base and head differ here by design.
const sentTo = (dataset: string) => socrataWire.filter((w) => w.method === 'tools/call' && w.body.includes(`"dataset_id":"${dataset}"`)).length;
const initializes = () => socrataWire.filter((w) => w.method === 'initialize').length;

const beforeExpiry404 = initializes();
const EXPIRE_404 = await outcomeOf('tool expire-404', tool('expire-404'));
const afterExpiry404 = initializes();
const beforeAlways404 = initializes();
const ALWAYS_404 = await outcomeOf('tool always-404', tool('always-404'));
const afterAlways404 = initializes();
const beforeDecoy = initializes();
const DECOY = await outcomeOf('tool decoy-502', tool('decoy-502'));
const afterDecoy = initializes();

const TRAP = await outcomeOf('trap tool', () => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/06' }));
const TRAP_AGAIN = await outcomeOf('trap tool again', () => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' }));

const STATELESS_404 = await outcomeOf('stateless 404', () => callMcpTool('ckan__search_datasets', { query: 'permits' }));

const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as { outcomes: Outcome[]; wire: Wire[] };

// --- Premise ------------------------------------------------------------------------

test('premise: the recording is of a legacy exchange that reached every scripted branch', () => {
  assert.equal(golden.wire[0]?.method, 'initialize', 'the base recording does not open with initialize');
  assert.ok(golden.outcomes.some((o) => o.value === ROWS), 'no recorded call returned the rows');
  assert.ok(golden.outcomes.some((o) => o.errorClass === 'McpErrorEnvelope'), 'no recorded call was a JSON-RPC refusal');
  assert.ok(golden.outcomes.some((o) => o.message?.includes('502')), 'no recorded call met an HTTP failure');
  assert.equal(golden.outcomes.length, OUTCOMES.length, 'the recording and this run made different calls');
});

// --- D4: the probe, and the era it finds ---------------------------------------------

test('D4: first contact is one server/discover, as the 2026-07-28 page builds it, with the registry headers', () => {
  const probe = socrataWire[0];
  assert.equal(probe.method, 'server/discover', `first contact was ${probe.method}`);
  const body = JSON.parse(probe.body) as { params?: { _meta?: Record<string, unknown> } };
  const meta = body.params?._meta ?? {};
  // server_discover.mdx:13-30 — `_meta` alone, with these three keys.
  assert.equal(meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  assert.deepEqual(meta['io.modelcontextprotocol/clientCapabilities'], {});
  assert.equal((meta['io.modelcontextprotocol/clientInfo'] as { name?: string })?.name, 'civic-ai-tools-website');
  // basic_transports_streamable-http.mdx:252-261 and :286-293.
  assert.equal(headerOf(probe, 'mcp-protocol-version'), '2026-07-28');
  assert.equal(headerOf(probe, 'mcp-method'), 'server/discover');
  assert.equal(headerOf(probe, 'mcp-session-id'), undefined, 'the probe carried a session id');
  assert.equal(socrataWire.filter((w) => w.method === 'server/discover').length, 1, 'the era was probed more than once for one origin');
});

test('D4: a 400 without a modern error body (the Socrata shape) falls back to initialize', () => {
  assert.equal(socrataWire[1]?.method, 'initialize', `after the refused probe came ${socrataWire[1]?.method}`);
});

// --- Criterion 1 and D6: base's exchange, plus exactly the three additions -----------

test('criterion 1: after the probe, less the notifications and the version header, the traffic is base\'s byte for byte', () => {
  const stripped = COMPARED_WIRE.slice(1)
    .filter((w) => w.method !== 'notifications/initialized')
    .map((w) => ({ ...w, headers: w.headers.filter(([n]) => n !== 'mcp-protocol-version') }));
  assert.deepEqual(stripped, golden.wire);
});

test('criterion 1: one notifications/initialized follows each initialize, with no id, the session and the agreed version', () => {
  const wire = COMPARED_WIRE.slice(1);
  const inits = wire.map((w, i) => [w, i] as const).filter(([w]) => w.method === 'initialize');
  assert.ok(inits.length >= 2, 'premise: the session expiry did not start a second session');
  for (const [, i] of inits) {
    const next = wire[i + 1];
    assert.equal(next?.method, 'notifications/initialized', `after initialize came ${next?.method}`);
    assert.equal(next.body, '{"jsonrpc":"2.0","method":"notifications/initialized"}');
    assert.match(headerOf(next, 'mcp-session-id') ?? '', /^legacy-session-\d+$/);
    assert.equal(headerOf(next, 'mcp-protocol-version'), '2024-11-05');
  }
  assert.equal(wire.filter((w) => w.method === 'notifications/initialized').length, inits.length);
});

test('criterion 1: MCP-Protocol-Version is on every request after initialize, and on neither initialize nor anything before it', () => {
  const wire = COMPARED_WIRE.slice(1);
  for (const w of wire) {
    if (w.method === 'initialize') assert.equal(headerOf(w, 'mcp-protocol-version'), undefined, 'initialize carried a version header');
    else assert.equal(headerOf(w, 'mcp-protocol-version'), '2024-11-05', `${w.method} carried ${headerOf(w, 'mcp-protocol-version')}`);
  }
});

test('D6: every returned string, and every thrown error\'s class and message, equals base\'s', () => {
  assert.deepEqual(OUTCOMES, golden.outcomes);
});

test('D4: the instructions of a legacy server are initialize\'s', () => {
  assert.equal(OUTCOMES[0].value, LEGACY_INSTRUCTIONS);
});

// --- Criterion 5, legacy: the 404 after a session (#467) ------------------------------

test('#467: a 404 to a request that carried a session starts one new session and sends the request once more', () => {
  assert.equal(EXPIRE_404.value, ROWS, `the call after the 404 did not recover: ${JSON.stringify(EXPIRE_404)}`);
  assert.equal(afterExpiry404 - beforeExpiry404, 1, 'initialize count');
  assert.equal(sentTo('expire-404'), 2);
});

test('#467: a 404 that persists is re-initialized once and sent twice, then thrown as today', () => {
  assert.equal(afterAlways404 - beforeAlways404, 1, 'initialize count');
  assert.equal(sentTo('always-404'), 2);
  assert.equal(ALWAYS_404.message, 'MCP server "socrata" error: 404 Not Found');
});

test('D5: the retry reads the status, never the words — a 502 whose reason phrase says "session 400" is sent once', () => {
  assert.equal(sentTo('decoy-502'), 1);
  assert.equal(afterDecoy - beforeDecoy, 0);
  assert.equal(DECOY.message, 'MCP server "socrata" error: 502 session 400');
});

test('#467, a regression pin: a 404 with no session in play is not retried', () => {
  assert.equal(statelessWire.filter((w) => w.method === 'initialize').length, 1);
  assert.equal(statelessWire.filter((w) => w.method === 'tools/call').length, 1);
  assert.equal(STATELESS_404.message, 'MCP server "boston-opencontext" error: 404 Not Found');
});

// --- Criterion 4: the 200 trap ---------------------------------------------------------

test('criterion 4: a server that answers the probe 200 with a tool result is legacy, and sees initialize', () => {
  const methods = trapWire.map((w) => w.method);
  assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
  assert.equal(TRAP.value, 'Trap fixture rows.');
  assert.equal(TRAP_AGAIN.value, 'Trap fixture rows.');
  const calls = trapWire.filter((w) => w.method === 'tools/call');
  for (const w of calls) {
    assert.equal(headerOf(w, 'mcp-protocol-version'), '2024-11-05');
    assert.equal(headerOf(w, 'mcp-method'), undefined, 'a legacy request carried the modern Mcp-Method header');
    assert.ok(!w.body.includes('io.modelcontextprotocol/'), 'a legacy request carried modern _meta');
  }
});
