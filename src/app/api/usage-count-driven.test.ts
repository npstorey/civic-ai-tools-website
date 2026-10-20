// R6 W5 (#632), criterion 2: the usage count is written after the answer, and
// never changes it. Driven through the three query routes.
//
// THE RULE. Each route counts a run once, when it ends. It registers the write
// with `after()` while the request is open (before the handler returns), as a
// promise that settles after the write. The write itself starts only after the
// stream's `writer.close()` on `/api/compare-stream` and `/api/query-notebook`,
// and after the JSON response is built on `/api/compare`; never before. The
// registered promise never rejects, the write is bounded (10 s), and a write
// that throws is logged as a class only (`errorLogFacts`). A request refused
// before its run starts (validation, the rate limit) is not counted.
//
// WHAT IS DRIVEN. Each route's real handler, its real stream, the real model
// loop against a loopback model, the real MCP client against a loopback
// Socrata and Data Commons, and the real usage module. STUBS, and why:
// `next/headers`, `next-auth`, `@/lib/auth` (a signed-in session carrying
// canaries, and a canary address); `@/lib/rate-limit` (inert, with a switch to
// refuse); `@/lib/sandbox` (the executor returns the notebook it was given);
// `@/lib/sources/consent-store` (no row); `next/server` (the real module, with
// `after` replaced by a recorder, as Next's own throws outside a request
// scope, and `NextResponse.json` wrapped to record when the response is
// built); and `src/lib/db/index.ts`, by its resolved URL, so any spelling of
// the import reaches it (an insert that records its table, its values and its
// conflict target, and then answers, never settles, or rejects).
//
// THE ORDER is read from one event log: `after()` registrations, the handler's
// return, the close of the writer the route streams through (identified as the
// writer that wrote SSE bytes), the JSON response's construction, and the
// insert's start.
//
// THE RUN'S CALLS. The model calls `socrata__get_data`, which answers, and
// `data_commons__search_indicators`, which the Data Commons fixture refuses:
// so a counter that names called sources rather than answered ones writes
// `data-commons,socrata` and fails. On the failing drives the model refuses
// the answering turn (HTTP 400, which the SDK does not retry), after the
// Socrata call answered: so `sources_used` is still `socrata`, and the outcome
// is `error`. On `/api/compare-stream` the failing drive runs both panels, and
// only the withMcp panel fails, so a counter that took any panel's
// completion as the outcome writes `complete` and fails.
//
// WHAT MAKES IT ABLE TO FAIL. At the base no route registers or writes
// anything: (a) finds no insert and no registration, (b) and (c) find no
// registered promise. (b)'s red against a route that awaits the write before
// `writer.close()` is the mutation the phase report records: its stream does
// not end within the read deadline, which is shorter than the bound.
//
// No live endpoint, no credential: every key is a placeholder and every
// address is loopback.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import util from 'node:util';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
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
const DB_MODULE_URL = pathToFileURL(path.join(SRC, 'lib', 'db', 'index.ts')).href;
const NEXT_SERVER_URL = import.meta.resolve('next/server.js');

/** The bound the contract names; the module's constant is checked in count.test.ts. */
const BOUND_MS = 10_000;
/** How long a stream may take to end once the run has: well under the bound,
 *  so a route that awaited a never-settling write before closing fails here. */
const READ_DEADLINE_MS = 5_000;

const CANARY = {
  question: 'w5 canary question about sidewalk repairs on birch lane',
  accountId: 'w5-canary-account-31c9',
  dbId: '5ca1ab1e-0000-4000-8000-00000000c0de',
  address: '198.51.100.77',
  dbError: 'w5-canary-database-error-text',
} as const;
const FAIL_MARKER = 'w5-refuse-the-answering-turn';
/** A question carrying this is answered 300 ms late each turn, so a reader can leave mid-run. */
const SLOW_MARKER = 'w5-answer-slowly';

// --- The shared state the stubs read and write --------------------------------

type InsertMode = 'ok' | 'hang' | 'throw';
interface Event { kind: 'after' | 'returned' | 'closed' | 'response-built' | 'insert'; detail?: string }
interface InsertRecord { table: unknown; values: unknown; target: unknown }
interface W5State {
  session: unknown;
  limited: boolean;
  insertMode: InsertMode;
  afterMode: 'record' | 'throw';
  events: Event[];
  registered: unknown[];
  inserts: InsertRecord[];
  dbError: string;
}
const globals = globalThis as unknown as { __w5: W5State };
globals.__w5 = {
  session: null,
  limited: false,
  insertMode: 'ok',
  afterMode: 'record',
  events: [],
  registered: [],
  inserts: [],
  dbError: CANARY.dbError,
};
const W5 = globals.__w5;

// --- Unhandled rejections are recorded, not fatal ------------------------------
//
// A route that waited on the write keeps its stream open past the read
// deadline; the reader then cancels it, and the route's own later
// `writer.close()` rejects inside a run nothing awaits. Recorded here, so that
// shape reads as red assertions rather than a crashed file, and asserted empty
// below.
const UNHANDLED: string[] = [];
process.on('unhandledRejection', (reason) => {
  UNHANDLED.push(reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason);
});

// --- The writer the route streams through, and its close ---------------------

const writerIds = new WeakMap<object, number>();
const sseWriters = new Set<number>();
let nextWriterId = 0;
const idOf = (writer: object) => {
  let id = writerIds.get(writer);
  if (id === undefined) { id = nextWriterId++; writerIds.set(writer, id); }
  return id;
};
const sniff = new TextDecoder();
const proto = WritableStreamDefaultWriter.prototype as unknown as {
  write(this: object, chunk?: unknown): Promise<void>;
  close(this: object): Promise<void>;
};
const realWrite = proto.write;
const realClose = proto.close;
proto.write = function write(this: object, chunk?: unknown) {
  if (chunk instanceof Uint8Array && /^(data: |: )/.test(sniff.decode(chunk.subarray(0, 6)))) sseWriters.add(idOf(this));
  return realWrite.call(this, chunk);
};
proto.close = function close(this: object) {
  const id = idOf(this);
  const closing = realClose.call(this);
  // Attached inside close(), so it runs before the caller's own continuation.
  closing.then(() => { if (sseWriters.has(id)) W5.events.push({ kind: 'closed', detail: String(id) }); }, () => {});
  return closing;
};

// --- Module hooks ---------------------------------------------------------------

const STUB_PREFIX = 'file:///r6-w5-usage-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': ${JSON.stringify(`${CANARY.address}, 10.0.0.1`)} }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__w5.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return globalThis.__w5.limited; }
    export async function incrementRateLimit() {}
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook(notebook) {
      return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
  // R6 W3 (#632): the gate is on, and the canary session carries a dbId, so
  // its consent is the account's row: one in force, every source On, against
  // the statement in force at the moment it is read.
  '@/lib/sources/consent-store': `
    import { buildFlowsStatement, statementHash } from '@/lib/flows/statement';
    export async function readConsentRow(userId) {
      const statement = await buildFlowsStatement();
      const states = Object.fromEntries(statement.sources.map((s) => [s.sourceId, { state: 'on', since: '2026-10-20' }]));
      return { userId, states, flowsHash: statementHash(statement), flowsStatement: statement, consentedAt: new Date(), updatedAt: new Date() };
    }
    export async function writeConsentRow() {}
    export async function deleteConsentRow() {}`,
  'next/server': `
    import * as real from ${JSON.stringify(NEXT_SERVER_URL)};
    export * from ${JSON.stringify(NEXT_SERVER_URL)};
    export function after(task) {
      const w5 = globalThis.__w5;
      if (w5.afterMode === 'throw') {
        const error = new Error('\`after\` was called outside a request scope.');
        Object.defineProperty(error, '__NEXT_ERROR_CODE', { value: 'E468', enumerable: false });
        throw error;
      }
      w5.events.push({ kind: 'after', detail: task && typeof task.then === 'function' ? 'promise' : typeof task });
      w5.registered.push(task);
    }
    export const NextResponse = new Proxy(real.NextResponse, {
      get(target, prop, receiver) {
        if (prop === 'json') {
          return (...args) => { const response = target.json(...args); globalThis.__w5.events.push({ kind: 'response-built' }); return response; };
        }
        return Reflect.get(target, prop, receiver);
      },
    });`,
  [DB_MODULE_URL]: `
    const NAME = Symbol.for('drizzle:Name');
    export const db = {
      insert(table) {
        const w5 = globalThis.__w5;
        const record = { table: table ? table[NAME] : undefined, values: undefined, target: undefined };
        w5.inserts.push(record);
        w5.events.push({ kind: 'insert' });
        const settle = () => {
          if (w5.insertMode === 'hang') return new Promise(() => {});
          if (w5.insertMode === 'throw') return Promise.reject(new Error('insert refused: ' + w5.dbError));
          return Promise.resolve([]);
        };
        const chain = {
          values(values) { record.values = values; return chain; },
          onConflictDoUpdate(config) {
            const target = Array.isArray(config && config.target) ? config.target : [config && config.target];
            record.target = target.map((column) => column && column.name);
            return chain;
          },
          onConflictDoNothing() { return chain; },
          then(resolve, reject) { return settle().then(resolve, reject); },
          catch(reject) { return settle().catch(reject); },
        };
        return chain;
      },
    };`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    // `next/server` in either spelling: the routes write it bare, and a module
    // that `node --test` loads without hooks has to name the file.
    const key = specifier === 'next/server.js' ? 'next/server' : specifier;
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, key) && key !== DB_MODULE_URL) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(key)}.mjs`, format: 'module', shortCircuit: true };
    }
    let resolved: ResolveResult | null = null;
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) { resolved = { url: pathToFileURL(candidate).href, shortCircuit: true }; break; }
        } catch { /* next candidate */ }
      }
      if (!resolved) throw new Error(`r6-w5 usage test hook: cannot resolve ${specifier}`);
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (!resolved && specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) { resolved = { url: pathToFileURL(candidate).href, shortCircuit: true }; break; }
      }
    }
    resolved ??= nextResolve(specifier, context);
    // The database client, whichever spelling reached it.
    if (resolved.url === DB_MODULE_URL) return { url: `${STUB_PREFIX}db.mjs`, format: 'module', shortCircuit: true };
    return resolved;
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === `${STUB_PREFIX}db.mjs`) return { format: 'module', source: STUB_SOURCE[DB_MODULE_URL], shortCircuit: true };
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

// R6 W3 (#632): the consent gate is on, so each gated request carries a consent
// in force, built by the real encoder (`consentCookieForTests`).
const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- The loopback MCP sources: Socrata on /socrata/mcp, Data Commons on /dc/mcp

const ONE_ROW = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'r6-w5' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'r6-w5-fixture', version: '0' }, instructions: 'Fixture server instructions.' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (msg.method === 'prompts/get') {
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture skill guidance.' } }] } })}\n\n`);
    return;
  }
  // Data Commons refuses every call: a called source that was never used.
  if ((req.url ?? '').startsWith('/dc/')) {
    res.end(`event: message\ndata: ${reply({ result: { isError: true, content: [{ type: 'text', text: 'fixture refusal' }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// --- The loopback model --------------------------------------------------------
//
// A request that offers tools and carries no tool result yet is answered with
// the two calls. A request that carries a tool result, for a question with the
// failure marker, is refused with a 400. Anything else gets a plain answer. A
// question with the slow marker is answered 300 ms late, every turn.

const ANSWER = 'One figure was retrieved.';
const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const messages = (body.messages ?? []) as Array<{ role?: string; content?: unknown }>;
    if (JSON.stringify(messages).includes(SLOW_MARKER)) setTimeout(answer, 300);
    else answer();
    function answer() {
      const afterTools = messages.some((m) => m.role === 'tool');
      const failing = JSON.stringify(messages).includes(FAIL_MARKER);
      if (failing && afterTools) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'fixture refusal of the answering turn', type: 'invalid_request_error' } }));
        return;
      }
      const pickTools = Array.isArray(body.tools) && body.tools.length > 0 && !afterTools;
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      if (body.stream === true) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frame = (payload: Record<string, unknown>) =>
          `data: ${JSON.stringify({ id: 'chatcmpl-r6-w5', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
        res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
        res.write(frame({ choices: [], usage }));
        res.end('data: [DONE]\n\n');
        return;
      }
      const toolCalls = [
        { id: 'call-socrata', type: 'function', function: { name: 'socrata__get_data', arguments: JSON.stringify({ type: 'query', dataset_id: 'aaaa-1111', limit: 1 }) } },
        { id: 'call-dc', type: 'function', function: { name: 'data_commons__search_indicators', arguments: JSON.stringify({ query: 'sidewalk repairs' }) } },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-r6-w5',
        object: 'chat.completion',
        created: 1,
        model: 'fake/model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: pickTools ? null : ANSWER, ...(pickTools ? { tool_calls: toolCalls } : {}) },
          finish_reason: pickTools ? 'tool_calls' : 'stop',
        }],
        usage,
      }));
    }
  });
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Environment, set before any app module loads -----------------------------

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL',
  'MODEL_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'VERCEL_ENV', 'DATABASE_URL', 'DB_DRIVER', 'EXECUTOR_DRIVER',
]) {
  delete process.env[name];
}
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-r6-w5';
process.env.MODEL_API_BASE_URL = `${MODEL_ORIGIN}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  {
    id: 'fixture-fast',
    name: 'Fixture Model',
    provider: 'Example Provider',
    supports_tools: true,
    endpointModel: 'example-fixture-deployment',
    model: 'vendor/model-fixture-1',
    default: true,
    evaluator: 1,
  },
]);

const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
_resetDefaultModelClientForTests();
const { errorLogFacts } = await import('../../lib/streaming.ts');

const notebookRoute = await import('./query-notebook/route.ts');
const compareStreamRoute = await import('./compare-stream/route.ts');
const compareRoute = await import('./compare/route.ts');

// --- Drives ---------------------------------------------------------------------

type Surface = 'compare-stream' | 'query-notebook' | 'compare';
const SIGNED_IN = { user: { id: CANARY.accountId, dbId: CANARY.dbId, name: 'Canary Reader' }, expires: '2026-11-18T00:00:00.000Z' };

const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: consentCookieForTests() }, body: JSON.stringify(body) }) as never;

function request(surface: Surface, opts: { fail?: boolean; bothPanels?: boolean; refuse?: 'invalid'; slow?: boolean } = {}): () => Promise<Response> {
  const query = `${CANARY.question}${opts.fail ? ` ${FAIL_MARKER}` : ''}${opts.slow ? ` ${SLOW_MARKER}` : ''}`;
  const invalid = opts.refuse === 'invalid';
  switch (surface) {
    case 'compare-stream':
      return () => compareStreamRoute.POST(post('/api/compare-stream', invalid ? { model: 'fixture-fast' } : { query, model: 'fixture-fast', portal: 'data.example.org', mcpOnly: !opts.bothPanels }));
    case 'query-notebook':
      return () => notebookRoute.POST(post('/api/query-notebook', invalid ? { portal: 'data.example.org' } : { query, portal: 'data.example.org' }));
    case 'compare':
      return () => compareRoute.POST(post('/api/compare', invalid ? { model: 'fixture-fast' } : { query, model: 'fixture-fast', portal: 'data.example.org' }));
  }
}

interface Drive {
  surface: Surface;
  status: number;
  body: string;
  ended: boolean;
  events: Event[];
  inserts: InsertRecord[];
  registered: unknown[];
  lines: string[];
  /** ms from the insert's start to the registered promise's settling; null when nothing settled. */
  settledAfterMs: number | null;
  rejected: boolean;
}

/** Read a body to its end, or give up at the deadline. */
async function readBody(response: Response): Promise<{ body: string; ended: boolean }> {
  if (!response.body) return { body: '', ended: true };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  const deadline = Date.now() + READ_DEADLINE_MS;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) { void reader.cancel().catch(() => {}); return { body, ended: false }; }
    let timer: NodeJS.Timeout | undefined;
    const next = await Promise.race([
      reader.read(),
      new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), left); }),
    ]);
    clearTimeout(timer);
    if (next === 'timeout') { void reader.cancel().catch(() => {}); return { body, ended: false }; }
    if (next.done) return { body, ended: true };
    body += decoder.decode(next.value, { stream: true });
  }
}

/** Drive one request with the shared state set; one drive at a time. */
async function drive(surface: Surface, opts: Parameters<typeof request>[1] & { insertMode?: InsertMode; afterMode?: 'record' | 'throw'; session?: unknown; limited?: boolean } = {}): Promise<Drive> {
  W5.events = [];
  W5.registered = [];
  W5.inserts = [];
  W5.insertMode = opts.insertMode ?? 'ok';
  W5.afterMode = opts.afterMode ?? 'record';
  W5.session = opts.session === undefined ? SIGNED_IN : opts.session;
  W5.limited = opts.limited ?? false;
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(util.format(...args)); };
  try {
    const response = await request(surface, opts)();
    W5.events.push({ kind: 'returned' });
    const { body, ended } = await readBody(response);
    const registered = [...W5.registered];
    const events = W5.events;
    const inserts = W5.inserts;
    // Wait for the registered promise (or, unregistered, for the write) within the bound and a margin.
    let settledAfterMs: number | null = null;
    let rejected = false;
    const watchdog = BOUND_MS + 3_000;
    const startedAt = Date.now();
    if (registered.length > 0) {
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        Promise.all(registered.map((p) => Promise.resolve(p))).then(() => 'resolved' as const, () => 'rejected' as const),
        new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), watchdog); }),
      ]);
      clearTimeout(timer);
      if (outcome !== 'pending') settledAfterMs = Date.now() - startedAt;
      rejected = outcome === 'rejected';
    } else {
      // Unregistered: give a write that runs anyway a moment to start and log.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return { surface, status: response.status, body, ended, events, inserts, registered, lines, settledAfterMs, rejected };
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function expectedRow(surface: Surface, outcome: 'complete' | 'error') {
  return {
    environment: 'local',
    surface,
    signedIn: true,
    model: 'vendor/model-fixture-1',
    outcome,
    sourcesOffered: 'data-commons,socrata',
    sourcesUsed: 'socrata',
    count: 1,
  };
}

const KEY_COLUMNS = ['day', 'environment', 'surface', 'signed_in', 'model', 'outcome', 'sources_offered', 'sources_used'];

/** The response with what varies run to run (ids, times, durations) masked. */
function normalized(body: string): unknown {
  const VOLATILE_KEY = /time|Time|duration|_ms$|Ms$|^id$|Id$|_id$|correlationId|executedAt|^when$/;
  const mask = (value: unknown, key = ''): unknown => {
    if (VOLATILE_KEY.test(key)) return '<v>';
    if (Array.isArray(value)) return value.map((v) => mask(v));
    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.key === 'string' && 'value' in obj && VOLATILE_KEY.test(obj.key)) return { ...obj, value: '<v>' };
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, mask(v, k)]));
    }
    if (typeof value === 'string') {
      if (/^[0-9a-f]{16,32}$/.test(value)) return '<hex>';
      if (/^\d{10,}$/.test(value)) return '<n>';
      return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<date>');
    }
    return value;
  };
  const dataLines = body.split('\n').filter((l) => l.startsWith('data: '));
  if (dataLines.length === 0) {
    try { return mask(JSON.parse(body)); } catch { return body; }
  }
  return dataLines.map((l) => { try { return mask(JSON.parse(l.slice('data: '.length))); } catch { return l; } });
}

function assertNoCanary(where: string, text: string): void {
  for (const [what, canary] of Object.entries(CANARY)) {
    assert.ok(!text.includes(canary), `${where} carries the ${what} canary:\n${text.slice(0, 600)}`);
  }
}

// --- The drives, run once, read by the tests below ---------------------------------

const SURFACES: Surface[] = ['compare-stream', 'query-notebook', 'compare'];
const OK: Record<Surface, Drive> = {} as Record<Surface, Drive>;
const FAILED: Record<Surface, Drive> = {} as Record<Surface, Drive>;
const THROWN: Record<Surface, Drive> = {} as Record<Surface, Drive>;
for (const surface of SURFACES) {
  OK[surface] = await drive(surface);
  FAILED[surface] = await drive(surface, { fail: true, bothPanels: true });
  THROWN[surface] = await drive(surface, { insertMode: 'throw' });
}
const UNREGISTERED = await drive('compare-stream', { afterMode: 'throw' });
const REFUSED: Drive[] = [];
for (const surface of SURFACES) {
  REFUSED.push(await drive(surface, { refuse: 'invalid' }));
  REFUSED.push(await drive(surface, { limited: true }));
}
// The never-settling insert: the three routes at once, so the bound is waited out once.
// Each drive owns the shared state only until it has started; the stubs read the mode
// at insert time, so the mode stays `hang` for all three.
const HUNG: Record<Surface, { status: number; body: string; ended: boolean }> = {} as Record<Surface, { status: number; body: string; ended: boolean }>;
let HUNG_REGISTERED = 0;
const HUNG_SETTLED: Array<number | null> = [];
{
  W5.events = [];
  W5.registered = [];
  W5.inserts = [];
  W5.insertMode = 'hang';
  W5.afterMode = 'record';
  W5.session = SIGNED_IN;
  W5.limited = false;
  const done = await Promise.all(SURFACES.map(async (surface) => {
    const response = await request(surface)();
    const { body, ended } = await readBody(response);
    return { surface, status: response.status, body, ended };
  }));
  for (const d of done) HUNG[d.surface] = { status: d.status, body: d.body, ended: d.ended };
  const registered = [...W5.registered];
  HUNG_REGISTERED = registered.length;
  const startedAt = Date.now();
  HUNG_SETTLED.push(...await Promise.all(registered.map(async (p) => {
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      Promise.resolve(p).then(() => 'resolved' as const, () => 'rejected' as const),
      new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), BOUND_MS + 3_000); }),
    ]);
    clearTimeout(timer);
    return outcome === 'pending' ? null : Date.now() - startedAt;
  })));
  W5.insertMode = 'ok';
}

// The reader leaves mid-run: it reads the first chunk and cancels the stream.
// The run goes on (or stops at its next write) without anyone to send to; its
// last `writer.close()` then meets a stream the reader cancelled. Measured at
// the base (641a82f), with no counter at all: compare-stream left eight
// rejections unhandled (its callbacks' un-awaited writes, and the final
// `trace` write, which threw before `writer.close()` was reached), and
// query-notebook's `writer.close()` rejected ("Invalid state: WritableStream
// is closed") out of a run nothing awaits.
interface CancelDrive { inserts: number; registered: number; settledAfterMs: number | null; unhandled: string[]; firstChunk: number }
const CANCELLED: Partial<Record<Surface, CancelDrive>> = {};
for (const surface of ['compare-stream', 'query-notebook'] as const) {
  W5.events = [];
  W5.registered = [];
  W5.inserts = [];
  W5.insertMode = 'ok';
  W5.afterMode = 'record';
  W5.session = SIGNED_IN;
  W5.limited = false;
  const unhandledBefore = UNHANDLED.length;
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = () => {};
  try {
    const response = await request(surface, { slow: true })();
    const reader = response.body!.getReader();
    const first = await reader.read();
    await reader.cancel();
    // The run ends on its own clock: wait for the registration it made, then
    // for the bound and a margin.
    const startedAt = Date.now();
    let settledAfterMs: number | null = null;
    for (;;) {
      if (W5.registered.length > 0) break;
      if (Date.now() - startedAt > 5_000) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (W5.registered.length > 0) {
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        Promise.all(W5.registered.map((p) => Promise.resolve(p))).then(() => 'settled' as const, () => 'settled' as const),
        new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), BOUND_MS + 3_000); }),
      ]);
      clearTimeout(timer);
      if (outcome === 'settled') settledAfterMs = Date.now() - startedAt;
    }
    // Long enough for a run that writes nothing to have ended, and for any
    // rejection left unhandled to be reported.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    CANCELLED[surface] = {
      inserts: W5.inserts.length,
      registered: W5.registered.length,
      settledAfterMs,
      unhandled: UNHANDLED.slice(unhandledBefore),
      firstChunk: first.value?.length ?? 0,
    };
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
}

// --- Premises: the shapes that let the row's assertions fail ---------------------

/** Every object in a body: SSE `data:` lines, or one JSON document. */
function objects(body: string): Array<Record<string, unknown>> {
  const docs: unknown[] = [];
  const lines = body.split('\n').filter((l) => l.startsWith('data: '));
  if (lines.length > 0) for (const l of lines) { try { docs.push(JSON.parse(l.slice('data: '.length))); } catch { /* keep-alive */ } }
  else { try { docs.push(JSON.parse(body)); } catch { /* not JSON */ } }
  const out: Array<Record<string, unknown>> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v !== null && typeof v === 'object') { out.push(v as Record<string, unknown>); Object.values(v).forEach(walk); }
  };
  docs.forEach(walk);
  return out;
}

test('criterion 2 premise: each completed run answered a Socrata call and had its only Data Commons call refused', () => {
  for (const surface of SURFACES) {
    const all = objects(OK[surface].body);
    const named = (name: string) => all.filter((o) => o.name === name && ('args' in o || 'failed' in o));
    assert.ok(named('socrata__get_data').some((o) => o.failed !== true), `${surface}: no answered Socrata call on the record`);
    const dc = named('data_commons__search_indicators');
    assert.ok(dc.length > 0, `${surface}: no Data Commons call on the record`);
    assert.ok(dc.every((o) => o.failed === true), `${surface}: a Data Commons call answered`);
  }
});

test('criterion 2 premise: on the failing compare-stream drive the withoutMcp panel completed and the withMcp panel failed', () => {
  const events = objects(FAILED['compare-stream'].body).filter((o) => typeof o.type === 'string' && typeof o.panel === 'string');
  assert.ok(events.some((e) => e.type === 'complete' && e.panel === 'withoutMcp'), 'the withoutMcp panel did not complete');
  assert.ok(events.some((e) => e.type === 'error' && e.panel === 'withMcp'), 'the withMcp panel did not fail');
  assert.ok(!events.some((e) => e.type === 'complete' && e.panel === 'withMcp'), 'the withMcp panel completed');
});

// --- (a) The write is attempted once, with the expected row, after the last byte ----

for (const surface of SURFACES) {
  test(`criterion 2(a) ${surface}: a completed run registers one promise with after() before the handler returns`, () => {
    const d = OK[surface];
    assert.equal(d.status, 200, `premise: the run was served:\n${d.body.slice(0, 400)}`);
    assert.ok(d.ended, 'premise: the response ended');
    const afters = d.events.filter((e) => e.kind === 'after');
    assert.equal(afters.length, 1, `after() was called ${afters.length} times: ${JSON.stringify(d.events)}`);
    assert.equal(afters[0].detail, 'promise', 'after() was handed something other than a promise');
    assert.ok(d.events.indexOf(afters[0]) < d.events.findIndex((e) => e.kind === 'returned'), `after() was called after the handler returned: ${JSON.stringify(d.events)}`);
  });

  test(`criterion 2(a) ${surface}: a completed run writes one row, outcome complete, sources used = the answered source only`, () => {
    const d = OK[surface];
    assert.equal(d.inserts.length, 1, `the write was attempted ${d.inserts.length} times`);
    const [insert] = d.inserts;
    assert.equal(insert.table, 'usage_counts');
    const { day, ...rest } = (insert.values ?? {}) as Record<string, unknown>;
    assert.ok(day === today() || day === new Date(Date.now() - 60_000).toISOString().slice(0, 10), `day ${String(day)} is not today's UTC date`);
    assert.deepEqual(rest, expectedRow(surface, 'complete'));
    assert.deepEqual(insert.target, KEY_COLUMNS, 'the conflict target is not the eight key columns');
    assertNoCanary('the row', JSON.stringify(insert.values));
  });

  test(`criterion 2(a) ${surface}: the write starts after the response's last byte`, () => {
    const d = OK[surface];
    const insertAt = d.events.findIndex((e) => e.kind === 'insert');
    assert.ok(insertAt >= 0, 'no write was attempted');
    const lastByte = surface === 'compare' ? 'response-built' : 'closed';
    const lastByteAt = d.events.findIndex((e) => e.kind === lastByte);
    assert.ok(lastByteAt >= 0, `premise: the log holds no ${lastByte} event: ${JSON.stringify(d.events)}`);
    assert.ok(lastByteAt < insertAt, `the write started before the ${lastByte}: ${JSON.stringify(d.events)}`);
  });

  test(`criterion 2(a) ${surface}: a failed run writes one row, outcome error, and still names the source that answered first`, () => {
    const d = FAILED[surface];
    assert.ok(d.ended, 'premise: the response ended');
    assert.ok(/error/i.test(d.body), `premise: the run failed:\n${d.body.slice(-600)}`);
    assert.equal(d.inserts.length, 1, `the write was attempted ${d.inserts.length} times`);
    const { day, ...rest } = (d.inserts[0].values ?? {}) as Record<string, unknown>;
    assert.ok(day === today() || day === new Date(Date.now() - 60_000).toISOString().slice(0, 10), `day ${String(day)} is not today's UTC date`);
    assert.deepEqual(rest, expectedRow(surface, 'error'));
    const lastByte = surface === 'compare' ? 'response-built' : 'closed';
    assert.ok(d.events.findIndex((e) => e.kind === lastByte) < d.events.findIndex((e) => e.kind === 'insert'), `the write started before the ${lastByte}`);
  });
}

test('criterion 2(a): a request refused before its run (validation, the rate limit) registers nothing and writes nothing', () => {
  assert.equal(REFUSED.length, 6);
  for (const d of REFUSED) {
    assert.ok(d.status === 400 || d.status === 429, `premise: ${d.surface} refused the request (status ${d.status})`);
    assert.equal(d.registered.length, 0, `${d.surface} (${d.status}) registered a count`);
    assert.equal(d.inserts.length, 0, `${d.surface} (${d.status}) wrote a count`);
  }
});

test('criterion 2(a): outside a request scope (after() throws E468) the write still runs, and one class-only line says it is unregistered', () => {
  const d = UNREGISTERED;
  assert.ok(d.ended, 'premise: the response ended');
  assert.equal(d.inserts.length, 1, 'the unregistered write did not run');
  const usageLines = d.lines.filter((l) => l.startsWith('[usage]'));
  assert.equal(usageLines.length, 1, `expected one [usage] line:\n${d.lines.join('\n')}`);
  assert.match(usageLines[0], /request scope/i);
  for (const line of d.lines) assertNoCanary('a log line', line);
});

// --- (b) An insert that never settles changes nothing the reader receives ------------

for (const surface of SURFACES) {
  test(`criterion 2(b) ${surface}: with an insert that never settles the response ends, byte for byte the working run's`, () => {
    const d = HUNG[surface];
    assert.ok(d.ended, `the response did not end within ${READ_DEADLINE_MS} ms of the request: the route waited on the write`);
    assert.equal(d.status, OK[surface].status);
    assert.deepEqual(normalized(d.body), normalized(OK[surface].body));
  });

}

test('criterion 2(b): with an insert that never settles, each route\'s registered promise settles within the bound', () => {
  assert.equal(HUNG_REGISTERED, SURFACES.length, `after() received ${HUNG_REGISTERED} promises for ${SURFACES.length} runs`);
  for (const [i, settled] of HUNG_SETTLED.entries()) {
    assert.ok(settled !== null, `registered promise ${i} had not settled ${BOUND_MS + 3_000} ms after the streams ended`);
    assert.ok(settled <= BOUND_MS + 2_000, `registered promise ${i} settled after ${settled} ms, past the ${BOUND_MS} ms bound`);
  }
});

// --- (c) An insert that throws is a class-only log line; the promise resolves ---------

for (const surface of SURFACES) {
  test(`criterion 2(c) ${surface}: an insert that throws leaves the response as it was, and the registered promise resolves`, () => {
    const d = THROWN[surface];
    assert.ok(d.ended, 'premise: the response ended');
    assert.deepEqual(normalized(d.body), normalized(OK[surface].body));
    assert.equal(d.inserts.length, 1, 'premise: the write was attempted');
    assert.equal(d.registered.length, 1, 'no promise was registered');
    assert.ok(d.settledAfterMs !== null, 'the registered promise did not settle');
    assert.equal(d.rejected, false, 'the registered promise rejected: Next would log it raw');
  });

  test(`criterion 2(c) ${surface}: the failure is one errorLogFacts line, and no line carries the database's text or a canary`, () => {
    const d = THROWN[surface];
    const facts = util.inspect(errorLogFacts(new Error('insert refused')));
    const usageLines = d.lines.filter((l) => l.startsWith('[usage]'));
    assert.equal(usageLines.length, 1, `expected one [usage] line:\n${d.lines.join('\n')}`);
    assert.ok(usageLines[0].includes(facts), `the line is not the error's class facts (${facts}): ${usageLines[0]}`);
    for (const line of d.lines) assertNoCanary('a log line', line);
  });
}

// --- (d) A reader that leaves mid-run: the row is still attempted, and nothing is left unhandled

for (const surface of ['compare-stream', 'query-notebook'] as const) {
  test(`criterion 2(d) ${surface}: the reader cancels mid-stream, and the row is still attempted once`, () => {
    const d = CANCELLED[surface]!;
    assert.ok(d.firstChunk > 0, 'premise: the reader received a chunk before cancelling');
    assert.equal(d.registered, 1, `after() received ${d.registered} promises`);
    assert.equal(d.inserts, 1, `the write was attempted ${d.inserts} times after the reader left`);
  });

  test(`criterion 2(d) ${surface}: the registered promise settles within the bound`, () => {
    const d = CANCELLED[surface]!;
    assert.ok(d.settledAfterMs !== null, 'the registered promise did not settle');
    assert.ok(d.settledAfterMs <= BOUND_MS + 2_000, `it settled after ${d.settledAfterMs} ms`);
  });

  test(`criterion 2(d) ${surface}: no rejection is left unhandled when the reader leaves`, () => {
    assert.deepEqual(CANCELLED[surface]!.unhandled, []);
  });
}

test('criterion 2: no drive left a rejection unhandled', () => {
  assert.deepEqual(UNHANDLED, []);
});
