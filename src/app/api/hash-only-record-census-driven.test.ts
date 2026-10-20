// #516 P10 — under hash-only visibility, a record carries no verbatim copy of
// the question.
//
// THE RULE THIS HOLDS. When a reader publishes with `promptVisibility:
// "hash_only"`, nothing the app writes into the record carries the question
// verbatim: not the canonical package's bytes, not the record's slug or its
// title as defaulted, and not the stored row. The package keeps the question's
// hash. A `full_text` record is unchanged. The model's answer, the generated
// summary and the model-written source queries are model text: the dialog
// names them, and nothing here filters them (the fixtures below are written so
// that none of them quotes the question, so a finding is always the app's).
//
// WHAT IS DRIVEN, end to end, from the question to the stored record:
//   - the REAL `/api/compare-stream` and `/api/query-notebook` handlers, with
//     the real prompt composer, MCP client, loop core, trace builder, notebook
//     synthesizer, provenance stamp and validator;
//   - the REAL publish dialog (`PublishEvidenceDialog.tsx`), mounted with the
//     props each surface hands it (`McpResponseDisplay` for the chat flow,
//     `NotebookOutput` for the executed notebook), through
//     `src/components/publish-dialog-test-harness.ts`: the reader picks the
//     prompt visibility and presses the button, and the dialog builds the
//     publish body itself — its default title, its default summary, and its
//     notebook (the executed one, or the skeleton it generates);
//   - the dialog's `POST /api/records` is answered by the REAL handler,
//     imported from `src/app/api/records/route.ts` (which re-exports the one
//     defined in `src/app/api/evidence/route.ts`), with the real packager.
// The seams replaced, each where the real one would leave this machine or
// needs a request scope: `next/headers`, `next-auth`, `@/lib/auth`,
// `@/lib/api-auth`; the executor (`@/lib/sandbox`: it returns the notebook it
// was given, so no sandbox is created); `@/lib/evidence/unsigned-tier`,
// `@/lib/evidence/signing`, `@/lib/storage`, `@/lib/db`,
// `@/lib/evidence/publication`. The storage stand-in keeps the package it was
// handed, serialized, as the bytes it would have stored; the database
// stand-in keeps the row it was asked to insert. The model and the MCP
// sources are loopback servers. Every key is a placeholder.
//
// THE CENSUS. The question is searched in four forms — raw,
// `encodeURIComponent`-ed, JSON-escaped, and the slug's own form — over the
// stored package (every key and string at any depth, and the serialized
// bytes), the slug the handler answered with, and the stored row. A finding is
// reported by JSON path.
//
// WHAT MAKES EACH ASSERTION ABLE TO FAIL.
//   - The question's four forms are pairwise different, and each is long
//     enough that nothing else in a record can contain it by accident.
//   - Premise tests require the full-text records to carry the question in
//     the package, the slug and the row, so the search is seen finding it.
//   - Premise tests require the answer, the summary and every tool call to
//     carry no form of the question, so the hash-only census measures what the
//     app writes and nothing else.
//   - The direct-submission test posts a notebook carrying every form in
//     a markdown cell, a code cell, outputs, metadata and keys, so the
//     removal does not lean on the dialog having cleaned anything, and the
//     model text it must leave alone is there to be changed.
//
// WHAT IS THE APP'S, IN A NOTEBOOK. The generator's markdown cells: every
// markdown cell is generator-authored, the model's answer is a code cell, and
// code output is never a cell source (`notebook-author/validate.ts`). Code-cell
// sources, outputs and metadata are model text or the run's own record, and
// are packaged as submitted.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/hash-only-record-census-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
/** The question. Quotes, an ampersand and a question mark make its four forms differ. */
const QUESTION = 'How many "hydrant spray" & noise complaints came from Astoria Park in 2026?';
const ANSWER = 'Twelve complaints were recorded across four blocks.\n\nOne request returned the figure.';
const GENERATED_SUMMARY = 'This analysis counts complaints recorded in one city dataset.';
const WITHHELD = 'withheld (hash only)';

/** The publish handler's own slug rule, restated: this file's statement of the slug form. */
function slugForm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

const FORMS: Array<[string, string]> = [
  ['raw', QUESTION],
  ['encodeURIComponent', encodeURIComponent(QUESTION)],
  ['JSON-escaped', JSON.stringify(QUESTION).slice(1, -1)],
  ['slug', slugForm(QUESTION)],
];

function formsIn(text: string): string[] {
  return FORMS.filter(([, form]) => text.includes(form)).map(([name]) => name);
}

/** Every path in a JSON value whose key or string carries a form of the question. */
function findingsIn(value: unknown, root: string): string[] {
  const out: string[] = [];
  const visit = (node: unknown, at: string) => {
    if (typeof node === 'string') {
      const found = formsIn(node);
      if (found.length > 0) out.push(`${at} (${found.join(', ')})`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${at}[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        const found = formsIn(key);
        if (found.length > 0) out.push(`${at} key ${JSON.stringify(key)} (${found.join(', ')})`);
        visit(item, /^[A-Za-z_$][\w$]*$/.test(key) ? `${at}.${key}` : `${at}[${JSON.stringify(key)}]`);
      }
    }
  };
  visit(value, root);
  return out;
}

// --- Module hooks ------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-516-p10-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.110' }); }`,
  // Signed out, except where a test signs in (the summary handler's check).
  'next-auth': `export async function getServerSession() { return globalThis.__p10?.session ?? null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return { userId: 'fixture-account', scopes: ['records:publish'], method: 'bearer' }; }
    export function hasPublishScope() { return true; }`,
  // The real error class; an executor that returns the notebook it was given.
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
    export async function putPackage(hash, pkg) { globalThis.__p10.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/pkg.json'; }
    export async function putCommittedPackage(pkg) { globalThis.__p10.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/sealed.json'; }`,
  '@/lib/db': `
    const selectChain = { from: () => selectChain, where: () => selectChain, limit: async () => [] };
    export const db = {
      select() { return selectChain; },
      insert() { return { values: async (row) => { globalThis.__p10.rows.push(JSON.parse(JSON.stringify(row))); } }; },
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
      throw new Error(`#516 P10 test hook: cannot resolve ${specifier}`);
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

const { mountPublishDialog, fire } = await import('../../components/publish-dialog-test-harness.ts');

interface P10Globals { stored: string[]; rows: Array<Record<string, unknown>>; session: unknown }
const P10: P10Globals = { stored: [], rows: [], session: null };
(globalThis as unknown as { __p10: P10Globals }).__p10 = P10;

// --- The loopback MCP source and model ------------------------------------------

const ONE_ROW = JSON.stringify({ data: [{ count: '12' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-p10' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-p10-fixture', version: '0' } } }));
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

/** The one source query the model writes. It names the dataset, never the question. */
const TOOL_ARGS = { type: 'query', dataset_id: 'erm2-nwe9', query: "SELECT count(*) AS n WHERE complaint_type = 'Noise'" };

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
        `data: ${JSON.stringify({ id: 'chatcmpl-p10', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = [{ id: 'call-p10', type: 'function', function: { name: 'socrata__get_data', arguments: JSON.stringify(TOOL_ARGS) } }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-p10',
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

// --- Environment, before any app module loads ----------------------------------

for (const name of [
  'DATA_COMMONS_API_KEY', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'SITE_SEAL_ONLY', 'MODEL_API_KEY', 'OPENAI_API_KEY',
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'EXECUTOR_DRIVER', 'NYC_CHARTER_HOSTING',
  'SOCRATA_APP_TOKEN', 'DC_API_KEY',
]) {
  delete process.env[name];
}
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.OPENROUTER_API_KEY = 'fixture';
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

// --- Requests: loopback for the server side, the dialog's own paths answered here --

const recordsRoute = (await import('./records/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };

interface DialogRequest { url: string; body: Record<string, unknown> | null }
let DIALOG_REQUESTS: DialogRequest[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith('/')) {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    DIALOG_REQUESTS.push({ url: raw, body });
    if (raw === '/api/records/signing-status') return Response.json({ signingConfigured: true, sealOnly: false });
    if (raw === '/api/records/generate-summary') return Response.json({ summary: GENERATED_SUMMARY });
    if (raw === '/api/records') {
      return recordsRoute.POST(new Request('http://localhost/api/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: init?.body as string,
      }));
    }
    return Response.json({ error: 'not answered here' }, { status: 404 });
  }
  if (new URL(raw).hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- The two runs -----------------------------------------------------------------

type Json = Record<string, unknown>;

function eventsOf(body: string): Json[] {
  return body.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice('data: '.length)) as Json]; } catch { return []; }
  });
}

const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', headers: { cookie: consentCookieForTests() }, body: JSON.stringify(body) }) as never;

const compareStreamRoute = await import('./compare-stream/route.ts');
const notebookRoute = await import('./query-notebook/route.ts');
const CHAT_SSE = await (await compareStreamRoute.POST(post('/api/compare-stream', { query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true }))).text();
const NOTEBOOK_SSE = await (await notebookRoute.POST(post('/api/query-notebook', { query: QUESTION, portal: PORTAL }))).text();
const CHAT_EVENTS = eventsOf(CHAT_SSE);
const NOTEBOOK_EVENTS = eventsOf(NOTEBOOK_SSE);

const chatComplete = CHAT_EVENTS.find((e) => e.type === 'complete' && e.panel === 'withMcp')?.data as Json | undefined;
const chatTrace = CHAT_EVENTS.find((e) => e.type === 'trace')?.data as Json | undefined;

/** The props `McpResponseDisplay` hands the dialog for a chat-flow answer. */
const CHAT_PROPS: Json = {
  queryText: QUESTION,
  output: chatComplete?.content,
  toolCalls: chatComplete?.tools_called ?? [],
  evidenceTrace: chatTrace,
  model: 'fixture-fast',
  portal: PORTAL,
  promptTokens: chatComplete?.prompt_tokens,
  completionTokens: chatComplete?.completion_tokens,
  duration_ms: chatComplete?.duration_ms,
};

const notebookEvent = NOTEBOOK_EVENTS.find((e) => e.type === 'notebook');
const publishInputs = NOTEBOOK_EVENTS.find((e) => e.type === 'publish_inputs');
const STREAMED_NOTEBOOK = notebookEvent?.notebook as { cells: Array<Json>; metadata: Json } | undefined;

/** `NotebookOutput`'s `structuredSummaryText`, restated. */
function structuredSummary(notebook: { metadata?: Json } | undefined): string | undefined {
  const summary = ((notebook?.metadata?.extensions as Json | undefined)?.['org.civicaitools.summary']) as Json | undefined;
  if (typeof summary?.analysisDescription !== 'string' || typeof summary?.headlineFinding !== 'string') return undefined;
  return `${summary.analysisDescription.trim()} ${summary.headlineFinding.trim()}`;
}

/** The props `NotebookOutput` hands the dialog for an executed notebook. */
const NOTEBOOK_PROPS: Json = {
  queryText: QUESTION,
  output: publishInputs?.answer,
  toolCalls: NOTEBOOK_EVENTS.filter((e) => e.type === 'phase_a_tool_call').map((e) => ({
    name: e.name,
    args: e.args ?? {},
    resultSummary: e.resultSummary,
    duration_ms: e.duration_ms,
    operationType: e.operationType,
    reason: e.reason,
    ...(e.failed !== undefined ? { failed: e.failed } : {}),
    ...(e.failureKind !== undefined ? { failureKind: e.failureKind } : {}),
  })),
  evidenceTrace: publishInputs?.trace,
  model: 'fixture-fast',
  portal: PORTAL,
  promptTokens: (publishInputs?.tokenUsage as Json | undefined)?.promptTokens,
  completionTokens: (publishInputs?.tokenUsage as Json | undefined)?.completionTokens,
  duration_ms: publishInputs?.duration_ms,
  executedNotebook: STREAMED_NOTEBOOK,
  initialSummary: structuredSummary(STREAMED_NOTEBOOK),
};

// --- Publishing through the dialog -------------------------------------------------

interface Published {
  status: number | null;
  slug: string | null;
  sent: Json | null;
  stored: string;
  pkg: Json | null;
  row: Json | null;
  requests: DialogRequest[];
}

const ATTRIBUTION = { origin: 'https://fixture.invalid', host: 'fixture.invalid', platformTitle: 'Fixture Instance' };

async function publishThroughDialog(props: Json, promptVisibility: 'full_text' | 'hash_only'): Promise<Published> {
  P10.stored = [];
  P10.rows = [];
  DIALOG_REQUESTS = [];
  const dialog = await mountPublishDialog(props, ATTRIBUTION);
  await dialog.settle();
  if (promptVisibility === 'hash_only') {
    fire(dialog.inputLabelled('Hash only'), 'onChange');
    await dialog.settle();
  }
  await fire(dialog.button('Seal'), 'onClick');
  await dialog.settle();
  const publish = DIALOG_REQUESTS.find((r) => r.url === '/api/records');
  const stored = P10.stored[0] ?? '';
  const answer = /Sealed|Public/.test(dialog.text());
  return {
    status: answer ? 200 : null,
    slug: (P10.rows[0]?.slug as string | undefined) ?? null,
    sent: publish?.body ?? null,
    stored,
    pkg: stored ? (JSON.parse(stored) as Json) : null,
    row: P10.rows[0] ?? null,
    requests: [...DIALOG_REQUESTS],
  };
}

const RUNS = {
  chatHashOnly: await publishThroughDialog(CHAT_PROPS, 'hash_only'),
  notebookHashOnly: await publishThroughDialog(NOTEBOOK_PROPS, 'hash_only'),
  chatFullText: await publishThroughDialog(CHAT_PROPS, 'full_text'),
  notebookFullText: await publishThroughDialog(NOTEBOOK_PROPS, 'full_text'),
};

/** The census of one publish: package, slug and row, by path. */
function census(run: Published): string[] {
  const out = [
    ...findingsIn(run.pkg, 'package'),
    ...findingsIn(run.slug, 'slug'),
    ...findingsIn(run.row, 'row'),
  ];
  // The bytes, as stored: a form the walk did not attribute to a path is still a finding.
  const bytesForms = formsIn(run.stored).filter((name) => name !== 'raw');
  const walked = new Set(out.filter((f) => f.startsWith('package')).flatMap((f) => f.replace(/^.*\(/, '').replace(/\)$/, '').split(', ')));
  for (const name of bytesForms) {
    if (name === 'JSON-escaped' && walked.has('raw')) continue;
    if (!walked.has(name)) out.push(`package bytes (${name})`);
  }
  return out;
}

// --- Premises ------------------------------------------------------------------------

test('premise: the question’s four forms differ pairwise', () => {
  const forms = FORMS.map(([, form]) => form);
  assert.equal(new Set(forms).size, 4, JSON.stringify(forms));
  for (const form of forms) assert.ok(form.length > 40, `${form} is short enough to occur by accident`);
});

test('premise: both query routes ran to the end and handed the dialog what it publishes', () => {
  assert.ok(chatComplete, `the chat flow emitted no complete event:\n${CHAT_SSE.slice(0, 600)}`);
  assert.ok(chatTrace, 'the chat flow emitted no trace');
  assert.ok((CHAT_PROPS.toolCalls as unknown[]).length > 0, 'the chat flow recorded no tool call');
  assert.ok(STREAMED_NOTEBOOK, `the notebook route emitted no notebook:\n${NOTEBOOK_SSE.slice(-800)}`);
  assert.ok(publishInputs, 'the notebook route emitted no publish inputs');
  assert.ok((NOTEBOOK_PROPS.toolCalls as unknown[]).length > 0, 'the notebook route recorded no tool call');
});

test('premise: every publish reached the handler, which stored one package and one row', () => {
  for (const [name, run] of Object.entries(RUNS)) {
    assert.ok(run.sent, `${name}: the dialog sent no publish request`);
    assert.equal(run.status, 200, `${name}: the dialog did not reach its success state`);
    assert.ok(run.pkg, `${name}: no package was stored`);
    assert.ok(run.row, `${name}: no row was stored`);
    assert.equal(run.sent?.promptVisibility, name.endsWith('HashOnly') ? 'hash_only' : 'full_text', `${name}: the visibility sent`);
  }
});

test('premise: the model text in each publish body carries no form of the question', () => {
  for (const [name, run] of Object.entries(RUNS)) {
    const sent = run.sent ?? {};
    for (const field of ['output', 'toolCalls', 'summary'] as const) {
      assert.deepEqual(findingsIn(sent[field], `${name}.${field}`), [], `${name}: the ${field} carries the question, so a finding would not be the app's`);
    }
  }
});

test('premise: the search finds the question in a full-text record’s package, slug and row', () => {
  for (const name of ['chatFullText', 'notebookFullText'] as const) {
    const found = census(RUNS[name]);
    assert.ok(found.some((f) => f.startsWith('package.prompt.text')), `${name}: ${JSON.stringify(found)}`);
    assert.ok(found.some((f) => f.startsWith('slug')), `${name}: ${JSON.stringify(found)}`);
    assert.ok(found.some((f) => f.startsWith('row.promptText')), `${name}: ${JSON.stringify(found)}`);
  }
});

// --- 1. The census ---------------------------------------------------------------------

test('1: under hash-only visibility, the chat-flow record (skeleton notebook) carries no form of the question', () => {
  assert.deepEqual(census(RUNS.chatHashOnly), [], 'the question is found at these paths');
});

test('1: under hash-only visibility, the executed-notebook record carries no form of the question', () => {
  assert.deepEqual(census(RUNS.notebookHashOnly), [], 'the question is found at these paths');
});

test('1: under hash-only visibility, the record keeps the question’s hash', () => {
  for (const name of ['chatHashOnly', 'notebookHashOnly'] as const) {
    const prompt = RUNS[name].pkg?.prompt as Json | undefined;
    assert.equal(prompt?.visibility, 'hash_only');
    assert.match(String(prompt?.hash), /^[0-9a-f]{64}$/);
    assert.equal(RUNS[name].row?.promptText, null);
    assert.equal(RUNS[name].row?.promptHash, prompt?.hash);
  }
});

/**
 * Where a full-text record carries the question, measured at the base
 * (a24a004) by this census. A full-text record is unchanged: the same paths.
 */
const FULL_TEXT_PATHS = {
  chatFullText: [
    'package.prompt.text (raw)',
    'package.provenance["@graph"][0]["prov:value"] (raw)',
    'package.extensions["org.civicaitools.notebook"].cells[0].source[2] (raw)',
    'slug (slug)',
    'row.slug (slug)',
    'row.title (raw)',
    'row.promptText (raw)',
  ],
  notebookFullText: [
    'package.prompt.text (raw)',
    'package.provenance["@graph"][0]["prov:value"] (raw)',
    'package.extensions["org.civicaitools.notebook"].cells[0].source[1] (raw)',
    'slug (slug)',
    'row.slug (slug)',
    'row.title (raw)',
    'row.promptText (raw)',
  ],
};

test('1: under full-text visibility, the question stays where it was', () => {
  assert.deepEqual(
    { chatFullText: census(RUNS.chatFullText), notebookFullText: census(RUNS.notebookFullText) },
    FULL_TEXT_PATHS,
  );
});

// --- 2. The executed notebook ------------------------------------------------------------

const { validateExecutedNotebook } = await import('../../lib/notebook-author/validate.ts');
const { findCoverCell } = await import('../../lib/notebook-author/reproduction-claim.ts');
type ValidatableNotebook = Parameters<typeof validateExecutedNotebook>[0];

interface PackagedNotebook { cells: Array<Json & { source: string[] | string }>; metadata: Json }

function packagedNotebook(run: Published): PackagedNotebook {
  const notebook = (run.pkg?.extensions as Json | undefined)?.['org.civicaitools.notebook'] as PackagedNotebook | undefined;
  assert.ok(notebook, 'the package carries no notebook');
  return notebook!;
}

function sourceOf(cell: { source: string[] | string }): string {
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}

function verdictOf(notebook: { metadata: Json }): unknown {
  return ((notebook.metadata.extensions as Json)['org.civicaitools.notebook'] as Json).validation;
}

test('2: under hash-only visibility, the published executed notebook’s cover reads the withheld line', () => {
  const cover = findCoverCell(packagedNotebook(RUNS.notebookHashOnly).cells);
  assert.ok(cover, 'the published notebook has no cover');
  const text = sourceOf(cover!);
  assert.ok(text.includes(`**Query:** ${WITHHELD}`), `the cover does not read the withheld line:\n${text}`);
  assert.deepEqual(formsIn(text), []);
});

test('2: the provenance stamp and every cell but the cover are the ones the notebook route streamed', () => {
  const published = packagedNotebook(RUNS.notebookHashOnly);
  const streamed = STREAMED_NOTEBOOK!;
  assert.equal(published.cells.length, streamed.cells.length);
  const coverAt = published.cells.indexOf(findCoverCell(published.cells)!);
  published.cells.forEach((cell, i) => {
    if (i !== coverAt) assert.deepEqual(cell, streamed.cells[i], `cell ${i} changed`);
  });
  const extensions = published.metadata.extensions as Json;
  assert.deepEqual(extensions['org.civicaitools.execution'], (streamed.metadata.extensions as Json)['org.civicaitools.execution']);
  assert.ok(extensions['org.civicaitools.execution'], 'premise: the streamed notebook carries an execution stamp');
});

test('2: the verdict the published notebook carries is the validator’s verdict on the published notebook', () => {
  const published = packagedNotebook(RUNS.notebookHashOnly);
  const verdict = verdictOf(published);
  assert.ok(verdict, 'premise: the published notebook carries a verdict');
  assert.deepEqual(validateExecutedNotebook(published as unknown as ValidatableNotebook), verdict);
  assert.deepEqual(verdict, verdictOf(STREAMED_NOTEBOOK!), 'the verdict differs from the one the route attached');
  // The instrument can fail: a cover whose claim no longer matches its steps gets another verdict.
  const altered = structuredClone(published);
  const cover = findCoverCell(altered.cells)!;
  cover.source = [sourceOf(cover).replace(/(\d+) of its (\d+)/, (_m, a: string, b: string) => `${Number(a) + 1} of its ${Number(b) + 1}`)];
  assert.notDeepEqual(validateExecutedNotebook(altered as unknown as ValidatableNotebook), verdict, 'premise: the validator reads the cover’s claim');
});

// --- 3. The skeleton --------------------------------------------------------------------

const notebookModule = await import('../../lib/notebook.ts');
/** Called with the options argument the fix adds, typed loosely so this file type-checks without it. */
const generateNotebook = notebookModule.generateNotebook as unknown as (...args: unknown[]) => PackagedNotebook;

test('3: under hash-only visibility, generateNotebook writes the withheld line on the cover', () => {
  const notebook = generateNotebook(QUESTION, PORTAL, [], ANSWER, ATTRIBUTION, { promptVisibility: 'hash_only' });
  const cover = sourceOf(notebook.cells[0]);
  assert.ok(cover.includes(`**Query:** ${WITHHELD}`), `the skeleton cover does not read the withheld line:\n${cover}`);
  assert.deepEqual(findingsIn(notebook, 'skeleton'), []);
});

test('3: under full-text visibility, and with no options, generateNotebook writes the question as before', () => {
  for (const notebook of [
    generateNotebook(QUESTION, PORTAL, [], ANSWER, ATTRIBUTION, { promptVisibility: 'full_text' }),
    generateNotebook(QUESTION, PORTAL, [], ANSWER, ATTRIBUTION),
  ]) {
    assert.ok(sourceOf(notebook.cells[0]).includes(`**Query:** ${QUESTION}  \n`));
  }
});

test('3: the chat-flow record’s packaged skeleton reads the withheld line', () => {
  const cover = sourceOf(packagedNotebook(RUNS.chatHashOnly).cells[0]);
  assert.ok(cover.includes(`**Query:** ${WITHHELD}`), cover);
});

// --- 4. The publish handler, whoever built the notebook -----------------------------------

const URL_FORM = encodeURIComponent(QUESTION);
const JSON_FORM = JSON.stringify(QUESTION).slice(1, -1);
const SLUG_FORM = slugForm(QUESTION);

/** A submitted notebook carrying the question in every form, in cells, outputs, metadata and keys. */
const CARRYING = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
    extensions: { 'org.civicaitools.notebook': { provenance: 'executed', note: `asked: ${QUESTION}` } },
    [QUESTION]: true,
    tags: [SLUG_FORM],
  },
  cells: [
    { cell_type: 'markdown', id: 'p10-cover', metadata: {}, source: ['# Data Analysis\n', '\n', `**Query:** ${QUESTION}  \n`, '**Generated:** 2026-10-17\n'] },
    {
      cell_type: 'code',
      execution_count: 1,
      id: 'p10-code',
      metadata: {},
      source: [`# ${QUESTION}\n`, `url = "https://${PORTAL}/search?q=${URL_FORM}"\n`, `payload = "{\\"q\\": \\"${JSON_FORM}\\"}"\n`],
      outputs: [
        { output_type: 'stream', name: 'stdout', text: [`${QUESTION}\n`] },
        { output_type: 'display_data', metadata: { [URL_FORM]: 1 }, data: { 'application/json': { asked: QUESTION }, 'text/plain': [`{"asked": "${JSON_FORM}"}`] } },
        { output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/plain': [`'${SLUG_FORM}.csv'`] } },
      ],
    },
  ],
};

/**
 * This file's statement of the expected document: every form of the question
 * replaced by the withheld text in each markdown cell's source, and nothing
 * else changed.
 */
function withheldDocument(notebook: typeof CARRYING): unknown {
  const forms = FORMS.map(([, form]) => form).sort((a, b) => b.length - a.length);
  const text = (s: string) => forms.reduce((out, form) => out.split(form).join(WITHHELD), s);
  return {
    ...notebook,
    cells: notebook.cells.map((cell) => (cell.cell_type === 'markdown' ? { ...cell, source: cell.source.map(text) } : cell)),
  };
}

async function publishDirectly(
  promptVisibility: 'full_text' | 'hash_only',
  prompt: string = QUESTION,
  notebook: unknown = CARRYING,
): Promise<Json | null> {
  P10.stored = [];
  P10.rows = [];
  const res = await recordsRoute.POST(new Request('http://localhost/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace: { resourceSpans: [] },
      prompt,
      output: ANSWER,
      toolCalls: [],
      model: 'fixture-fast',
      tokenUsage: { promptTokens: 10, completionTokens: 5 },
      promptVisibility,
      captureMethod: 'chat-flow-stream',
      title: 'Fixture record',
      summary: GENERATED_SUMMARY,
      visibility: 'sealed',
      extensions: { 'org.civicaitools.notebook': notebook },
    }),
  }));
  assert.equal(res.status, 200, await res.clone().text());
  return P10.stored[0] ? (JSON.parse(P10.stored[0]) as Json) : null;
}

const DIRECT_HASH_ONLY = await publishDirectly('hash_only');
const DIRECT_FULL_TEXT = await publishDirectly('full_text');

test('premise: the submitted notebook carries every form of the question', () => {
  const found = new Set(findingsIn(CARRYING, 'submitted').flatMap((f) => f.replace(/^.*\(/, '').replace(/\)$/, '').split(', ')));
  assert.deepEqual([...found].sort(), FORMS.map(([name]) => name).sort());
});

test('4: under hash-only visibility, no markdown cell of a submitted notebook reaches the package with a form of the question', () => {
  const notebook = (DIRECT_HASH_ONLY?.extensions as Json | undefined)?.['org.civicaitools.notebook'] as PackagedNotebook | undefined;
  assert.ok(notebook, 'the package carries no notebook');
  const markdown = notebook!.cells.map((cell, i) => (cell.cell_type === 'markdown' ? findingsIn(cell.source, `notebook.cells[${i}].source`) : [])).flat();
  assert.deepEqual(markdown, [], 'a markdown cell carries the question at these paths');
  // What remains is model text and the run's own record, left as submitted, by path.
  assert.deepEqual(findingsIn(notebook, 'notebook'), [
    'notebook.metadata.extensions["org.civicaitools.notebook"].note (raw)',
    'notebook.metadata key "How many \\"hydrant spray\\" & noise complaints came from Astoria Park in 2026?" (raw)',
    'notebook.metadata.tags[0] (slug)',
    'notebook.cells[1].source[0] (raw)',
    'notebook.cells[1].source[1] (encodeURIComponent)',
    'notebook.cells[1].source[2] (JSON-escaped)',
    'notebook.cells[1].outputs[0].text[0] (raw)',
    'notebook.cells[1].outputs[1].metadata key "How%20many%20%22hydrant%20spray%22%20%26%20noise%20complaints%20came%20from%20Astoria%20Park%20in%202026%3F" (encodeURIComponent)',
    'notebook.cells[1].outputs[1].data["application/json"].asked (raw)',
    'notebook.cells[1].outputs[1].data["text/plain"][0] (JSON-escaped)',
    'notebook.cells[1].outputs[2].data["text/plain"][0] (slug)',
  ]);
});

test('4: each form is replaced by the withheld text in the markdown cells, and nothing else in the notebook changes', () => {
  const notebook = (DIRECT_HASH_ONLY?.extensions as Json | undefined)?.['org.civicaitools.notebook'];
  assert.deepEqual(notebook, withheldDocument(CARRYING));
});

test('4: under full-text visibility, a submitted notebook is packaged as submitted', () => {
  assert.deepEqual((DIRECT_FULL_TEXT?.extensions as Json | undefined)?.['org.civicaitools.notebook'], CARRYING);
});

// --- 4. Model text is left as submitted -----------------------------------------------------

/**
 * A short question, which the model's own code and its output also carry: as
 * a search phrase in a code cell's source, and in that cell's outputs. Code
 * sources and outputs are model text; only the generator's markdown cells are
 * the app's.
 */
const SHORT_QUESTION = 'rat sightings';
const SHORT_CARRYING = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
    extensions: { 'org.civicaitools.notebook': { provenance: 'executed' } },
  },
  cells: [
    { cell_type: 'markdown', id: 'p10-short-cover', metadata: {}, source: ['# Data Analysis\n', '\n', `**Query:** ${SHORT_QUESTION}  \n`, '**Generated:** 2026-10-17\n'] },
    {
      cell_type: 'code',
      execution_count: 1,
      id: 'p10-short-code',
      metadata: { tags: ['step'] },
      source: [`datasets = search("${SHORT_QUESTION}")\n`, 'datasets.head()\n'],
      outputs: [
        { output_type: 'stream', name: 'stdout', text: [`3 datasets match ${SHORT_QUESTION}\n`] },
        { output_type: 'display_data', metadata: {}, data: { 'text/html': [`<b>${SHORT_QUESTION}</b>`], 'text/plain': [`'${SHORT_QUESTION}'`] } },
      ],
    },
  ],
};

const SHORT_HASH_ONLY = await publishDirectly('hash_only', SHORT_QUESTION, SHORT_CARRYING);

test('4: under hash-only visibility, a code cell that carries the question is packaged byte for byte as submitted', () => {
  const notebook = (SHORT_HASH_ONLY?.extensions as Json | undefined)?.['org.civicaitools.notebook'] as PackagedNotebook | undefined;
  assert.ok(notebook, 'the package carries no notebook');
  const code = notebook!.cells.find((cell) => cell.id === 'p10-short-code');
  assert.equal(JSON.stringify(code), JSON.stringify(SHORT_CARRYING.cells[1]), 'the code cell, its source or its outputs changed');
  assert.equal(JSON.stringify(notebook!.metadata), JSON.stringify(SHORT_CARRYING.metadata), 'the notebook metadata changed');
  const cover = sourceOf(notebook!.cells[0]);
  assert.ok(cover.includes(`**Query:** ${WITHHELD}  \n`), `the cover does not read the withheld line:\n${cover}`);
  assert.ok(!cover.includes(SHORT_QUESTION), cover);
});

// --- 6. The summary handler, sent no question -------------------------------------------

const summaryRoute = (await import('./records/generate-summary/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };

async function summarize(body: Record<string, unknown>): Promise<{ status: number; userMessage: string | null }> {
  P10.session = { user: { id: 'fixture-account' } };
  const from = MODEL_REQUESTS.length;
  try {
    const res = await summaryRoute.POST(new Request('http://localhost/api/records/generate-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    const sent = MODEL_REQUESTS.slice(from)[0];
    const messages = (sent?.messages ?? []) as Array<{ role?: string; content?: unknown }>;
    const user = messages.find((m) => m.role === 'user');
    return { status: res.status, userMessage: typeof user?.content === 'string' ? user.content : null };
  } finally {
    P10.session = null;
  }
}

test('6: the summary handler answers a request that carries no question, and tells the model none', async () => {
  const { status, userMessage } = await summarize({ output: ANSWER, toolCalls: [{ name: 'socrata__get_data', args: TOOL_ARGS }] });
  assert.equal(status, 200);
  assert.ok(userMessage, 'premise: the handler asked the model');
  assert.ok(!userMessage!.includes('Original question'), userMessage!);
  assert.ok(userMessage!.includes(ANSWER.split('\n')[0]), 'the answer did not reach the model');
});

test('6: a summary request that carries the question still tells the model the question', async () => {
  const { status, userMessage } = await summarize({ prompt: QUESTION, output: ANSWER, toolCalls: [] });
  assert.equal(status, 200);
  assert.ok(userMessage?.startsWith(`Original question: ${QUESTION}\n\n`), String(userMessage));
});

// --- 7. The publish contract ----------------------------------------------------------------

test('7: docs/api/records-publish.md states the rule for hash-only visibility', () => {
  const doc = fs.readFileSync(path.join(SRC, '..', 'docs/api/records-publish.md'), 'utf8');
  assert.ok(doc.includes('Under `"hash_only"`, a record carries no verbatim copy of the question.'), 'the publish contract does not state the rule');
  assert.ok(doc.includes(`with \`${WITHHELD}\` in the generator's markdown cells of a submitted \`org.civicaitools.notebook\` extension`), 'the publish contract does not say what the endpoint does with a submitted notebook');
  assert.ok(doc.includes('Code-cell sources, every cell\'s outputs, cell metadata and notebook metadata are packaged as submitted.'), 'the publish contract does not say what is left as submitted');
});
