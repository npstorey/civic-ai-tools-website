// R7 WF, criterion F1 (#617, G7 F1): a call against a session this process
// has seen ready, whose bridge has since died.
//
// THE DEFECT AT 931fa48. `/health` is checked only for a session the process
// has not seen ready (`lifecycle.ts:386-389`); the idle window restarts before
// the exchange, whatever its outcome (`:390`); and the bridge is started only
// from `onCreate` and `onResume`. So a bridge that dies inside a running
// session is never restarted, every call against it fails, and each of those
// calls extends the session, which therefore never idles out.
//
// WHAT IS DRIVEN. The REAL client (`callMcpTool`) and the REAL lifecycle and
// address modules, with the sandbox SDK replaced by a scripted one (the shape
// `hosted-call-driven.test.ts` uses) and the bridge by a scripted modern MCP
// server on loopback that checks the token. "The bridge died" is its server
// closed, with every connection, at the address the session still states.
// "The bridge restarted" is the scripted handle's detached `runCommand`
// listening again on that same port and printing the ready line, as the real
// bridge does once it listens.
//
// THE THREE SHAPES:
//   - recovery: the dead bridge is restarted once and the call answers; no
//     sandbox is deleted and no second wake is asked for;
//   - no recovery (the restart cannot bring the bridge up): the call fails
//     `unavailable` and the idle window is NOT restarted, so the session
//     stops by itself;
//   - a live bridge whose call fails for the source's own reason: no restart
//     is attempted, so a second bridge is never started beside a live one.
//
// EXPECTED AT 931fa48: the recovery test fails at the call's answer (the call
// rejects); the no-recovery test fails at the idle-window assertion or the
// error's kind; the live-bridge guard passes (no restart code exists to
// misfire).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';

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
const STUB_URL = 'file:///r7-wf-f1-stub/vercel-sandbox.mjs';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@vercel/sandbox') return { url: STUB_URL, format: 'module', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === STUB_URL) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export const Sandbox = { getOrCreate: (params) => globalThis.__r7wfSdk.getOrCreate(params) };
                 export class APIError extends Error {}`,
      };
    }
    return nextLoad(url, context);
  },
});

// --- Scripted bridges -----------------------------------------------------------------

const SECRET = 'r7-wf-f1-test-secret-not-a-real-one';
const NAME = 'civic-src-local-nyc_charter__0_3_1';
const TOKEN = createHmac('sha256', SECRET).update(NAME, 'utf8').digest('hex');
const CHARTER_TEXT = '[CHARTER] § 259 — Section 259. Independent budget office.';

interface Bridge { server: http.Server; seen: string[] }

/** A modern MCP bridge on `port` (0: any). `failCalls`: alive, but every tools/call answers 500. */
async function startBridge(port: number, options: { failCalls?: boolean } = {}): Promise<Bridge & { port: number; origin: string }> {
  const seen: string[] = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
    seen.push(req.url === '/health' ? 'health' : String(msg.method));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
    const reply = (payload: Record<string, unknown>) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, ...payload }));
    };
    if (msg.method === 'server/discover') return reply({ result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } });
    if (msg.method === 'tools/call') {
      if (options.failCalls) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"bridge error"}'); return; }
      return reply({ result: { content: [{ type: 'text', text: CHARTER_TEXT }] } });
    }
    reply({ error: { code: -32601, message: 'Method not found' } });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  server.unref();
  const bound = (server.address() as AddressInfo).port;
  return { server, seen, port: bound, origin: `http://127.0.0.1:${bound}` };
}

async function kill(bridge: Bridge): Promise<void> {
  const closed = new Promise<void>((resolve) => bridge.server.close(() => resolve()));
  bridge.server.closeAllConnections?.();
  await closed;
}

// --- The scripted sandbox SDK ------------------------------------------------------------

interface Session { origin: string; sessionId: string; expiresInMs: number }
type Wake = 'create' | 'resume' | 'running';
/** What the scripted handle does when the lifecycle starts the bridge detached. */
type OnStart = () => Promise<{ ready: boolean }>;

const sdk = {
  getOrCreateCalls: 0,
  extendCalls: [] as number[],
  deleteCalls: 0,
  detachedStarts: 0,
  next: (async () => { throw new Error('no session scripted'); }) as () => Promise<{ session: Session; wake: Wake }>,
  onStart: (async () => ({ ready: true })) as OnStart,
  handle(session: Session) {
    return {
      name: NAME,
      domain: () => session.origin,
      currentSession: () => ({ sessionId: session.sessionId }),
      expiresAt: new Date(Date.now() + session.expiresInMs),
      extendTimeout: async (ms: number) => { sdk.extendCalls.push(ms); },
      writeFiles: async () => {},
      update: async () => {},
      delete: async () => { sdk.deleteCalls += 1; },
      runCommand: async (params: { detached?: boolean }) => {
        if (!params.detached) return { exitCode: 0, stdout: async () => '', stderr: async () => '' };
        sdk.detachedStarts += 1;
        const { ready } = await sdk.onStart();
        return {
          logs: async function* () {
            if (ready) yield { stream: 'stdout', data: 'BRIDGE_READY {}' };
          },
        };
      },
    };
  },
  async getOrCreate(params: { onCreate?: (h: unknown) => Promise<void>; onResume?: (h: unknown) => Promise<void> }) {
    const { session, wake } = await sdk.next();
    sdk.getOrCreateCalls += 1;
    const handle = sdk.handle(session);
    if (wake === 'create') await params.onCreate?.(handle);
    if (wake === 'resume') await params.onResume?.(handle);
    return handle;
  },
};
(globalThis as unknown as { __r7wfSdk: typeof sdk }).__r7wfSdk = sdk;

// --- Environment, before the client's registry is built -------------------------------------

delete process.env.VERCEL_ENV;
delete process.env.VERCEL_TOKEN;
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.SOURCE_BRIDGE_SECRET = SECRET;
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:9/never';

const { callMcpTool } = await import('../client.ts');
const { DEFAULT_IDLE_WINDOW_MS } = await import('./lifecycle.ts');

/** A session with four minutes left of its window: an extend would be called (it lacks six). */
const LACKING_SIX_MINUTES = 4 * 60_000;

/** Make `sessionId` one this process has seen ready: a created session's first call answers. */
async function sessionSeenReady(sessionId: string, options: { failCalls?: boolean } = {}) {
  const bridge = await startBridge(0, options);
  sdk.next = async () => ({ session: { origin: bridge.origin, sessionId, expiresInMs: DEFAULT_IDLE_WINDOW_MS }, wake: 'create' });
  sdk.onStart = async () => ({ ready: true });
  if (!options.failCalls) {
    assert.equal(await callMcpTool('nyc_charter__get_section', { citation: '§ 259' }), CHARTER_TEXT, 'premise: the first call answered');
  } else {
    await callMcpTool('nyc_charter__get_section', { citation: '§ 259' }).catch(() => undefined);
  }
  assert.equal(sdk.detachedStarts > 0, true, 'premise: the created session started its bridge');
  return bridge;
}

function counters() {
  return { getOrCreate: sdk.getOrCreateCalls, extend: sdk.extendCalls.length, deletes: sdk.deleteCalls, starts: sdk.detachedStarts };
}

async function outcome(promise: Promise<string>): Promise<{ text?: string; error?: unknown }> {
  return promise.then((text) => ({ text }), (error: unknown) => ({ error }));
}

test('F1 recovery: a dead bridge in a session this process saw ready is restarted once, and the call answers', async () => {
  const bridge = await sessionSeenReady('f1-recover');
  await kill(bridge);
  let restarted: Bridge | undefined;
  sdk.next = async () => ({ session: { origin: bridge.origin, sessionId: 'f1-recover', expiresInMs: LACKING_SIX_MINUTES }, wake: 'running' });
  sdk.onStart = async () => {
    restarted = await startBridge(bridge.port);
    return { ready: true };
  };
  const before = counters();
  const result = await outcome(callMcpTool('nyc_charter__get_section', { citation: '§ 259' }));
  const after = counters();
  assert.equal(
    result.text,
    CHARTER_TEXT,
    `the call against a dead bridge did not recover (it failed: ${result.error instanceof Error ? `${result.error.name}: ${result.error.message}` : String(result.error)})`,
  );
  assert.equal(after.starts - before.starts, 1, 'the bridge was not started exactly once');
  assert.equal(after.deletes - before.deletes, 0, 'a sandbox was deleted');
  assert.equal(after.getOrCreate - before.getOrCreate, 1, 'the recovery asked for a second wake');
  assert.ok(restarted?.seen.includes('tools/call'), 'the restarted bridge saw no tools/call');
});

test('F1 no recovery: when the restart cannot bring the bridge up, the call fails unavailable and the idle window is not restarted', async () => {
  const bridge = await sessionSeenReady('f1-stays-dead');
  await kill(bridge);
  sdk.next = async () => ({ session: { origin: bridge.origin, sessionId: 'f1-stays-dead', expiresInMs: LACKING_SIX_MINUTES }, wake: 'running' });
  sdk.onStart = async () => ({ ready: false });
  const before = counters();
  const result = await outcome(callMcpTool('nyc_charter__get_section', { citation: '§ 259' }));
  const after = counters();
  assert.equal(result.text, undefined, 'premise: a call against a bridge that never came back answered');
  assert.equal(after.extend - before.extend, 0, 'a call that reached no bridge restarted the idle window, so the dead session never stops');
  assert.equal(
    (result.error as { code?: string } | undefined)?.code,
    'mcp_unavailable',
    `the call did not fail as the source being unavailable (it failed: ${result.error instanceof Error ? result.error.name : String(result.error)})`,
  );
  assert.equal(after.deletes - before.deletes, 0, 'a sandbox was deleted');
});

test('F1 guard: a live bridge whose call fails for the source\'s own reason is not restarted beside itself', async () => {
  const bridge = await sessionSeenReady('f1-alive', { failCalls: true });
  sdk.next = async () => ({ session: { origin: bridge.origin, sessionId: 'f1-alive', expiresInMs: LACKING_SIX_MINUTES }, wake: 'running' });
  sdk.onStart = async () => { throw new Error('a second bridge was started beside a live one'); };
  const before = counters();
  const result = await outcome(callMcpTool('nyc_charter__get_section', { citation: '§ 259' }));
  const after = counters();
  assert.equal(result.text, undefined, 'premise: the source failed the call');
  assert.equal(after.starts - before.starts, 0, 'a bridge was started while the bridge was alive');
  assert.equal(after.deletes - before.deletes, 0, 'a sandbox was deleted');
});
