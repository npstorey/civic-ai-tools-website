// #516 P9 — a notebook output never carries the value of a notebook credential.
// Driven through the real `POST /api/query-notebook` handler on the session
// path, and through the real `POST /api/records` handler with what it emitted.
//
// THE RULE THIS HOLDS. The two credentials the app puts into a notebook's
// environment (`SOCRATA_APP_TOKEN`, `DC_API_KEY`) never appear by value in a
// notebook output: not in the `notebook` stream event, and not in the signed
// package a publish request builds. Each value is removed in the three forms
// `withoutCredentials` (`src/lib/streaming.ts`) names — raw, URL-encoded and
// JSON-escaped — and the place it stood says `[NAME removed]`. Everything else
// in the notebook is unchanged.
//
// WHAT IS REAL, AND WHAT IS NOT. The two routes, the tool loop, the rate
// limiter (with a fixture secret), the trace builder, the notebook
// synthesizer, the provenance stamp, the validator, the packager,
// `src/lib/sandbox/execute.ts` (so `buildNotebookEnv` and `runInSession` are
// the code that runs) and `src/lib/sandbox/container.ts` are the real modules.
// The seams replaced, each where the real one would leave this machine:
//   - the container CLI: `EXECUTOR_CONTAINER_CLI` names a script this file
//     writes out per run. It answers `run`, `exec` and `kill` the way the
//     docker CLI does, reads each `-e NAME` from its own environment as docker
//     does, and for the nbconvert exec writes an executed notebook whose added
//     cell printed every value it was passed, in the three forms, through four
//     kinds of output: a stdout stream, an `execute_result` (`text/plain`), a
//     `display_data` (`text/html`) and an `error` output (a caught exception
//     the cell displayed, which leaves the run successful). The cell also
//     prints a metric-capture line carrying both values, which the provenance
//     stamp reads into the comparison cell it writes;
//   - `next/headers`, `next-auth`, `@/lib/auth`, `@/lib/api-auth`: no request
//     scope or sign-in provider outside Next;
//   - `@/lib/evidence/unsigned-tier`, `@/lib/evidence/signing`, `@/lib/storage`,
//     `@/lib/db`, `@/lib/evidence/publication`: no signing key, storage or
//     database is touched here; the storage stand-in records the package it
//     was handed, serialized, as the bytes it would have stored.
// No sandbox, container or function is created.
//
// WHAT MAKES EACH ASSERTION ABLE TO FAIL.
//   - The premise tests require every form of both values, verbatim, in each
//     of the four kinds of output the fake CLI wrote, so a drive in which the
//     notebook never printed them cannot pass as a removal.
//   - The fixture's two values cannot collapse into one another: each carries
//     characters that make its URL-encoded and JSON-escaped forms differ from
//     it, and neither is a substring of the other's forms.
//   - The publish body in the second package test carries the values itself,
//     so the package assertion does not lean on the stream having removed them.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/notebook-outputs-credentials-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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

// --- The canaries ---------------------------------------------------------------

/**
 * The two notebook credentials. Inert, and not credential-shaped. The first
 * carries a space, a slash, a plus and double quotes; the second a backslash
 * and a space: so each one's URL-encoded and JSON-escaped forms differ from it.
 */
const SOCRATA_CANARY = 'fixture socrata/p9+"canary"';
const DC_CANARY = 'fixture-dc\\p9 canary';
const VALUES = { SOCRATA_APP_TOKEN: SOCRATA_CANARY, DC_API_KEY: DC_CANARY };

function formsOf(value: string): string[] {
  return [...new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])];
}

/** Every form of both values, with the variable it belongs to, longest first. */
const FORMS: Array<[string, string]> = Object.entries(VALUES)
  .flatMap(([name, value]) => formsOf(value).map((form): [string, string] => [form, name]))
  .sort((a, b) => b[0].length - a[0].length);

/** This file's own statement of the expected text: every form replaced by its marker. */
function expectedText(text: string): string {
  let out = text;
  for (const [form, name] of FORMS) out = out.split(form).join(`[${name} removed]`);
  return out;
}

/** The expected document: `expectedText` over every key and every string, at any depth. */
function expectedDocument(value: unknown): unknown {
  if (typeof value === 'string') return expectedText(value);
  if (Array.isArray(value)) return value.map(expectedDocument);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [expectedText(k), expectedDocument(v)]));
  }
  return value;
}

/** Every key and every string in a JSON value, at any depth. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); stringsIn(v, out); }
  }
  return out;
}

/** The forms found anywhere in a JSON value, and in its serialization. */
function formsFoundIn(value: unknown): string[] {
  const strings = stringsIn(value);
  const serialized = JSON.stringify(value) ?? '';
  return FORMS.map(([form]) => form).filter(
    (form) => strings.some((s) => s.includes(form)) || serialized.includes(JSON.stringify(form).slice(1, -1)),
  );
}

// --- The notebook cell the fake nbconvert adds ----------------------------------

/**
 * The executed cell: what a model-written cell that printed every value it was
 * given, in the three forms, would leave in the executed notebook. Written out
 * as a module for the fake CLI too (`.toString()`), so it must not reach for
 * anything outside its own body.
 */
function printingCell(values: Record<string, string | undefined>): Record<string, unknown> {
  const E = '\u001b';
  const lines: string[] = [];
  const head: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    lines.push(`${name} raw ${value}`, `${name} url ${encodeURIComponent(value)}`, `${name} json ${JSON.stringify(value).slice(1, -1)}`);
    head[name.toLowerCase()] = value;
  }
  const text = lines.join('\n');
  return {
    cell_type: 'code',
    execution_count: 9,
    id: 'p9-printing-cell',
    metadata: {},
    source: [
      'import json, os, urllib.parse\n',
      "from IPython.display import HTML, display\n",
      "values = [(n, os.environ[n]) for n in ('SOCRATA_APP_TOKEN', 'DC_API_KEY')]\n",
      "text = '\\n'.join(f'{n} {k} {f}' for n, v in values for k, f in (('raw', v), ('url', urllib.parse.quote(v, safe=\"!~*'()\")), ('json', json.dumps(v)[1:-1])))\n",
      'print(text)\n',
      "print('_civic_capture=' + json.dumps({'df1': {'rows': 1, 'head': [{n.lower(): v for n, v in values}]}}))\n",
      'display(HTML(f"<pre>{text}</pre>"))\n',
      'try:\n',
      '    raise ValueError(text)\n',
      'except ValueError:\n',
      '    get_ipython().showtraceback()\n',
      'text',
    ],
    outputs: [
      { output_type: 'stream', name: 'stdout', text: lines.map((line) => `${line}\n`) },
      { output_type: 'stream', name: 'stdout', text: [`_civic_capture=${JSON.stringify({ df1: { rows: 1, head: [head] } })}\n`] },
      { output_type: 'display_data', metadata: {}, data: { 'text/html': [`<pre>${text}</pre>`], 'text/plain': ['<IPython.core.display.HTML object>'] } },
      {
        output_type: 'error',
        ename: 'ValueError',
        evalue: text,
        traceback: [
          `${E}[31m---------------------------------------------------------------------------${E}[39m`,
          `${E}[31mValueError${E}[39m                                Traceback (most recent call last)`,
          `${E}[32m----> ${E}[39m${E}[32m9${E}[39m     ${E}[38;5;28;01mraise${E}[39;00m ${E}[38;5;167;01mValueError${E}[39;00m(text)`,
          `${E}[31mValueError${E}[39m: ${text}`,
        ],
      },
      { output_type: 'execute_result', execution_count: 9, metadata: {}, data: { 'text/plain': [`'${text}'`] } },
    ],
  };
}

// --- Module hooks ---------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-516-p9-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': globalThis.__p9.ip }); }`,
  'next-auth': 'export async function getServerSession() { return null; }',
  '@/lib/auth': 'export const authOptions = {};',
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return { userId: 'fixture-account', scopes: ['records:publish'], method: 'bearer' }; }
    export function hasPublishScope() { return true; }`,
  '@/lib/evidence/unsigned-tier': `
    export function evaluateSealCommitGate() { return null; }
    export function evaluateUnsignedRecordPublishGate() { return null; }`,
  '@/lib/evidence/signing': `
    export function getConfiguredKeyId() { return 'fixture-kid'; }
    export function getActiveSigner() { return { bindingTier: 'self-asserted', identifier: 'fixture.invalid', displayName: 'Fixture' }; }
    export function signPackage() { return null; }
    export async function getRfc3161Timestamp() { return null; }
    export async function publishToRekor() { return null; }`,
  '@/lib/storage': `
    export async function putPackage(hash, pkg) { globalThis.__p9.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/pkg.json'; }
    export async function putCommittedPackage(pkg) { globalThis.__p9.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/sealed.json'; }`,
  '@/lib/db': `
    const selectChain = { from: () => selectChain, where: () => selectChain, limit: async () => [] };
    export const db = {
      select() { return selectChain; },
      insert() { return { values: async () => undefined }; },
    };`,
  '@/lib/evidence/publication': `
    export async function emitPublicationPair() { return { publishesNodeId: 'p', locatedAtNodeId: 'l' }; }`,
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
      throw new Error(`#516 P9 test hook: cannot resolve ${specifier}`);
    }
    // Next's bundler resolves an extensionless relative import; Node's does not.
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

// R6 W3 (#632): the consent gate is on, so each gated request carries a consent
// in force, built by the real encoder (`consentCookieForTests`).
const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

interface P9Globals { ip: string; stored: string[] }
const P9: P9Globals = { ip: '203.0.113.91', stored: [] };
(globalThis as unknown as { __p9: P9Globals }).__p9 = P9;

// --- The fake container CLI, written out for this run ---------------------------

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'civic-516-p9-'));
const CLI = path.join(WORK, 'fake-container-cli.mjs');
const CLI_LOG = path.join(WORK, 'cli-log.jsonl');
const STAGED = path.join(WORK, 'staged.ipynb');
const EXECUTED = path.join(WORK, 'executed.ipynb');

fs.writeFileSync(path.join(WORK, 'cell.mjs'), `export ${printingCell.toString()}\n`);
fs.writeFileSync(
  CLI,
  `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const record = (entry) => fs.appendFileSync(${JSON.stringify(CLI_LOG)}, JSON.stringify(entry) + '\\n');
if (args[0] === 'run') { record({ args }); process.stdout.write('p9fixturecontainer\\n'); process.exit(0); }
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
  if (command[0] === 'sh') {
    fs.writeFileSync(${JSON.stringify(STAGED)}, fs.readFileSync(0, 'utf8'));
    record({ args });
    process.exit(0);
  }
  if (command[0] === 'jupyter') {
    // docker semantics: \`-e NAME\` takes NAME's value from this process's environment.
    const values = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const { printingCell } = await import(${JSON.stringify(pathToFileURL(path.join(WORK, 'cell.mjs')).href)});
    const notebook = JSON.parse(fs.readFileSync(${JSON.stringify(STAGED)}, 'utf8'));
    notebook.cells.push(printingCell(values));
    const executed = JSON.stringify(notebook, null, 1);
    fs.writeFileSync(${JSON.stringify(EXECUTED)}, executed);
    record({ args, names, values });
    process.exit(0);
  }
  if (command[0] === 'cat') { process.stdout.write(fs.readFileSync(${JSON.stringify(EXECUTED)})); process.exit(0); }
  if (command[0] === 'python3') { process.stdout.write('3.13.0\\n'); process.exit(0); }
  record({ args });
}
process.exit(2);
`,
  { mode: 0o755 },
);

interface CliEntry { args: string[]; names?: string[]; values?: Record<string, string> }
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
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-p9-session' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-p9-stub', version: '0' } } }));
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
const scripted = await startScriptedModelServer([{ content: 'Twelve complaints were recorded.' }]);
scripted.server.unref();

// --- Environment, set before any app module loads -------------------------------

for (const name of ['MODEL_API_KEY', 'OPENAI_API_KEY', 'SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'SITE_SEAL_ONLY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'SANDBOX_SNAPSHOT_ID']) {
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
process.env.EXECUTOR_DRIVER = 'container';
process.env.EXECUTOR_CONTAINER_CLI = CLI;
// The packager names the instance in the signed provenance graph; fixture values.
process.env.PUBLISHER_PLATFORM_AGENT_TITLE = 'Fixture Instance';
process.env.PUBLISHER_SITE_ORIGIN = 'https://fixture.invalid';
process.env.PUBLISHER_KEY_ID = 'fixture-kid';
// The app's own copies of the two notebook credentials: what `buildNotebookEnv`
// passes into the notebook on the session path.
process.env.SOCRATA_APP_TOKEN = SOCRATA_CANARY;
process.env.DC_API_KEY = DC_CANARY;

// --- The drives -----------------------------------------------------------------

interface WireEvent { type: string; [key: string]: unknown }

const notebookRoute = (await import('./query-notebook/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };
const recordsRoute = (await import('./records/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };

const response = await notebookRoute.POST(new Request('http://localhost/api/query-notebook', {
  method: 'POST',
  headers: { cookie: consentCookieForTests() },
  body: JSON.stringify({ query: 'How many noise complaints were there last week?', portal: 'data.example.org' }),
}));
const STATUS = response.status;
const SSE = await response.text();
const EVENTS = SSE
  .split('\n\n')
  .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
  .filter((line): line is string => line !== undefined)
  .map((line) => JSON.parse(line.slice(6)) as WireEvent);
const NOTEBOOK_EVENT = EVENTS.find((e) => e.type === 'notebook');
const PUBLISH_INPUTS = EVENTS.find((e) => e.type === 'publish_inputs');
const STREAMED = (NOTEBOOK_EVENT?.notebook ?? null) as { cells: Array<Record<string, unknown>> } | null;
const CLI_ENTRIES = cliLog();
const EXECUTED_ON_DISK = fs.existsSync(EXECUTED)
  ? (JSON.parse(fs.readFileSync(EXECUTED, 'utf8')) as { cells: Array<Record<string, unknown>> })
  : null;
fs.rmSync(WORK, { recursive: true, force: true });

function publishBody(notebook: unknown): Record<string, unknown> {
  return {
    trace: (PUBLISH_INPUTS?.trace as Record<string, unknown> | undefined) ?? { resourceSpans: [] },
    prompt: 'How many noise complaints were there last week?',
    output: 'Twelve complaints were recorded.',
    toolCalls: [],
    model: 'fixture-fast',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    duration_ms: 1000,
    promptVisibility: 'full_text',
    captureMethod: 'chat-flow-stream',
    title: 'Noise complaints',
    summary: 'Twelve complaints.',
    extensions: { 'org.civicaitools.notebook': notebook },
  };
}

async function publish(notebook: unknown): Promise<{ status: number; stored: string[] }> {
  P9.stored = [];
  const res = await recordsRoute.POST(new Request('http://localhost/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(publishBody(notebook)),
  }));
  return { status: res.status, stored: [...P9.stored] };
}

const FROM_STREAM = await publish(STREAMED);

/** A publish body's notebook that already carries both values, in its outputs and elsewhere. */
const CARRYING = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
    extensions: { 'org.civicaitools.notebook': { provenance: 'executed' } },
    note: `left by ${SOCRATA_CANARY}`,
  },
  cells: [
    { cell_type: 'markdown', id: 'p9-cover', metadata: {}, source: ['# Noise complaints\n'] },
    printingCell(VALUES),
    {
      cell_type: 'code',
      execution_count: 10,
      id: 'p9-keyed',
      metadata: { tags: [DC_CANARY] },
      source: ['display({"application/json": {}}, raw=True)\n'],
      outputs: [{ output_type: 'display_data', metadata: { [encodeURIComponent(DC_CANARY)]: true }, data: { 'text/plain': ['{}'] } }],
    },
  ],
};
const FROM_BODY = await publish(CARRYING);

// --- Premises: the instrument reached what it measures -------------------------

test('premise: the route ran the notebook through the container stand-in and emitted a notebook event', () => {
  assert.equal(STATUS, 200, SSE.slice(-600));
  assert.ok(NOTEBOOK_EVENT, `no notebook event:\n${SSE.slice(-800)}`);
  assert.ok(!EVENTS.some((e) => e.type === 'error'), `the run failed:\n${JSON.stringify(EVENTS.find((e) => e.type === 'error'))}`);
  assert.ok(PUBLISH_INPUTS, 'no publish_inputs event');
});

test('premise: the notebook was handed both credentials, and its four kinds of output carried every form of both', () => {
  const nbconvert = CLI_ENTRIES.find((e) => e.args.includes('jupyter'));
  assert.ok(nbconvert, 'the fake CLI never ran nbconvert');
  assert.deepEqual([...(nbconvert!.names ?? [])].sort(), ['DC_API_KEY', 'SOCRATA_APP_TOKEN']);
  assert.deepEqual(nbconvert!.values, VALUES);
  const cell = EXECUTED_ON_DISK?.cells.find((c) => c.id === 'p9-printing-cell');
  assert.ok(cell, 'the executed notebook has no printing cell');
  const outputs = cell!.outputs as Array<Record<string, unknown>>;
  const kinds = {
    stdout: outputs.find((o) => o.output_type === 'stream'),
    execute_result: outputs.find((o) => o.output_type === 'execute_result'),
    display_data: outputs.find((o) => o.output_type === 'display_data'),
    error: outputs.find((o) => o.output_type === 'error'),
  };
  for (const [kind, output] of Object.entries(kinds)) {
    assert.ok(output, `no ${kind} output`);
    const strings = stringsIn(output);
    for (const [form] of FORMS) {
      assert.ok(strings.some((s) => s.includes(form)), `the ${kind} output does not carry ${JSON.stringify(form)}`);
    }
  }
});

test('premise: both publishes reached the storage put', () => {
  assert.equal(FROM_STREAM.status, 200, `the publish of the streamed notebook answered ${FROM_STREAM.status}`);
  assert.equal(FROM_STREAM.stored.length, 1);
  assert.equal(FROM_BODY.status, 200, `the publish of the carrying notebook answered ${FROM_BODY.status}`);
  assert.equal(FROM_BODY.stored.length, 1);
  assert.equal(formsFoundIn(CARRYING).length, FORMS.length, 'the carrying body does not carry every form');
});

// --- 1. The stream ----------------------------------------------------------------

test('1: the notebook event carries no form of either notebook credential', () => {
  assert.deepEqual(formsFoundIn(NOTEBOOK_EVENT), [], 'the notebook event carries a credential value');
});

test('1: no event on the wire carries a form of either notebook credential', () => {
  for (const event of EVENTS) {
    assert.deepEqual(formsFoundIn(event), [], `the ${event.type} event carries a credential value`);
  }
  for (const [form] of FORMS) {
    assert.ok(!SSE.includes(JSON.stringify(form).slice(1, -1)), `the stream carries ${JSON.stringify(form)}`);
  }
});

test('1: each value is replaced by a marker naming its variable, and the rest of each output is unchanged', () => {
  const cell = STREAMED?.cells.find((c) => c.id === 'p9-printing-cell');
  assert.ok(cell, 'the streamed notebook has no printing cell');
  assert.deepEqual(cell, expectedDocument(printingCell(VALUES)));
  const stdout = ((cell!.outputs as Array<Record<string, unknown>>)[0].text as string[]).join('');
  assert.equal(
    stdout,
    [
      'SOCRATA_APP_TOKEN raw [SOCRATA_APP_TOKEN removed]',
      'SOCRATA_APP_TOKEN url [SOCRATA_APP_TOKEN removed]',
      'SOCRATA_APP_TOKEN json [SOCRATA_APP_TOKEN removed]',
      'DC_API_KEY raw [DC_API_KEY removed]',
      'DC_API_KEY url [DC_API_KEY removed]',
      'DC_API_KEY json [DC_API_KEY removed]',
      '',
    ].join('\n'),
  );
});

test('1: the comparison cell the provenance stamp derives from the outputs carries the marker, not the value', () => {
  const comparison = STREAMED?.cells.find((c) => String(([] as string[]).concat(c.source as string[]).join('')).includes('original = '));
  assert.ok(comparison, 'no comparison cell');
  const source = ([] as string[]).concat(comparison!.source as string[]).join('');
  assert.deepEqual(formsFoundIn(comparison), [], `the comparison cell carries a credential value:\n${source}`);
  assert.ok(source.includes('[SOCRATA_APP_TOKEN removed]'), `the comparison cell lost the captured entry:\n${source}`);
});

// --- 2. The package ---------------------------------------------------------------

test('2: the notebook from the stream, published, gives stored bytes that carry neither value', () => {
  const bytes = FROM_STREAM.stored[0] ?? '';
  assert.deepEqual(formsFoundIn(JSON.parse(bytes || 'null')), [], 'the stored package carries a credential value');
  for (const [form] of FORMS) assert.ok(!bytes.includes(JSON.stringify(form).slice(1, -1)), `the stored bytes carry ${JSON.stringify(form)}`);
});

test('2: a publish body whose notebook already carries the values gives a package without them', () => {
  const bytes = FROM_BODY.stored[0] ?? '';
  assert.deepEqual(formsFoundIn(JSON.parse(bytes || 'null')), [], 'the stored package carries a credential value');
  for (const [form] of FORMS) assert.ok(!bytes.includes(JSON.stringify(form).slice(1, -1)), `the stored bytes carry ${JSON.stringify(form)}`);
});

test('2: the packaged notebook is the submitted one with each value replaced by its marker, and nothing else changed', () => {
  const pkg = JSON.parse(FROM_BODY.stored[0] ?? 'null') as { extensions?: Record<string, unknown> } | null;
  assert.deepEqual(pkg?.extensions?.['org.civicaitools.notebook'], expectedDocument(CARRYING));
});
