// OF3a (Sprint OF-1, website #810; criteria 1 to 6): a question asked in a map format, run by the REAL
// `/api/compare-stream` handler and published through the REAL `/api/records` handler and packager.
//
// WHAT IS DRIVEN. The route, the consent gate, the limiter, the prompt composer, the MCP client, the loop core, the
// trace builder, the publish handler and the packager are the real ones. The seams replaced, as OF2's
// `output-format-driven.test.ts` replaces them: `next/headers`, `next-auth`, `@/lib/auth`, `@/lib/api-auth`,
// `@/lib/sandbox`, `@/lib/evidence/unsigned-tier`, `@/lib/evidence/signing`, `@/lib/storage`, `@/lib/db`,
// `@/lib/evidence/publication`. The model and the MCP source are loopback servers: the model follows a script of tool
// calls per drive, and the source answers each `get_data` call with the rows its `dataset_id` names.
//
// THE CLOCK AND THE RANDOMNESS ARE FIXED (criterion 6's pin): `Date` is mocked to one instant, and
// `crypto.getRandomValues` / `crypto.randomUUID` are a counter, so two runs of one drive make the same bytes, and the
// "Auto" pins below compare digests measured at the base (`bd1f978`, harness 0.15.0) by this file.
//
// THE FORMAT. This file registers its own map format (`registerOutputFormatForTests`, `kind: 'map'`), offered: the
// site's own `plain-map` is registered but not yet offered (OF3b offers it with its menu).
//
// WHAT MAKES IT ABLE TO FAIL. At the base the loop has no present step: a `present_result` call goes to the source as
// any call does, the route offers no such tool and writes no outcome, and the record carries `preset` alone. Every
// red below fails at an assertion there.
//
// Run with: npm test

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import nodeCrypto, { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- A fixed clock and fixed randomness, before any app module loads -----------------------------------------------

mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-20T12:00:00.000Z') });
let randomCounter = 0;
const fixedRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
  if (array) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (randomCounter++ * 131 + 7) & 0xff;
  }
  return array;
};
const fixedUuid = () => {
  const hex = Array.from({ length: 16 }, () => ((randomCounter++ * 37 + 11) & 0xff).toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` as `${string}-${string}-${string}-${string}-${string}`;
};
Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: fixedRandomValues, configurable: true, writable: true });
Object.defineProperty(globalThis.crypto, 'randomUUID', { value: fixedUuid, configurable: true, writable: true });
(nodeCrypto as unknown as { randomUUID: () => string }).randomUUID = fixedUuid;
nodeModule.syncBuiltinESMExports();

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
const KEY = 'org.civicaitools.output-format';
/** A word that is in the question and the AI's answer, and in no row. */
const TOKEN = 'ZQXTOKEN';
const QUESTION = `Where were the ${TOKEN} complaints filed?`;
/** A coordinate pair that appears only in the AI's answer. */
const TEXT_LAT = 40.999111;
const TEXT_LON = -73.111999;
const ANSWER = `The ${TOKEN} complaints cluster near ${TEXT_LAT}, ${TEXT_LON}.`;

// --- Module hooks (OF2's, unchanged) -----------------------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-of3a-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  // One requester per drive, so the anonymous limit never refuses one.
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.' + globalThis.__of3a.requester }); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__of3a.session ?? null; }`,
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
    export async function putPackage(hash, pkg) { globalThis.__of3a.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/pkg.json'; }
    export async function putCommittedPackage(pkg) { globalThis.__of3a.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/sealed.json'; }
    export async function findBlob() { return null; }
    export async function putBlob() { return 'https://storage.invalid/blob'; }
    export async function getBlobText() { return null; }`,
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
      throw new Error(`OF3a test hook: cannot resolve ${specifier}`);
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
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json') && !loadUrl.includes('/node_modules/')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

interface Of3aGlobals { stored: string[]; requester: number; session: unknown }
const OF3A: Of3aGlobals = { stored: [], requester: 0, session: null };
(globalThis as unknown as { __of3a: Of3aGlobals }).__of3a = OF3A;

const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- The rows each dataset answers with -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
/** Five rows: two located by a latitude and longitude pair, one by a point column, two with no location. */
const POINT_ROWS: Row[] = [
  { unique_key: 'k1', complaint_type: 'Noise', latitude: '40.712801', longitude: '-73.990001' },
  { unique_key: 'k2', complaint_type: 'Heat', latitude: '40.720002', longitude: '-73.980003' },
  { unique_key: 'k3', complaint_type: 'Noise' },
  { unique_key: 'k4', complaint_type: 'Rodent', location: { type: 'Point', coordinates: [-73.950004, 40.750005] } },
  { unique_key: 'k5', complaint_type: 'Heat', latitude: 'not a number', longitude: '-73.9' },
];
/** 1,203 rows; every 23rd has no location. */
const CAP_ROWS: Row[] = Array.from({ length: 1203 }, (_unused, i) =>
  i % 23 === 0
    ? { unique_key: `c${i}`, complaint_type: `Type ${i % 7}` }
    : { unique_key: `c${i}`, complaint_type: `Type ${i % 7}`, latitude: (40.5 + i / 10000).toFixed(6), longitude: (-74 + i / 10000).toFixed(6) });
const DATASETS: Record<string, Row[] | 'fail'> = {
  'cnt0-0001': [{ count: '12' }],
  'pts1-0001': POINT_ROWS,
  'cap1-0001': CAP_ROWS,
  'nolc-0001': [{ complaint_type: 'Noise', borough: 'Bronx' }, { complaint_type: 'Heat', borough: 'Queens' }],
  'null-0002': [{ complaint_type: 'Noise', latitude: null, longitude: null }, { complaint_type: 'Heat', latitude: 'n/a', longitude: 'n/a' }],
  'null-0001': [{ complaint_type: 'Noise', latitude: null, longitude: null }],
  'none-0000': [],
  'fail-0001': 'fail',
};

let MCP_REQUESTS: Array<{ method?: string; name?: string }> = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }) : {};
  MCP_REQUESTS.push({ method: msg.method, name: msg.params?.name });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-of3a' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-of3a-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  const rows = DATASETS[String(msg.params?.arguments?.dataset_id ?? 'cnt0-0001')] ?? DATASETS['cnt0-0001'];
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (rows === 'fail') {
    res.end(`event: message\ndata: ${reply({ result: { isError: true, content: [{ type: 'text', text: 'fixture: the source failed' }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify({ data: rows, total_rows: (rows as Row[]).length }) }] } })}\n\n`);
});
// Fixed ports: the flows statement's hash, and so the record's content hash, covers the sources' addresses.
await new Promise<void>((resolve) => mcp.listen(47831, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// --- The model, following one script of tool calls per drive ----------------------------------------------------------

interface ScriptedCall { name: string; args: Record<string, unknown> }
let SCRIPT: ScriptedCall[] = [];
let MODEL_REQUESTS: Array<Record<string, unknown>> = [];
const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(raw) as Record<string, unknown>;
    MODEL_REQUESTS.push(body);
    const messages = (body.messages ?? []) as Array<{ role?: string; tool_calls?: unknown }>;
    const turn = messages.filter((m) => m.role === 'assistant' && m.tool_calls).length;
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-of3a', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const next = Array.isArray(body.tools) && body.tools.length > 0 ? SCRIPT[turn] : undefined;
    const toolCalls = next ? [{ id: `call-of3a-${turn}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] : undefined;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-of3a',
      object: 'chat.completion',
      created: 1,
      model: 'fake/model',
      choices: [{ index: 0, message: { role: 'assistant', content: next ? null : ANSWER, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: next ? 'tool_calls' : 'stop' }],
      usage,
    }));
  });
});
await new Promise<void>((resolve) => model.listen(47832, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Environment, before any app module loads --------------------------------------------------------------------

for (const name of [
  'DATA_COMMONS_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'SITE_SEAL_ONLY', 'SITE_OUTPUT_FORMAT', 'MODEL_API_KEY',
  'OPENAI_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'EXECUTOR_DRIVER',
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'SOURCE_ROUTING', 'SOCRATA_APP_TOKEN', 'DC_API_KEY',
  'CKAN_MCP_URL', 'BOSTON_MCP_URL',
]) {
  delete process.env[name];
}
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-of3a';
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

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const importOrNull = (relative: string): Promise<Mod | null> =>
  import(pathToFileURL(path.join(SRC, relative)).href).catch(() => null);
const registry = (await importOrNull('lib/output-format/registry.ts'))!;
/** The present step's module and the map builder, once they exist (absent at the base). */
const presentModule = await importOrNull('lib/output-format/present-step.ts');

/** The map format this file registers for itself, offered. */
const MAP_FORMAT = { id: 'fixture-map', version: '1' } as const;
registry.registerOutputFormatForTests({ ...MAP_FORMAT, label: 'Fixture map', description: 'A map format a test registers.', offered: true, kind: 'map' });

const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');
const verifyCore = await import('@typedstandards/verify-core');
const verifyCoreVersion = (await import('@typedstandards/verify-core/package.json', { with: { type: 'json' } })).default.version;
const { ed25519ph, ed25519 } = await import('@noble/curves/ed25519.js');
const { default: Ajv2020 } = (await import('ajv/dist/2020.js')) as unknown as { default: new (options: Record<string, unknown>) => { compile(schema: unknown): ((data: unknown) => boolean) & { errors?: unknown } } };
const SCHEMA = JSON.parse(fs.readFileSync(path.join(SRC, 'lib/output-format/schema/squidmaps-map.d7cdb725.schema.json'), 'utf8')) as Record<string, unknown>;
const validateMap = new Ajv2020({ strict: false, validateFormats: false }).compile(SCHEMA);

// --- The drives ----------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
interface Drive {
  name: string;
  status: number;
  text: string;
  modelRequests: Array<Record<string, unknown>>;
  mcpRequests: Array<{ method?: string; name?: string }>;
}

const COOKIE = consentCookieForTests();
const compareStreamRoute = await import('./compare-stream/route.ts');
const recordsRoute = (await import('./records/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };

const getData = (dataset: string): ScriptedCall => ({ name: 'socrata__get_data', args: { type: 'query', dataset_id: dataset, query: 'SELECT *' } });
const present = (result: unknown, label: unknown): ScriptedCall => ({ name: 'present_result', args: { result, label } });

async function drive(name: string, script: ScriptedCall[], options: { format?: boolean; routing?: 'in-loop' } = {}): Promise<Drive> {
  process.env.SITE_OUTPUT_FORMAT = 'on';
  if (options.routing) process.env.SOURCE_ROUTING = options.routing;
  SCRIPT = script;
  MODEL_REQUESTS = [];
  MCP_REQUESTS = [];
  randomCounter = 0;
  OF3A.requester += 1;
  try {
    const response = await compareStreamRoute.POST(new Request('http://localhost/api/compare-stream', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true, ...(options.format ? { outputFormat: { ...MAP_FORMAT } } : {}) }),
    }) as never);
    const text = await response.text();
    return { name, status: response.status, text, modelRequests: MODEL_REQUESTS, mcpRequests: MCP_REQUESTS };
  } finally {
    delete process.env.SITE_OUTPUT_FORMAT;
    delete process.env.SOURCE_ROUTING;
  }
}

const AUTO_ALL = await drive('Auto, all sources', [getData('cnt0-0001')]);
const AUTO_IN_LOOP = await drive('Auto, in loop', [{ name: 'load_source', args: { alias: 'socrata' } }, getData('cnt0-0001')], { routing: 'in-loop' });
const MAP_POINTS = await drive('map: points', [getData('cnt0-0001'), getData('pts1-0001'), present(2, 'complaint_type')], { format: true });
const MAP_CAP = await drive('map: over the cap', [getData('cap1-0001'), present(1, 'complaint_type')], { format: true });
const MAP_IN_LOOP = await drive('map: in loop', [{ name: 'load_source', args: { alias: 'socrata' } }, getData('pts1-0001'), present(2, 'complaint_type')], { format: true, routing: 'in-loop' });
const MAP_NO_SUCH_RESULT = await drive('map: a result that names no call', [getData('pts1-0001'), present(7, 'complaint_type')], { format: true });
const MAP_NO_SUCH_LABEL = await drive('map: a label the result lacks', [getData('pts1-0001'), present(1, 'not_a_column')], { format: true });
const MAP_NOT_CALLED = await drive('map: the step never called', [getData('pts1-0001')], { format: true });
const MAP_NO_LOCATION_COLUMNS = await drive('map: no location column', [getData('nolc-0001'), present(1, 'complaint_type')], { format: true });
const MAP_NONE_LOCATED_2 = await drive('map: none of 2 rows located', [getData('null-0002'), present(1, 'complaint_type')], { format: true });
const MAP_NONE_LOCATED_1 = await drive('map: the one row not located', [getData('null-0001'), present(1, 'complaint_type')], { format: true });
const MAP_NO_ROWS = await drive('map: no rows', [getData('none-0000'), present(1, 'complaint_type')], { format: true });
const MAP_RESULT_FAILED = await drive('map: the named call failed', [getData('fail-0001'), present(1, 'complaint_type')], { format: true });
/** A Sandbox question in a map format (K3 = A: maps are Standard-session only), as OF2 drives the notebook route. */
const notebookRoute = await import('./query-notebook/route.ts');
async function sandboxMapDrive(): Promise<{ status: number; body: string; modelRequests: number }> {
  process.env.SITE_OUTPUT_FORMAT = 'on';
  MODEL_REQUESTS = [];
  OF3A.requester += 1;
  OF3A.session = { user: { id: 'fixture-account' } };
  try {
    const response = await notebookRoute.POST(new Request('http://localhost/api/query-notebook', {
      method: 'POST',
      headers: { cookie: COOKIE },
      body: JSON.stringify({ query: QUESTION, portal: PORTAL, outputFormat: { ...MAP_FORMAT } }),
    }) as never);
    const body = await response.text();
    return { status: response.status, body, modelRequests: MODEL_REQUESTS.length };
  } finally {
    OF3A.session = null;
    delete process.env.SITE_OUTPUT_FORMAT;
  }
}
const SANDBOX_MAP = await sandboxMapDrive();
const MAP_RUNS = [MAP_POINTS, MAP_CAP, MAP_IN_LOOP, MAP_NO_SUCH_RESULT, MAP_NO_SUCH_LABEL, MAP_NOT_CALLED, MAP_NO_LOCATION_COLUMNS, MAP_NONE_LOCATED_2, MAP_NONE_LOCATED_1, MAP_NO_ROWS, MAP_RESULT_FAILED];

// --- Readers --------------------------------------------------------------------------------------------------------

interface Span { name: string; parentSpanId?: string; attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }> }
function events(d: Drive): Json[] {
  return d.text.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice('data: '.length)) as Json]; } catch { return []; }
  });
}
function traceOf(d: Drive): Json {
  const trace = events(d).find((e) => e.type === 'trace')?.data as Json | undefined;
  assert.ok(trace, `${d.name}: premise: the route emitted no trace (status ${d.status}):\n${d.text.slice(0, 600)}`);
  return trace!;
}
function spansOf(d: Drive): Span[] {
  return (traceOf(d) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
}
const attrs = (span: Span) => Object.fromEntries(span.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.boolValue]));
function toolCallsOf(d: Drive): Json[] {
  const complete = events(d).find((e) => e.type === 'complete' && e.panel === 'withMcp')?.data as { tools_called?: Json[] } | undefined;
  assert.ok(complete, `${d.name}: premise: the run did not complete:\n${d.text.slice(0, 600)}`);
  return complete!.tools_called ?? [];
}
function systemPromptOf(request: Record<string, unknown>): string {
  const system = ((request.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : '';
}
const toolNamesOf = (request: Record<string, unknown>): string[] =>
  ((request.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '');

/** Publish a run through the real handler, with its own calls; the package as stored. */
async function publish(d: Drive, extensions?: Json): Promise<Json> {
  OF3A.stored = [];
  randomCounter = 0;
  const res = await recordsRoute.POST(new Request('http://localhost/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace: traceOf(d),
      prompt: QUESTION,
      output: ANSWER,
      toolCalls: toolCallsOf(d),
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
  assert.equal(res.status, 200, `${d.name}: the publish was refused: ${await res.clone().text()}`);
  assert.equal(OF3A.stored.length, 1, 'premise: the handler stored one package');
  return JSON.parse(OF3A.stored[0]) as Json;
}
const RECORDS = new Map<Drive, Json>();
async function recordOf(d: Drive): Promise<Json> {
  if (!RECORDS.has(d)) RECORDS.set(d, await publish(d));
  return RECORDS.get(d)!;
}
async function formatOf(d: Drive): Promise<Json> {
  const ext = ((await recordOf(d)).extensions ?? {}) as Json;
  assert.ok(KEY in ext, `${d.name}: the record has no ${KEY} key: ${JSON.stringify(Object.keys(ext))}`);
  return ext[KEY] as Json;
}

/** The rows a fixture located, by position from 1, as the test reads them (independently of the builder). */
function expectedLocated(rows: Row[]): Array<{ id: string; lon: number; lat: number; name: unknown }> {
  const out: Array<{ id: string; lon: number; lat: number; name: unknown }> = [];
  rows.forEach((row, i) => {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    const loc = row.location as { coordinates?: number[] } | undefined;
    if (typeof row.latitude === 'string' && Number.isFinite(lat) && Number.isFinite(lon)) out.push({ id: String(i + 1), lon, lat, name: row.complaint_type });
    else if (loc?.coordinates) out.push({ id: String(i + 1), lon: loc.coordinates[0], lat: loc.coordinates[1], name: row.complaint_type });
  });
  return out;
}

// --- Premises ---------------------------------------------------------------------------------------------------------

test('premise: every drive ran to completion and emitted its trace', () => {
  for (const d of [AUTO_ALL, AUTO_IN_LOOP, ...MAP_RUNS]) {
    assert.equal(d.status, 200, d.name);
    toolCallsOf(d);
    traceOf(d);
  }
});

// --- Criterion 1: the map is the named result's located rows, one for one -------------------------------------------

test('criterion 1 (red): the map\'s features are the named result\'s located rows, one for one, each carrying its row\'s id', async () => {
  for (const d of [MAP_POINTS, MAP_IN_LOOP]) {
    const format = await formatOf(d);
    const map = format.map as { features: Array<{ id: string; geometry: { coordinates: number[] }; properties: Json }> } | undefined;
    assert.ok(map, `${d.name}: the record has no map: ${JSON.stringify(format).slice(0, 400)}`);
    const expected = expectedLocated(POINT_ROWS);
    assert.deepEqual(map!.features.map((f) => f.id), expected.map((e) => e.id), d.name);
    assert.deepEqual(map!.features.map((f) => f.geometry.coordinates), expected.map((e) => [e.lon, e.lat]), d.name);
    assert.deepEqual(map!.features.map((f) => f.properties.name), expected.map((e) => e.name), d.name);
    assert.deepEqual(format.outcome, { drawn: true }, d.name);
    assert.deepEqual(format.counts, { returned: 5, drawn: 3, withoutLocation: 2, beyondCap: 0 }, d.name);
  }
});

test('criterion 1 (red): over 1,000 located rows the map keeps the first 1,000 in the source\'s order, and the counts say so', async () => {
  const format = await formatOf(MAP_CAP);
  const located = expectedLocated(CAP_ROWS);
  assert.ok(located.length > 1000, 'premise: the fixture holds more than 1,000 located rows');
  const counts = format.counts as Record<string, number>;
  assert.deepEqual(counts, { returned: 1203, drawn: 1000, withoutLocation: 1203 - located.length, beyondCap: located.length - 1000 });
  assert.equal(counts.drawn + counts.withoutLocation + counts.beyondCap, counts.returned);
  const features = (format.map as { features: Array<{ id: string }> }).features;
  assert.deepEqual(features.map((f) => f.id), located.slice(0, 1000).map((e) => e.id));
});

test('criterion 1 (red): every record that carries counts states drawn + withoutLocation + beyondCap = returned', async () => {
  let carried = 0;
  for (const d of MAP_RUNS) {
    const counts = (await formatOf(d)).counts as Record<string, number> | undefined;
    if (!counts) continue;
    carried += 1;
    assert.equal(counts.drawn + counts.withoutLocation + counts.beyondCap, counts.returned, d.name);
  }
  assert.ok(carried >= 7, `premise: ${carried} records carried counts`);
});

// --- Criterion 2: the builder reads rows only -----------------------------------------------------------------------

test('criterion 2 (red): a coordinate in the AI\'s text only never reaches the map; no free-text field carries the question or the answer', async () => {
  for (const d of [MAP_POINTS, MAP_CAP, MAP_IN_LOOP]) {
    const answer = (events(d).find((e) => e.type === 'complete' && e.panel === 'withMcp')?.data as { content?: string } | undefined)?.content ?? '';
    assert.ok(answer.includes(String(TEXT_LAT)) && answer.includes(TOKEN), `${d.name}: premise: the answer carries the text-only coordinate and the question's word`);
    const map = (await formatOf(d)).map as { name: string; description: string; legend: unknown; features: Array<{ geometry: { coordinates: number[] } }> };
    assert.ok(map, `${d.name}: no map`);
    const coordinates = map.features.flatMap((f) => f.geometry.coordinates);
    assert.ok(!coordinates.includes(TEXT_LAT) && !coordinates.includes(TEXT_LON), `${d.name}: the answer's coordinate reached the map`);
    const freeText = JSON.stringify({ name: map.name, description: map.description, legend: map.legend });
    assert.ok(!freeText.includes(TOKEN), `${d.name}: a free-text field carries the question's word: ${freeText}`);
    assert.ok(!JSON.stringify(map).includes(TOKEN), `${d.name}: the map carries the question's word`);
  }
});

// --- Criterion 3: the step's arguments are identifiers; each no-map reason is driven --------------------------------

/** The present span of a run (the last one), with its attributes. */
function presentSpan(d: Drive): Record<string, unknown> | undefined {
  const found = spansOf(d).filter((s) => s.name === 'mcp_tool_call' && attrs(s)['tool.operation_type'] === 'present_result');
  return found.length > 0 ? attrs(found[found.length - 1]) : undefined;
}

const NO_MAP: Array<[Drive, string, 'accepted' | 'refused' | 'none', Record<string, number> | undefined]> = [
  [MAP_NO_SUCH_RESULT, 'no-result-named', 'refused', undefined],
  [MAP_NO_SUCH_LABEL, 'no-result-named', 'refused', undefined],
  [MAP_NOT_CALLED, 'no-result-named', 'none', undefined],
  [MAP_NO_LOCATION_COLUMNS, 'no-location-columns', 'accepted', { returned: 2, drawn: 0, withoutLocation: 2, beyondCap: 0 }],
  [MAP_NONE_LOCATED_2, 'no-located-rows', 'accepted', { returned: 2, drawn: 0, withoutLocation: 2, beyondCap: 0 }],
  [MAP_NONE_LOCATED_1, 'no-located-rows', 'accepted', { returned: 1, drawn: 0, withoutLocation: 1, beyondCap: 0 }],
  [MAP_NO_ROWS, 'no-located-rows', 'accepted', { returned: 0, drawn: 0, withoutLocation: 0, beyondCap: 0 }],
  [MAP_RESULT_FAILED, 'result-failed', 'refused', undefined],
];
for (const [d, reason, step, counts] of NO_MAP) {
  test(`criterion 3 (red) (${d.name}): the record states no map, reason ${reason}, ${counts ? 'with' : 'without'} counts; the step is ${step}`, async () => {
    const format = await formatOf(d);
    assert.deepEqual(format.outcome, { drawn: false, reason }, JSON.stringify(format).slice(0, 300));
    assert.ok(!('map' in format), `${d.name}: a record with no map carries one`);
    if (counts) assert.deepEqual(format.counts, counts);
    else assert.ok(!('counts' in format), `${d.name}: counts on ${reason}: ${JSON.stringify(format.counts)}`);
    const span = presentSpan(d);
    if (step === 'none') {
      assert.equal(span, undefined);
    } else {
      assert.ok(span, `${d.name}: no present span`);
      assert.equal(span!['tool.present_outcome'], step);
      for (const refused of ['error', 'mcp.source', 'mcp.server.id', 'mcp.alias', 'mcp.pack_id', 'tool.upstream_name']) {
        assert.ok(!(refused in span!), `${d.name}: the present span carries ${refused}`);
      }
    }
  });
}

test('criterion 3 (red): a present_result call is answered by the site: no source receives it, and the record\'s call states its outcome', () => {
  for (const d of MAP_RUNS) {
    assert.ok(!d.mcpRequests.some((r) => r.name === 'present_result' || String(r.name).endsWith('present_result')), `${d.name}: the source received a present_result call`);
    for (const call of toolCallsOf(d).filter((c) => c.name === 'present_result')) {
      assert.equal(call.operationType, 'present_result', d.name);
      assert.ok(call.presentOutcome === 'accepted' || call.presentOutcome === 'refused', `${d.name}: ${JSON.stringify(call)}`);
      assert.ok(!call.failed, `${d.name}: a present call recorded as failed`);
    }
  }
});

test('criterion 3 (red): the step\'s arguments are identifiers: the recorded arguments are the call\'s, and a refusal tells the AI why', () => {
  const refusedTexts = [MAP_NO_SUCH_RESULT, MAP_NO_SUCH_LABEL].map((d) => {
    const last = d.modelRequests[d.modelRequests.length - 1];
    const toolMessages = ((last.messages ?? []) as Array<{ role?: string; content?: unknown }>).filter((m) => m.role === 'tool');
    return String(toolMessages[toolMessages.length - 1]?.content ?? '');
  });
  assert.ok(/result/.test(refusedTexts[0]) && /Nothing was mapped/.test(refusedTexts[0]), refusedTexts[0]);
  assert.ok(/label/.test(refusedTexts[1]) && refusedTexts[1].includes('complaint_type'), refusedTexts[1]);
});

// --- Criterion 4: the record's map validates; ids are checked; the record verifies; no source for the step -----------

test('criterion 4 (red): every map a record carries validates against the schema copy (squidmaps-map-spec@d7cdb725)', async () => {
  const schemaHash = createHash('sha256').update(fs.readFileSync(path.join(SRC, 'lib/output-format/schema/squidmaps-map.d7cdb725.schema.json'))).digest('hex');
  assert.equal(schemaHash, 'ac0aad31f9e695ac34ab0d1a8653ee86e85ebc5c73141eccd4c8e45e853f089a', 'the schema copy is not the bytes at d7cdb725');
  let maps = 0;
  for (const d of MAP_RUNS) {
    const map = (await formatOf(d)).map;
    if (map === undefined) continue;
    maps += 1;
    assert.equal(validateMap(map), true, `${d.name}: ${JSON.stringify(validateMap.errors)}`);
    assert.deepEqual(Object.keys(map as Json).sort(), ['basemap', 'description', 'extent', 'features', 'legend', 'name', 'view']);
  }
  assert.equal(maps, 3, 'premise: three runs drew a map');
});

test('criterion 4 (red): a record whose map repeats a feature id is refused at packaging by the producer\'s own check', async () => {
  const trace = structuredClone(traceOf(MAP_POINTS)) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };
  const root = trace.resourceSpans[0].scopeSpans[0].spans.find((s) => !s.parentSpanId)!;
  const entry = root.attributes.find((a) => a.key === 'analysis.output_format_result');
  assert.ok(entry, 'the root span states no outcome');
  const planted = JSON.parse(entry!.value.stringValue!) as { map: { features: Array<{ id: string }> } };
  planted.map.features[1].id = planted.map.features[0].id;
  assert.equal(validateMap(planted.map), true, 'premise: the schema admits the duplicate (OF0 item 4)');
  entry!.value.stringValue = JSON.stringify(planted);
  assert.throws(() => buildEvidencePackage({
    trace, prompt: QUESTION, output: ANSWER, toolCalls: toolCallsOf(MAP_POINTS) as never, model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 10, completionTokens: 5 }, promptVisibility: 'full_text', title: 'Map', summary: 'Map.',
    type: 'content/analysis/v1', captureMethod: 'chat-flow-stream', contentProfile: 'datHere',
  } as never), /appears more than once/);
});

function packaged(d: Drive): { pkg: Json; hash: string } {
  const built = buildEvidencePackage({
    trace: traceOf(d), prompt: QUESTION, output: ANSWER, toolCalls: toolCallsOf(d) as never, model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 10, completionTokens: 5 }, promptVisibility: 'full_text', title: 'Map', summary: 'Map.',
    type: 'content/analysis/v1', captureMethod: 'chat-flow-stream', contentProfile: 'datHere',
    // The datHere content rule hashes the notebook (verify-core 0.15.4), as W1-7's record carries one.
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
    // A platform signer, as the publish route names one, under the key id the record states, so host-core can serve it under a registry.
    signer: { bindingTier: 'platform', identifier: 'fixture-kid', displayName: 'Fixture host' },
  } as never);
  return { pkg: built.pkg as unknown as Json, hash: built.hash };
}

test('criterion 4 (red): a map record carries its map, and verifies at verify-core 0.15.4', async () => {
  assert.equal(verifyCoreVersion, '0.15.4');
  for (const d of [MAP_POINTS, MAP_CAP]) {
    const { pkg, hash: packageHash } = packaged(d);
    assert.ok(((pkg.extensions as Json)[KEY] as Json | undefined)?.map, `${d.name}: premise: the record carries its map`);
    const seed = Uint8Array.from(Array.from({ length: 32 }, (_unused, i) => (i * 17 + 3) & 0xff));
    const raw = ed25519.getPublicKey(seed);
    const spki = Buffer.concat([Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), Buffer.from(raw)]).toString('base64');
    const kid = String((pkg.metadata as Json).signingKeyId);
    const signature = { signature: Buffer.from(ed25519ph.sign(new TextEncoder().encode(packageHash), seed)).toString('base64'), publicKey: spki, algorithm: 'Ed25519ph', kid };
    const keyRegistry = { keys: [{ kid, publicKey: spki, status: 'active', activatedAt: '2026-01-01T00:00:00.000Z', deprecatedAt: null, revokedAt: null, signerIdentity: pkg.signer }] };
    const failFetch = (() => { throw new Error('verify-core touched the network'); }) as never;
    const result = await verifyCore.verifyEvidence(
      { package: pkg as never, packageHash, signature: signature as never, rekorEntryId: null, lifecycle: null },
      { registry: keyRegistry as never, fetch: failFetch },
    );
    assert.equal(result.hashMatch, true, d.name);
    assert.equal(result.signatureValid, true, d.name);
    assert.equal(result.contentHash?.status, 'ok', d.name);
    // host-core's check (S5) runs outside this repository, which does not depend on host-core: with
    // OF3A_HOST_DRIVE_DIR set (CI sets nothing), the signed record is written there as the CLI's `sign` prints one.
    const out = process.env.OF3A_HOST_DRIVE_DIR;
    if (out) {
      const signer = pkg.signer as Json;
      fs.writeFileSync(path.join(out, `${d.name.replace(/\W+/g, '-')}.signed.json`), JSON.stringify({ package: pkg, envelopeHash: packageHash, signature: { ...signature, kid: signer.identifier } }));
    }
  }
});

test('criterion 4 (red): the provenance graph states no source agent and no data-source entry for the step', async () => {
  for (const d of [MAP_POINTS, MAP_IN_LOOP, MAP_NO_SUCH_RESULT, MAP_RESULT_FAILED]) {
    const pkg = await recordOf(d);
    const graph = JSON.stringify(pkg.provenance);
    assert.ok(!graph.includes('mcp-server:unknown'), `${d.name}: the graph names an unknown source`);
    const dataSources = (pkg.dataSources ?? []) as Array<{ sourceId?: string }>;
    assert.ok(!dataSources.some((e) => e.sourceId === 'unknown'), `${d.name}: ${JSON.stringify(dataSources)}`);
    const nodes = ((pkg.provenance as { '@graph'?: Json[] })['@graph'] ?? []) as Json[];
    const presentActivities = nodes.filter((n) => JSON.stringify(n).includes('present_result') && JSON.stringify(n).includes('civic:presentOutcome'));
    assert.ok(presentActivities.length > 0, `${d.name}: the graph states no present_result activity with its outcome`);
    for (const node of presentActivities) assert.ok(!('civic:sourceId' in node), `${d.name}: the step's activity names a source`);
  }
});

// --- Criterion 5: a source's tool named present_result is refused when the run's tools are composed ------------------

test('criterion 5 (red): composing a map run\'s tools refuses a source tool named present_result, in either spelling', () => {
  assert.ok(presentModule, 'the present step module does not exist');
  const source = (name: string) => ({ type: 'function', function: { name, description: 'a source tool', parameters: { type: 'object', properties: {} } } });
  const format = { ...MAP_FORMAT };
  assert.throws(() => presentModule!.withPresentTool([source('socrata__get_data'), source('present_result')], format), /present_result/);
  assert.throws(() => presentModule!.withPresentTool([source('example__present_result')], format), /present_result/);
  const composed = presentModule!.withPresentTool([source('socrata__get_data')], format) as Array<{ function: { name: string } }>;
  assert.deepEqual(composed.map((t) => t.function.name), ['socrata__get_data', 'present_result']);
});

// --- Criterion 6: "Auto" is the base's; "Map" asks for located rows; a replay of a map record runs as "Auto" ----------

/** Ports and the loopback hosts vary per process; everything else is fixed. */
const normalize = (text: string) => text.split(MODEL_ORIGIN).join('http://model.fixture').split(MCP_ORIGIN).join('http://mcp.fixture');
const digest = (text: string) => createHash('sha256').update(normalize(text)).digest('hex');

/** Measured at the base (`bd1f978`, harness 0.15.0) by this file's drives. */
const BASE_DIGESTS = {
  'Auto, all sources': {
    send: 'da928405d44523d5d618eb39e330ca0e2b76d2497ba712b6b3525275fba09604',
    prompt: '49691ee9b808728dd2254a8c71e0a587872272f646ef42c5b4e88f2fb3b25901',
    record: '2b773407d201bd9b379460847c45ad99d2029debf798db76022b9e75210025bc',
  },
  'Auto, in loop': {
    send: '0bccfbb6920b1d5fa2c5db714dcf7586d94c9e96e1168169241fcd8dc749a1af',
    prompt: 'e23daec0b02539f47ed18429f5f497f8d983dd11c08722fec697c1f39c821cac',
    record: 'f060ca893201f4ed73615fdb76d836b737bad5c1a5d3cac9eb4a76f9ab3adaf4',
  },
} as const;

for (const d of [AUTO_ALL, AUTO_IN_LOOP]) {
  test(`criterion 6 (pin) (${d.name}): the send body, the composed prompt and the record's bytes are the base's`, async () => {
    const measured = {
      send: digest(JSON.stringify(d.modelRequests)),
      prompt: digest(systemPromptOf(d.modelRequests[0])),
      record: digest(JSON.stringify(await recordOf(d))),
    };
    console.log(`# OF3a pin ${d.name}: ${JSON.stringify(measured)}`);
    assert.deepEqual(measured, BASE_DIGESTS[d.name as keyof typeof BASE_DIGESTS]);
    assert.ok(!d.modelRequests.some((r) => toolNamesOf(r).includes('present_result')), 'an "Auto" run offered present_result');
  });
}

test('criterion 6 (red): under "Map", every request\'s composed prompt asks for the located rows and offers present_result', () => {
  assert.ok(presentModule, 'the present step module does not exist');
  const guidance = String(presentModule!.MAP_FORMAT_GUIDANCE);
  for (const d of [MAP_POINTS, MAP_IN_LOOP]) {
    for (const request of d.modelRequests.filter((r) => Array.isArray(r.tools))) {
      const prompt = systemPromptOf(request);
      assert.ok(prompt.endsWith(guidance), `${d.name}: a request's prompt does not end with the map guidance`);
      assert.ok(/located rows|location/.test(guidance), 'premise: the guidance asks for located rows');
      assert.equal(toolNamesOf(request).filter((n) => n === 'present_result').length, 1, `${d.name}: ${toolNamesOf(request).join(', ')}`);
    }
  }
  // The decoy: the same prompt with the guidance removed is the "Auto" run's.
  assert.equal(systemPromptOf(MAP_POINTS.modelRequests[0]).slice(0, -guidance.length), systemPromptOf(AUTO_ALL.modelRequests[0]));
});

test('criterion 6 (pin): a replay of a map record runs as "Auto": no present_result tool, no present step, no map guidance', async () => {
  const replayLoop = await import('../../lib/model-loop/replay-loop.ts');
  const { createModelClient } = await import('../../lib/model-client.ts');
  const pkg = await recordOf(MAP_POINTS);
  const options = await replayLoop.replayLoopOptionsForPackage({
    pkg: pkg as never,
    client: createModelClient({ apiKey: 'placeholder-model-key-of3a' }),
    endpointModel: 'example-fixture-deployment',
    requestSettings: undefined,
    prompt: QUESTION,
  }) as unknown as Json;
  const names = ((options.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name);
  assert.ok(names.length > 0, 'premise: the replay offers tools');
  assert.ok(!names.includes('present_result'), names.join(', '));
  assert.ok(!('presentStep' in options) || options.presentStep === undefined);
  assert.ok(!String(options.systemPrompt).includes('present_result'));
});

// --- K3 = A: a map format is off in a Sandbox session ------------------------------------------------------------------

test('K3 = A (red): a Sandbox question in a map format is refused as a format this site does not offer there, before the model', () => {
  assert.equal(SANDBOX_MAP.status, 403, SANDBOX_MAP.body.slice(0, 300));
  assert.equal((JSON.parse(SANDBOX_MAP.body) as Json).code, 'output_format_not_offered');
  assert.equal(SANDBOX_MAP.modelRequests, 0);
});
