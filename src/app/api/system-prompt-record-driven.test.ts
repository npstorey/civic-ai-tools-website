// R10 P1b (#694, ruled C; P1b-a ruled A) — the run's system prompt in the
// record: its hash inline, its text as a BlobRef.
//
// WHAT IS DRIVEN. The REAL `/api/compare-stream` and `/api/query-notebook`
// handlers (prompt composer, MCP client, loop core, trace builder), then the
// REAL publish handler (`/api/records`, which re-exports `/api/evidence`) with
// the real packager, posted the body the publish dialog posts
// (`PublishEvidenceDialog.tsx:281-300`): no `skillMetadataOverride`,
// `captureMethod: 'chat-flow-stream'`. The storage index
// (`src/lib/storage/index.ts`) is the real module; the DRIVER under it is a
// double defined in this file (a Map of pathname to bytes), loaded in place of
// `src/lib/storage/vercel-blob.ts`. Like Vercel Blob with no `allowOverwrite`,
// the double refuses a `put` to a pathname it already holds. The sweep
// (`src/lib/evidence/blob-gc.ts`) runs over the same double. The model and the
// three MCP sources are loopback servers; every key is a placeholder.
//
// THE SHAPES THAT MAKE EACH ASSERTION ABLE TO FAIL.
//   - The in-loop runs load Socrata, call it, and only then load Data
//     Commons: three distinct prompts (the directory; the directory and
//     Socrata; the directory, Socrata and Data Commons). The second is not
//     contained in the third (measured, P1b-a), so a record stating the first
//     or second prompt's hash differs from one stating the final prompt's.
//   - Two run kinds share each final prompt (all-sources with all-sources,
//     in-loop with in-loop), so "one blob per distinct prompt" is asserted
//     over four publishes that could have written four objects.
//   - The no-text assertion reads lines of the final prompts in the stored
//     package bytes, and a premise requires those lines to exist.
//
// Criterion 1 (contract v1, criterion 1 reading "the final request's prompt"):
// each publish carries `systemPromptHash` equal to the final request's
// prompt hash and `skillText` a BlobRef whose stored bytes hash to it, and
// `mcpServerUrl` where the trace states one (the comparison's `skill_fetch`).
// The executed run's trace states none, so its record carries none.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/system-prompt-record-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `module.registerHooks()` is Node 22.15+ but not in the pinned `@types/node`.
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
const QUESTION = 'How many potholes were reported in 2025?';
const ANSWER = 'Two figures were retrieved.';
const DATA_COMMONS_INSTRUCTIONS = 'Fixture Data Commons instructions: name places by DCID.';

// --- The storage driver double --------------------------------------------------
//
// Defined here, never as a tracked module: a pathname-keyed Map, the URL a
// public store would serve, and an upload time a test can age.

interface StoredObject { body: Uint8Array; contentType: string; uploadedAt: string }
interface StoreDouble {
  objects: Map<string, StoredObject>;
  /** Every `put`, in order, by pathname. */
  puts: string[];
  /** While set, every `put` throws. */
  refusePuts: boolean;
}
const STORE: StoreDouble = { objects: new Map(), puts: [], refusePuts: false };
(globalThis as unknown as { __p1bStore: StoreDouble }).__p1bStore = STORE;
const STORE_ORIGIN = 'https://store.example.invalid/';

const DRIVER_SOURCE = `
  const S = globalThis.__p1bStore;
  const ORIGIN = ${JSON.stringify(STORE_ORIGIN)};
  const pathnameOf = (url) => url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : null;
  export function createVercelBlobDriver() {
    return {
      name: 'vercel-blob',
      async put(pathname, body, { contentType }) {
        if (S.refusePuts) throw new Error('fixture: the store refused the write');
        if (S.objects.has(pathname)) throw new Error('fixture: this blob already exists');
        S.puts.push(pathname);
        S.objects.set(pathname, { body: typeof body === 'string' ? new TextEncoder().encode(body) : body, contentType, uploadedAt: new Date().toISOString() });
        return { url: ORIGIN + pathname };
      },
      async delete(url) { S.objects.delete(pathnameOf(url)); },
      async list({ prefix, limit }) {
        const items = [...S.objects.entries()].filter(([p]) => p.startsWith(prefix)).slice(0, limit ?? 1000)
          .map(([p, o]) => ({ url: ORIGIN + p, pathname: p, uploadedAt: o.uploadedAt, size: o.body.byteLength }));
        return { items, hasMore: false };
      },
      async getText(url) {
        const o = S.objects.get(pathnameOf(url));
        return o ? new TextDecoder().decode(o.body) : null;
      },
      async grantClientUpload() { throw new Error('fixture: no client uploads'); },
    };
  }`;

// --- Module hooks ------------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-r10-p1b-stub/';
const SANDBOX_DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const VERCEL_BLOB_FILE = path.join(SRC, 'lib/storage/vercel-blob.ts');
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.61' }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return { userId: 'fixture-account', scopes: ['records:publish'], method: 'bearer' }; }
    export function hasPublishScope() { return true; }`,
  '@/lib/sandbox': `
    import { NotebookExecutionError } from ${JSON.stringify(SANDBOX_DRIVER_URL)};
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
  '@/lib/db': `
    const selectChain = { from: () => selectChain, where: () => selectChain, limit: async () => [] };
    export const db = {
      select() { return selectChain; },
      insert() { return { values: async () => {} }; },
    };`,
  '@/lib/evidence/publication': `
    export async function emitPublicationPair() { return { publishesNodeId: 'p', locatedAtNodeId: 'l' }; }`,
};
const DRIVER_STUB_URL = `${STUB_PREFIX}vercel-blob-driver.mjs`;

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    const parent = (context as { parentURL?: string }).parentURL;
    let file: string | null = null;
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      file = firstFile([base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]);
      if (file === null) throw new Error(`R10 P1b test hook: cannot resolve ${specifier}`);
    } else if (specifier.startsWith('.') && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      file = firstFile(path.extname(specifier) ? [base] : [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]);
    }
    if (file === VERCEL_BLOB_FILE) return { url: DRIVER_STUB_URL, format: 'module', shortCircuit: true };
    if (file !== null) return { url: pathToFileURL(file).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === DRIVER_STUB_URL) return { format: 'module', source: DRIVER_SOURCE, shortCircuit: true };
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(loadUrl), 'utf8')};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');

// --- The loopback MCP sources ------------------------------------------------------

const ONE_ROW = JSON.stringify({ data: [{ count: '512' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  const route = req.url ?? '';
  if (msg.method === 'initialize') {
    const instructions = route.startsWith('/dc/') ? { instructions: DATA_COMMONS_INSTRUCTIONS } : {};
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r10-p1b' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r10-p1b-fixture', version: '0' }, ...instructions } }));
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

// --- The loopback model ----------------------------------------------------------------
//
// All-sources: one Socrata call, then the answer. In-loop: load Socrata, call
// it, load Data Commons, then answer — the two-turn shape P1b-a measured.

const MODEL_REQUESTS: Array<{ body: Record<string, unknown> }> = [];
type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
const call = (id: string, name: string, args: Record<string, unknown>): Call =>
  ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const SOCRATA_CALL = { type: 'query', dataset_id: 'aaaa-1111', limit: 1 };

function turnFor(body: Record<string, unknown>): Call[] | null {
  const tools = (body.tools ?? []) as Array<{ function: { name: string } }>;
  if (tools.length === 0) return null;
  const assistantTurns = ((body.messages ?? []) as Array<{ role?: string }>).filter((m) => m.role === 'assistant').length;
  if (!tools.some((t) => t.function.name === 'load_source')) {
    return assistantTurns === 0 ? [call('call-socrata', 'socrata__get_data', SOCRATA_CALL)] : null;
  }
  if (assistantTurns === 0) return [call('call-load-socrata', 'load_source', { alias: 'socrata' })];
  if (assistantTurns === 1) return [call('call-socrata', 'socrata__get_data', SOCRATA_CALL)];
  if (assistantTurns === 2) return [call('call-load-dc', 'load_source', { alias: 'data_commons' })];
  return null;
}

const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    MODEL_REQUESTS.push({ body });
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-p1b', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = turnFor(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-p1b', object: 'chat.completion', created: 1, model: 'fake/model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: toolCalls ? null : ANSWER, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      }],
      usage,
    }));
  });
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Environment, before any app module loads --------------------------------------

for (const name of [
  'DATA_COMMONS_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'SITE_SEAL_ONLY', 'MODEL_API_KEY', 'OPENAI_API_KEY',
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'EXECUTOR_DRIVER', 'NYC_CHARTER_HOSTING',
  'SOURCE_ROUTING', 'BLOB_DRIVER',
]) {
  delete process.env[name];
}
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-r10-p1b';
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

// --- The drives -------------------------------------------------------------------------

type Json = Record<string, unknown>;

interface Drive { name: string; kind: 'comparison' | 'executed'; events: Json[]; requests: Array<{ body: Json }>; logs: string[] }

const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: consentCookieForTests() }, body: JSON.stringify(body) }) as never;

function eventsOf(body: string): Json[] {
  return body.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice('data: '.length)) as Json]; } catch { return []; }
  });
}

const compareStreamRoute = await import('./compare-stream/route.ts');
const notebookRoute = await import('./query-notebook/route.ts');
const recordsRoute = (await import('./records/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };

async function drive(name: string, kind: Drive['kind'], routing: 'all-sources' | 'in-loop'): Promise<Drive> {
  process.env.SOURCE_ROUTING = routing;
  const from = MODEL_REQUESTS.length;
  const logs: string[] = [];
  const real = { warn: console.warn, error: console.error };
  console.warn = (...args: unknown[]) => { logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  console.error = console.warn;
  try {
    const response = kind === 'comparison'
      ? await compareStreamRoute.POST(post('/api/compare-stream', { query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true }))
      : await notebookRoute.POST(post('/api/query-notebook', { query: QUESTION, portal: PORTAL }));
    const events = eventsOf(await response.text());
    return { name, kind, events, requests: MODEL_REQUESTS.slice(from), logs };
  } finally {
    console.warn = real.warn;
    console.error = real.error;
    delete process.env.SOURCE_ROUTING;
  }
}

/** The system text of every model request that carried one, in order. */
function promptsOf(d: Drive): string[] {
  return d.requests.flatMap((r) => {
    const system = ((r.body.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
    return typeof system?.content === 'string' ? [system.content] : [];
  });
}
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const finalPromptOf = (d: Drive) => { const p = promptsOf(d); return p[p.length - 1]; };

/** The body the publish dialog posts for this run (`PublishEvidenceDialog.tsx:281-300`). */
function dialogBody(d: Drive): Json {
  if (d.kind === 'comparison') {
    const complete = d.events.find((e) => e.type === 'complete' && e.panel === 'withMcp')?.data as Json | undefined;
    const trace = d.events.find((e) => e.type === 'trace')?.data;
    assert.ok(complete && trace, `${d.name}: premise — the run completed and sent its trace`);
    return {
      trace, prompt: QUESTION, output: complete!.content, toolCalls: complete!.tools_called ?? [],
      model: 'fixture-fast', portal: PORTAL,
      tokenUsage: { promptTokens: complete!.prompt_tokens, completionTokens: complete!.completion_tokens },
      duration_ms: complete!.duration_ms, promptVisibility: 'full_text', title: 'Potholes', summary: 'Potholes.',
      captureMethod: 'chat-flow-stream', contentProfile: 'datHere', visibility: 'public',
      extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
    };
  }
  const inputs = d.events.find((e) => e.type === 'publish_inputs');
  const notebook = d.events.find((e) => e.type === 'notebook')?.notebook;
  assert.ok(inputs && notebook, `${d.name}: premise — the run completed and sent its publish inputs`);
  return {
    trace: inputs!.trace, prompt: QUESTION, output: inputs!.answer,
    toolCalls: d.events.filter((e) => e.type === 'phase_a_tool_call').map((e) => ({
      name: e.name, args: e.args ?? {}, resultSummary: e.resultSummary, duration_ms: e.duration_ms, operationType: e.operationType, reason: e.reason,
    })),
    model: 'fixture-fast', portal: PORTAL, tokenUsage: inputs!.tokenUsage, duration_ms: inputs!.duration_ms,
    promptVisibility: 'full_text', title: 'Potholes', summary: 'Potholes.',
    captureMethod: 'chat-flow-stream', contentProfile: 'datHere', visibility: 'public',
    extensions: { 'org.civicaitools.notebook': notebook },
  };
}

/** Publish through the real handler; the package as the store holds it. */
async function publish(body: Json): Promise<{ status: number; stored: Json; bytes: string; logs: string[] }> {
  const before = new Set([...STORE.objects.keys()].filter((p) => p.startsWith('evidence-packages/')));
  const logs: string[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => { logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const response = await recordsRoute.POST(new Request('http://localhost/api/records', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    const status = response.status;
    const added = [...STORE.objects.keys()].filter((p) => p.startsWith('evidence-packages/') && !before.has(p));
    assert.equal(added.length, 1, `premise — the publish stored one package (status ${status}: ${await response.text()})`);
    const bytes = new TextDecoder().decode(STORE.objects.get(added[0])!.body);
    return { status, stored: JSON.parse(bytes) as Json, bytes, logs };
  } finally {
    console.warn = real;
  }
}

const CS_ALL = await drive('comparison, all-sources', 'comparison', 'all-sources');
const CS_LOOP = await drive('comparison, in-loop', 'comparison', 'in-loop');
const NB_ALL = await drive('executed, all-sources', 'executed', 'all-sources');
const NB_LOOP = await drive('executed, in-loop', 'executed', 'in-loop');
const DRIVES = [CS_ALL, CS_LOOP, NB_ALL, NB_LOOP];
const PUBLISHED = new Map<Drive, { stored: Json; bytes: string }>();
for (const d of DRIVES) PUBLISHED.set(d, await publish(dialogBody(d)));

interface BlobRefShape { ref: string; url: string; contentType: string; size: number }
const skillOf = (pkg: Json) => (pkg.skillMetadata ?? {}) as { systemPromptHash?: string; mcpServerUrl?: string; skillText?: unknown };
const isRef = (v: unknown): v is BlobRefShape =>
  typeof v === 'object' && v !== null && typeof (v as BlobRefShape).ref === 'string' && /^blob:sha256:[0-9a-f]{64}$/.test((v as BlobRefShape).ref)
  && typeof (v as BlobRefShape).url === 'string' && typeof (v as BlobRefShape).size === 'number';
const pathnameOfUrl = (url: string) => (url.startsWith(STORE_ORIGIN) ? url.slice(STORE_ORIGIN.length) : url);

// --- Premises ------------------------------------------------------------------------------

test('premise: the in-loop runs saw three distinct prompts, the second not contained in the third (P1b-a)', () => {
  for (const d of [CS_LOOP, NB_LOOP]) {
    const distinct = [...new Set(promptsOf(d))];
    assert.equal(distinct.length, 3, `${d.name}: ${distinct.length} distinct prompts`);
    assert.equal(distinct[2].includes(distinct[1]), false, `${d.name}: the second prompt is contained in the final one, so the shape cannot tell them apart`);
  }
  for (const d of [CS_ALL, NB_ALL]) assert.equal(new Set(promptsOf(d)).size, 1, `${d.name}: one prompt`);
  assert.equal(finalPromptOf(CS_LOOP), finalPromptOf(NB_LOOP), 'the two in-loop runs end on one prompt');
  assert.equal(finalPromptOf(CS_ALL), finalPromptOf(NB_ALL), 'the two all-sources runs share one prompt');
  assert.notEqual(finalPromptOf(CS_ALL), finalPromptOf(CS_LOOP));
});

// --- Criterion 1: the record carries hash and BlobRef -----------------------------------------

for (const d of DRIVES) {
  test(`criterion 1, ${d.name}: systemPromptHash is the final request's prompt hash`, () => {
    const skill = skillOf(PUBLISHED.get(d)!.stored);
    assert.equal(skill.systemPromptHash, sha(finalPromptOf(d)));
  });

  test(`criterion 1, ${d.name}: skillText is a BlobRef whose stored bytes hash to systemPromptHash`, () => {
    const skill = skillOf(PUBLISHED.get(d)!.stored);
    assert.ok(isRef(skill.skillText), `skillText is ${JSON.stringify(skill.skillText)}, not a BlobRef`);
    const ref = skill.skillText as BlobRefShape;
    const hash = sha(finalPromptOf(d));
    assert.equal(ref.ref, `blob:sha256:${hash}`);
    const object = STORE.objects.get(pathnameOfUrl(ref.url));
    assert.ok(object, `the store holds nothing at ${ref.url}`);
    assert.equal(sha(object!.body), hash, 'the stored bytes do not hash to the record\'s hash');
    assert.equal(ref.size, object!.body.byteLength);
    assert.equal(new TextDecoder().decode(object!.body), finalPromptOf(d), 'the stored bytes are not the final prompt');
  });

  test(`criterion 1, ${d.name}: mcpServerUrl where the trace states one, and none where it does not`, () => {
    const skill = skillOf(PUBLISHED.get(d)!.stored);
    if (d.kind === 'comparison') assert.equal(skill.mcpServerUrl, process.env.SOCRATA_MCP_URL);
    else assert.equal(Object.hasOwn(skill, 'mcpServerUrl'), false, 'the executed run\'s trace states no server, so its record states none');
  });

  test(`criterion 1, ${d.name}: the package JSON carries no prompt text (#411 D3)`, () => {
    const { bytes } = PUBLISHED.get(d)!;
    for (const prompt of [finalPromptOf(CS_ALL), finalPromptOf(CS_LOOP)]) {
      const lines = prompt.split('\n').filter((l) => l.trim().length >= 40);
      assert.ok(lines.length > 10, 'premise — the prompt has lines long enough to search for');
      const found = lines.filter((l) => bytes.includes(JSON.stringify(l).slice(1, -1)));
      assert.deepEqual(found, [], 'prompt prose is in the signed bytes');
    }
  });
}

test('criterion 1: two publishes of one prompt reference one blob, and the store holds one object per distinct prompt', () => {
  const urlOf = (d: Drive) => (skillOf(PUBLISHED.get(d)!.stored).skillText as BlobRefShape | undefined)?.url;
  assert.ok(urlOf(CS_LOOP) !== undefined && urlOf(CS_ALL) !== undefined, 'premise — the records carry BlobRefs');
  assert.equal(urlOf(CS_LOOP), urlOf(NB_LOOP));
  assert.equal(urlOf(CS_ALL), urlOf(NB_ALL));
  const refs = [...STORE.objects.keys()].filter((p) => p.startsWith('evidence-refs/'));
  assert.deepEqual(refs.sort(), [sha(finalPromptOf(CS_ALL)), sha(finalPromptOf(CS_LOOP))].map((h) => `evidence-refs/${h}.txt`).sort());
  const promptPuts = STORE.puts.filter((p) => p.startsWith('evidence-refs/'));
  assert.equal(promptPuts.length, 2, `each key is written once: ${JSON.stringify(promptPuts)}`);
});

test('the seam: every key a run writes is evidence-refs/<sha256>.txt, the shape the upload grant and the sweep use', () => {
  const PATHNAME_PATTERN = /^evidence-refs\/[0-9a-f]{64}(?:\.[a-z0-9]+)?$/;
  const upload = fs.readFileSync(path.join(SRC, 'app/api/blob/upload-token/route.ts'), 'utf8');
  assert.ok(upload.includes(String(PATHNAME_PATTERN)), 'premise — the upload grant\'s pattern is the one restated here');
  const written = STORE.puts.filter((p) => !p.startsWith('evidence-packages/'));
  assert.ok(written.length > 0, 'premise — a run wrote a key');
  for (const key of written) {
    assert.match(key, /^evidence-refs\/[0-9a-f]{64}\.txt$/);
    assert.match(key, PATHNAME_PATTERN);
  }
  const object = STORE.objects.get(written[0])!;
  assert.equal(object.contentType, 'text/plain; charset=utf-8');
});

// --- The seam's failure paths --------------------------------------------------------------

test('the seam: a failed write fails neither the run nor its answer, logs facts only, and the record carries the hash alone', async () => {
  // The run's key is removed for this drive, so its write is attempted, and refused; then put back.
  const held = [...STORE.objects.entries()].filter(([key]) => key.startsWith('evidence-refs/'));
  for (const [key] of held) STORE.objects.delete(key);
  STORE.refusePuts = true;
  let d: Drive;
  try {
    d = await drive('comparison, all-sources, refused write', 'comparison', 'all-sources');
  } finally {
    STORE.refusePuts = false;
  }
  assert.ok(d.events.some((e) => e.type === 'complete' && e.panel === 'withMcp'), 'the answer did not complete');
  assert.ok(d.events.some((e) => e.type === 'trace'), 'the run sent no trace');
  assert.equal(d.events.some((e) => e.type === 'error'), false, 'the reader was sent an error');
  const lines = d.logs.filter((l) => l.includes('[prompt-blob]'));
  assert.equal(lines.length, 1, `logged: ${JSON.stringify(d.logs)}`);
  assert.equal(lines[0].includes('fixture: the store refused the write'), false, 'the raw error message reached the log');
  assert.match(lines[0], /errorClass/);
  const { stored } = await publish(dialogBody(d));
  const skill = skillOf(stored);
  assert.equal(skill.systemPromptHash, sha(finalPromptOf(d)));
  assert.equal(Object.hasOwn(skill, 'skillText'), false, 'a record whose blob was never written carries a BlobRef');
  for (const [key, object] of held) STORE.objects.set(key, object);
});

test('the seam: a stored blob whose bytes do not hash to the trace\'s hash gives the hash alone, never a guess', async () => {
  const hash = sha(finalPromptOf(CS_LOOP));
  const key = `evidence-refs/${hash}.txt`;
  const original = STORE.objects.get(key);
  assert.ok(original, 'premise — the in-loop prompt is stored');
  STORE.objects.set(key, { ...original!, body: new TextEncoder().encode(`${finalPromptOf(CS_LOOP)}\nTAMPERED`) });
  try {
    const { stored } = await publish(dialogBody(CS_LOOP));
    const skill = skillOf(stored);
    assert.equal(skill.systemPromptHash, hash);
    assert.equal(Object.hasOwn(skill, 'skillText'), false, 'a tampered blob was referenced');
  } finally {
    STORE.objects.set(key, original!);
  }
});

test('the seam: the documented programmatic override passes through unchanged', async () => {
  const override = {
    systemPromptHash: 'c'.repeat(64),
    mcpServerUrl: 'https://mcp.example.invalid/mcp',
    skillText: { ref: `blob:sha256:${'c'.repeat(64)}`, url: 'https://elsewhere.example.invalid/x.txt', contentType: 'text/plain', size: 3 },
  };
  const { stored } = await publish({ ...dialogBody(CS_LOOP), skillMetadataOverride: override });
  assert.deepEqual(skillOf(stored), override);
});

// --- The sweep: an unpublished prompt blob goes, a referenced one stays -----------------------

test('the sweep: collectRefsFromPackage keeps a published prompt blob; an unpublished one past 24 h is removed', async () => {
  const { collectRefsFromPackage, sweepOrphans } = await import('../../lib/evidence/blob-gc.ts');
  const published = PUBLISHED.get(CS_LOOP)!.stored;
  const ref = skillOf(published).skillText as BlobRefShape | undefined;
  assert.ok(ref && isRef(ref), 'premise — the record references its prompt');
  const referenced = new Set<string>();
  collectRefsFromPackage(published, referenced);
  assert.ok(referenced.has(ref!.url), 'collectRefsFromPackage does not name the prompt blob');

  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const orphanText = 'An unpublished run\'s prompt.';
  const orphanKey = `evidence-refs/${sha(orphanText)}.txt`;
  STORE.objects.set(orphanKey, { body: new TextEncoder().encode(orphanText), contentType: 'text/plain; charset=utf-8', uploadedAt: old });
  const keptKey = pathnameOfUrl(ref!.url);
  STORE.objects.set(keptKey, { ...STORE.objects.get(keptKey)!, uploadedAt: old });
  const stats = await sweepOrphans(referenced);
  assert.equal(STORE.objects.has(orphanKey), false, 'the unpublished prompt blob survived the sweep');
  assert.equal(STORE.objects.has(keptKey), true, 'the referenced prompt blob was swept');
  assert.ok(stats.deleted >= 1 && stats.skippedReferenced >= 1, JSON.stringify(stats));
});

// --- The many-prompts disclosure, over the two-turn shape ----------------------------------
//
// The ruling (P1b-a = A): when the trace states more than one distinct prompt
// hash, section B shows the last prompt and lists the earlier ones by hash,
// read from the spans. Asserted on the models the record page and the
// finished executed run render from (`SkillSection` and the run's B render
// them: `src/components/evidence/skill-section-render.test.ts`).

/** String-typed specifiers, so the red commit type-checks before the adapters change. */
const ADAPT_RECORD: string = '../../components/answer-view/adapt-record.ts';
const ADAPT_NOTEBOOK: string = '../../components/answer-view/adapt-notebook.ts';
const PROMPT_HASHES: string = '../../lib/evidence/prompt-hashes.ts';
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function recordModel(d: Drive): Promise<Loose> {
  const { adaptRecord } = (await import(ADAPT_RECORD)) as Loose;
  return adaptRecord({
    stored: PUBLISHED.get(d)!.stored, resolution: null,
    row: { slug: 'r10-p1b', summary: 'Potholes.', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' },
    instance: null, servedStatement: null,
  });
}

const distinctHashes = (d: Drive) => [...new Set(promptsOf(d))].map((p) => sha(p));

for (const d of [CS_LOOP, NB_LOOP]) {
  test(`many prompts, the record of the ${d.name} run: B shows the final prompt and lists the two earlier ones by hash`, async () => {
    const b = (await recordModel(d)).disclosure.recordInstructions;
    const distinct = distinctHashes(d);
    assert.equal(distinct.length, 3, 'premise — three distinct prompts');
    assert.ok(b, 'the record has no section B');
    assert.equal(b.disclosure.kind, 'blob');
    assert.equal(b.disclosure.hash, distinct[2]);
    assert.deepEqual(b.earlierPromptHashes, distinct.slice(0, 2));
  });
}

test('many prompts: an all-sources record lists no earlier prompt', async () => {
  const b = (await recordModel(CS_ALL)).disclosure.recordInstructions;
  assert.ok(b, 'the record has no section B');
  assert.deepEqual(b.earlierPromptHashes, []);
});

function notebookInput(d: Drive, withTrace: boolean): Loose {
  const metadata = d.events.find((e) => e.type === 'metadata')!;
  const notebook = d.events.find((e) => e.type === 'notebook')!.notebook;
  return {
    notebook, prompt: QUESTION, model: 'fixture-fast', portal: PORTAL, toolCalls: [],
    composedSystemPrompt: metadata.composedSystemPrompt, composedSystemPromptHash: metadata.composedSystemPromptHash,
    signingKeyId: null, instance: null, socrataMcpUrl: null,
    ...(withTrace ? { evidenceTrace: d.events.find((e) => e.type === 'publish_inputs')!.trace } : {}),
  };
}

test('many prompts, the finished executed in-loop run: B states the record\'s hash, the final one, and lists the earlier ones', async () => {
  const { adaptNotebook } = (await import(ADAPT_NOTEBOOK)) as Loose;
  const distinct = distinctHashes(NB_LOOP);
  const b = adaptNotebook(notebookInput(NB_LOOP, true)).disclosure.instructions;
  assert.equal(b.hash, distinct[2], 'the finished view states a hash other than the final prompt\'s');
  assert.equal(b.hash, skillOf(PUBLISHED.get(NB_LOOP)!.stored).systemPromptHash, 'the view and the record state different hashes');
  assert.equal(b.text, undefined, 'the first prompt\'s text is shown under the final prompt\'s hash');
  assert.deepEqual(b.earlierPromptHashes, distinct.slice(0, 2));
});

test('the executed in-loop run before publish_inputs: B states the metadata event\'s hash, the first prompt\'s (reported)', async () => {
  const { adaptNotebook } = (await import(ADAPT_NOTEBOOK)) as Loose;
  const b = adaptNotebook(notebookInput(NB_LOOP, false)).disclosure.instructions;
  assert.equal(b.hash, distinctHashes(NB_LOOP)[0]);
  assert.equal(b.text, promptsOf(NB_LOOP)[0]);
});

test('the finished executed all-sources run: the view\'s hash is the record\'s, its text is that prompt, and no earlier prompt is listed', async () => {
  const { adaptNotebook } = (await import(ADAPT_NOTEBOOK)) as Loose;
  const b = adaptNotebook(notebookInput(NB_ALL, true)).disclosure.instructions;
  assert.equal(b.hash, skillOf(PUBLISHED.get(NB_ALL)!.stored).systemPromptHash);
  assert.equal(b.text, finalPromptOf(NB_ALL));
  assert.equal((b.earlierPromptHashes ?? []).length, 0);
});

// --- The guard on the earlier list (fix round 1, item 7) -----------------------------------
//
// The list and the count are shown only when the hash the record states is the
// trace's last stated `llm_inference` hash. A record stating any other hash —
// one of the earlier prompts, or one the trace never states — gets neither,
// never a list labelled "earlier" that is not.

test('the guard: a record whose stated hash is an earlier prompt\'s, not the last, lists no earlier prompts', async () => {
  const distinct = distinctHashes(CS_LOOP);
  const stored = structuredClone(PUBLISHED.get(CS_LOOP)!.stored) as Loose;
  stored.skillMetadata = { ...stored.skillMetadata, systemPromptHash: distinct[1] };
  delete stored.skillMetadata.skillText;
  const { adaptRecord } = (await import(ADAPT_RECORD)) as Loose;
  const b = adaptRecord({
    stored, resolution: null,
    row: { slug: 'r10-p1b-guard', summary: 'Potholes.', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' },
    instance: null, servedStatement: null,
  }).disclosure.recordInstructions;
  assert.equal(b.disclosure.hash, distinct[1], 'premise — the record states the second prompt\'s hash');
  assert.deepEqual(b.earlierPromptHashes, [], 'a list labelled "earlier" is shown beside a hash that is not the last');
});

test('the guard: a hash the trace never states lists no earlier prompts', async () => {
  const { earlierSystemPromptHashes } = (await import(PROMPT_HASHES)) as Loose;
  const trace = CS_LOOP.events.find((e) => e.type === 'trace')!.data;
  const distinct = distinctHashes(CS_LOOP);
  assert.deepEqual(earlierSystemPromptHashes(trace, distinct[2]), distinct.slice(0, 2), 'premise — the last hash lists the two earlier ones');
  assert.deepEqual(earlierSystemPromptHashes(trace, distinct[0]), []);
  assert.deepEqual(earlierSystemPromptHashes(trace, 'f'.repeat(64)), []);
});
