// #617 P3 — a call to a hosted source, driven through the REAL client
// (`callMcpTool`), the REAL lifecycle and address modules, and the REAL loop
// core, with the sandbox SDK replaced by a scripted one and the bridge by a
// scripted modern MCP server on loopback.
//
// WHAT EACH CRITERION IS MADE TO FACE:
//   - 3, the routing: a hosted name resolves through the registry's hosted map
//     (not `servers`), and the request reaches the address the handle states,
//     at `/mcp`, carrying `Authorization: Bearer <HMAC of the sandbox name>`;
//     the client finds the bridge modern.
//   - 6, the address: the second call's handle states a DIFFERENT address (a
//     resume into a new session), and the first address is then dead — closed,
//     so a client that kept it fails instead of passing by luck.
//   - 8, honest failure: three ways the source can be unreachable — the bridge
//     refuses the token (401: a rotated or wrong secret), the platform refuses
//     the wake, and a wake that never finishes (its own deadline, 60 ms here) —
//     each recorded `unavailable`, told to the model as the source being
//     unavailable, and told to the reader as "could not be reached", never as
//     data that came back empty.
//   - concurrency inside one process: two simultaneous first calls make ONE
//     `getOrCreate` call (the cross-process case is measured live; see the
//     phase record).
//   - the idle window restarts without growing: `extendTimeout` receives what
//     the session lacks of one window, and is not called when it lacks little.
//   - no secret in the log: every console line the run printed is searched for
//     the token and the secret.
//
// RED on the commit before the host (#617 P3's red commit): the registry has
// no hosted map and the hosting modules are stubs, so every hosted call is
// refused or throws, and the call reaches no server.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/hosting/hosted-call-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import type OpenAI from 'openai';

// --- Console capture (criterion 7, the local half) ---------------------------

const printed: string[] = [];
for (const level of ['log', 'warn', 'error', 'info'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    printed.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    original(...args);
  };
}

// --- The scripted sandbox SDK ------------------------------------------------

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
const STUB_URL = 'file:///r7-p3-stub/vercel-sandbox.mjs';
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
        source: `export const Sandbox = { getOrCreate: (params) => globalThis.__r7p3Sdk.getOrCreate(params) };
                 export class APIError extends Error {}`,
      };
    }
    return nextLoad(url, context);
  },
});

/** One scripted sandbox session: its address, its session id, its expiry. */
interface Session { origin: string; sessionId: string; expiresInMs: number }
interface SdkCall { name: string; wake: 'create' | 'resume' | 'running' }
const sdk = {
  calls: [] as SdkCall[],
  extendCalls: [] as number[],
  /** What the next `getOrCreate` does. */
  next: (async () => {
    throw new Error('no session scripted');
  }) as (params: Record<string, unknown>) => Promise<{ session: Session; wake: SdkCall['wake'] }>,
  /** A handle as the lifecycle uses it. Commands succeed; the bridge prints its ready line. */
  handle(session: Session) {
    return {
      name: 'scripted',
      domain: (port: number) => {
        assert.equal(port, 8080, 'the lifecycle asks for the bridge port');
        return session.origin;
      },
      currentSession: () => ({ sessionId: session.sessionId }),
      expiresAt: new Date(Date.now() + session.expiresInMs),
      extendTimeout: async (ms: number) => { sdk.extendCalls.push(ms); },
      writeFiles: async () => {},
      update: async () => {},
      delete: async () => {},
      runCommand: async (params: { detached?: boolean }) => params.detached
        ? { logs: async function* () { yield { stream: 'stdout', data: 'BRIDGE_READY {}' }; } }
        : { exitCode: 0, stdout: async () => '', stderr: async () => '' },
    };
  },
  async getOrCreate(params: Record<string, unknown> & { name: string; onCreate?: (h: unknown) => Promise<void>; onResume?: (h: unknown) => Promise<void> }) {
    const { session, wake } = await sdk.next(params);
    sdk.calls.push({ name: params.name, wake });
    const handle = sdk.handle(session);
    if (wake === 'create') await params.onCreate?.(handle);
    if (wake === 'resume') await params.onResume?.(handle);
    return handle;
  },
};
(globalThis as unknown as { __r7p3Sdk: typeof sdk }).__r7p3Sdk = sdk;

// --- Scripted bridges: a modern MCP server that checks the token ------------

const SECRET = 'r7-p3-test-secret-not-a-real-one';
const NAME = 'civic-src-local-nyc_charter__0_3_1';
const TOKEN = createHmac('sha256', SECRET).update(NAME, 'utf8').digest('hex');
const CHARTER_TEXT = '[CHARTER] § 259 — Section 259. Independent budget office.';

interface Seen { path: string; method: string; authorization: string | undefined }
function bridge(options: { refuseToken?: boolean } = {}) {
  const seen: Seen[] = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
    seen.push({ path: req.url ?? '', method: String(msg.method ?? req.method), authorization: req.headers.authorization });
    if (options.refuseToken || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
    const reply = (payload: Record<string, unknown>) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, ...payload }));
    };
    if (msg.method === 'server/discover') return reply({ result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } });
    if (msg.method === 'tools/call') return reply({ result: { content: [{ type: 'text', text: CHARTER_TEXT }] } });
    reply({ error: { code: -32601, message: 'Method not found' } });
  });
  return { server, seen };
}
async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  server.unref();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// --- Environment, before the client's registry is built ----------------------

delete process.env.VERCEL_ENV;
delete process.env.VERCEL_TOKEN;
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.SOURCE_BRIDGE_SECRET = SECRET;
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:9/never';

const { callMcpTool } = await import('../client.ts');
const { buildMcpRegistry, readMcpEnvFromProcess, routeToolCall, routedSourceId, isHostedServer } = await import('../registry.ts');
const { wakeHostedSource, HostedSourceUnavailableError, DEFAULT_IDLE_WINDOW_MS } = await import('./lifecycle.ts');
const { runToolLoop } = await import('../../model-loop/run-tool-loop.ts');
const { describeToolFailureForLlm } = await import('../../streaming.ts');
const { describeQueryOutcome } = await import('../../evidence/query-step.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../../evidence/trace.ts');

const FIRST = bridge();
const SECOND = bridge();
const FIRST_ORIGIN = await listen(FIRST.server);
const SECOND_ORIGIN = await listen(SECOND.server);

// --- Criterion 3: the routing --------------------------------------------------

test('criterion 3: a hosted name routes through the hosted map, never through `servers`', () => {
  const registry = buildMcpRegistry(readMcpEnvFromProcess());
  assert.equal(registry.servers['nyc-charter'], undefined, 'a hosted source is in `servers`, where forgetEra and the instructions fetch read');
  assert.ok(registry.hosted['nyc-charter'], 'the registry holds no hosted map entry for nyc-charter');
  for (const server of Object.values(registry.servers)) {
    assert.doesNotThrow(() => new URL(server.endpointUrl), `${server.sourceId}'s endpoint does not parse: forgetEra would throw`);
  }
  const routed = routeToolCall(registry, 'nyc_charter__get_section');
  assert.ok(isHostedServer(routed.server), 'the routed server is not the hosted entry');
  assert.equal(routed.upstreamName, 'get_section');
  assert.equal(routed.server.serverId, '@betanyc/nyc-charter-laws-rules@https://github.com/BetaNYC/nyc-charter-laws-rules');
  assert.equal(routedSourceId('nyc_charter__get_section', readMcpEnvFromProcess()), 'nyc-charter', 'the trace would attribute the call to no source');
  assert.equal(registry.unconfiguredTools['nyc_charter__get_section'], undefined, 'the switch is on and the tool is still refused');
});

test('criterion 3: callMcpTool reaches the address the handle states, at /mcp, with the bridge token, in the modern era', async () => {
  sdk.next = async () => ({ session: { origin: FIRST_ORIGIN, sessionId: 's1', expiresInMs: DEFAULT_IDLE_WINDOW_MS }, wake: 'create' });
  const text = await callMcpTool('nyc_charter__get_section', { citation: '§ 259', corpus: 'charter' });
  assert.equal(text, CHARTER_TEXT);
  assert.deepEqual(sdk.calls.at(-1), { name: NAME, wake: 'create' }, 'the sandbox was not asked for by its name');
  const call = FIRST.seen.find((s) => s.method === 'tools/call');
  assert.ok(call, 'the bridge saw no tools/call');
  assert.equal(call!.path, '/mcp');
  assert.equal(call!.authorization, `Bearer ${TOKEN}`);
  assert.equal(FIRST.seen[0]?.method, 'server/discover', 'the client did not probe the bridge first');
  assert.ok(printed.some((line) => line.includes('[MCP:nyc-charter] Protocol era: modern (2026-07-28)')), 'the client did not find the bridge modern');
});

// --- Criterion 6: the address is never kept ---------------------------------------

test('criterion 6: after a resume whose address differs, the stale address is never reused', async () => {
  await new Promise<void>((resolve) => FIRST.server.close(() => resolve()));
  FIRST.server.closeAllConnections?.();
  const before = FIRST.seen.length;
  sdk.next = async () => ({ session: { origin: SECOND_ORIGIN, sessionId: 's2', expiresInMs: DEFAULT_IDLE_WINDOW_MS }, wake: 'resume' });
  const text = await callMcpTool('nyc_charter__get_section', { citation: '§ 259', corpus: 'charter' });
  assert.equal(text, CHARTER_TEXT, 'the call after the resume did not answer');
  assert.equal(FIRST.seen.length, before, 'a request went to the first session\'s address after the resume');
  assert.ok(SECOND.seen.some((s) => s.method === 'tools/call' && s.authorization === `Bearer ${TOKEN}`), 'the new address saw no tools/call');
});

// --- Concurrency inside one process, and the idle window ---------------------------

test('two simultaneous calls share one wake: one getOrCreate', async () => {
  const count = sdk.calls.length;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  sdk.next = async () => { await gate; return { session: { origin: SECOND_ORIGIN, sessionId: 's2', expiresInMs: DEFAULT_IDLE_WINDOW_MS }, wake: 'running' }; };
  const both = Promise.all([
    callMcpTool('nyc_charter__get_version', {}),
    callMcpTool('nyc_charter__get_version', {}),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const answers = await both;
  assert.deepEqual(answers, [CHARTER_TEXT, CHARTER_TEXT]);
  assert.equal(sdk.calls.length - count, 1, 'two concurrent first calls made two getOrCreate calls');
});

test('the idle window restarts without growing: extend by what the session lacks, and only past the slack', async () => {
  sdk.extendCalls.length = 0;
  sdk.next = async () => ({ session: { origin: SECOND_ORIGIN, sessionId: 's2', expiresInMs: DEFAULT_IDLE_WINDOW_MS - 30_000 }, wake: 'running' });
  await callMcpTool('nyc_charter__get_version', {});
  assert.deepEqual(sdk.extendCalls, [], 'a session lacking 30 s of its window was extended');
  sdk.next = async () => ({ session: { origin: SECOND_ORIGIN, sessionId: 's2', expiresInMs: 4 * 60_000 }, wake: 'running' });
  await callMcpTool('nyc_charter__get_version', {});
  assert.equal(sdk.extendCalls.length, 1);
  const lacking = sdk.extendCalls[0];
  // The handle's expiry was fixed when the scripted session was made, a few ms
  // before the lifecycle read it, so what it lacks is six minutes plus that.
  assert.ok(lacking >= 6 * 60_000 && lacking < 6 * 60_000 + 1_000, `extended by ${lacking} ms; the session lacked 6 minutes of its window`);
});

// --- Criterion 8: honest failure -------------------------------------------------------

function stubModel(toolName: string): { client: OpenAI; sent: Array<{ role: string; content?: unknown }[]> } {
  const sent: Array<{ role: string; content?: unknown }[]> = [];
  let served = 0;
  const client = {
    chat: {
      completions: {
        create: async (body: { messages: Array<{ role: string; content?: unknown }> }) => {
          sent.push(body.messages.map((m) => ({ ...m })));
          const first = served++ === 0;
          return {
            id: 'chatcmpl-r7-p3', object: 'chat.completion', created: 1, model: 'fake/model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: first ? null : 'The charter text could not be retrieved.',
                ...(first ? { tool_calls: [{ id: 'c1', type: 'function', function: { name: toolName, arguments: JSON.stringify({ citation: '§ 259' }) } }] } : {}),
              },
              finish_reason: first ? 'tool_calls' : 'stop',
            }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as unknown as OpenAI;
  return { client, sent };
}

async function failedRun(label: string) {
  const { client, sent } = stubModel('nyc_charter__get_section');
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const result = await runToolLoop({
    client,
    endpointModel: 'fake/model',
    requestSettings: undefined,
    prompt: 'What does section 259 of the charter say?',
    systemPrompt: 'Fixture.',
    tools: [],
    executeToolCall: (name, args) => callMcpTool(name, args),
    trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: (name) => routedSourceId(name, readMcpEnvFromProcess()) },
  });
  builder.endRoot({});
  const call = result.toolCalls[0] as { failed?: boolean; failureKind?: string; name: string };
  assert.ok(call, `${label}: the loop recorded no call`);
  const toolMessage = sent[1]?.find((m) => m.role === 'tool');
  const trace = JSON.stringify(builder.finalize());
  return { call, toolMessage, trace };
}

const UNAVAILABLE_FOR_MODEL = describeToolFailureForLlm('nyc_charter__get_section', { code: 'mcp_unavailable' });

for (const [label, script] of [
  ['the bridge refuses the token (401)', async () => {
    const refusing = bridge({ refuseToken: true });
    const origin = await listen(refusing.server);
    sdk.next = async () => ({ session: { origin, sessionId: 's-401', expiresInMs: DEFAULT_IDLE_WINDOW_MS }, wake: 'resume' });
  }],
  ['the platform refuses the wake', async () => {
    sdk.next = async () => { throw Object.assign(new Error('Status code 500 is not ok'), { status: 500 }); };
  }],
] as const) {
  test(`criterion 8: ${label} — recorded unavailable, the model told so, the reader told it could not be reached`, async () => {
    await script();
    const { call, toolMessage, trace } = await failedRun(label);
    assert.equal(call.failed, true, 'the call is recorded as answered');
    assert.equal(call.failureKind, 'unavailable');
    assert.equal(toolMessage?.content, UNAVAILABLE_FOR_MODEL, 'the model was not told the source is unavailable');
    const reader = describeQueryOutcome({ failed: true, failureKind: call.failureKind as 'unavailable' }).text;
    assert.match(reader, /could not be reached/);
    assert.doesNotMatch(reader, /empty|no results|0 rows/i, 'the reader is told the data came back empty');
    assert.match(trace, /"error\.kind"[^}]*"unavailable"/, 'the trace does not mark the call failed as unavailable');
    assert.ok(!trace.includes(TOKEN) && !trace.includes(SECRET), 'the trace carries the token or the secret');
  });
}

test('the wake has a deadline of its own: a wake that never finishes fails unavailable at the deadline', async () => {
  sdk.next = () => new Promise(() => {});
  const registry = buildMcpRegistry(readMcpEnvFromProcess());
  const started = Date.now();
  await assert.rejects(
    wakeHostedSource(registry.hosted['nyc-charter'], { secret: SECRET, deadlineMs: 60 }),
    (error: unknown) => error instanceof HostedSourceUnavailableError && (error as { code?: string }).code === 'mcp_unavailable',
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 55 && elapsed < 2_000, `the wake failed after ${elapsed} ms, not at its 60 ms deadline`);
});

// --- Criterion 7, the local half: nothing printed carries the token or the secret ---------

test('no line the run printed carries the token or the secret', () => {
  assert.ok(printed.length > 5, 'premise: the run printed its operator lines');
  const leaked = printed.filter((line) => line.includes(TOKEN) || line.includes(SECRET));
  assert.deepEqual(leaked, []);
  assert.ok(printed.some((line) => line.includes(`sandbox ${NAME}`)), 'premise: the sandbox name is an operator fact in the log');
});
