// #740 P3, ruling R3 and OA-863 = B — the provider routing on the wire, for
// the built-in catalog the reference instance runs on.
//
// MiMo-V2.6-Flash is served by several providers behind one OpenRouter slug,
// and the November 2026 evaluation sent each of its requests one routing
// object (`OPEN_WEIGHT_PROVIDER`, scripts/eval-models.mjs). Its catalog entry
// carries that object, restricted by `only` to the three providers that served
// the run's MiMo-V2.6-Flash requests, as `providerRouting`, and
// `modelRequestParameters` sends it as `provider`
// (`model-request-settings.test.ts` holds the builder). This
// file holds the property where it matters: in the request bodies that leave
// the real route handlers, at every call site a request for a built-in model
// can reach.
//
// THE CALL SITES, and the drive that reaches each (the same eight as
// `model-request-settings-driven.test.ts`):
//   the loop's first turn and later rounds (tools)  — compare, compare-stream, replay
//   the loop's answering turn, streamed              — compare-stream
//   the loop's answering turn, not streamed          — compare, replay
//   the no-data side, streamed                       — compare-stream
//   the no-data side, not streamed                   — compare
//   the evaluation rubric                            — evaluate
//   the summary draft                                — generate-summary
// Each of the first four drives runs once for MiMo-V2.6-Flash and once for
// Claude Haiku 5.5. The summary draft is made by the catalog's summariser,
// Haiku 5.5 (ruling R4: MiMo-V2.6-Flash takes no role), so no MiMo request
// reaches it on this catalog; it is driven once, as a Claude request.
//
// THE ENDPOINT IS THE BUILT-IN ONE. The built-in catalog is offered only while
// the base URL is OpenRouter's (`model-resolver.ts`), so no MODEL_API_BASE_URL
// is set and the requests are addressed to openrouter.ai. A stand-in `fetch`
// answers them in process; nothing leaves the machine but loopback traffic to
// the stand-in data source.
//
// STUBS, as in `model-request-settings-driven.test.ts` and for the same
// reasons: no request scope or sign-in provider outside Next (`next/headers`,
// `next-auth`, `@/lib/auth`), no object storage or database (`@/lib/storage`,
// `@/lib/db`, `@/lib/evidence/sealed-access`).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-routing-driven.test.ts)

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

const STUB_PREFIX = 'file:///civic-740-p3-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.74' }); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `
    export async function getPackage() { return globalThis.__p3Package ?? null; }
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
      throw new Error(`#740 P3 test hook: cannot resolve ${specifier}`);
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
// in force, built by the real encoder.
const { consentCookieForTests } = (await import('./sources/consent-cookie-for-tests.ts')) as typeof import('./sources/consent-cookie-for-tests.ts');

const globals = globalThis as unknown as Record<string, unknown>;

// --- The model endpoint: OpenRouter's address, answered in process -------------
//
// By the SHAPE of each request, not by order, as the loopback endpoint in
// `model-request-settings-driven.test.ts` answers: a request with tools and no
// tool result yet gets a tool call; a request with tools after one gets an
// empty message, which sends the loop to its answering turn; everything else
// gets an answer, streamed when asked for.

const MODEL_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

interface Received { drive: string; url: string; raw: string; body: Record<string, unknown> }

const received: Received[] = [];
let currentDrive = '';

function answer(body: Record<string, unknown>): Response {
  const messages = (body.messages ?? []) as Array<{ role: string }>;
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  const envelope = { id: 'chatcmpl-740', created: 1, model: String(body.model) };

  if (body.stream === true) {
    const frame = (payload: Record<string, unknown>) =>
      `data: ${JSON.stringify({ ...envelope, object: 'chat.completion.chunk', ...payload })}\n\n`;
    const text =
      frame({ choices: [{ index: 0, delta: { content: 'Twelve complaints.' }, finish_reason: null }] }) +
      frame({ choices: [], usage }) +
      'data: [DONE]\n\n';
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  let message: Record<string, unknown> = { role: 'assistant', content: 'Twelve complaints.' };
  let finish = 'stop';
  if (body.tools !== undefined) {
    if (!messages.some((m) => m.role === 'tool')) {
      message = {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_740',
          type: 'function',
          function: { name: 'get_data', arguments: JSON.stringify({ type: 'query', dataset_id: 'abcd-1234', portal: 'data.example.org' }) },
        }],
      };
      finish = 'tool_calls';
    } else {
      message = { role: 'assistant', content: '' };
    }
  }
  return new Response(
    JSON.stringify({ ...envelope, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }], usage }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('https://openrouter.ai/')) return realFetch(input, init);
  const raw = typeof init?.body === 'string' ? init.body : await new Response(init?.body ?? null).text();
  const body = JSON.parse(raw) as Record<string, unknown>;
  received.push({ drive: currentDrive, url, raw, body });
  return answer(body);
}) as typeof fetch;

// --- Loopback: an MCP source that answers every tool call with an empty page ---

const source = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-740-p3-session' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3', version: '0' } } }));
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
  'MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'MODEL_API_AUTH', 'MODEL_CATALOG',
  'MODEL_CATALOG_PATH', 'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'MODEL_API_VERSION',
  'SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
]) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = SOURCE_URL;
process.env.DATA_COMMONS_MCP_URL = SOURCE_URL;
process.env.BOSTON_OPENCONTEXT_MCP_URL = SOURCE_URL;
// Presence is all the routes' guard checks; the stand-in endpoint never authenticates.
process.env.MODEL_API_KEY = 'fixture';
// The rate limiter is the real module, and it derives its key from this
// secret (#516 P1); an inert fixture value, not a real secret.
process.env.RATE_LIMIT_SECRET = 'fixture';
process.env.AUTHENTICATED_RATE_LIMIT = '1000';
process.env.APP_TIER_RATE_LIMIT = '1000';
// The packager refuses to build a package for an instance that has not
// declared who it is; fixture values for a fixture instance, and no key.
process.env.PUBLISHER_PLATFORM_AGENT_TITLE = 'Fixture Instance';
process.env.PUBLISHER_SITE_ORIGIN = 'https://fixture.invalid';
process.env.PUBLISHER_KEY_ID = 'fixture-kid';

// --- The drives ------------------------------------------------------------------

const MIMO = 'xiaomi/mimo-v2.6-flash';
const HAIKU = 'anthropic/claude-haiku-5.5';
const MODELS = [MIMO, HAIKU] as const;
type Model = (typeof MODELS)[number];

/**
 * MiMo-V2.6-Flash's routing: R3 (#740, the roster memo's ruling), the November
 * 2026 run's provider object, then the owner's ruling OA-863 = B, `only` the
 * three providers that served the run's MiMo-V2.6-Flash requests, by base slug.
 */
const MIMO_ROUTING =
  '{"max_price":{"prompt":0.15,"completion":0.6},"require_parameters":true,"data_collection":"deny","only":["cohere","gmicloud","xiaomi"]}';

const { _resetModelCatalogForTests } = await import('./model-resolver.ts');
const { _resetDefaultModelClientForTests } = await import('./model-client.ts');
const { buildEvidencePackage } = await import('./evidence/packager.ts');
const compare = await import('../app/api/compare/route.ts');
const compareStream = await import('../app/api/compare-stream/route.ts');
const summary = await import('../app/api/evidence/generate-summary/route.ts');
const evaluate = await import('../app/api/evidence/[slug]/evaluate/route.ts');
const replay = await import('../app/api/evidence/[slug]/replay/route.ts');

/** A package the real packager built, naming `model` as a signed package names its analysis model. */
function packageNaming(model: Model): unknown {
  return buildEvidencePackage({
    trace: { resourceSpans: [] } as never,
    prompt: 'How many noise complaints were there?',
    output: 'Twelve complaints.',
    toolCalls: [],
    model,
    tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    duration_ms: 1000,
    promptVisibility: 'full_text',
    title: 'Noise complaints',
    captureMethod: 'chat-flow-stream',
  } as never).pkg;
}

function post(route: string, body: unknown): Request {
  return new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: consentCookieForTests() },
    body: JSON.stringify(body),
  });
}

const SLUG = { params: Promise.resolve({ slug: 'noise' }) };
const query = (model: Model) => ({ query: 'How many noise complaints were there?', model, portal: 'data.example.org' });
const other = (model: Model): Model => (model === MIMO ? HAIKU : MIMO);

interface Outcome { status: number; body: string }
const outcomes = new Map<string, Outcome>();

/** The routes log their own lines; this file reads the wire, not the log. */
function silence(): () => void {
  const methods = ['log', 'error', 'warn', 'info', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = () => {};
  return () => methods.forEach((m, i) => { console[m] = saved[i]; });
}

_resetModelCatalogForTests();
_resetDefaultModelClientForTests();

const drives: Array<[string, () => Promise<Response>]> = [];
for (const model of MODELS) {
  drives.push(
    [`${model}/compare`, () => compare.POST(post('/api/compare', query(model)) as never)],
    [`${model}/compare-stream`, () => compareStream.POST(post('/api/compare-stream', query(model)) as never)],
    [`${model}/replay`, () => {
      globals.__p3Package = packageNaming(model);
      return replay.POST(post('/api/evidence/noise/replay', { modelApiKey: 'fixture' }) as never, SLUG);
    }],
    [`${model}/evaluate`, () => {
      // The evaluator must differ from the analysis model, so the record names the other one.
      globals.__p3Package = packageNaming(other(model));
      return evaluate.POST(post('/api/evidence/noise/evaluate', { modelApiKey: 'fixture', evaluatorModel: model }) as never, SLUG);
    }],
  );
}
drives.push(['summariser/summary', () => summary.POST(post('/api/evidence/generate-summary', { prompt: 'How many?', output: 'Twelve.', toolCalls: [] }) as never)]);

for (const [name, run] of drives) {
  currentDrive = name;
  const restore = silence();
  try {
    const response = await run();
    // Read to the end: a streamed route's model calls happen while it streams.
    outcomes.set(name, { status: response.status, body: await response.text() });
  } finally {
    restore();
  }
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

/** The sites each drive reaches. */
const EXPECTED_SITES: Record<string, Site[]> = {
  compare: ['loop: first turn', 'loop: later round', 'loop: answering turn, not streamed', 'no-data side, not streamed'],
  'compare-stream': ['loop: first turn', 'loop: later round', 'loop: answering turn, streamed', 'no-data side, streamed'],
  replay: ['loop: first turn', 'loop: later round', 'loop: answering turn, not streamed'],
  evaluate: ['evaluation rubric'],
  summary: ['summary draft'],
};

function requestsOf(drive: string): Received[] {
  return received.filter((r) => r.drive === drive);
}

// --- Premise: each drive reached every site it is listed for, at OpenRouter -----

test('premise: every drive reached the built-in endpoint at every site it is listed for, for the model it drove', () => {
  for (const [drive] of drives) {
    const kind = drive.slice(drive.lastIndexOf('/') + 1);
    const requests = requestsOf(drive);
    const outcome = outcomes.get(drive);
    assert.deepEqual(
      [...new Set(requests.map(siteOf))].sort(),
      [...EXPECTED_SITES[kind]].sort(),
      `${drive} reached the wrong sites (status ${outcome?.status}: ${outcome?.body.slice(0, 300)})`,
    );
    for (const request of requests) {
      assert.equal(request.url, MODEL_ENDPOINT, `${drive}: the request left for the built-in endpoint`);
      const expectedModel = kind === 'summary' ? HAIKU : drive.slice(0, drive.lastIndexOf('/'));
      assert.equal(request.body.model, expectedModel, `${drive} / ${siteOf(request)}: the model on the wire`);
    }
  }
});

// --- The criterion (#740 P3, criterion 2) -----------------------------------------

test('every request for MiMo-V2.6-Flash carries its routing exactly, the three-provider restriction included, at every site a MiMo request reaches', () => {
  const mimo = received.filter((r) => r.body.model === MIMO);
  const differences: string[] = [];
  for (const request of mimo) {
    const site = `${request.drive} / ${siteOf(request)}`;
    if (JSON.stringify(request.body.provider) !== MIMO_ROUTING) {
      differences.push(`${site}: provider ${JSON.stringify(request.body.provider)}`);
    }
    // In the bytes, too: the body is the plain serialization of its fields.
    if (!request.raw.includes(`"provider":${MIMO_ROUTING}`) || request.raw !== JSON.stringify(request.body)) {
      differences.push(`${site}: the bytes do not carry "provider":${MIMO_ROUTING}`);
    }
    // What the November run sent it beside the routing: max_tokens, no reasoning setting.
    if (typeof request.body.max_tokens !== 'number' || 'max_completion_tokens' in request.body || 'reasoning_effort' in request.body) {
      differences.push(`${site}: limit or reasoning fields ${JSON.stringify(Object.keys(request.body))}`);
    }
  }
  assert.deepEqual(differences, []);
  // Seven of the eight sites: the summary draft is the summariser's, Haiku 5.5's.
  assert.deepEqual(
    [...new Set(mimo.map(siteOf))].sort(),
    Object.values(EXPECTED_SITES).flat().filter((s) => s !== 'summary draft').filter((s, i, all) => all.indexOf(s) === i).sort(),
  );
});

test('no request for a Claude model carries a provider object, at any of the eight sites', () => {
  const claude = received.filter((r) => String(r.body.model).startsWith('anthropic/'));
  assert.deepEqual(
    [...new Set(claude.map(siteOf))].sort(),
    [...new Set(Object.values(EXPECTED_SITES).flat())].sort(),
    'premise: Claude requests reached all eight sites',
  );
  const carrying = claude.filter((r) => 'provider' in r.body);
  assert.deepEqual(carrying.map((r) => `${r.drive} / ${siteOf(r)}`), []);
  // The decoy: MiMo-V2.6-Flash's object, and its restriction, appear in no
  // Claude request's bytes, at any site — so a routing that reached a Claude
  // request under another key would still be seen.
  const decoyed = claude.filter((r) => r.raw.includes(MIMO_ROUTING) || r.raw.includes('"only":['));
  assert.deepEqual(decoyed.map((r) => `${r.drive} / ${siteOf(r)}`), []);
});
