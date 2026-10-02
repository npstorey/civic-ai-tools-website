// #548 — what every model request SENDS, read off the wire, for a catalog
// entry with and without its request settings, under both dialects.
//
// A reasoning model reached through Chat Completions refuses `max_tokens`,
// and refuses a request carrying tools unless `reasoning_effort` is `none`.
// The catalog now says which name a model takes its token limit under and
// which reasoning setting it is sent (`model-request-settings.test.ts` holds
// the schema). This file holds the property where it matters: in the bytes a
// loopback endpoint receives, at every call site, reached through the real
// route handlers.
//
// THE CALL SITES, and the drive that reaches each:
//   the loop's first turn and later rounds (tools)  — compare, compare-stream, replay
//   the loop's answering turn, streamed              — compare-stream
//   the loop's answering turn, not streamed          — compare, replay
//   the no-data side, streamed                       — compare-stream
//   the no-data side, not streamed                   — compare
//   the evaluation rubric                            — evaluate
//   the summary draft                                — generate-summary
// That is all eight `chat.completions.create` calls in the tree (the registry
// in `model-loop/model-call-registry.test.ts` lists their files). Two routes
// are not driven here: `/api/query-notebook` runs the same streaming loop
// entry as compare-stream and needs a notebook executor, and the publication
// gate needs a signing key and storage. Both take their identity from
// `modelIdentity()`, which `model-request-settings.test.ts` drives.
//
// THE TWO CATALOGS. "Without" sets neither field on any entry: every request
// must be exactly today's — same keys, same order, `max_tokens` with today's
// value, and the body nothing but `JSON.stringify` of those, so the bytes
// follow. "With" gives each role a different combination:
//   the analysis model   reasoningEffort "none"                          (the downstream case)
//   the evaluator        reasoningEffort "low", tokenLimitParameter max_completion_tokens
//   the summariser       tokenLimitParameter max_completion_tokens only
//
// STUBS, as in `errors-out-of-logs-driven.test.ts` and for the same reasons:
// no request scope or sign-in provider outside Next (`next/headers`,
// `next-auth`, `@/lib/auth`), no object storage or database (`@/lib/storage`,
// `@/lib/db`, `@/lib/evidence/sealed-access`). No live endpoint, no signing
// key, no non-loopback address.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-request-settings-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
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
const SRC = path.resolve(HERE, '..');

// --- Module hooks -------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-548-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.7' }); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `
    export async function getPackage() { return globalThis.__s548Package ?? null; }
    export async function putPackage() { throw new Error('no storage in this test'); }`,
  '@/lib/db': `
    const row = { id: 'rec-1', slug: 'noise', basePackageStorageKey: 'sealed/rec-1.json', visibility: 'public', creatorId: 'fixture-account' };
    const chain = { from: () => chain, where: () => chain, limit: async () => [row] };
    export const db = { select: () => chain };`,
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
      throw new Error(`#548 test hook: cannot resolve ${specifier}`);
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

const globals = globalThis as unknown as Record<string, unknown>;

// --- Loopback: a model endpoint that answers by the SHAPE of each request ------
//
// By shape, not by order: compare runs its two sides in parallel, so arrival
// order is not the script. A request with tools and no tool result yet gets a
// tool call; a request with tools after one gets an empty message, which sends
// the loop to its answering turn; everything else gets an answer, streamed when
// asked for.

interface Received { drive: string; path: string; raw: string; body: Record<string, unknown> }

const received: Received[] = [];
let currentDrive = '';

const model = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw) as Record<string, unknown>;
  received.push({ drive: currentDrive, path: req.url ?? '', raw, body });
  const messages = (body.messages ?? []) as Array<{ role: string }>;
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  const envelope = { id: 'chatcmpl-548', created: 1, model: 'vendor/model-reported' };

  if (body.stream === true) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (payload: Record<string, unknown>) =>
      `data: ${JSON.stringify({ ...envelope, object: 'chat.completion.chunk', ...payload })}\n\n`;
    res.write(frame({ choices: [{ index: 0, delta: { content: 'Twelve complaints.' }, finish_reason: null }] }));
    res.write(frame({ choices: [], usage }));
    res.end('data: [DONE]\n\n');
    return;
  }

  let message: Record<string, unknown> = { role: 'assistant', content: 'Twelve complaints.' };
  let finish = 'stop';
  if (body.tools !== undefined) {
    if (!messages.some((m) => m.role === 'tool')) {
      message = {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_548',
          type: 'function',
          function: { name: 'get_data', arguments: JSON.stringify({ type: 'query', dataset_id: 'abcd-1234', portal: 'data.example.org' }) },
        }],
      };
      finish = 'tool_calls';
    } else {
      message = { role: 'assistant', content: '' };
    }
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ...envelope, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }], usage }));
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Loopback: an MCP source that answers every tool call with an empty page ---

const source = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-548-session' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 's548', version: '0' } } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (msg.method === 'prompts/get') {
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Guidance.' } }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: '{"data":[]}' }] } })}\n\n`);
});
await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', () => resolve()));
source.unref();
const SOURCE_URL = `http://127.0.0.1:${(source.address() as AddressInfo).port}/mcp`;

// --- Environment, before any app module loads ----------------------------------

for (const name of [
  'MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'MODEL_API_AUTH', 'MODEL_CATALOG_PATH',
  'SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
]) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = SOURCE_URL;
process.env.DATA_COMMONS_MCP_URL = SOURCE_URL;
process.env.BOSTON_OPENCONTEXT_MCP_URL = SOURCE_URL;
// Presence is all the routes' guard checks; the loopback endpoint never authenticates.
process.env.MODEL_API_KEY = 'fixture';
// Every drive below is one query by the same fixture account.
process.env.AUTHENTICATED_RATE_LIMIT = '1000';
process.env.APP_TIER_RATE_LIMIT = '1000';
// The packager refuses to build a package for an instance that has not
// declared who it is; fixture values for a fixture instance, and no key.
process.env.PUBLISHER_PLATFORM_AGENT_TITLE = 'Fixture Instance';
process.env.PUBLISHER_SITE_ORIGIN = 'https://fixture.invalid';
process.env.PUBLISHER_KEY_ID = 'fixture-kid';

const ANALYSIS = { endpointModel: 'example-analysis-deployment', model: 'vendor/model-fixture-1' };

function catalog(withSettings: boolean): string {
  return JSON.stringify([
    {
      id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true,
      ...ANALYSIS, default: true, evaluator: 2,
      ...(withSettings ? { reasoningEffort: 'none' } : {}),
    },
    {
      id: 'fixture-judge', name: 'Fixture Judge', provider: 'Example Provider', supports_tools: true,
      endpointModel: 'example-judge-deployment', model: 'vendor/model-judge-1', evaluator: 1,
      ...(withSettings ? { reasoningEffort: 'low', tokenLimitParameter: 'max_completion_tokens' } : {}),
    },
    {
      id: 'fixture-summary', name: 'Fixture Summariser', provider: 'Example Provider', supports_tools: true,
      endpointModel: 'example-summary-deployment', model: 'vendor/model-summary-1', summarizer: true, selectable: false,
      ...(withSettings ? { tokenLimitParameter: 'max_completion_tokens' } : {}),
    },
  ]);
}

const DIALECTS = ['openai-compatible', 'azure-openai'] as const;
type Dialect = (typeof DIALECTS)[number];
const VARIANTS = ['without', 'with'] as const;
type Variant = (typeof VARIANTS)[number];

function configure(dialect: Dialect, variant: Variant): void {
  process.env.MODEL_CATALOG = catalog(variant === 'with');
  if (dialect === 'azure-openai') {
    process.env.MODEL_API_KIND = 'azure-openai';
    process.env.MODEL_API_BASE_URL = MODEL_ORIGIN;
    process.env.MODEL_API_VERSION = '2024-12-01-preview';
  } else {
    delete process.env.MODEL_API_KIND;
    delete process.env.MODEL_API_VERSION;
    process.env.MODEL_API_BASE_URL = `${MODEL_ORIGIN}/v1`;
  }
}

// --- The drives ------------------------------------------------------------------

const { _resetModelCatalogForTests } = await import('./model-resolver.ts');
const { _resetDefaultModelClientForTests } = await import('./model-client.ts');
const { buildEvidencePackage } = await import('./evidence/packager.ts');
const compare = await import('../app/api/compare/route.ts');
const compareStream = await import('../app/api/compare-stream/route.ts');
const summary = await import('../app/api/evidence/generate-summary/route.ts');
const evaluate = await import('../app/api/evidence/[slug]/evaluate/route.ts');
const replay = await import('../app/api/evidence/[slug]/replay/route.ts');

// A record that exists, for evaluate and replay: a package the real packager
// built, naming the analysis model by its DECLARED identity, as a signed
// package does — replay maps it back to the entry, settings included.
const { pkg } = buildEvidencePackage({
  trace: { resourceSpans: [] } as never,
  prompt: 'How many noise complaints were there?',
  output: 'Twelve complaints.',
  toolCalls: [],
  model: ANALYSIS.model,
  tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  duration_ms: 1000,
  promptVisibility: 'full_text',
  title: 'Noise complaints',
  captureMethod: 'chat-flow-stream',
} as never);
globals.__s548Package = pkg;

function post(route: string, body: unknown): Request {
  return new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const QUERY = { query: 'How many noise complaints were there?', model: 'fixture-fast', portal: 'data.example.org' };
const SLUG = { params: Promise.resolve({ slug: 'noise' }) };

interface Outcome { status: number; body: string }
const outcomes = new Map<string, Outcome>();

for (const dialect of DIALECTS) {
  for (const variant of VARIANTS) {
    configure(dialect, variant);
    _resetModelCatalogForTests();
    _resetDefaultModelClientForTests();
    const drives: Array<[string, () => Promise<Response>]> = [
      ['compare', () => compare.POST(post('/api/compare', QUERY) as never)],
      ['compare-stream', () => compareStream.POST(post('/api/compare-stream', QUERY) as never)],
      ['summary', () => summary.POST(post('/api/evidence/generate-summary', { prompt: QUERY.query, output: 'Twelve.', toolCalls: [] }) as never)],
      ['evaluate', () => evaluate.POST(post('/api/evidence/noise/evaluate', { modelApiKey: 'fixture', evaluatorModel: 'fixture-judge' }) as never, SLUG)],
      ['replay', () => replay.POST(post('/api/evidence/noise/replay', { modelApiKey: 'fixture' }) as never, SLUG)],
    ];
    for (const [name, run] of drives) {
      currentDrive = `${dialect}/${variant}/${name}`;
      const silenced = silence();
      try {
        const response = await run();
        // Read to the end: a streamed route's model calls happen while it streams.
        outcomes.set(currentDrive, { status: response.status, body: await response.text() });
      } finally {
        silenced();
      }
    }
  }
}

/** The routes log their own lines; this file reads the wire, not the log. */
function silence(): () => void {
  const methods = ['log', 'error', 'warn', 'info', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = () => {};
  return () => methods.forEach((m, i) => { console[m] = saved[i]; });
}

// --- Reading the wire ------------------------------------------------------------

type Site =
  | 'loop: first turn'
  | 'loop: later round'
  | 'loop: answering turn, streamed'
  | 'loop: answering turn, not streamed'
  | 'no-data side, streamed'
  | 'no-data side, not streamed'
  | 'evaluation rubric'
  | 'summary draft';

const { EVALUATION_RUBRIC } = await import('./evidence/adversarial-eval-core.ts');

function siteOf(request: Received): Site {
  const messages = request.body.messages as Array<{ role: string; content: unknown }>;
  const system = messages.find((m) => m.role === 'system')?.content;
  const last = String(messages.at(-1)?.content ?? '');
  if (request.body.tools !== undefined) {
    return messages.some((m) => m.role === 'tool') ? 'loop: later round' : 'loop: first turn';
  }
  if (last.startsWith('This is the final turn')) {
    return request.body.stream === true ? 'loop: answering turn, streamed' : 'loop: answering turn, not streamed';
  }
  if (system === EVALUATION_RUBRIC) return 'evaluation rubric';
  if (String(system).startsWith('You are writing a one-paragraph summary')) return 'summary draft';
  return request.body.stream === true ? 'no-data side, streamed' : 'no-data side, not streamed';
}

/** Which sites each drive reaches, and the token limit each sends there. */
const EXPECTED: Record<string, Partial<Record<Site, number>>> = {
  compare: {
    'loop: first turn': 2000,
    'loop: later round': 2000,
    'loop: answering turn, not streamed': 2000,
    'no-data side, not streamed': 2000,
  },
  'compare-stream': {
    'loop: first turn': 4000,
    'loop: later round': 4000,
    'loop: answering turn, streamed': 4000,
    'no-data side, streamed': 4000,
  },
  summary: { 'summary draft': 300 },
  evaluate: { 'evaluation rubric': 2000 },
  replay: {
    'loop: first turn': 4000,
    'loop: later round': 4000,
    'loop: answering turn, not streamed': 4000,
  },
};

/** What the "with" catalog's entry for each drive's model must put in place of `max_tokens`. */
const WITH_SETTINGS: Record<string, (limit: number) => Record<string, unknown>> = {
  compare: (limit) => ({ max_completion_tokens: limit, reasoning_effort: 'none' }),
  'compare-stream': (limit) => ({ max_completion_tokens: limit, reasoning_effort: 'none' }),
  replay: (limit) => ({ max_completion_tokens: limit, reasoning_effort: 'none' }),
  evaluate: (limit) => ({ max_completion_tokens: limit, reasoning_effort: 'low' }),
  summary: (limit) => ({ max_completion_tokens: limit }),
};

/** The request each site has always sent, as an ordered key list, `max_tokens` marked. */
function todaysKeys(site: Site, dialect: Dialect): string[] {
  if (site === 'loop: first turn' || site === 'loop: later round') {
    return ['model', 'messages', 'tools', 'tool_choice', 'max_tokens'];
  }
  if (site === 'loop: answering turn, streamed' || site === 'no-data side, streamed') {
    return ['model', 'messages', 'max_tokens', 'stream', ...(dialect === 'openai-compatible' ? ['stream_options'] : [])];
  }
  return ['model', 'messages', 'max_tokens'];
}

function requestsOf(dialect: Dialect, variant: Variant, drive: string): Received[] {
  return received.filter((r) => r.drive === `${dialect}/${variant}/${drive}`);
}

// --- Premises: each drive reached every site it is listed for -------------------

for (const dialect of DIALECTS) {
  for (const variant of VARIANTS) {
    test(`premise, ${dialect}, ${variant} settings: every drive reached the endpoint at every site it is listed for`, () => {
      for (const [drive, sites] of Object.entries(EXPECTED)) {
        const requests = requestsOf(dialect, variant, drive);
        const outcome = outcomes.get(`${dialect}/${variant}/${drive}`);
        assert.deepEqual(
          [...new Set(requests.map(siteOf))].sort(),
          Object.keys(sites).sort(),
          `${drive} reached the wrong sites (status ${outcome?.status}: ${outcome?.body.slice(0, 300)})`,
        );
        for (const request of requests) {
          // The dialect really was the one configured: Azure routes by deployment.
          if (dialect === 'azure-openai') {
            assert.match(request.path, /^\/openai\/deployments\/example-[a-z]+-deployment\/chat\/completions\?api-version=2024-12-01-preview$/);
          } else {
            assert.equal(request.path, '/v1/chat/completions');
          }
        }
      }
    });
  }
}

// --- The criterion ---------------------------------------------------------------

for (const dialect of DIALECTS) {
  test(`${dialect}, an entry with no settings: every request is the one each site has always sent`, () => {
    const differences: string[] = [];
    for (const [drive, sites] of Object.entries(EXPECTED)) {
      for (const request of requestsOf(dialect, 'without', drive)) {
        const site = siteOf(request);
        const keys = Object.keys(request.body);
        if (JSON.stringify(keys) !== JSON.stringify(todaysKeys(site, dialect))) {
          differences.push(`${drive} / ${site}: keys ${keys.join(',')}`);
        }
        if (request.body.max_tokens !== sites[site]) {
          differences.push(`${drive} / ${site}: max_tokens ${String(request.body.max_tokens)}, expected ${sites[site]}`);
        }
        // The body is `JSON.stringify` of exactly those keys and values, so the
        // keys and their order above determine the bytes.
        if (request.raw !== JSON.stringify(request.body)) {
          differences.push(`${drive} / ${site}: the body is not the plain serialization of its fields`);
        }
      }
    }
    assert.deepEqual(differences, []);
  });

  test(`${dialect}, an entry with settings: every request takes its limit and reasoning setting from the entry`, () => {
    const differences: string[] = [];
    for (const [drive, sites] of Object.entries(EXPECTED)) {
      for (const request of requestsOf(dialect, 'with', drive)) {
        const site = siteOf(request);
        const fields = WITH_SETTINGS[drive](sites[site] as number);
        // The derived fields stand where `max_tokens` stood; nothing else moves.
        const expectedKeys = todaysKeys(site, dialect).flatMap((k) => (k === 'max_tokens' ? Object.keys(fields) : [k]));
        const keys = Object.keys(request.body);
        if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
          differences.push(`${drive} / ${site}: keys ${keys.join(',')}, expected ${expectedKeys.join(',')}`);
        }
        for (const [field, value] of Object.entries(fields)) {
          if (request.body[field] !== value) {
            differences.push(`${drive} / ${site}: ${field} ${JSON.stringify(request.body[field])}, expected ${JSON.stringify(value)}`);
          }
        }
      }
    }
    assert.deepEqual(differences, []);
  });
}
