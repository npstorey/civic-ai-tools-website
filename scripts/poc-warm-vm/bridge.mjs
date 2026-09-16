#!/usr/bin/env node
/**
 * POC MCP-WARM-VM — stdio-to-HTTP bridge.
 *
 * Keeps ONE `@betanyc/nyc-charter-laws-rules` process warm over stdio and
 * exposes it on an HTTP port that speaks enough of MCP Streamable HTTP for
 * this app's hand-written client (src/lib/mcp/client.ts) to drive it:
 *   - POST JSON-RPC in, SSE `event: message\ndata: {...}` out when the
 *     caller's Accept includes text/event-stream (the app always does),
 *     raw JSON otherwise;
 *   - a session id issued on `initialize` via the `mcp-session-id` header
 *     and required on every later request (the STATEFUL dialect, i.e. the
 *     Socrata-shaped path, deliberately — it is the more demanding of the
 *     two the client supports);
 *   - `Authorization: Bearer $BRIDGE_TOKEN` required on EVERY path,
 *     including readiness. There is no unauthenticated route.
 *
 * TWO adaptations the bridge makes, both deliberate, both reportable:
 *
 * 1. REQUEST-ID REWRITING. The app's client stamps `id: Date.now()`
 *    (client.ts), so two calls inside one millisecond carry the SAME id.
 *    Over a single multiplexed stdio pipe that is a response-matching
 *    collision. The bridge assigns its own monotonic id downstream and
 *    restores the caller's original id on the way back.
 *
 * 2. `notifications/initialized`. The app's client sends `initialize` and
 *    never the follow-up notification the MCP lifecycle specifies. The
 *    bridge emits it to the child itself after a successful initialize, so
 *    a child that gates on it is not left half-open.
 *
 * SECRET HYGIENE: the bearer token arrives in BRIDGE_TOKEN and is compared
 * with a length-independent constant-time check. It is never logged, echoed
 * in an error body, or written to the request log.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';

const PORT = Number(process.env.BRIDGE_PORT || 3000);
const TOKEN = process.env.BRIDGE_TOKEN || '';
const SERVER_CMD = process.env.BRIDGE_SERVER_CMD || 'nyc-charter-laws-rules';
const SERVER_ARGS = process.env.BRIDGE_SERVER_ARGS ? JSON.parse(process.env.BRIDGE_SERVER_ARGS) : [];
const CHILD_TIMEOUT_MS = Number(process.env.BRIDGE_CHILD_TIMEOUT_MS || 60_000);
/**
 * The instance alias. THE BRIDGE IS THE ALIAS BOUNDARY: it adds this prefix
 * to every name `tools/list` returns and strips it from `tools/call` on the
 * way upstream, so the app speaks `nyc_charter__get_section` end to end while
 * the upstream server only ever sees its own `get_section`. Keeping this here
 * rather than in the app is what lets src/lib/mcp/client.ts stay untouched.
 */
const TOOL_PREFIX = process.env.BRIDGE_TOOL_PREFIX || '';

if (!TOKEN) {
  console.error('[bridge] FATAL: BRIDGE_TOKEN is empty — refusing to start an unauthenticated port.');
  process.exit(1);
}

/** Constant-time compare that does not leak length through early return. */
function tokenMatches(presented) {
  const a = Buffer.from(String(presented));
  const b = Buffer.from(TOKEN);
  const len = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(len); a.copy(pa);
  const pb = Buffer.alloc(len); b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

// ---------------------------------------------------------------- child ---
let child = null;
let childStartedAt = 0;
let buf = '';
const waiters = new Map();
let downstreamId = 0;

const counters = { requests: 0, unauthorized: 0, badSession: 0, toolCalls: 0, childRestarts: 0 };

function startChild() {
  child = spawn(SERVER_CMD, SERVER_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
  childStartedAt = Date.now();
  buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { console.error('[bridge] non-JSON on child stdout:', line.slice(0, 200)); continue; }
      if (msg.id != null && waiters.has(msg.id)) {
        const w = waiters.get(msg.id);
        waiters.delete(msg.id);
        w.resolve(msg);
      }
    }
  });
  child.stderr.on('data', (d) => console.error('[bridge][child stderr]', d.toString().trimEnd()));
  child.on('exit', (code, signal) => {
    console.error(`[bridge] child exited code=${code} signal=${signal}`);
    for (const w of waiters.values()) w.reject(new Error('child exited'));
    waiters.clear();
    child = null;
  });
  console.error(`[bridge] child started pid=${child.pid} cmd=${SERVER_CMD}`);
}

function ensureChild() {
  if (!child) { counters.childRestarts++; startChild(); }
}

/** Forward one JSON-RPC request to the child under a fresh downstream id. */
function forward(message) {
  ensureChild();
  const originalId = message.id;
  const id = ++downstreamId;
  const wire = { ...message, id };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`child did not answer ${message.method} within ${CHILD_TIMEOUT_MS}ms`));
    }, CHILD_TIMEOUT_MS);
    waiters.set(id, {
      resolve: (msg) => { clearTimeout(timer); resolve({ ...msg, id: originalId }); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    child.stdin.write(JSON.stringify(wire) + '\n');
  });
}

function notifyChild(method, params) {
  ensureChild();
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

// -------------------------------------------------------------- sessions ---
const sessions = new Set();

// ------------------------------------------------------------------ http ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 4_000_000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

/** Frame a JSON-RPC response the way the caller's Accept asks for. */
function sendRpc(res, accept, sessionId, payload) {
  const extra = sessionId ? { 'mcp-session-id': sessionId } : {};
  const json = JSON.stringify(payload);
  if (String(accept || '').includes('text/event-stream')) {
    send(res, 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...extra },
      `event: message\ndata: ${json}\n\n`);
  } else {
    send(res, 200, { 'Content-Type': 'application/json', ...extra }, json);
  }
}

function childRss() {
  if (!child) return null;
  try {
    const status = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8');
    const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) : null;      // kB
  } catch { return null; }               // macOS has no /proc — sandbox is Linux
}

const server = http.createServer(async (req, res) => {
  counters.requests++;
  const url = new URL(req.url, 'http://bridge.local');

  // EVERY path requires the bearer token. No unauthenticated route exists.
  const auth = req.headers['authorization'] || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!tokenMatches(presented)) {
    counters.unauthorized++;
    console.error(`[bridge] 401 ${req.method} ${url.pathname} (no or wrong bearer token)`);
    return send(res, 401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
      JSON.stringify({ error: 'unauthorized', detail: 'Authorization: Bearer <token> required on every path' }));
  }

  if (url.pathname === '/readyz') {
    return send(res, child ? 200 : 503, { 'Content-Type': 'application/json' },
      JSON.stringify({ ready: Boolean(child), childUptimeMs: child ? Date.now() - childStartedAt : 0 }));
  }

  if (url.pathname === '/metrics') {
    const mu = process.memoryUsage();
    return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({
      bridgeRssKb: Math.round(mu.rss / 1024),
      childRssKb: childRss(),
      childPid: child ? child.pid : null,
      childUptimeMs: child ? Date.now() - childStartedAt : 0,
      bridgeUptimeMs: Math.round(process.uptime() * 1000),
      counters,
    }));
  }

  if (url.pathname !== '/mcp' || req.method !== 'POST') {
    return send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'not found' }));
  }

  let message;
  try { message = JSON.parse(await readBody(req)); }
  catch { return send(res, 400, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'invalid JSON body' })); }

  const accept = req.headers['accept'];
  const presentedSession = req.headers['mcp-session-id'] || null;

  if (message.method === 'initialize') {
    let result;
    try { result = await forward(message); }
    catch (e) { return send(res, 502, { 'Content-Type': 'application/json' }, JSON.stringify({ error: String(e.message) })); }
    notifyChild('notifications/initialized', {});
    const sessionId = randomUUID();
    sessions.add(sessionId);
    console.error(`[bridge] initialize -> session ${sessionId}`);
    return sendRpc(res, accept, sessionId, result);
  }

  // Stateful dialect: every non-initialize request must echo a live session.
  if (!presentedSession || !sessions.has(presentedSession)) {
    counters.badSession++;
    return send(res, 400, { 'Content-Type': 'application/json' },
      JSON.stringify({ error: 'invalid or missing mcp-session-id — call initialize first' }));
  }

  // --- alias boundary, inbound: strip the prefix before going upstream ---
  let outbound = message;
  if (message.method === 'tools/call') {
    counters.toolCalls++;
    const called = message?.params?.name;
    if (TOOL_PREFIX && typeof called === 'string') {
      if (!called.startsWith(TOOL_PREFIX)) {
        return send(res, 400, { 'Content-Type': 'application/json' }, JSON.stringify({
          error: `tool "${called}" is not namespaced for this source; expected the "${TOOL_PREFIX}" prefix`,
        }));
      }
      outbound = { ...message, params: { ...message.params, name: called.slice(TOOL_PREFIX.length) } };
    }
  }

  let result;
  try { result = await forward(outbound); }
  catch (e) { return send(res, 502, { 'Content-Type': 'application/json' }, JSON.stringify({ error: String(e.message) })); }

  // --- alias boundary, outbound: re-prefix the advertised tool names ---
  if (message.method === 'tools/list' && TOOL_PREFIX && Array.isArray(result?.result?.tools)) {
    result = {
      ...result,
      result: {
        ...result.result,
        tools: result.result.tools.map((t) => ({ ...t, name: `${TOOL_PREFIX}${t.name}` })),
      },
    };
  }
  return sendRpc(res, accept, presentedSession, result);
});

startChild();
server.listen(PORT, '0.0.0.0', () => {
  console.error(`[bridge] listening on 0.0.0.0:${PORT} (token required on every path)`);
});
