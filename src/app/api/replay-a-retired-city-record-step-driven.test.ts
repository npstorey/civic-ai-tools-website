// S2-B W11 (npstorey/civic-ai-tools#309; card G0-B4 A: "no translation"): a record sealed while NYC City Record
// ran its own server names that server's tools; its notebook step says what it does not re-run, and a live replay
// of it is offered the pack's tools.
//
// THE RECORD. It loaded City Record under router 0.6.0 and called `nyc_record__search_notices`, a tool of the
// server router 0.8.0 retired (City Record is now a pack over the Socrata server, keeping its `sourceId` and
// alias). Its composition offered Socrata and City Record.
//
// WHAT IS DRIVEN.
//   - The notebook author's real entry point (`synthesizeNotebook`) over the call the record names: the step is
//     stated as not re-runnable in R8's words (the owner's D4 = A), with the pin frozen in `RETIRED_HOSTED_SERVERS`.
//   - The real `POST /api/evidence/[slug]/replay` with the real `replayLoopOptionsForPackage` and loop, the scripted
//     model endpoint and a loopback Socrata server, under the consent gate (the replayer's consent covers every
//     source the flows statement lists, City Record among them). The replay is offered the pack's two tools and no
//     retired one, and a pack call it makes reaches the Socrata server with the pack's portal and dataset. The
//     decoy reads the same record's offered set with the base absent (`SOCRATA_MCP_URL` unset), where the route
//     refuses the replay before any model request: the pack is not offered. A pack
//     is routable on replay exactly when its base is (`replay-loop.ts`, the rule `registry.ts` applies to the
//     tool index; the seat's admission, hub #309 6780055495).
//
// RED at tree 5b (d99f2532): the retired call is no step, and the replay states City Record `lacking` and offers no
// `nyc_record__` tool (`replayOfferedSet`'s `routable` reads `servers` and `hosted` only, and the pack is in neither).
//
// STUBS, and why, as in `replay-narrows-to-the-records-offered-set-driven.test.ts`: `next-auth`, `@/lib/auth`,
// `@/lib/db`, `@/lib/storage`, `@/lib/evidence/sealed-access`. No network: every address is loopback and every
// key a placeholder.
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

// --- Module hooks -------------------------------------------------------------

interface Globals { __s2bRetiredReplay: { packages: Record<string, unknown> } }
const globals = globalThis as unknown as Globals;
globals.__s2bRetiredReplay = { packages: {} };

const STUB_PREFIX = 'file:///s2b-retired-replay-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/storage': `export async function getPackage(key) { return globalThis.__s2bRetiredReplay.packages[key] ?? null; }`,
  '@/lib/db': `
    export const db = {
      select() {
        const chain = { from: () => chain, where: () => chain, limit: async () => [globalThis.__s2bRetiredReplay.row] };
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
      throw new Error(`s2b retired replay test hook: cannot resolve ${specifier}`);
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

// --- The loopback Socrata server: every tools/call recorded with its arguments ----------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;
const CALLS: Array<{ path: string; tool?: string; args?: Record<string, unknown> }> = [];
// S2-B P3R (the seat's ruling 12): the server reports, and lists its tools, as the deployed Socrata server did
// at the GR read (`src/lib/mcp/fixtures/socrata-tools-at-gr.json`, copied by script), so the replayed pack call
// passes the base check; `socrata-tools-at-gr.test.ts` holds each pinned entry to its pin.
const GR = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../lib/mcp/fixtures/socrata-tools-at-gr.json'), 'utf8')) as { serverInfo: { name: string; version: string }; tools: unknown[] };
const LISTS: string[] = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }) : {};
  const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (msg.method === 'tools/call') CALLS.push({ path: p, tool: msg.params?.name, args: msg.params?.arguments });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, prompts: {} }, serverInfo: GR.serverInfo } }));
    return;
  }
  if (msg.method === 'tools/list') {
    LISTS.push(p);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { tools: GR.tools } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture skill guidance.' } }] } })}\n\n`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ notice: 'Sidewalk repair, Brooklyn' }], total_rows: 1 }) }], isError: false } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'NYC_CHARTER_HOSTING']) delete process.env[name];
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;

const { consentCookieForTests } = (await import('../../lib/sources/consent-cookie-for-tests.ts')) as typeof import('../../lib/sources/consent-cookie-for-tests.ts');
const { startScriptedModelServer } = await import('../../lib/model-loop/test-harness.ts');
const { synthesizeNotebook } = await import('../../lib/notebook-author/synthesize.ts');
const { RETIRED_HOSTED_SERVERS } = await import('../../lib/mcp/retired-sources.ts');
const { readMcpEnvFromProcess } = await import('../../lib/mcp/registry.ts');
const { replayOfferedSet } = await import('../../lib/model-loop/replay-loop.ts');
const replayRoute = (await import('./evidence/[slug]/replay/route.ts')) as unknown as {
  POST: (request: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
};

// --- The record --------------------------------------------------------------------------------

const QUESTION = 'Which notices did the City Record publish about sidewalk repair?';
const RETIRED_CALL = { name: 'nyc_record__search_notices', args: { query: 'sidewalk repair', limit: 5 }, resultSummary: { rows: 5, columns: 9 }, reason: 'to search City Record notices' };
const RECORD = {
  prompt: { text: QUESTION },
  cost: { model: 'fake/model' },
  queries: [],
  dataSources: [],
  extensions: {
    [COMPOSITION]: {
      assertedDate: '2026-10-28',
      sourcesOffered: [
        { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
        { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-selected' },
        { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'selected' },
      ],
      components: [],
      routing: { method: 'in-loop', version: '0.6.0' },
    },
  },
};
globals.__s2bRetiredReplay.packages['pkg/retired.json'] = RECORD;
(globals.__s2bRetiredReplay as unknown as { row: Record<string, unknown> }).row = { id: 'rec-retired', slug: 'retired', basePackageStorageKey: 'pkg/retired.json', visibility: 'public', creatorId: 'fixture-account' };

// --- The replay, in loop as the record was: the model loads City Record, calls the pack, then answers ---------

const scripted = await startScriptedModelServer([
  { toolCalls: [{ id: 'l1', name: 'load_source', args: { alias: 'nyc_record' } }] },
  { toolCalls: [{ id: 'p1', name: 'nyc_record__get_data', args: { type: 'query', query: 'sidewalk repair', limit: 1 } }] },
  { content: 'One notice.' },
]);
process.env.MODEL_API_BASE_URL = scripted.url;
const response = await replayRoute.POST(
  new Request('http://localhost/api/evidence/retired/replay', { method: 'POST', headers: { 'content-type': 'application/json', cookie: consentCookieForTests() }, body: JSON.stringify({ modelApiKey: 'placeholder-model-key-s2b-retired' }) }),
  { params: Promise.resolve({ slug: 'retired' }) },
);
const REPLAY = { status: response.status, body: (await response.json()) as { offeredSet?: unknown } & Record<string, unknown> };
await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
const toolsOf = (request: Record<string, unknown> | undefined) => (((request ?? {}).tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '');
const FIRST_TOOLS = toolsOf(scripted.requests[0]);
const AFTER_LOAD_TOOLS = toolsOf(scripted.requests[1]);

// The decoy: the same record replayed on an instance without the base (`SOCRATA_MCP_URL` unset). The route
// refuses a replay with no Socrata endpoint before any model request; the offered set is read directly too.
const CALLS_BEFORE_DECOY = CALLS.length;
delete process.env.SOCRATA_MCP_URL;
const NO_BASE_ENV = readMcpEnvFromProcess();
const scriptedNoBase = await startScriptedModelServer([{ content: 'No notices.' }]);
process.env.MODEL_API_BASE_URL = scriptedNoBase.url;
const responseNoBase = await replayRoute.POST(
  new Request('http://localhost/api/evidence/retired/replay', { method: 'POST', headers: { 'content-type': 'application/json', cookie: consentCookieForTests() }, body: JSON.stringify({ modelApiKey: 'placeholder-model-key-s2b-retired' }) }),
  { params: Promise.resolve({ slug: 'retired' }) },
);
const NO_BASE = { status: responseNoBase.status, modelRequests: scriptedNoBase.requests.length };
await new Promise<void>((resolve) => scriptedNoBase.server.close(() => resolve()));

// --- The notebook step -----------------------------------------------------------------------------

test('S2-B W11: the record\'s retired call is a notebook step stated as not re-runnable, in R8\'s words, with the frozen pin', () => {
  const retired = RETIRED_HOSTED_SERVERS['nyc-record'];
  const { notebook } = synthesizeNotebook({ query: QUESTION, defaultPortal: 'data.cityofnewyork.us', toolCalls: [RETIRED_CALL], finalAnswer: 'Five notices.', modelName: 'vendor/model-fixture-1', modelAccess: 'through a fixture', generatedAt: '2026-11-10T00:00:00Z' });
  const cells = notebook.cells.map((c) => [c.source].flat().join(''));
  const step = cells.find((c) => c.startsWith('#### Not reproduced: `nyc_record__search_notices`'));
  assert.ok(step, `no step cell names the retired call: ${JSON.stringify(cells.filter((c) => c.includes('search_notices')))}`);
  assert.ok(step!.includes(`The original analysis called \`nyc_record__search_notices\`, a tool of BetaNYC's City Record MCP server. The site that ran the analysis used the pinned package \`${retired.package}@${retired.version}\` for that server.`), step);
  assert.ok(step!.endsWith('No code cell is generated for it, and nothing is cited for it: this document did not read that source.'), step);
});

// --- The live replay (G0-B4 A's second half) ---------------------------------------------------------

test('S2-B W11: the live replay is offered the pack\'s two tools and no retired tool, and states City Record offered, not lacking', () => {
  assert.equal(REPLAY.status, 200, `the replay failed: ${JSON.stringify(REPLAY.body).slice(0, 400)}`);
  assert.deepEqual(REPLAY.body.offeredSet, { from: 'sourcesOffered', sources: ['socrata', 'nyc-record'], lacking: [] });
  // In loop, as the record was: the first request offers the directory's one tool; the load brings the pack's.
  assert.deepEqual(FIRST_TOOLS, ['load_source']);
  assert.deepEqual(AFTER_LOAD_TOOLS.filter((n) => n.startsWith('nyc_record__')).sort(), ['nyc_record__fetch', 'nyc_record__get_data']);
  for (const tool of (RETIRED_HOSTED_SERVERS['nyc-record'] as unknown as { toolNames?: string[] }).toolNames ?? ['search_notices']) {
    assert.equal(AFTER_LOAD_TOOLS.includes(`nyc_record__${tool}`), false, `the replay offered the retired nyc_record__${tool}`);
  }
});

test('S2-B W11: a replayed pack call reaches the Socrata server as get_data with the pack\'s portal and dataset', () => {
  assert.deepEqual(
    CALLS.map((c) => ({ path: c.path, tool: c.tool, portal: c.args?.portal, dataset_id: c.args?.dataset_id })),
    [{ path: '/socrata/mcp', tool: 'get_data', portal: 'data.cityofnewyork.us', dataset_id: 'dg92-zbpx' }],
  );
  // S2-B P3R: the replay is a path that sends a pack call, so the base's list was read before it.
  assert.deepEqual(LISTS, ['/socrata/mcp']);
});

test('S2-B W11 decoy: with the base absent (SOCRATA_MCP_URL unset) the pack is not offered: it is lacking with its base', () => {
  assert.deepEqual(replayOfferedSet(RECORD, NO_BASE_ENV, ['socrata', 'nyc-record']), { from: 'sourcesOffered', sources: [], lacking: ['socrata', 'nyc-record'] });
  // The route refuses such a replay before any model request, so nothing reaches a server.
  assert.notEqual(NO_BASE.status, 200);
  assert.equal(NO_BASE.modelRequests, 0);
  assert.equal(CALLS.length, CALLS_BEFORE_DECOY, 'the replay without the base reached the Socrata path');
});
