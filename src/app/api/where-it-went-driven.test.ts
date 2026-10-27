// R6 W4 (#632), §6, the wiring: each run route sends the section's model with
// its completion, and it is the model the record gives for the same run.
//
// WHAT IS DRIVEN. The harness of `consent-gate-on-driven.test.ts`: each
// route's real handler and stream with the consent gate on as shipped, the
// real model loop against a scripted model endpoint, the real MCP client
// against a loopback fixture, the real consent module and flows statement.
// One consent for all three drives: Socrata On, Data Commons Off, Boston Ask
// first. The model calls Socrata (answered) and Data Commons (refused
// `not_offered`, a source the run was not offered), then answers.
//   - `/api/compare-stream`: the `complete` event's `data.flows`;
//   - `/api/query-notebook`: the `complete` phase event's `flows`, with the
//     notebook runner (the sandbox stubbed to return the notebook it is given);
//   - `/api/compare`: the JSON body's `withMcp.flows`.
//
// WHAT IS ASSERTED.
//   - Each completion carries the run's model: the model endpoint, Socrata
//     with one call, the runner for the notebook, and the reasons for the
//     others; the statement in force (§1, run side).
//   - Ruling F2: the routes build it from the run's tool-call records with the
//     resolver the loop was given; a package the real packager builds from
//     the same run's trace, read against the same statement, gives the same
//     model. Ruling F4: that package is driven through a route with the gate on,
//     and reads back `in-force` against the statement the run had, and
//     `reference` against another.
//   - Criterion 5: the package carries no `flows` key, and the trace event
//     carries no model of the section.
//
//   - R6 cold read F2: the three routes driven again under an azure-shaped
//     catalog whose declared `model` is not its `endpointModel`; each
//     section's model row names the declared model, the one the record names.
//     The two streaming routes are the control that the fixture tells the
//     two strings apart.
//
// At `2051cb5` (before the wiring) no completion carries `flows`, so each
// route's test fails at its first assertion. At `b1ef02f` the JSON route
// names the deployment, so its F2 test fails at the model string.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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

// --- Module hooks (as consent-gate-on-driven.test.ts) -------------------------------

const STUB_PREFIX = 'file:///r6-w4-wiring-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.44' }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/rate-limit': `
    export async function checkRateLimit() { return { remaining: 99, limit: 100, resetAt: 0 }; }
    export function isRateLimited() { return false; }
    export async function incrementRateLimit() {}
    export function getMissingRateLimitSecretError() { return null; }`,
  '@/lib/sandbox': `
    export class NotebookExecutionError extends Error {}
    export async function executeNotebook(notebook) {
      return { notebook, sandboxId: 'fixture-sandbox-w4', executionDuration_ms: 1, pythonVersion: '3.13.0', libraries: {} };
    }`,
  '@/lib/sources/consent-store': `
    export async function readConsentRow() { return null; }
    export async function writeConsentRow() {}
    export async function deleteConsentRow() {}`,
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
      throw new Error(`r6-w4 wiring test hook: cannot resolve ${specifier}`);
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

// --- The loopback data sources ------------------------------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'r6-w4-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture Socrata guidance.' } }] } })}\n\n`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ count: 4812 }], total_rows: 1 }) }], isError: false } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH',
  'MODEL_API_VERSION', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH', 'OPENROUTER_API_KEY', 'SITE_PORTAL_LOCKED',
  'SITE_DEFAULT_PORTAL', 'EXECUTOR_DRIVER', 'VERCEL_ENV', 'APP_HOST', 'NEXTAUTH_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'SOURCE_ROUTING',
]) delete process.env[name];
process.env.MODEL_API_KEY = 'placeholder-model-key-r6-w4-wiring';
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;

const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID ??= 'platform:test-suite-kid';

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { _resetDefaultModelClientForTests } = await import('../../lib/model-client.ts');
const { getDefaultModel } = await import('@/lib/model-resolver');
const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');
const { buildFlowsStatement, statementHash } = await import('../../lib/flows/statement.ts');
const { CONSENT_COOKIE_NAME, encodeConsentCookie } = await import('../../lib/sources/consent.ts');
const { whereItWentFromPackage } = await import('../../lib/flows/where-it-went.ts');
const { WHERE_IT_WENT_REASONS } = await import('../../lib/sources/copy.ts');

type Handler = (request: Request) => Promise<Response>;
const compareStream = (await import('./compare-stream/route.ts')) as unknown as { POST: Handler };
const notebook = (await import('./query-notebook/route.ts')) as unknown as { POST: Handler };
const compare = (await import('./compare/route.ts')) as unknown as { POST: Handler };

type Statement = Awaited<ReturnType<typeof buildFlowsStatement>>;

// --- One drive -----------------------------------------------------------------------

const QUESTION = 'How many noise complaints were filed in Queens?';
const SOCRATA_ARGS = { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9', query: 'SELECT count(*)' };
const REPLIES = [
  {
    toolCalls: [
      { id: 'c1', name: 'socrata__get_data', args: SOCRATA_ARGS },
      { id: 'c2', name: 'data_commons__search_indicators', args: { query: 'population', places: ['Queens County'] } },
    ],
  },
  { content: 'There were 4,812 complaints.' },
];
const STATES = { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first' };

interface Drive { status: number; events: Record<string, unknown>[]; json: Record<string, unknown> | null; statement: Statement; model: string }

/**
 * The model endpoint. A request that offers tools is the with-data run and is
 * answered from `REPLIES` in order; one that offers none (the comparison's
 * without-data half, which runs beside it) gets an answer from a second
 * script, so the two halves cannot draw each other's replies.
 */
async function modelEndpoint(): Promise<{ url: string; close: () => Promise<void> }> {
  const withTools = await startScriptedModelServer(REPLIES);
  const withoutTools = await startScriptedModelServer([{ content: 'An answer from training data.' }]);
  const front = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body) as { tools?: unknown[] };
    const target = Array.isArray(parsed.tools) && parsed.tools.length > 0 ? withTools.url : withoutTools.url;
    const upstream = await realFetch(`${target}${req.url ?? ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', () => resolve()));
  const close = (s: http.Server) => new Promise<void>((resolve) => s.close(() => resolve()));
  return {
    url: `http://127.0.0.1:${(front.address() as AddressInfo).port}${new URL(withTools.url).pathname.replace(/\/$/, '')}`,
    close: async () => { await close(front); await close(withTools.server); await close(withoutTools.server); },
  };
}

async function drive(handler: Handler, url: string, body: Record<string, unknown>): Promise<Drive> {
  const scripted = await modelEndpoint();
  process.env.MODEL_API_BASE_URL = scripted.url;
  _resetDefaultModelClientForTests();
  const statement = await buildFlowsStatement();
  const versionOf = (id: string) => statement.sources.find((s) => s.sourceId === id)?.version ?? 'f'.repeat(64);
  const cookie = `${CONSENT_COOKIE_NAME}=${encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(Object.entries(STATES).map(([id, state]) => [id, { state: state as 'on', since: '2026-10-21', version: versionOf(id) }])),
  })}`;
  try {
    const response = await handler(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }));
    const text = await Promise.race([
      response.text(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('the response did not close within 20 s')), 20_000).unref()),
    ]);
    let json: Record<string, unknown> | null = null;
    if ((response.headers.get('content-type') ?? '').includes('application/json')) json = JSON.parse(text) as Record<string, unknown>;
    const events = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice('data: '.length)) as Record<string, unknown>);
    return { status: response.status, events, json, statement, model: String(body.model ?? getDefaultModel().id) };
  } finally {
    _resetDefaultModelClientForTests();
    await scripted.close();
  }
}

const MODEL_ID = getDefaultModel().id;
const STREAM = await drive(compareStream.POST, 'http://localhost/api/compare-stream', { query: QUESTION, model: MODEL_ID, mcpOnly: true });
const NOTEBOOK = await drive(notebook.POST, 'http://localhost/api/query-notebook', { query: QUESTION });
const COMPARE = await drive(compare.POST, 'http://localhost/api/compare', { query: QUESTION, model: MODEL_ID });

// --- The same three drives under a catalog whose declared model is not its deployment ----
//
// R6 cold read F2. Under `azure-openai` a catalog entry's `model` (the declared
// identity, the one the record names) differs from its `endpointModel` (the
// deployment name sent on the wire). Configured the way
// `src/lib/model-identity.test.ts` configures one; obviously fake names, a
// loopback endpoint. Driven here, before any test runs, and the environment is
// put back before the tests above read anything, so the default-catalog drives
// and their tests are unchanged.
const AZURE_DEPLOYMENT = 'example-deployment-alias-cr';
const AZURE_DECLARED = 'vendor/model-cr';
const { _resetModelCatalogForTests } = await import('../../lib/model-resolver.ts');
process.env.MODEL_API_KIND = 'azure-openai';
process.env.MODEL_API_VERSION = '2099-01-01-preview';
process.env.MODEL_CATALOG = JSON.stringify([{
  id: 'fast', name: 'Fast', provider: 'Example Vendor', supports_tools: true,
  endpointModel: AZURE_DEPLOYMENT, model: AZURE_DECLARED, default: true, evaluator: 1,
}]);
_resetModelCatalogForTests();
const AZURE_STREAM = await drive(compareStream.POST, 'http://localhost/api/compare-stream', { query: QUESTION, model: 'fast', mcpOnly: true });
const AZURE_NOTEBOOK = await drive(notebook.POST, 'http://localhost/api/query-notebook', { query: QUESTION });
const AZURE_COMPARE = await drive(compare.POST, 'http://localhost/api/compare', { query: QUESTION, model: 'fast' });
for (const name of ['MODEL_API_KIND', 'MODEL_API_VERSION', 'MODEL_CATALOG']) delete process.env[name];
_resetModelCatalogForTests();
_resetDefaultModelClientForTests();

const streamFlows = (d: Drive) => (d.events.find((e) => e.type === 'complete' && e.panel === 'withMcp')?.data as Record<string, unknown> | undefined)?.flows;
const notebookFlows = (d: Drive) => d.events.find((e) => e.type === 'phase' && e.name === 'complete')?.flows;
const compareFlows = (d: Drive) => (d.json?.withMcp as Record<string, unknown> | undefined)?.flows;

const streamTrace = (d: Drive) => d.events.find((e) => e.type === 'trace')?.data as Record<string, unknown> | undefined;
const notebookTrace = (d: Drive) => (d.events.find((e) => e.type === 'publish_inputs') as { trace?: Record<string, unknown> } | undefined)?.trace;

interface Model { reached: Array<{ kind: string; sourceId?: string; calls?: number; recipients: Array<{ got?: string }> }>; notReached: Array<{ sourceId: string; whyNotSent: string }>; statement: { kind: string } }

function packageOf(trace: Record<string, unknown>, extensions?: Record<string, unknown>) {
  return buildEvidencePackage({
    trace,
    prompt: QUESTION,
    output: 'There were 4,812 complaints.',
    toolCalls: [{ name: 'socrata__get_data', args: SOCRATA_ARGS, resultSummary: { rows: 1, columns: 1 } }],
    model: MODEL_ID,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'R6 W4 wiring',
    summary: 'R6 W4 wiring.',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    ...(extensions ? { extensions } : {}),
  }).pkg;
}

function assertRunModel(flows: unknown, label: string, executed: boolean) {
  assert.ok(flows && typeof flows === 'object', `${label}: the completion carries no flows`);
  const m = flows as Model;
  assert.deepEqual(m.statement, { kind: 'in-force' }, `${label}: the statement in force`);
  assert.deepEqual(m.reached.map((r) => [r.kind, r.sourceId ?? null, r.calls ?? null]), [
    ['model', null, null],
    ['source', 'socrata', 1],
    ...(executed ? [['notebook', null, null]] : []),
  ], `${label}: the rows reached`);
  assert.ok(m.reached.every((r) => r.recipients.length > 0 && r.recipients.every((x) => typeof x.got === 'string')), `${label}: each recipient states what it got`);
  const why = Object.fromEntries(m.notReached.map((r) => [r.sourceId, r.whyNotSent]));
  assert.equal(why['data-commons'], WHERE_IT_WENT_REASONS.off, `${label}: Data Commons, Off (its refused call is not received)`);
  assert.equal(why['boston-opencontext'], WHERE_IT_WENT_REASONS.notAsked, `${label}: Boston, Ask first`);
}

// --- The completions ---------------------------------------------------------------------

test('§6: /api/compare-stream sends the section\'s model with its completion', () => {
  assert.equal(STREAM.status, 200, `premise: the stream was served (${STREAM.status})`);
  assertRunModel(streamFlows(STREAM), 'compare-stream', false);
});

test('§6: /api/query-notebook sends it on its complete phase, with the notebook runner', () => {
  assert.equal(NOTEBOOK.status, 200, `premise: the stream was served (${NOTEBOOK.status})`);
  assert.ok(NOTEBOOK.events.some((e) => e.type === 'notebook'), `premise: the notebook ran: ${JSON.stringify(NOTEBOOK.events.find((e) => e.type === 'error') ?? {}).slice(0, 300)}`);
  assertRunModel(notebookFlows(NOTEBOOK), 'query-notebook', true);
});

test('§6: /api/compare sends it in its JSON body, its reasons through recordReasons', () => {
  assert.equal(COMPARE.status, 200, `premise: the request was served: ${JSON.stringify(COMPARE.json).slice(0, 300)}`);
  assertRunModel(compareFlows(COMPARE), 'compare', false);
});

// --- Rulings F2 and F4, and criterion 5 ---------------------------------------------------

for (const [label, d, flowsOf, traceOf] of [
  ['compare-stream', STREAM, streamFlows, streamTrace],
  ['query-notebook', NOTEBOOK, notebookFlows, notebookTrace],
] as const) {
  test(`F2, F4 (${label}): the package built from the same run's trace gives the same model; in force against the run's statement, a reference against another`, () => {
    const flows = flowsOf(d);
    assert.ok(flows, `${label}: the completion carries no flows`);
    const trace = traceOf(d);
    assert.ok(trace, `premise: ${label} emitted its trace`);
    const notebookExtension = label === 'query-notebook'
      ? { 'org.civicaitools.notebook': (d.events.find((e) => e.type === 'notebook') as { notebook?: unknown }).notebook }
      : undefined;
    const pkg = packageOf(trace, notebookExtension);
    const composition = (pkg.extensions as Record<string, Record<string, unknown>>)['org.civicaitools.composition'];
    assert.equal((composition.flowsStatement as { hash?: string }).hash, statementHash(d.statement), 'premise: the package references the run\'s statement');
    assert.deepEqual(whereItWentFromPackage(pkg, d.statement), flows, 'the record gives the model the completion carried');
    const other = structuredClone(d.statement);
    other.date = '2026-01-01';
    const unmatched = whereItWentFromPackage(pkg, other);
    assert.deepEqual(unmatched?.statement, { kind: 'reference', date: d.statement.date, url: (composition.flowsStatement as { url: string }).url });
  });

  test(`criterion 5 (${label}): neither the trace nor the package carries the section's model`, () => {
    const trace = traceOf(d);
    assert.ok(trace, `premise: ${label} emitted its trace`);
    assert.ok(flowsOf(d), `premise: ${label}'s completion carries flows`);
    for (const [what, value] of [['trace', trace], ['package', packageOf(trace)]] as const) {
      const text = JSON.stringify(value);
      assert.ok(!text.includes('"flows":') && !text.includes('whyNotSent') && !text.includes('Where this question went'), `the ${what} carries the section's model`);
    }
  });
}

// --- R6 cold read F2: the section's model is the declared model, on every route ------------

for (const [label, d, flowsOf] of [
  ['compare-stream', AZURE_STREAM, streamFlows],
  ['query-notebook', AZURE_NOTEBOOK, notebookFlows],
  ['compare', AZURE_COMPARE, compareFlows],
] as const) {
  test(`F2 (${label}): under a catalog whose declared model is not its deployment, the section names the declared model`, () => {
    assert.notEqual(AZURE_DECLARED, AZURE_DEPLOYMENT, 'premise: the fixture can tell the two apart');
    assert.ok(d.status === 200, `premise: ${label} was served (${d.status}): ${JSON.stringify(d.json ?? d.events.find((e) => e.type === 'error') ?? {}).slice(0, 300)}`);
    const flows = flowsOf(d) as Model | undefined;
    assert.ok(flows, `${label}: the completion carries no flows`);
    const row = flows.reached[0] as { kind: string; model?: string | null };
    assert.equal(row.kind, 'model', `${label}: the first row is the model endpoint`);
    assert.equal(row.model, AZURE_DECLARED, `${label}: the section names ${JSON.stringify(row.model)}, not the declared model the record names`);
  });
}
