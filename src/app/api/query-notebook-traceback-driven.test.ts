// #516 P3 — a notebook's own traceback goes to the reader; the log keeps the
// structure. Driven through the real `POST /api/query-notebook` handler.
//
// THE RULINGS THIS HOLDS. 2026-09-21: the notebook's traceback goes to the
// reader, in a field of its own on the error event, with the notebook's two
// credentials removed by value; the log line gains structural fields only.
// G0-9 (b): under `EXECUTOR_DRIVER=lambda` the reader gets the message and no
// traceback field, because the function holds the two credentials and the app
// cannot remove values it does not hold. Setup failures keep the message alone.
//
// WHAT IS REAL, AND WHAT IS NOT. The route, the tool loop, the rate limiter
// (with the fixture secret a later phase makes required), the trace builder,
// the notebook synthesizer, `src/lib/sandbox/execute.ts` (so `nbconvertFailed`,
// `runInSession`, `buildNotebookEnv` and the pip step are the code that runs),
// `src/lib/sandbox/container.ts` and `src/lib/sandbox/lambda.ts` are the real
// modules. Three seams are replaced, each where the real one would leave this
// machine:
//   - the container CLI: `EXECUTOR_CONTAINER_CLI` names a script this file
//     writes out per run. It answers `run`, `exec` and `kill` the way the
//     docker CLI does, reads each `-e NAME` from its own environment as docker
//     does, and for the nbconvert exec writes to stderr the shape nbconvert
//     wrote in the executor image (measured; see `NBCONVERT_STDERR`) with
//     every value it was passed printed by the failing cell;
//   - the Lambda client: `./lambda.ts` loads with a stand-in for its
//     `createLambdaDriver` that hands the REAL driver a client whose `send`
//     answers as the handler does, with the function's own credential values
//     in the traceback (the handler adds them from its own environment);
//   - `./vercel-sandbox.ts`: a session whose stack is not preinstalled, so the
//     real pip step runs, and fails.
// Plus `next/headers`, `next-auth` and `@/lib/auth`, which need a request
// scope or a sign-in provider. No sandbox, container or function is created:
// this project's sandbox scope is shared with production (CLAUDE.md).
//
// ONE MODULE GRAPH PER DRIVER. `execute.ts` caches the driver it resolves, so
// each driver gets its own copy of every module under `src/`: the route is
// imported with `?leg=<driver>`, and the resolve hook carries that query to
// every `src/` module the route reaches.
//
// WHAT MAKES EACH ASSERTION ABLE TO FAIL.
//   - On the wire: red on the base, which sends no traceback at all.
//   - Setup failures and `lambda`: these pass on the base (it sends no stderr
//     anywhere), so each is shown red on the head with its own check switched
//     off — the marker check, and the one-shot exclusion.
//   - The credentials: the fake CLI records the names it was passed, and the
//     premise test requires both, with the canary values, in what it wrote.
//     Shown red on the head with the redaction switched off.
//   - The log line: the facts must be present (red on the base, which has
//     none), and a class name too long or not identifier-shaped, carrying a
//     canary, must not reach it — shown red with the shape bound switched off.
//   - Every capture is through `util.format`, once per `console` call, so an
//     object is rendered the way the platform's log would render it.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/query-notebook-traceback-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Typed here because the installed `@types/node` predates `registerHooks`.
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
const SRC = path.resolve(HERE, '../..');
const SRC_URL = pathToFileURL(SRC).href;

// --- The canaries ---------------------------------------------------------------

/** In the failing cell's exception: the reader's own detail. */
const TRACEBACK_CANARY = 'Tb7nQw2-traceback-canary';
/** In a setup failure's stderr. */
const SETUP_CANARY = 'Sx4pLm9-setup-stderr-canary';
/** In a class name that the log line must not admit. */
const CLASS_CANARY = 'Cz8rKv3classcanary';
/**
 * The two notebook credentials. Inert, and not credential-shaped; the first
 * carries a space, a slash and a plus, so its URL-encoded form differs from it.
 */
const SOCRATA_CANARY = 'fixture socrata/p3+canary';
const DC_CANARY = 'fixture-dc-p3-canary';

// --- Module hooks ---------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-516-p3-stub/';
const LAMBDA_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/lambda.ts')).href;
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;

function stubSource(key: string, leg: string | null): string {
  const q = leg ? `?leg=${leg}` : '';
  switch (key) {
    case 'next/headers':
      return `export async function headers() {
        return new Headers({ 'x-forwarded-for': globalThis.__p3.ip });
      }`;
    case 'next-auth':
      return 'export async function getServerSession() { return null; }';
    case '@/lib/auth':
      return 'export const authOptions = {};';
    case 'lambda':
      // The real driver, with a client that answers as the handler does. The
      // handler adds the two credentials from the FUNCTION's environment
      // (handler.py), so the traceback it returns can carry them, and the app
      // never sent them (the payload is recorded to show that).
      return `
        import { createLambdaDriver as realCreateLambdaDriver } from ${JSON.stringify(LAMBDA_URL + q)};
        export * from ${JSON.stringify(LAMBDA_URL + q)};
        export function createLambdaDriver() {
          return realCreateLambdaDriver({
            env: { ...process.env, EXECUTOR_LAMBDA_FUNCTION: 'p3-fixture-function', EXECUTOR_LAMBDA_REGION: 'us-east-1' },
            client: {
              async send(command) {
                const payload = JSON.parse(new TextDecoder().decode(command.input.Payload));
                globalThis.__p3.lambdaPayloads.push(payload);
                const stderr = globalThis.__p3.nbconvertStderr({
                  SOCRATA_APP_TOKEN: globalThis.__p3.functionHeld.SOCRATA_APP_TOKEN,
                  DC_API_KEY: globalThis.__p3.functionHeld.DC_API_KEY,
                });
                globalThis.__p3.emittedStderr.push(stderr);
                const body = { protocol: payload.protocol, requestId: 'p3-handler', exitCode: 1, stderr, python: '3.13.0' };
                return { $metadata: { requestId: 'p3-lambda-request' }, Payload: new TextEncoder().encode(JSON.stringify(body)) };
              },
            },
          });
        }`;
    case 'vercel-sandbox':
      // A fresh session: no stack preinstalled, so execute.ts runs its real
      // pip step, which fails with the canary in its stderr.
      return `
        import ${JSON.stringify(DRIVER_URL + q)};
        export function createVercelSandboxDriver() {
          return {
            name: 'vercel-sandbox',
            async createSession() {
              const ok = { exitCode: 0, stdout: async () => '', stderr: async () => '' };
              return {
                id: 'p3-fresh-session',
                stackPreinstalled: false,
                async runCommand(command) {
                  if (command.cmd !== 'pip') return ok;
                  return {
                    exitCode: 1,
                    stdout: async () => '',
                    stderr: async () => 'ERROR: Could not find a version that satisfies the requirement ${SETUP_CANARY}\\n',
                  };
                },
                async writeFiles() {},
                async readFileToBuffer() { return null; },
                async stop() {},
              };
            },
          };
        }`;
    default:
      throw new Error(`no stub for ${key}`);
  }
}

const TOP_STUBS = new Set(['next/headers', 'next-auth', '@/lib/auth']);

function legOf(url: string | undefined): string | null {
  if (!url) return null;
  const at = url.indexOf('?leg=');
  return at === -1 ? null : url.slice(at + 5);
}

function tagged(url: string, leg: string | null): string {
  return leg && url.startsWith(SRC_URL) && !url.includes('?') ? `${url}?leg=${leg}` : url;
}

function resolveUnderSrc(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      if (fs.statSync(candidate).isFile()) return pathToFileURL(candidate).href;
    } catch { /* next candidate */ }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentURL = (context as { parentURL?: string }).parentURL;
    const leg = legOf(parentURL);
    if (TOP_STUBS.has(specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    const parentPath = parentURL?.startsWith('file:') ? fileURLToPath(parentURL.split('?')[0]) : '';
    if (parentPath === path.join(SRC, 'lib/sandbox/execute.ts')) {
      if (specifier === './lambda.ts') {
        return { url: `${STUB_PREFIX}lambda.mjs${leg ? `?leg=${leg}` : ''}`, format: 'module', shortCircuit: true };
      }
      if (specifier === './vercel-sandbox.ts') {
        return { url: `${STUB_PREFIX}vercel-sandbox.mjs${leg ? `?leg=${leg}` : ''}`, format: 'module', shortCircuit: true };
      }
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const found = resolveUnderSrc(path.join(SRC, specifier.slice(2)));
      if (found === null) throw new Error(`#516 P3 test hook: cannot resolve ${specifier}`);
      return { url: tagged(found, leg), shortCircuit: true };
    }
    const resolved = nextResolve(specifier, context);
    return { ...resolved, url: tagged(resolved.url, leg) };
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const [file, query] = url.slice(STUB_PREFIX.length).split('?');
      const key = decodeURIComponent(file.replace(/\.mjs$/, ''));
      return { format: 'module', source: stubSource(key, legOf(query ? `?${query}` : undefined)), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// --- What nbconvert writes, measured --------------------------------------------

/**
 * The stderr of `jupyter nbconvert --execute` when a cell fails, as the
 * executor image (`docker/executor`, nbconvert under Python 3.13) wrote it for
 * a cell that printed two environment variables to stderr and then raised a
 * KeyError. nbconvert's own frames are shortened to their first and last; the
 * rest is byte for byte, ANSI colour codes included. The failing cell is the
 * second code cell, so IPython names it `In[2]`.
 */
function nbconvertStderr(
  values: Record<string, string | undefined>,
  opts: { className?: string } = {},
): string {
  const E = '\u001b';
  const cls = opts.className ?? 'KeyError';
  const printed = Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([name, v]) => `${name.toLowerCase()} ${v}`);
  const socrata = values.SOCRATA_APP_TOKEN;
  const url = socrata
    ? `https://data.example.org/resource/abcd-1234.json?$$app_token=${encodeURIComponent(socrata)}`
    : 'https://data.example.org/resource/abcd-1234.json';
  return [
    '[NbConvertApp] Converting notebook /tmp/notebook.ipynb to notebook',
    'Traceback (most recent call last):',
    '  File "/usr/local/bin/jupyter-nbconvert", line 6, in <module>',
    '    sys.exit(main())',
    '             ~~~~^^',
    '  File "/usr/local/lib/python3.13/site-packages/nbclient/client.py", line 918, in _check_raise_for_error',
    '    raise CellExecutionError.from_cell_and_msg(cell, exec_reply_content)',
    'nbclient.exceptions.CellExecutionError: An error occurred while executing the following cell:',
    '------------------',
    'import os, sys',
    "print('token', os.environ['SOCRATA_APP_TOKEN'], file=sys.stderr)",
    `raise ${cls}('complaint_type for ${TRACEBACK_CANARY}')`,
    '------------------',
    '',
    '----- stderr -----',
    ...printed,
    `GET ${url}`,
    '------------------',
    '',
    `${E}[31m---------------------------------------------------------------------------${E}[39m`,
    `${E}[31m${cls}${E}[39m${' '.repeat(Math.max(0, 42 - cls.length))}Traceback (most recent call last)`,
    `${E}[36mCell${E}[39m${E}[36m ${E}[39m${E}[32mIn[2]${E}[39m${E}[32m, line 3${E}[39m`,
    `${E}[32m      1${E}[39m ${E}[38;5;28;01mimport${E}[39;00m os, sys`,
    `${E}[32m----> ${E}[39m${E}[32m3${E}[39m ${E}[38;5;28;01mraise${E}[39;00m ${cls}(${E}[33m'complaint_type for ${TRACEBACK_CANARY}'${E}[39m)`,
    '',
    `${E}[31m${cls}${E}[39m: 'complaint_type for ${TRACEBACK_CANARY}'`,
    '',
  ].join('\n');
}

// --- Shared state the stubs and the fake CLI read -------------------------------

interface P3Globals {
  ip: string;
  lambdaPayloads: Array<Record<string, unknown>>;
  emittedStderr: string[];
  functionHeld: Record<string, string>;
  nbconvertStderr: (values: Record<string, string | undefined>) => string;
}
const P3 = { ip: '203.0.113.31', lambdaPayloads: [], emittedStderr: [], functionHeld: {}, nbconvertStderr } as P3Globals;
(globalThis as unknown as { __p3: P3Globals }).__p3 = P3;

// --- The fake container CLI, written out for this run ---------------------------

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'civic-516-p3-'));
const CLI = path.join(WORK, 'fake-container-cli.mjs');
const CLI_LOG = path.join(WORK, 'cli-log.jsonl');
const STDERR_FILE = path.join(WORK, 'nbconvert-stderr.json');

/**
 * Writes the nbconvert stderr template's inputs where the CLI reads them: the
 * class name to raise. The CLI fills in the values it was passed by `-e`.
 */
function setCliMode(mode: 'nbconvert-fails' | 'run-fails', className?: string): void {
  process.env.CIVIC_P3_CLI_MODE = mode;
  fs.writeFileSync(STDERR_FILE, JSON.stringify({ className: className ?? null }));
}

fs.writeFileSync(
  CLI,
  `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.CIVIC_P3_CLI_MODE;
const record = (entry) => fs.appendFileSync(${JSON.stringify(CLI_LOG)}, JSON.stringify(entry) + '\\n');
const stdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
if (args[0] === 'run') {
  if (mode === 'run-fails') {
    const stderr = 'docker: Error response from daemon: pull access denied for ${SETUP_CANARY}.\\n';
    record({ args, stderr });
    process.stderr.write(stderr);
    process.exit(125);
  }
  record({ args });
  process.stdout.write('p3fixturecontainer\\n');
  process.exit(0);
}
if (args[0] === 'kill') { record({ args }); process.exit(0); }
if (args[0] === 'exec') {
  let i = 1;
  const names = [];
  while (i < args.length) {
    if (args[i] === '-i') { i += 1; continue; }
    if (args[i] === '-e') { names.push(args[i + 1]); i += 2; continue; }
    break;
  }
  const command = args.slice(i + 1);
  if (command[0] === 'sh') { stdin(); record({ args }); process.exit(0); }
  if (command[0] === 'jupyter') {
    // docker semantics: \`-e NAME\` takes NAME's value from this process's environment.
    const values = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const { className } = JSON.parse(fs.readFileSync(${JSON.stringify(STDERR_FILE)}, 'utf8'));
    const { nbconvertStderr } = await import(${JSON.stringify(pathToFileURL(path.join(WORK, 'template.mjs')).href)});
    const stderr = nbconvertStderr(values, className ? { className } : {});
    record({ args, names, values, stderr });
    process.stderr.write(stderr);
    process.exit(1);
  }
  record({ args });
  if (command[0] === 'cat') process.exit(1);
  if (command[0] === 'python3') { process.stdout.write('3.13.0\\n'); process.exit(0); }
}
process.exit(2);
`,
  { mode: 0o755 },
);
// The template, as a module the CLI imports: this file's own function, so the
// stderr the CLI writes and the stderr the lambda stand-in returns are one shape.
fs.writeFileSync(
  path.join(WORK, 'template.mjs'),
  `const TRACEBACK_CANARY = ${JSON.stringify(TRACEBACK_CANARY)};\nexport ${nbconvertStderr.toString()}\n`,
);

interface CliEntry { args: string[]; names?: string[]; values?: Record<string, string>; stderr?: string }
function cliLog(): CliEntry[] {
  if (!fs.existsSync(CLI_LOG)) return [];
  return fs.readFileSync(CLI_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as CliEntry);
}

// --- The scripted MCP source and model (loopback) -------------------------------

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-p3-session' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-p3-stub', version: '0' } } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (msg.method === 'prompts/get') {
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture guidance.' } }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: '{"data":[],"total_rows":0}' }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_URL = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { consentCookieForTests } = await import('../../lib/sources/consent-fixture.ts');
const scripted = await startScriptedModelServer([{ content: 'Twelve complaints were recorded.' }]);
scripted.server.unref();

// --- Environment, set before any app module loads -------------------------------

for (const name of ['MODEL_API_KEY', 'OPENAI_API_KEY', 'SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'SANDBOX_SNAPSHOT_ID']) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = MCP_URL;
process.env.DATA_COMMONS_MCP_URL = MCP_URL;
process.env.BOSTON_OPENCONTEXT_MCP_URL = MCP_URL;
process.env.OPENROUTER_API_KEY = 'fixture';
process.env.MODEL_API_BASE_URL = scripted.url;
process.env.RATE_LIMIT_SECRET = 'fixture';
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
process.env.EXECUTOR_CONTAINER_CLI = CLI;
// The app's own copies of the two notebook credentials: what `buildNotebookEnv`
// passes into the notebook on the session path.
process.env.SOCRATA_APP_TOKEN = SOCRATA_CANARY;
process.env.DC_API_KEY = DC_CANARY;
// What the function holds under `lambda`. The same values: the app holding them
// too is the case in which a removal by the app would be possible, and G0-9
// still sends no traceback there.
P3.functionHeld = { SOCRATA_APP_TOKEN: SOCRATA_CANARY, DC_API_KEY: DC_CANARY };

// --- Console capture and one drive ----------------------------------------------

type ConsoleMethod = 'log' | 'error' | 'warn' | 'info' | 'debug';
const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'error', 'warn', 'info', 'debug'];

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

interface WireEvent { type: string; [key: string]: unknown }
interface Drive { log: string[]; sse: string; events: WireEvent[]; error: WireEvent | undefined; status: number }

type RouteModule = { POST: (request: Request) => Promise<Response> };
const routes = new Map<string, RouteModule>();

async function routeFor(driver: 'container' | 'lambda' | 'vercel-sandbox'): Promise<RouteModule> {
  let mod = routes.get(driver);
  if (!mod) {
    process.env.EXECUTOR_DRIVER = driver;
    const url = `${pathToFileURL(path.join(SRC, 'app/api/query-notebook/route.ts')).href}?leg=${driver}`;
    mod = (await import(url)) as RouteModule;
    routes.set(driver, mod);
  }
  return mod;
}

let ipCounter = 40;
async function drive(driver: 'container' | 'lambda' | 'vercel-sandbox'): Promise<Drive> {
  const { POST } = await routeFor(driver);
  process.env.EXECUTOR_DRIVER = driver;
  P3.ip = `203.0.113.${ipCounter++}`;
  let sse = '';
  let status = 0;
  const log = await captureConsole(async () => {
    const response = await POST(new Request('http://localhost/api/query-notebook', {
      method: 'POST',
      // R6 W2 (#632): a consent in force (every configured source On), as a browser that had answered the card would.
      headers: { cookie: consentCookieForTests() },
      body: JSON.stringify({ query: 'How many noise complaints were there last week?', portal: 'data.example.org' }),
    }));
    status = response.status;
    sse = await response.text();
  });
  const events = sse
    .split('\n\n')
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice(6)) as WireEvent);
  return { log, sse, events, error: events.find((e) => e.type === 'error'), status };
}

/** The message the reader got before this phase, for a failure with this exit code and reference. */
function todaysMessage(exitCode: unknown, correlationId: unknown): string {
  const exit = typeof exitCode === 'number' ? exitCode : 'n/a';
  return `Notebook execution failed (exit ${exit}). Reference: ${String(correlationId)}. Try again, or include this reference if you report the problem.`;
}

function failureLine(log: string[]): string | undefined {
  return log.find((entry) => entry.includes('[query-notebook] NotebookExecutionError'));
}

// --- The drives -----------------------------------------------------------------

setCliMode('nbconvert-fails');
const SESSION = await drive('container');
const SESSION_CLI = cliLog().find((e) => e.args.includes('jupyter'));

setCliMode('nbconvert-fails', `Long${CLASS_CANARY}${'X'.repeat(60)}Error`);
const LONG_CLASS = await drive('container');

setCliMode('nbconvert-fails', `Not-An-Identifier-${CLASS_CANARY}`);
const ODD_CLASS = await drive('container');

setCliMode('nbconvert-fails', 'StopIteration');
const NO_ERROR_IN_NAME = await drive('container');

setCliMode('run-fails');
const CONTAINER_RUN = await drive('container');

const PIP = await drive('vercel-sandbox');

const LAMBDA = await drive('lambda');

const CLI_ENTRIES = cliLog();
fs.rmSync(WORK, { recursive: true, force: true });

// --- Premises: the instrument reached what it measures -------------------------

test('premise: every drive reached the NotebookExecutionError branch', () => {
  for (const [what, d] of Object.entries({ SESSION, LONG_CLASS, ODD_CLASS, NO_ERROR_IN_NAME, CONTAINER_RUN, PIP, LAMBDA })) {
    assert.equal(d.status, 200, `${what}: status ${d.status}`);
    assert.ok(d.error, `${what}: no error event:\n${d.sse.slice(-600)}`);
    assert.equal(d.error!.code, 'notebook_execution', `${what}: not the notebook branch: ${JSON.stringify(d.error)}`);
    assert.ok(failureLine(d.log), `${what}: no failure line was logged:\n${d.log.join('\n')}`);
  }
});

test('premise: on the session path the notebook was handed both credentials, and its stderr carried them and the canary', () => {
  assert.ok(SESSION_CLI, 'the fake CLI never ran nbconvert');
  assert.deepEqual([...(SESSION_CLI!.names ?? [])].sort(), ['DC_API_KEY', 'SOCRATA_APP_TOKEN']);
  assert.equal(SESSION_CLI!.values?.SOCRATA_APP_TOKEN, SOCRATA_CANARY);
  assert.equal(SESSION_CLI!.values?.DC_API_KEY, DC_CANARY);
  const stderr = SESSION_CLI!.stderr ?? '';
  for (const planted of [TRACEBACK_CANARY, SOCRATA_CANARY, encodeURIComponent(SOCRATA_CANARY), DC_CANARY]) {
    assert.ok(stderr.includes(planted), `the session stderr does not carry ${planted}`);
  }
});

test('premise: the setup failures and the lambda run carried their canaries in stderr', () => {
  assert.ok(CLI_ENTRIES.some((e) => e.args[0] === 'run' && (e.stderr ?? '').includes(SETUP_CANARY)), 'the container run never failed with the canary');
  assert.equal(P3.lambdaPayloads.length, 1, 'the lambda client was not invoked exactly once');
  const sentEnv = (P3.lambdaPayloads[0].command as { env: Record<string, string> }).env;
  assert.ok(!('SOCRATA_APP_TOKEN' in sentEnv) && !('DC_API_KEY' in sentEnv), 'the app sent the function-held credentials');
  assert.ok(P3.emittedStderr.some((s) => s.includes(TRACEBACK_CANARY) && s.includes(DC_CANARY)), 'the handler stand-in returned no canary');
});

// --- 1. On the wire ---------------------------------------------------------------

test('1: a notebook’s own failure on the session path puts its traceback on the wire, in a field of its own', () => {
  const traceback = SESSION.error!.traceback;
  assert.equal(typeof traceback, 'string', `the error event has no traceback field: ${JSON.stringify(SESSION.error)}`);
  assert.ok((traceback as string).includes(TRACEBACK_CANARY), `the traceback does not carry the cell's exception:\n${traceback}`);
  assert.equal(SESSION.error!.message, todaysMessage(SESSION.error!.exitCode, SESSION.error!.correlationId), 'the message changed');
  assert.ok(!String(SESSION.error!.message).includes(TRACEBACK_CANARY), 'the traceback rode in the message (#271)');
});

test('1: the traceback is in no console line, no trace event and no publish_inputs event', () => {
  for (const [what, d] of Object.entries({ SESSION, LONG_CLASS, ODD_CLASS, NO_ERROR_IN_NAME })) {
    const logged = d.log.filter((l) => l.includes(TRACEBACK_CANARY));
    assert.deepEqual(logged, [], `${what}: the traceback reached the log:\n${logged.join('\n')}`);
    const elsewhere = d.events.filter((e) => e.type !== 'error' && JSON.stringify(e).includes(TRACEBACK_CANARY));
    assert.deepEqual(elsewhere, [], `${what}: the traceback rode on another event`);
    assert.ok(!d.events.some((e) => e.type === 'publish_inputs'), `${what}: a failed run emitted publish_inputs`);
    assert.ok(!d.events.some((e) => e.type === 'trace'), `${what}: a trace event was emitted`);
  }
});

test('1: a setup failure (pip install, the container run) sends today’s message and no traceback field', () => {
  for (const [what, d] of Object.entries({ PIP, CONTAINER_RUN })) {
    assert.ok(!('traceback' in d.error!), `${what}: a setup failure sent a traceback: ${JSON.stringify(d.error)}`);
    assert.equal(d.error!.message, todaysMessage(d.error!.exitCode, d.error!.correlationId), `${what}: the message changed`);
    assert.ok(!d.sse.includes(SETUP_CANARY), `${what}: the setup stderr reached the wire`);
    assert.ok(!d.log.some((l) => l.includes(SETUP_CANARY)), `${what}: the setup stderr reached the log`);
  }
});

test('1: under EXECUTOR_DRIVER=lambda a failing nbconvert sends today’s message and no traceback field (G0-9)', () => {
  assert.ok(!('traceback' in LAMBDA.error!), `lambda sent a traceback: ${JSON.stringify(LAMBDA.error)}`);
  assert.equal(LAMBDA.error!.message, todaysMessage(LAMBDA.error!.exitCode, LAMBDA.error!.correlationId));
  for (const planted of [TRACEBACK_CANARY, SOCRATA_CANARY, encodeURIComponent(SOCRATA_CANARY), DC_CANARY]) {
    assert.ok(!LAMBDA.sse.includes(planted), `lambda: ${planted} reached the wire`);
    assert.ok(!LAMBDA.log.some((l) => l.includes(planted)), `lambda: ${planted} reached the log`);
  }
});

// --- 3. The credentials ---------------------------------------------------------

test('3: neither notebook credential reaches the wire, in any form the traceback carried it', () => {
  for (const [what, d] of Object.entries({ SESSION, LONG_CLASS, ODD_CLASS, NO_ERROR_IN_NAME })) {
    for (const planted of [SOCRATA_CANARY, encodeURIComponent(SOCRATA_CANARY), DC_CANARY]) {
      assert.ok(!d.sse.includes(planted), `${what}: ${planted} reached the wire:\n${String(d.error?.traceback).slice(0, 1200)}`);
      assert.ok(!d.log.some((l) => l.includes(planted)), `${what}: ${planted} reached the log`);
    }
  }
});

test('3: the traceback says where a credential was removed, and keeps the rest of the line', () => {
  const traceback = String(SESSION.error!.traceback);
  assert.match(traceback, /socrata_app_token \[SOCRATA_APP_TOKEN removed\]/, traceback);
  assert.match(traceback, /dc_api_key \[DC_API_KEY removed\]/, traceback);
  assert.match(traceback, /\$\$app_token=\[SOCRATA_APP_TOKEN removed\]/, traceback);
});

// --- 4. The log line --------------------------------------------------------------

test('4: the failure line keeps the correlation id, exit code and class, and gains the structure', () => {
  const line = failureLine(SESSION.log)!;
  assert.ok(line.includes(String(SESSION.error!.correlationId)), `no correlation id:\n${line}`);
  assert.match(line, /exitCode: 1\b/, `no exit code:\n${line}`);
  assert.match(line, /errorClass: 'NotebookExecutionError'/, `no error class:\n${line}`);
  assert.match(line, /pythonErrorClass: 'KeyError'/, `no Python exception class:\n${line}`);
  assert.match(line, /cellExecutionCount: 2\b/, `no cell execution count:\n${line}`);
  const bytes = new TextEncoder().encode(SESSION_CLI!.stderr ?? '').length;
  assert.match(line, new RegExp(`stderrBytes: ${bytes}\\b`), `no stderr byte count (${bytes}):\n${line}`);
});

test('4: a class name that is not an identifier of at most 63 characters does not reach the line', () => {
  for (const [what, d] of Object.entries({ LONG_CLASS, ODD_CLASS })) {
    const line = failureLine(d.log)!;
    assert.ok(!line.includes(CLASS_CANARY), `${what}: the class name reached the line:\n${line}`);
    assert.ok(!line.includes('pythonErrorClass'), `${what}: a class field was logged:\n${line}`);
  }
});

test('4: the shape is an identifier, not errorClassOf’s: a class without `Error` in its name is kept', () => {
  assert.match(failureLine(NO_ERROR_IN_NAME.log)!, /pythonErrorClass: 'StopIteration'/);
  for (const [what, d] of Object.entries({ LONG_CLASS, ODD_CLASS })) {
    assert.match(failureLine(d.log)!, /stderrBytes: \d+/, `${what}: the line lost its structure`);
  }
});

test('4: no line carries any field beyond the stated ones', () => {
  for (const [what, d] of Object.entries({ SESSION, LONG_CLASS, ODD_CLASS, NO_ERROR_IN_NAME, CONTAINER_RUN, PIP, LAMBDA })) {
    const line = failureLine(d.log)!;
    const fields = [...line.matchAll(/(\w+): /g)].map((m) => m[1]);
    const unexpected = fields.filter((f) => !['correlationId', 'exitCode', 'errorClass', 'pythonErrorClass', 'cellExecutionCount', 'stderrBytes'].includes(f));
    assert.deepEqual(unexpected, [], `${what}: unexpected field(s) on the line:\n${line}`);
  }
});

