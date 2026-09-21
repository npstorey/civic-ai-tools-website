// #503 P1 — a reader's words never reach the app's own function logs.
//
// WHAT THIS IS FOR. For a search tool the ARGUMENTS are the reader's question
// in other words, and a source's answer is the reader's data. Both used to be
// written to `console` on every call, which on a hosting platform means the
// platform's log store. The operator facts — which source, which tool, how
// long, what status, how many bytes — carry none of that, and this file pins
// the difference: the facts stay, the content goes.
//
// WHAT IS DRIVEN, AND WHAT IS ONLY READ. Four of the five sites are driven
// end to end with a unique canary planted in the reader-side inputs and in the
// source-side outputs, with `console` captured through `util.format` (what
// `console` itself uses, so an Error logged as an object is rendered the way
// the platform would render it, not flattened to `{}` by `JSON.stringify`):
//
//   1. `src/lib/mcp/client.ts` tool call   — `callMcpTool`, real client,
//      scripted MCP source on loopback. Covers `:285` (args), `:320` (raw
//      response) and `:518`/`:525` (the formatter).
//   2. `src/lib/mcp/client.ts` prompt fetch — `callMcpPrompt`. Covers `:432`
//      (args) and `:454` (raw response).
//   3. `src/lib/openrouter-streaming.ts:97` — `queryWithMcpStreaming` against a
//      model endpoint that refuses with 400 and echoes the prompt in the
//      refusal body, which is how a real endpoint leaks a question into an
//      error object.
//   4. `src/app/api/query-notebook/route.ts:346-351` — the REAL route handler,
//      driven to its `NotebookExecutionError` catch.
//
// The fifth, `src/app/api/evidence/route.ts:424-426`, is read as SOURCE and is
// the file's stated blind spot: reaching that line means a successful publish,
// which needs a database, object storage, a signing key and the publication
// gate. What it logs is an account id rather than a reader's words, and the
// assertion below is over the text of that one call.
//
// HOW THE ROUTE IS DRIVEN WITHOUT A SANDBOX OR A CLI FLAG. `npm test` is
// `node --test` over modules, and this repository has no route-handler
// harness: nothing resolves the `@/` alias, and `next/headers`' `headers()`
// throws outside a request scope. Node's own module mocking needs
// `--experimental-test-module-mocks`, a flag in `package.json`, which #503's
// rider forbids. So this file installs `module.registerHooks()` IN-FILE before
// it imports anything from the app:
//   - `@/x` resolves to `src/x`, exactly as `tsconfig.json`'s `paths` does;
//   - `next/server` resolves to `next/server.js`;
//   - `next/headers`, `next-auth`, `@/lib/auth` and `@/lib/sandbox` load from
//     small in-file stubs.
// Everything else — the route, the tool loop, the MCP client, the rate
// limiter, the trace builder, the notebook synthesizer — is the real module.
// The stub for `@/lib/sandbox` RE-EXPORTS the real `NotebookExecutionError`
// from `src/lib/sandbox/driver.ts`, so the route's `instanceof` check is
// against the same class, and its `executeNotebook` throws one carrying the
// canary as `stderr` and in `message`. No sandbox is created: this project's
// sandbox scope is shared with production (CLAUDE.md), and a test must never
// reach into it.
//
// NO NETWORK. `src/lib/mcp/registry.ts` carries literal default URLs for the
// Data Commons and Boston sources, so all three source URLs are pointed at the
// loopback server before any app module loads. Every key and model id here is
// an obvious fixture; every address is loopback.
//
// THE INSTRUMENT HAS BEEN SEEN WORKING (the converse of a green that could
// only ever be green). Run unmodified against `c895ab0` — this sprint's base —
// every `canary` assertion below FAILS, because the canary is in the log. That
// run is in #503's P1 gate record with its command and output.
//
// ANTI-VACUITY. Deleting a log line entirely would also make a canary
// disappear, so each leg additionally asserts that the operator facts the
// contract names — source id, tool or prompt name, byte count, duration,
// status, correlation id, exit code, error class — ARE on the line. A leg
// can fail in both directions.
//
// IF THE #271 RULING IS REVISITED. The notebook stderr is removed in its own
// commit so it can be reverted as one hunk; reverting it makes exactly
// `notebook: ...` below fail, and nothing else in this file.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/logs-carry-no-reader-content.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `module.registerHooks()` is Node 22.15+ (this repo requires >=22) but is not
// in the `@types/node` this tree pins, and #503's rider forbids touching
// `package.json`. Declared locally rather than depended on.
interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
type ResolveHook = (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
type LoadHook = (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?: ResolveHook; load?: LoadHook }): void;
};

// --- The canary ---------------------------------------------------------------

/** One token, planted on every reader-side input and source-side output below. */
const CANARY = 'Kq7ZvX4m-reader-content-canary';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const REPO = path.resolve(SRC, '..');

// --- Module hooks: the `@/` alias, and four stubs ------------------------------

const STUB_PREFIX = 'file:///civic-p1-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;

const STUB_SOURCE: Record<string, string> = {
  // `headers()` needs a request scope it does not have here; the route only
  // reads `x-forwarded-for` off it, for the rate-limit identifier.
  'next/headers': `export async function headers() {
     return new Headers({ 'x-forwarded-for': '203.0.113.9' });
   }`,
  // Anonymous: the route then takes the IP branch of its identifier choice.
  'next-auth': `export async function getServerSession() { return null; }`,
  // Only ever handed to the stubbed `getServerSession` above. Stubbed rather
  // than imported so this file pulls in no part of the sign-in provider tree,
  // which another sprint owns.
  '@/lib/auth': `export const authOptions = {};`,
  // The real error class, so the route's `instanceof` holds; a failing
  // executor that creates nothing.
  '@/lib/sandbox': `
     import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
     export { NotebookExecutionError };
     export async function executeNotebook() {
       throw new NotebookExecutionError(globalThis.__civicP1NotebookMessage,
         { exitCode: 1, stderr: globalThis.__civicP1NotebookStderr });
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
          if (fs.statSync(candidate).isFile()) {
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        } catch { /* try the next extension */ }
      }
      throw new Error(`#503 P1 test hook: cannot resolve ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const globals = globalThis as unknown as Record<string, unknown>;
globals.__civicP1NotebookStderr =
  `Traceback (most recent call last):\n  File "nb.py", line 3\n    df = fetch("${CANARY}")\nKeyError: '${CANARY}'`;
globals.__civicP1NotebookMessage = `nbconvert exited 1 while running the cell for ${CANARY}`;

// --- Console capture ----------------------------------------------------------

type ConsoleMethod = 'log' | 'error' | 'warn' | 'info' | 'debug';
const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'error', 'warn', 'info', 'debug'];

/**
 * Captures what `console` would have written, formatted the way `console`
 * formats it. `util.format` is the function `console` uses, so an Error passed
 * as an object renders with its message and stack here exactly as it would in
 * the platform's log — which `JSON.stringify` would have hidden.
 */
async function captureConsole(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const saved = {} as Record<ConsoleMethod, (...args: unknown[]) => void>;
  for (const method of CONSOLE_METHODS) {
    saved[method] = console[method] as (...args: unknown[]) => void;
    console[method] = (...args: unknown[]) => { lines.push(util.format(...args)); };
  }
  try {
    await run();
  } finally {
    for (const method of CONSOLE_METHODS) console[method] = saved[method];
  }
  return lines;
}

/** Every captured call as one blob, for assertions that do not care which call. */
function logText(entries: string[]): string {
  return entries.join('\n');
}

/** Asserts the canary is in no captured call, printing the offending ones. */
function assertNoCanary(logged: string[], where: string): void {
  const offending = logged.filter((entry) => entry.includes(CANARY));
  assert.deepEqual(
    offending,
    [],
    `${where}: the reader's content reached the function log on ${offending.length} line(s):\n` +
      offending.map((l) => `  | ${l.slice(0, 400)}`).join('\n'),
  );
}

// --- The scripted MCP source (loopback) ---------------------------------------

/** A source answer that carries the canary, as a real answer would. */
const SOURCE_ROWS = JSON.stringify({ data: [{ complaint_type: CANARY, count: '12' }], total_rows: 1 });
const SKILL_TEXT = `Guidance for the portal. Example filter: complaint_type='${CANARY}'.`;

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-p1-session' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-p1-stub', version: '0' } } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (msg.method === 'prompts/get') {
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: SKILL_TEXT } }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: SOURCE_ROWS }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_URL = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;

// --- The refusing model endpoint (loopback) -----------------------------------
//
// 400 with the prompt echoed in the refusal body: the shape that puts a
// reader's question inside the error object a stream failure logs.

const refusingModel = http.createServer(async (req, res) => {
  await new Promise<void>((done) => { req.resume(); req.on('end', () => done()); });
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `invalid request: could not parse prompt ${CANARY}`, type: 'invalid_request_error' } }));
});
await new Promise<void>((resolve) => refusingModel.listen(0, '127.0.0.1', () => resolve()));
refusingModel.unref();
const REFUSING_MODEL_URL = `http://127.0.0.1:${(refusingModel.address() as AddressInfo).port}/v1`;

// --- Environment, set before any app module loads -----------------------------

for (const name of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL', 'SITE_DEFAULT_PORTAL']) {
  delete process.env[name];
}
// All three sources on loopback: `registry.ts` carries literal default URLs
// for two of them, so leaving them unset would make real outbound calls.
process.env.SOCRATA_MCP_URL = MCP_URL;
process.env.DATA_COMMONS_MCP_URL = MCP_URL;
process.env.BOSTON_OPENCONTEXT_MCP_URL = MCP_URL;
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

const { callMcpTool, callMcpPrompt } = await import('./mcp/client.ts');
const { queryWithMcpStreaming } = await import('./openrouter-streaming.ts');
const { carriedModelIdentity } = await import('./model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('./model-client.ts');

const PORTAL = 'data.example.org';

// --- Leg 1: a tool call -------------------------------------------------------

process.env.OPENROUTER_API_KEY = 'placeholder-fixture-model-key-503-p1';
process.env.MODEL_API_BASE_URL = REFUSING_MODEL_URL;
_resetDefaultModelClientForTests();

let toolCallResult = '';
const TOOL_CALL_LOG = await captureConsole(async () => {
  toolCallResult = await callMcpTool('get_data', {
    type: 'query',
    dataset_id: 'abcd-1234',
    portal: PORTAL,
    select: 'complaint_type, count(*)',
    where: `complaint_type='${CANARY}'`,
  });
});

// --- Leg 2: a prompt fetch ----------------------------------------------------

let promptResult = '';
const PROMPT_LOG = await captureConsole(async () => {
  promptResult = await callMcpPrompt('skill-guidance', { modality: 'web', topic: CANARY });
});

// --- Leg 3: a stream failure --------------------------------------------------

let streamErrorCopy = '';
const STREAM_FAILURE_LOG = await captureConsole(async () => {
  await queryWithMcpStreaming(
    `How many complaints mention ${CANARY}?`,
    carriedModelIdentity('vendor/model-fixture-1'),
    [],
    async () => assert.fail('the endpoint refuses before any tool call'),
    'You are a fixture system prompt.',
    {
      onProgress: () => {},
      onToken: () => {},
      onComplete: () => assert.fail('the refusing endpoint must not complete'),
      onError: (_panel, message) => { streamErrorCopy = message; },
    },
  );
});

// --- Leg 4: the notebook route, driven to its NotebookExecutionError catch -----

const { startScriptedModelServer } = await import('./model-loop/test-harness.ts');
const scripted = await startScriptedModelServer([{ content: 'Twelve complaints were recorded.' }]);
process.env.MODEL_API_BASE_URL = scripted.url;
_resetDefaultModelClientForTests();

const { POST } = await import('../app/api/query-notebook/route.ts');

let notebookSse = '';
const NOTEBOOK_LOG = await captureConsole(async () => {
  const response = await POST(new Request('http://localhost/api/query-notebook', {
    method: 'POST',
    body: JSON.stringify({ query: `How many complaints mention ${CANARY}?`, portal: PORTAL }),
  }) as never);
  notebookSse = await response.text();
});
await new Promise<void>((resolve) => { scripted.server.close(() => resolve()); });
_resetDefaultModelClientForTests();

// --- Leg 5: the deprecated cookie-auth publish log, read as source ------------

const EVIDENCE_ROUTE = path.join(REPO, 'src/app/api/evidence/route.ts');
const EVIDENCE_SOURCE = fs.readFileSync(EVIDENCE_ROUTE, 'utf8');
const COOKIE_LOG_ANCHOR = "console.log('[api/evidence] cookie-auth publish (deprecated path)'";

/** The full text of that one `console.log` call, from its anchor to its `);`. */
function cookieAuthLogCall(): string {
  const start = EVIDENCE_SOURCE.indexOf(COOKIE_LOG_ANCHOR);
  assert.notEqual(start, -1, `src/app/api/evidence/route.ts no longer carries ${COOKIE_LOG_ANCHOR} — this assertion has lost its anchor and must be re-pointed, not deleted`);
  const end = EVIDENCE_SOURCE.indexOf(');', start);
  assert.notEqual(end, -1, 'the cookie-auth log call is unterminated');
  return EVIDENCE_SOURCE.slice(start, end + 2);
}

// --- Premises: the instrument reached the code it is measuring ----------------

test('premise: every leg ran the code it measures, and the canary was really planted', () => {
  assert.ok(toolCallResult.includes(CANARY), 'the tool call did not return the canary-bearing source answer');
  assert.ok(promptResult.includes(CANARY), 'the prompt fetch did not return the canary-bearing skill text');
  assert.ok(streamErrorCopy.length > 0, 'the stream failure never reached onError');
  assert.ok(!streamErrorCopy.includes(CANARY), 'reader-facing copy carries the endpoint’s raw words (#154)');
  assert.match(notebookSse, /"code":"notebook_execution"/, `the notebook drive never reached the NotebookExecutionError catch:\n${notebookSse.slice(-600)}`);
  for (const [where, logged] of [
    ['tool call', TOOL_CALL_LOG],
    ['prompt fetch', PROMPT_LOG],
    ['stream failure', STREAM_FAILURE_LOG],
    ['notebook failure', NOTEBOOK_LOG],
  ] as const) {
    assert.ok(logged.length > 0, `${where}: nothing was logged at all — the capture is not reading this path`);
  }
});

// --- The criterion: the canary is nowhere ------------------------------------

test('tool call: the reader’s arguments and the source’s answer are in no log line', () => {
  assertNoCanary(TOOL_CALL_LOG, 'src/lib/mcp/client.ts (tool call)');
});

test('tool call: the operator facts stay — source, tool name, byte count, duration', () => {
  assert.match(logText(TOOL_CALL_LOG), /\[MCP:socrata\][^\n]*get_data/, `no line names the source and the tool:\n${logText(TOOL_CALL_LOG)}`);
  assert.match(logText(TOOL_CALL_LOG), /\d+ bytes/, `no line reports a byte count:\n${logText(TOOL_CALL_LOG)}`);
  assert.match(logText(TOOL_CALL_LOG), /\d+ms/, `no line reports a duration:\n${logText(TOOL_CALL_LOG)}`);
});

test('prompt fetch: the prompt arguments and the source’s prompt text are in no log line', () => {
  assertNoCanary(PROMPT_LOG, 'src/lib/mcp/client.ts (prompt fetch)');
});

test('prompt fetch: the operator facts stay — source, prompt name, byte count', () => {
  assert.match(logText(PROMPT_LOG), /\[MCP:socrata\][^\n]*skill-guidance/, `no line names the source and the prompt:\n${logText(PROMPT_LOG)}`);
  assert.match(logText(PROMPT_LOG), /\d+ bytes/, `no line reports a byte count:\n${logText(PROMPT_LOG)}`);
});

test('stream failure: the endpoint’s refusal text — which carries the question — is in no log line', () => {
  assertNoCanary(STREAM_FAILURE_LOG, 'src/lib/openrouter-streaming.ts:97');
});

test('stream failure: the operator facts stay — the classified kind, the status and the error class', () => {
  assert.match(logText(STREAM_FAILURE_LOG), /\[stream:withMcp\] query failed \(\w+\)/, `no line states the panel and the classified kind:\n${logText(STREAM_FAILURE_LOG)}`);
  assert.match(logText(STREAM_FAILURE_LOG), /status 400/, `no line states the endpoint's status:\n${logText(STREAM_FAILURE_LOG)}`);
  assert.match(logText(STREAM_FAILURE_LOG), /error class: \w+/, `no line states the error class:\n${logText(STREAM_FAILURE_LOG)}`);
});

test('notebook: a failing run’s stderr and error message are in no log line', () => {
  assertNoCanary(NOTEBOOK_LOG, 'src/app/api/query-notebook/route.ts:346-351');
});

test('notebook: the operator facts stay — correlation id, exit code, error class — and the reader still gets the reference', () => {
  const line = NOTEBOOK_LOG.find((entry) => entry.includes('[query-notebook] NotebookExecutionError'));
  assert.ok(line, `the failure is no longer logged at all:\n${logText(NOTEBOOK_LOG)}`);
  const correlationId = /nb-[0-9a-f]{8}/.exec(line!)?.[0];
  assert.ok(correlationId, `the log line carries no correlation id:\n${line}`);
  assert.match(line!, /exitCode: 1|"exitCode":1/, `the log line carries no exit code:\n${line}`);
  // Named as a FIELD, not by the prefix: `[query-notebook] NotebookExecutionError`
  // is the grep anchor and would match this on its own.
  assert.match(
    line!,
    /errorClass: 'NotebookExecutionError'|"errorClass":"NotebookExecutionError"/,
    `the log line names no error class:\n${line}`,
  );
  // #271's traceability, unchanged: the id on the line is the id the reader sees.
  assert.ok(
    notebookSse.includes(`"correlationId":"${correlationId}"`),
    `the reader's reference and the log line's correlation id differ:\n${notebookSse.slice(-400)}`,
  );
});

test('evidence: the deprecated cookie-auth publish log names no account id (read as source — see this file’s header)', () => {
  const call = cookieAuthLogCall();
  assert.ok(
    !/userId/.test(call),
    `src/app/api/evidence/route.ts logs an account id on the deprecated cookie-auth path:\n${call}`,
  );
});
