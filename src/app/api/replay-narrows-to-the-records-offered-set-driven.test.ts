// R6 W1, criterion 3 (#632, D8 = A, part i): a replay is offered the record's
// set, not the instance's whole vocabulary, and says so.
//
// THE RULE. Design §1.6 makes "the record's offered set an input to the
// replay, not a consent". Before W1 a replay handed the model `mcpTools`,
// every source's tools, and a prompt composed for whatever this instance
// configures, whatever the record had been offered. From W1 the replay reads
// the record's set — its `sourcesOffered` entries whose reason is `configured`
// or `selected`, else the named entries of the environment block's
// `mcpServers` (a nameless entry counts for nothing) — and narrows the tools
// array, the prompt and the dispatch to it, intersected with the sources
// routable here. A record that states no set replays with the full vocabulary;
// a record whose set is empty replays with no source tool. The response says
// which in one unsigned field, `offeredSet: { from, sources, lacking }`, where
// `lacking` names a source the record was offered that this instance has not.
//
// WHAT IS DRIVEN. The real `POST /api/evidence/[slug]/replay`, the real
// `replayLoopOptionsForPackage` with its production defaults (the real
// `buildSystemPrompt` and the real MCP client), the real loop against the
// scripted model endpoint, and a loopback fixture for Socrata and Data Commons
// that counts every request per server. What the model was GIVEN — its tools
// array and its system prompt — is read off the first request the model
// endpoint received, not off the options object.
//
// THE INSTANCE. All four sources of the shipped manifest, with NYC Charter on
// (its switch, `NYC_CHARTER_HOSTING=sandbox`) and Boston's OpenContext
// unconfigured; case (b)'s second half turns the switch off. No case calls a
// Charter tool: a hosted call would reach a sandbox service.
//
// WHAT MAKES (a) ABLE TO FAIL. Charter is routable on this instance, and the
// premise below shows the instance's own composition carries it; only the
// narrowing to the record's set can remove it.
//
// STUBS, and why: `next-auth`, `@/lib/auth` (a signed-in fixture account);
// `@/lib/db` (one record row per slug), `@/lib/storage` (the package for that
// row), `@/lib/evidence/sealed-access` (readable). No network: every address
// is loopback and every key a placeholder.
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

const COMPOSITION = 'org.civicaitools.composition';
const ENVIRONMENT = 'org.civicaitools.environment';

// --- Module hooks -------------------------------------------------------------

interface Globals { __r6w1Replay: { packages: Record<string, unknown> } }
const globals = globalThis as unknown as Globals;
globals.__r6w1Replay = { packages: {} };

const STUB_PREFIX = 'file:///r6-w1-replay-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `export async function getPackage(key) { return globalThis.__r6w1Replay.packages[key] ?? null; }`,
  '@/lib/db': `
    export const db = {
      select() {
        const chain = { from: () => chain, where: () => chain, limit: async () => [globalThis.__r6w1Replay.row] };
        return chain;
      },
    };`,
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
      throw new Error(`r6-w1 replay test hook: cannot resolve ${specifier}`);
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

// --- Request census and the loopback data sources -------------------------------

const realFetch = globalThis.fetch;
const OUTBOUND: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  OUTBOUND.push(`${url.host}${url.pathname}`);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const RECEIVED: Array<{ path: string; method: string }> = [];
const toolCallsTo = (p: string): number => RECEIVED.filter((r) => r.path === p && r.method === 'tools/call').length;

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  RECEIVED.push({ path: p, method: msg.method ?? '' });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'r6-w1-replay-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture skill guidance.' } }] } })}\n\n`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ value: 7 }], total_rows: 1 }) }], isError: false } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL']) delete process.env[name];
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.NYC_CHARTER_HOSTING = 'sandbox';

const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { mcpTools } = await import('../../lib/mcp/tools.ts');
const { buildSystemPrompt } = await import('../../lib/mcp/socrata-skill.ts');
const { canonicalizeToolCall } = await import('../../lib/evidence/tool-call-identity.ts');
const replayRoute = (await import('./evidence/[slug]/replay/route.ts')) as unknown as {
  POST: (request: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
};

// --- Fixture records -------------------------------------------------------------

type Reason = 'configured' | 'selected' | 'not-configured' | 'not-selected';
const ALIAS: Record<string, string> = { socrata: 'socrata', 'data-commons': 'data_commons', 'boston-opencontext': 'boston', 'nyc-charter': 'nyc_charter' };
const offered = (reasons: Record<string, Reason>) => ({
  [COMPOSITION]: {
    assertedDate: '2026-10-01',
    sourcesOffered: Object.entries(reasons).map(([sourceId, reason]) => ({ sourceId, alias: ALIAS[sourceId], reason })),
    components: [],
  },
});

/** The fields the replay route reads, plus the record's own statement of its set. */
function recordPackage(extensions: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    prompt: { text: 'How many noise complaints were filed in the Bronx last month?' },
    cost: { model: 'fake/model' },
    queries: [],
    dataSources: [],
    ...(extensions ? { extensions } : {}),
  };
}

const RECORDS: Record<string, Record<string, unknown>> = {
  // (a) Socrata and Data Commons configured, Charter not configured when published.
  a: recordPackage(offered({ socrata: 'configured', 'data-commons': 'configured', 'boston-opencontext': 'not-configured', 'nyc-charter': 'not-configured' })),
  // (b) Charter configured when published.
  b: recordPackage(offered({ socrata: 'configured', 'data-commons': 'configured', 'boston-opencontext': 'not-configured', 'nyc-charter': 'configured' })),
  // (c) a datHere record packaged before W4: no composition block, named servers.
  c: recordPackage({ [ENVIRONMENT]: { mcpServers: [{ url: 'https://socrata-mcp.example.org', name: 'socrata' }] } }),
  // (d) a default-profile record packaged before W4: neither block.
  d: recordPackage(undefined),
  // (e) the pre-0.5.0 shape: a server list whose entries carry no name.
  e: recordPackage({ [ENVIRONMENT]: { mcpServers: [{ url: 'https://socrata-mcp.example.org' }, { url: 'https://api.datacommons.org/mcp' }] } }),
  // (f) a record whose composition offered no source.
  f: recordPackage(offered({ socrata: 'not-selected', 'data-commons': 'not-selected', 'boston-opencontext': 'not-configured', 'nyc-charter': 'not-configured' })),
  // the dispatch check: a set of Socrata alone.
  g: recordPackage(offered({ socrata: 'selected', 'data-commons': 'not-selected', 'boston-opencontext': 'not-configured', 'nyc-charter': 'not-configured' })),
};
for (const [slug, pkg] of Object.entries(RECORDS)) globals.__r6w1Replay.packages[`pkg/${slug}.json`] = pkg;

// --- One drive per record ----------------------------------------------------------

interface OfferedSet { from?: string; sources?: string[]; lacking?: string[] }
interface Replayed {
  status: number;
  body: { toolCalls?: Array<{ name: string; args: Record<string, unknown>; failed?: boolean; failureKind?: string }>; offeredSet?: OfferedSet } & Record<string, unknown>;
  toolNames: string[];
  systemPrompt: string;
  dcToolCalls: number;
  outbound: string[];
}

const ANSWER = { content: 'There were 4,812 noise complaints in the Bronx last month.' };

/** Every drive runs at module evaluation, in order, before any test is registered. */
async function replay(slug: string, replies: Array<Record<string, unknown>> = [ANSWER]): Promise<Replayed> {
  const scripted = await startScriptedModelServer(replies);
  process.env.MODEL_API_BASE_URL = scripted.url;
  (globals.__r6w1Replay as unknown as { row: Record<string, unknown> }).row = { id: `rec-${slug}`, slug, basePackageStorageKey: `pkg/${slug}.json`, visibility: 'public', creatorId: 'fixture-account' };
  const dcBefore = toolCallsTo('/dc/mcp');
  const outboundBefore = OUTBOUND.length;
  try {
    const response = await replayRoute.POST(
      new Request(`http://localhost/api/evidence/${slug}/replay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelApiKey: 'placeholder-model-key-r6-w1-replay' }) }),
      { params: Promise.resolve({ slug }) },
    );
    const body = (await response.json()) as Replayed['body'];
    const first = scripted.requests[0] ?? {};
    const toolNames = ((first.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '');
    const system = ((first.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
    return {
      status: response.status,
      body,
      toolNames,
      systemPrompt: typeof system?.content === 'string' ? system.content : '',
      dcToolCalls: toolCallsTo('/dc/mcp') - dcBefore,
      outbound: OUTBOUND.slice(outboundBefore).filter((u) => !u.startsWith(`${new URL(scripted.url).host}/`)),
    };
  } finally {
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

const ALL_TOOL_NAMES = mcpTools.map((t) => (t as { function: { name: string } }).function.name);
const INSTANCE_PROMPT = await buildSystemPrompt();
const A = await replay('a');
const B_WITH = await replay('b');
const C = await replay('c');
const D = await replay('d', [
  { toolCalls: [{ id: 'k1', name: 'socrata__get_data', args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us', where: "borough = 'BRONX'" } }] },
  ANSWER,
]);
const E = await replay('e');
const F = await replay('f');
const G = await replay('g', [
  { toolCalls: [{ id: 'g1', name: 'data_commons__search_indicators', args: { query: 'noise', places: ['Bronx County'] } }] },
  ANSWER,
]);
delete process.env.NYC_CHARTER_HOSTING;
const B_WITHOUT = await replay('b');

const charterTools = (names: string[]) => names.filter((n) => n.startsWith('nyc_charter__'));
const sourceTools = (names: string[], alias: string) => names.filter((n) => n.startsWith(`${alias}__`));

// --- Premise ---------------------------------------------------------------------

test('premise: every replay answered, and this instance offers Charter on its own composition', () => {
  for (const [name, run] of Object.entries({ A, B_WITH, B_WITHOUT, C, D, E, F, G })) {
    assert.equal(run.status, 200, `${name}: the replay failed: ${JSON.stringify(run.body)}`);
  }
  assert.ok(charterTools(ALL_TOOL_NAMES).length > 0, 'premise: the vocabulary holds Charter tools');
  assert.ok(INSTANCE_PROMPT.includes('nyc_charter__'), 'premise: this instance\'s own prompt carries Charter, so only the narrowing can remove it');
});

// --- Criterion 3 -------------------------------------------------------------------

test('criterion 3 (a): a record offered Socrata and Data Commons replays with no Charter tool and no Charter text, from sourcesOffered', () => {
  assert.deepEqual(charterTools(A.toolNames), [], `the replay offered Charter tools the record was not offered: ${charterTools(A.toolNames).join(', ')}`);
  assert.ok(!A.systemPrompt.includes('nyc_charter__'), 'the replay\'s prompt carries Charter guidance the record was not offered');
  assert.ok(sourceTools(A.toolNames, 'socrata').length > 0 && sourceTools(A.toolNames, 'data_commons').length > 0, 'the replay dropped a source the record was offered');
  assert.deepEqual(A.body.offeredSet, { from: 'sourcesOffered', sources: ['socrata', 'data-commons'], lacking: [] });
});

test('criterion 3 (b): a record offered Charter replays with it where the instance has it, and states it lacking where not', () => {
  assert.ok(charterTools(B_WITH.toolNames).includes('nyc_charter__search'), 'the replay dropped Charter on an instance that has it');
  assert.deepEqual(B_WITH.body.offeredSet, { from: 'sourcesOffered', sources: ['socrata', 'data-commons', 'nyc-charter'], lacking: [] });
  assert.deepEqual(charterTools(B_WITHOUT.toolNames), [], 'the replay offered Charter tools on an instance without Charter');
  assert.deepEqual(B_WITHOUT.body.offeredSet, { from: 'sourcesOffered', sources: ['socrata', 'data-commons'], lacking: ['nyc-charter'] });
});

test('criterion 3 (c): a datHere record with named mcpServers entries replays with the named sources, from mcpServers', () => {
  assert.deepEqual(C.body.offeredSet, { from: 'mcpServers', sources: ['socrata'], lacking: [] });
  assert.ok(sourceTools(C.toolNames, 'socrata').length > 0, 'the replay dropped the named source');
  assert.deepEqual(C.toolNames.filter((n) => !n.startsWith('socrata__')), [], 'the replay offered a source the record did not name');
});

test('criterion 3 (d): a record stating no set replays with the full vocabulary, from none', () => {
  assert.deepEqual(D.toolNames, ALL_TOOL_NAMES, 'a record stating no set did not replay with the full vocabulary');
  assert.deepEqual(D.body.offeredSet, { from: 'none', sources: ['socrata', 'data-commons', 'nyc-charter'], lacking: [] });
});

test('criterion 3 (e): a server list of nameless entries counts as no set', () => {
  assert.deepEqual(E.toolNames, ALL_TOOL_NAMES, 'nameless mcpServers entries narrowed the replay');
  assert.deepEqual(E.body.offeredSet, { from: 'none', sources: ['socrata', 'data-commons', 'nyc-charter'], lacking: [] });
});

test('criterion 3 (f): a record whose set is empty replays with no source tool, never the full vocabulary', () => {
  assert.deepEqual(F.toolNames, [], `a record offered no source replayed with tools: ${F.toolNames.slice(0, 5).join(', ')}…`);
  assert.deepEqual(F.body.offeredSet, { from: 'sourcesOffered', sources: [], lacking: [] });
});

test('criterion 3, added: a narrowed replay\'s dispatch follows its set — a tool outside it is refused not_offered, with no request', () => {
  assert.equal(G.body.toolCalls?.[0]?.name, 'data_commons__search_indicators', 'premise: the replaying model called the tool');
  assert.equal(G.dcToolCalls, 0, 'the replay sent a call to a source outside the record\'s set');
  assert.deepEqual(G.outbound, [], 'the replay made a request to a data source');
  assert.equal(G.body.toolCalls?.[0]?.failed, true);
  assert.equal(G.body.toolCalls?.[0]?.failureKind, 'not_offered');
});

test('criterion 3: the consistency attestation\'s inputs on the same calls are the base\'s (green at the base)', () => {
  // The four keys the dialog reads off a run, and the identity key of a call,
  // as the base wrote them for this run.
  for (const key of ['toolCalls', 'output', 'tokenUsage', 'durationMs']) assert.ok(key in D.body, `the response lost ${key}`);
  assert.deepEqual(D.body.toolCalls?.map((c) => canonicalizeToolCall(c)), [
    'get_data:{"dataset_id":"erm2-nwe9","portal":"data.cityofnewyork.us","type":"query","where":"borough = \'BRONX\'"}',
  ]);
});
