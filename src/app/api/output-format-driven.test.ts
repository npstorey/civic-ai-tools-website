// OF2 (Sprint OF-1, website #810; criteria 1, 3, 4, 5 and 7; the seat's S4, S8 and S9): the format a question asks
// for, at the two routes a question from the box reaches, and in the record a publish makes of the run.
//
// WHAT IS DRIVEN, end to end. The REAL `/api/compare-stream` (Standard) and `/api/query-notebook` (Sandbox) handlers,
// with the real consent gate, limiter, prompt composer, MCP client, loop core and trace builder; then the REAL publish
// handler (`/api/records`, which re-exports `/api/evidence`'s) and the real packager, over the trace each run emitted.
// The seams replaced, each where the real one would leave this machine or needs a request scope, as
// `hash-only-record-census-driven.test.ts` replaces them: `next/headers`, `next-auth`, `@/lib/auth`, `@/lib/api-auth`,
// `@/lib/sandbox` (returns the notebook it was given), `@/lib/evidence/unsigned-tier`, `@/lib/evidence/signing`,
// `@/lib/storage` (keeps the package it was handed, serialized), `@/lib/db`, `@/lib/evidence/publication`. The model
// and the MCP source are loopback servers that record every request. Every key is a placeholder.
//
// THE FORMAT. OF2 offers readers no format but "Auto" (G0-9 = A). The criteria that need another drive one this file
// registers for itself (`registerOutputFormatForTests`): test doubles live in test files.
//
// WHAT IS COUNTED for a refusal (criterion 4): the limiter's count for the requester (`checkRateLimit`, the real
// limiter's own read), every request to the model, and every request to the MCP source. The decoy: the accepted runs
// beside them move all three, so a zero is a measurement.
//
// WHAT MAKES IT ABLE TO FAIL. At the base (`407b68c`) the routes read no format: a request naming one runs as "Auto",
// is never refused, and its root span states nothing; and the publish handler copies the request's extensions through
// whole. Every red below fails at an assertion there; the pins hold there and after.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

const PORTAL = 'data.example.org';
const QUESTION = 'How many sidewalk repair permits were issued in 2025?';
const ANSWER = 'One figure was retrieved.';
const KEY = 'org.civicaitools.output-format';
const ATTRIBUTE = 'analysis.output_format';
const CODE = 'output_format_not_offered';

// --- Module hooks ------------------------------------------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-of2-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.81' }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__of2?.session ?? null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return { userId: 'fixture-account', scopes: ['records:publish'], method: 'bearer' }; }
    export function hasPublishScope() { return true; }`,
  '@/lib/sandbox': `
    import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
    export { NotebookExecutionError };
    export async function executeNotebook(notebook) {
      return { notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
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
    export async function putPackage(hash, pkg) { globalThis.__of2.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/pkg.json'; }
    export async function putCommittedPackage(pkg) { globalThis.__of2.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/sealed.json'; }`,
  '@/lib/db': `
    const selectChain = { from: () => selectChain, where: () => selectChain, limit: async () => [] };
    export const db = {
      select() { return selectChain; },
      insert() { return { values: async () => {} }; },
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
      throw new Error(`OF2 test hook: cannot resolve ${specifier}`);
    }
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

interface Of2Globals { stored: string[]; session: unknown }
const OF2: Of2Globals = { stored: [], session: null };
(globalThis as unknown as { __of2: Of2Globals }).__of2 = OF2;

const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- The loopback MCP source and model, recording every request ---------------------------------------------------

const ONE_ROW = JSON.stringify({ data: [{ count: '12' }], total_rows: 1 });
let MCP_REQUESTS = 0;
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  MCP_REQUESTS += 1;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-of2' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-of2-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

const TOOL_ARGS = { type: 'query', dataset_id: 'abcd-1234', query: 'SELECT count(*) AS n' };
const MODEL_REQUESTS: Array<Record<string, unknown>> = [];
const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    MODEL_REQUESTS.push(body);
    const messages = (body.messages ?? []) as Array<{ role?: string }>;
    const pickTools = Array.isArray(body.tools) && body.tools.length > 0 && !messages.some((m) => m.role === 'tool');
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-of2', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = [{ id: 'call-of2', type: 'function', function: { name: 'socrata__get_data', arguments: JSON.stringify(TOOL_ARGS) } }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-of2',
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
  });
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Environment, before any app module loads --------------------------------------------------------------------

for (const name of [
  'DATA_COMMONS_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'SITE_SEAL_ONLY', 'SITE_OUTPUT_FORMAT', 'MODEL_API_KEY',
  'OPENAI_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'EXECUTOR_DRIVER',
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'SOURCE_ROUTING', 'SOCRATA_APP_TOKEN', 'DC_API_KEY',
]) {
  delete process.env[name];
}
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-of2';
process.env.MODEL_API_BASE_URL = `${MODEL_ORIGIN}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  {
    id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true,
    endpointModel: 'example-fixture-deployment', model: 'vendor/model-fixture-1', default: true, evaluator: 1,
  },
]);
const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID = 'fixture-kid';

const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
_resetDefaultModelClientForTests();
const { checkRateLimit } = await import('../../lib/rate-limit.ts');
const { friendlyStreamError } = await import('../../lib/streaming.ts');

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The format module, once it exists (absent at the base). */
const registry: Mod | null = await import(pathToFileURL(path.join(SRC, 'lib/output-format/registry.ts')).href).catch(() => null);

/** The format this file registers for itself, offered; and one registered but not offered. */
const FORMAT = { id: 'fixture-format', version: '1' } as const;
registry?.registerOutputFormatForTests?.({ ...FORMAT, label: 'Fixture format', description: 'A format a test registers.', offered: true });
registry?.registerOutputFormatForTests?.({ id: 'fixture-retired', version: '1', label: 'Retired fixture', offered: false });

// --- The drives ----------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
interface Drive {
  name: string;
  status: number;
  text: string;
  modelRequests: Array<Record<string, unknown>>;
  mcpRequests: number;
  /** What the limiter counted for this requester during the drive. */
  counted: number;
}

const COOKIE = consentCookieForTests();
const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: COOKIE }, body: JSON.stringify(body) }) as never;
const compareStreamRoute = await import('./compare-stream/route.ts');
const notebookRoute = await import('./query-notebook/route.ts');
const recordsRoute = (await import('./records/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };

/** The requester as each route keys the limiter: the address signed out (Standard), the account signed in (Sandbox). */
const REQUESTER = { stream: ['203.0.113.81', false], notebook: ['fixture-account', true] } as const;
const remaining = async (route: keyof typeof REQUESTER) => (await checkRateLimit(REQUESTER[route][0], REQUESTER[route][1])).remaining;

async function drive(name: string, route: 'stream' | 'notebook', setting: 'on' | 'off' | undefined, extra: Json): Promise<Drive> {
  if (setting === undefined) delete process.env.SITE_OUTPUT_FORMAT;
  else process.env.SITE_OUTPUT_FORMAT = setting;
  const from = MODEL_REQUESTS.length;
  const mcpFrom = MCP_REQUESTS;
  const before = await remaining(route);
  try {
    let response: Response;
    if (route === 'stream') {
      response = await compareStreamRoute.POST(post('/api/compare-stream', { query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true, ...extra }));
    } else {
      OF2.session = { user: { id: 'fixture-account' } };
      try {
        response = await notebookRoute.POST(post('/api/query-notebook', { query: QUESTION, portal: PORTAL, ...extra }));
      } finally {
        OF2.session = null;
      }
    }
    const text = await response.text();
    return {
      name, status: response.status, text, modelRequests: MODEL_REQUESTS.slice(from), mcpRequests: MCP_REQUESTS - mcpFrom,
      counted: before - (await remaining(route)),
    };
  } finally {
    delete process.env.SITE_OUTPUT_FORMAT;
  }
}

const AUTO_OFF_STREAM = await drive('compare-stream, setting off, Auto', 'stream', undefined, {});
const AUTO_OFF_NOTEBOOK = await drive('query-notebook, setting off, Auto', 'notebook', undefined, {});
const AUTO_ON_STREAM = await drive('compare-stream, setting on, Auto', 'stream', 'on', {});
const AUTO_ON_NOTEBOOK = await drive('query-notebook, setting on, Auto', 'notebook', 'on', {});
const FORMAT_STREAM = await drive('compare-stream, setting on, the test format', 'stream', 'on', { outputFormat: { ...FORMAT } });
const FORMAT_NOTEBOOK = await drive('query-notebook, setting on, the test format', 'notebook', 'on', { outputFormat: { ...FORMAT } });
const REFUSED = [
  await drive('compare-stream, an id not offered', 'stream', 'on', { outputFormat: { id: 'not-a-format', version: '1' } }),
  await drive('compare-stream, a version not offered', 'stream', 'on', { outputFormat: { id: FORMAT.id, version: '2' } }),
  await drive('compare-stream, registered but not offered', 'stream', 'on', { outputFormat: { id: 'fixture-retired', version: '1' } }),
  await drive('compare-stream, not an object', 'stream', 'on', { outputFormat: FORMAT.id }),
  await drive('compare-stream, null', 'stream', 'on', { outputFormat: null }),
  await drive('compare-stream, setting off, a format', 'stream', 'off', { outputFormat: { ...FORMAT } }),
  await drive('compare-stream, setting unset, a format', 'stream', undefined, { outputFormat: { ...FORMAT } }),
  await drive('query-notebook, an id not offered', 'notebook', 'on', { outputFormat: { id: 'not-a-format', version: '1' } }),
  await drive('query-notebook, a version not offered', 'notebook', 'on', { outputFormat: { id: FORMAT.id, version: '2' } }),
  await drive('query-notebook, setting off, a format', 'notebook', 'off', { outputFormat: { ...FORMAT } }),
];
const ACCEPTED = [AUTO_OFF_STREAM, AUTO_OFF_NOTEBOOK, AUTO_ON_STREAM, AUTO_ON_NOTEBOOK, FORMAT_STREAM, FORMAT_NOTEBOOK];

// --- Readers --------------------------------------------------------------------------------------------------------

interface Span { name: string; parentSpanId?: string; attributes: Array<{ key: string; value: { stringValue?: string } }> }
function events(d: Drive): Json[] {
  return d.text.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice('data: '.length)) as Json]; } catch { return []; }
  });
}
function jsonOf(d: Drive): Json | null {
  try { return JSON.parse(d.text) as Json; } catch { return null; }
}
function traceOf(d: Drive): Json {
  const all = events(d);
  const trace = (all.find((e) => e.type === 'trace')?.data ?? (all.find((e) => e.type === 'publish_inputs') as Json | undefined)?.trace) as Json | undefined;
  assert.ok(trace, `${d.name}: premise: the route emitted no trace (status ${d.status}):\n${d.text.slice(0, 600)}`);
  return trace!;
}
function rootAttributes(d: Drive): Record<string, string> {
  const spans = (traceOf(d) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find((s) => !s.parentSpanId);
  assert.ok(root, `${d.name}: premise: the trace has no root span`);
  return Object.fromEntries(root!.attributes.map((a) => [a.key, a.value.stringValue ?? '']));
}
/** The system prompt of the first request that offered the model tools: the composed prompt. */
function composedPrompt(d: Drive): string {
  const first = d.modelRequests.find((r) => Array.isArray(r.tools) && (r.tools as unknown[]).length > 0);
  assert.ok(first, `${d.name}: premise: no model request offered a tool`);
  const system = ((first!.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
  assert.ok(typeof system?.content === 'string' && system.content.length > 0, `${d.name}: premise: no system prompt`);
  return system!.content as string;
}

/** Publish a run's trace through the real handler, with the extensions given; the package as stored. */
async function publish(trace: Json, extensions?: Json): Promise<Json> {
  OF2.stored = [];
  const res = await recordsRoute.POST(new Request('http://localhost/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace,
      prompt: QUESTION,
      output: ANSWER,
      toolCalls: [],
      model: 'fixture-fast',
      tokenUsage: { promptTokens: 10, completionTokens: 5 },
      promptVisibility: 'full_text',
      captureMethod: 'chat-flow-stream',
      title: 'Fixture record',
      summary: 'A fixture.',
      visibility: 'sealed',
      ...(extensions ? { extensions } : {}),
    }),
  }));
  assert.equal(res.status, 200, `the publish was refused: ${await res.clone().text()}`);
  assert.equal(OF2.stored.length, 1, 'premise: the handler stored one package');
  return JSON.parse(OF2.stored[0]) as Json;
}
const extensionsOf = (pkg: Json): Json => (pkg.extensions ?? {}) as Json;

// --- The decoy, first: an accepted run moves every count a refusal must not ------------------------------------------

test('premise (decoy able to fail): every accepted run is counted by the limiter, calls the model and calls the source', () => {
  for (const d of ACCEPTED) {
    assert.equal(d.counted, 1, `${d.name}: the limiter counted ${d.counted} (status ${d.status}): ${d.text.slice(0, 300)}`);
    assert.ok(d.modelRequests.length > 0, `${d.name}: the model was not called`);
    assert.ok(d.mcpRequests > 0, `${d.name}: the source was not called`);
  }
});

// --- Criterion 4: the format rides the send, and a format not offered is refused before anything is spent ------------

for (const d of REFUSED) {
  test(`criterion 4 (red) (${d.name}): refused at the picks' point: no limiter count, no model call, no source call`, () => {
    const refusal = (events(d).find((e) => e.type === 'error') ?? jsonOf(d)) as Json | null;
    assert.ok(refusal, `${d.name}: no refusal (status ${d.status}): ${d.text.slice(0, 400)}`);
    assert.equal(refusal!.code, CODE, `${d.name}: answered ${d.status}: ${d.text.slice(0, 400)}`);
    assert.equal(d.counted, 0, `${d.name}: the limiter counted the request`);
    assert.equal(d.modelRequests.length, 0, `${d.name}: the model was called`);
    assert.equal(d.mcpRequests, 0, `${d.name}: the source was contacted`);
  });
}

test('criterion 4 (red): the refusal\'s channel is the picks\' own: an error event per panel (Standard), a 403 JSON body (Sandbox)', () => {
  const stream = REFUSED.filter((d) => d.name.startsWith('compare-stream'));
  const notebook = REFUSED.filter((d) => d.name.startsWith('query-notebook'));
  for (const d of stream) {
    assert.equal(d.status, 200, d.name);
    const errors = events(d).filter((e) => e.type === 'error');
    assert.deepEqual(errors.map((e) => [e.panel, e.code]), [['withMcp', CODE]], `${d.name}: ${d.text.slice(0, 300)}`);
  }
  for (const d of notebook) {
    assert.equal(d.status, 403, `${d.name}: ${d.text.slice(0, 300)}`);
    assert.equal(jsonOf(d)?.code, CODE, d.name);
  }
});

test('criterion 4 (red): the refusal reads reader-facing words, never a raw message', () => {
  const words: string = friendlyStreamError({ code: CODE });
  assert.notEqual(words, friendlyStreamError({ code: 'generic' }), 'the refusal reads as the generic failure');
  for (const d of REFUSED) {
    const refusal = (events(d).find((e) => e.type === 'error') ?? jsonOf(d)) as Json | null;
    assert.equal(refusal?.message ?? refusal?.error, words, d.name);
  }
});

test('criterion 4 (red): with the test format chosen, both routes run, and each root span states the format asked', () => {
  for (const d of [FORMAT_STREAM, FORMAT_NOTEBOOK]) {
    const root = rootAttributes(d);
    assert.equal(root[ATTRIBUTE], JSON.stringify({ id: FORMAT.id, version: FORMAT.version }), `${d.name}: ${JSON.stringify(Object.keys(root))}`);
  }
});

// --- Criteria 1 and 3 (pins): with the setting off, or with "Auto", the run is the base's --------------------------------

/** The root span's keys an "Auto" run states, measured at the base (`407b68c`) by this file, in order. */
const BASE_ROOT_KEYS = {
  stream: ['analysis.prompt_hash', 'analysis.model', 'analysis.portal', 'analysis.asserted_date', 'analysis.mcp_servers', 'analysis.tool_definitions', 'analysis.sources_offered', 'analysis.components', 'analysis.flows_statement'],
  notebook: ['analysis.prompt_hash', 'analysis.model', 'analysis.portal', 'analysis.asserted_date', 'analysis.mcp_servers', 'analysis.tool_definitions', 'analysis.sources_offered', 'analysis.flows_statement', 'analysis.components'],
} as const;

test('criteria 1 and 3 (pin): an "Auto" run states the base\'s root-span keys, with the setting off and on', () => {
  for (const [d, keys] of [
    [AUTO_OFF_STREAM, BASE_ROOT_KEYS.stream], [AUTO_ON_STREAM, BASE_ROOT_KEYS.stream],
    [AUTO_OFF_NOTEBOOK, BASE_ROOT_KEYS.notebook], [AUTO_ON_NOTEBOOK, BASE_ROOT_KEYS.notebook],
  ] as const) {
    assert.deepEqual(Object.keys(rootAttributes(d)), keys, d.name);
  }
});

test('criterion 3 (pin): the composed system prompt is the same with the setting off, on with "Auto", and on with a format', () => {
  assert.equal(composedPrompt(AUTO_ON_STREAM), composedPrompt(AUTO_OFF_STREAM));
  assert.equal(composedPrompt(FORMAT_STREAM), composedPrompt(AUTO_OFF_STREAM));
  assert.equal(composedPrompt(AUTO_ON_NOTEBOOK), composedPrompt(AUTO_OFF_NOTEBOOK));
  assert.equal(composedPrompt(FORMAT_NOTEBOOK), composedPrompt(AUTO_OFF_NOTEBOOK));
});

// --- Criteria 5 and 7: the record, through the real publish handler --------------------------------------------------

test('criterion 5 (red): a record of a run in the test format carries extensions["org.civicaitools.output-format"].preset = { id, version }', async () => {
  for (const d of [FORMAT_STREAM, FORMAT_NOTEBOOK]) {
    const pkg = await publish(traceOf(d));
    assert.deepEqual(extensionsOf(pkg)[KEY], { preset: { id: FORMAT.id, version: FORMAT.version } }, `${d.name}: ${JSON.stringify(extensionsOf(pkg))}`);
  }
});

test('criterion 5: a record of an "Auto" run has no such key, with the setting off or on', async () => {
  for (const d of [AUTO_OFF_STREAM, AUTO_ON_STREAM, AUTO_OFF_NOTEBOOK, AUTO_ON_NOTEBOOK]) {
    const pkg = await publish(traceOf(d));
    assert.ok(!(KEY in extensionsOf(pkg)), `${d.name}: ${JSON.stringify(extensionsOf(pkg))}`);
  }
});

test('criterion 7 (red): the key is written from the run\'s root span: a key of that name in the publish request is replaced', async () => {
  const forged = { [KEY]: { preset: { id: 'forged-format', version: '9' } }, 'org.example.other': { kept: true } };
  for (const d of [FORMAT_STREAM, FORMAT_NOTEBOOK]) {
    const pkg = await publish(traceOf(d), forged);
    assert.deepEqual(extensionsOf(pkg)[KEY], { preset: { id: FORMAT.id, version: FORMAT.version } }, d.name);
    assert.deepEqual(extensionsOf(pkg)['org.example.other'], { kept: true }, `${d.name}: another extension did not pass through`);
  }
});

test('criterion 7 (red): under "Auto" the key is absent from the record even when the publish request carries one', async () => {
  const forged = { [KEY]: { preset: { id: FORMAT.id, version: FORMAT.version } } };
  for (const d of [AUTO_OFF_STREAM, AUTO_ON_STREAM, AUTO_OFF_NOTEBOOK, AUTO_ON_NOTEBOOK]) {
    const pkg = await publish(traceOf(d), forged);
    assert.ok(!(KEY in extensionsOf(pkg)), `${d.name}: the request's key reached an "Auto" record: ${JSON.stringify(extensionsOf(pkg))}`);
  }
});
