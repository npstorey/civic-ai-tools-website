// S2-B P3R criterion 2 (npstorey/civic-ai-tools#309): the client keeps each server's `serverInfo` from both
// protocol eras, sends `tools/list` and follows its cursor to the last page; and (the seat's ruling 6) a run's
// record of what each server reported holds only the reads that run made.
//
// WHAT IS DRIVEN. The real client (`./client.ts`) against three loopback servers, each its own origin:
//   - socrata — the older era, session-keeping, as the deployed Socrata server is: `initialize` mints a session,
//     anything else needs it. Its list is two pages, and `fetch`, a tool City Record's pin names, is on page 2 only.
//   - data-commons — the newer era, as the specification states it and as `modern-exchange.test.ts`'s fixture
//     checks it: every request's `MCP-Protocol-Version` and `Mcp-Method` headers must repeat its `_meta` version and
//     its method, or it is refused 400 -32020. Its `serverInfo` is in `server/discover`'s `_meta`. Two pages too.
//   - boston-opencontext — the older era with no session, one page.
//
// SHAPED TO FAIL. A client that read page 1 only would miss `fetch`; one that did not mirror the headers would be
// refused; one that kept `serverInfo` from neither result would report null. Decoys: a cursor that repeats, a list
// that never ends, a page with no `tools` array.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const MODERN = '2026-07-28';

interface Seen { method: string; headers: http.IncomingHttpHeaders; params: Record<string, unknown> }

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    server.unref();
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }));
}

async function bodyOf(req: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

const tool = (name: string) => ({ name, description: `${name} (fixture)`, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } });

/** How a server answers `tools/list`: two pages (the default), a repeating cursor, no end, or a page with no array. */
type ListMode = 'paged' | 'repeat' | 'endless' | 'no-tools';

function pageOf(mode: ListMode, cursor: unknown, n: number): Record<string, unknown> {
  if (mode === 'no-tools') return { nextCursor: null };
  if (mode === 'repeat') return { tools: [tool('get_data')], nextCursor: 'again' };
  if (mode === 'endless') return { tools: [tool(`t${n}`)], nextCursor: `page-${n + 1}` };
  return cursor === 'page-2' ? { tools: [tool('fetch')] } : { tools: [tool('get_data'), tool('search')], nextCursor: 'page-2' };
}

function legacyFixture(serverInfo: { name: string; version: string }, sessions: boolean) {
  const fixture = { seen: [] as Seen[], mode: 'paged' as ListMode, server: undefined as unknown as http.Server };
  const minted = new Set<string>();
  fixture.server = http.createServer(async (req, res) => {
    const body = JSON.parse(await bodyOf(req)) as { id?: unknown; method?: string; params?: Record<string, unknown> };
    fixture.seen.push({ method: String(body.method), headers: req.headers, params: body.params ?? {} });
    const answer = (status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
    };
    if (body.id === undefined) { res.writeHead(202); res.end(); return; }
    if (body.method === 'server/discover') { answer(400, { error: { code: -32601, message: 'Method not found' } }); return; }
    const session = req.headers['mcp-session-id'] as string | undefined;
    if (body.method === 'initialize') {
      const id = `s-${minted.size + 1}`;
      minted.add(id);
      answer(200, { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo } }, sessions ? { 'mcp-session-id': id } : {});
      return;
    }
    if (sessions && (!session || !minted.has(session))) { answer(400, { error: { code: -32000, message: 'Bad Request: No valid session ID provided' } }); return; }
    if (body.method === 'tools/list') {
      const n = fixture.seen.filter((s) => s.method === 'tools/list').length;
      answer(200, { result: pageOf(fixture.mode, body.params?.cursor, n) });
      return;
    }
    answer(200, { result: { content: [{ type: 'text', text: '[]' }] } });
  });
  return fixture;
}

function modernFixture(serverInfo: { name: string; version: string }) {
  const fixture = { seen: [] as Seen[], mode: 'paged' as ListMode, server: undefined as unknown as http.Server };
  fixture.server = http.createServer(async (req, res) => {
    const body = JSON.parse(await bodyOf(req)) as { id?: unknown; method?: string; params?: Record<string, unknown> };
    fixture.seen.push({ method: String(body.method), headers: req.headers, params: body.params ?? {} });
    const answer = (status: number, payload: Record<string, unknown>) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
    };
    const refuse = (code: number, message: string) => answer(400, { error: { code, message } });
    if (body.id === undefined) { res.writeHead(202); res.end(); return; }
    const version = req.headers['mcp-protocol-version'];
    const meta = (body.params?._meta ?? null) as Record<string, unknown> | null;
    if (typeof version !== 'string' || req.headers['mcp-method'] !== body.method) { refuse(-32020, 'Header mismatch: Mcp-Method'); return; }
    if (!meta || version !== meta['io.modelcontextprotocol/protocolVersion']) { refuse(-32020, 'Header mismatch: MCP-Protocol-Version'); return; }
    if (version !== MODERN) { answer(400, { error: { code: -32022, message: 'Unsupported protocol version', data: { supported: [MODERN] } } }); return; }
    if (body.method === 'server/discover') {
      answer(200, { result: { resultType: 'complete', supportedVersions: [MODERN], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo } } });
      return;
    }
    if (body.method === 'tools/list') {
      const n = fixture.seen.filter((s) => s.method === 'tools/list').length;
      answer(200, { result: { resultType: 'complete', ...pageOf(fixture.mode, body.params?.cursor, n) } });
      return;
    }
    answer(404, { error: { code: -32601, message: 'Method not found' } });
  });
  return fixture;
}

const socrata = legacyFixture({ name: 'socrata-fixture', version: '9.9.9' }, true);
const dataCommons = modernFixture({ name: 'dc-modern-fixture', version: '1.2.3' });
const boston = legacyFixture({ name: 'boston-stateless-fixture', version: '7' }, false);

for (const k of ['SITE_DEFAULT_PORTAL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `${await listen(socrata.server)}/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${await listen(dataCommons.server)}/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${await listen(boston.server)}/mcp`;

const client = await import('./client.ts');
const { readServerTools, startRunServerReads } = client;

/** One run: its own record of reads, opened before anything it does, as a route opens it. A run whose read
 *  failed keeps the error, so each test below fails at its own assertion, not at the file's load. */
async function inRun<T>(body: () => Promise<T>): Promise<{ value: T | null; reads: Map<string, unknown>; error?: unknown }> {
  // A fresh async context per run, as each request has one.
  return await new Promise((resolve) => {
    setImmediate(async () => {
      const reads = startRunServerReads();
      try {
        const value = await body();
        resolve({ value, reads: new Map(reads) });
      } catch (error) {
        resolve({ value: null, reads: new Map(reads), error });
      }
    });
  });
}
const valueOf = <T>(r: { value: T | null; error?: unknown }): T => {
  assert.ok(r.value, `the run's read failed: ${String((r.error as Error | undefined)?.message ?? r.error)}`);
  return r.value!;
};

const names = (tools: unknown[] | null) => (tools ?? []).map((t) => (t as { name: string }).name);
const lists = (seen: Seen[]) => seen.filter((s) => s.method === 'tools/list');

// --- The two eras, paged ----------------------------------------------------------------------------

const FIRST = await inRun(async () => ({
  socrata: await readServerTools('socrata'),
  dataCommons: await readServerTools('data-commons'),
  boston: await readServerTools('boston-opencontext'),
}));

test('older era: initialize\'s serverInfo is kept, and the list is read to its last page, a pinned tool on page 2 included', () => {
  const read = valueOf(FIRST).socrata;
  assert.deepEqual(read.serverInfo, { name: 'socrata-fixture', version: '9.9.9' });
  assert.deepEqual(names(read.tools), ['get_data', 'search', 'fetch']);
  const pages = lists(socrata.seen);
  assert.equal(pages.length, 2, 'the list was not read to its second page');
  assert.equal(pages[0].params.cursor, undefined);
  assert.equal(pages[1].params.cursor, 'page-2', 'the second page was not asked for by its cursor');
  for (const page of pages) assert.ok(page.headers['mcp-session-id'], 'a tools/list request carried no session');
});

test('newer era: server/discover\'s _meta serverInfo is kept, and each page\'s headers repeat its _meta and method', () => {
  const read = valueOf(FIRST).dataCommons;
  assert.deepEqual(read.serverInfo, { name: 'dc-modern-fixture', version: '1.2.3' });
  assert.deepEqual(names(read.tools), ['get_data', 'search', 'fetch']);
  const pages = lists(dataCommons.seen);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].params.cursor, 'page-2');
  for (const page of pages) {
    assert.equal(page.headers['mcp-method'], 'tools/list');
    assert.equal(page.headers['mcp-protocol-version'], (page.params._meta as Record<string, unknown>)['io.modelcontextprotocol/protocolVersion']);
  }
  assert.equal(dataCommons.seen.filter((s) => s.method === 'initialize').length, 0, 'the newer era was sent initialize');
});

test('a server that keeps no session: its initialize serverInfo is kept too', () => {
  assert.deepEqual(valueOf(FIRST).boston.serverInfo, { name: 'boston-stateless-fixture', version: '7' });
  assert.deepEqual(names(valueOf(FIRST).boston.tools), ['get_data', 'search', 'fetch']);
});

// --- Ruling 6: a run's record holds only its own reads -----------------------------------------------

test('ruling 6: the run that made each handshake records all three reports', () => {
  assert.deepEqual(Object.fromEntries(FIRST.reads), {
    socrata: { name: 'socrata-fixture', version: '9.9.9' },
    'data-commons': { name: 'dc-modern-fixture', version: '1.2.3' },
    'boston-opencontext': { name: 'boston-stateless-fixture', version: '7' },
  });
});

const SECOND = await inRun(async () => ({
  socrata: await readServerTools('socrata'),
  boston: await readServerTools('boston-opencontext'),
}));

test('ruling 6: a later run records the session-keeping server it was answered by, and no server read by an earlier handshake only', () => {
  assert.equal(socrata.seen.filter((s) => s.method === 'initialize').length, 1, 'premise: the later run made no new handshake');
  assert.equal(boston.seen.filter((s) => s.method === 'initialize').length, 1, 'premise: the later run made no new handshake');
  assert.deepEqual(valueOf(SECOND).boston.serverInfo, { name: 'boston-stateless-fixture', version: '7' }, 'premise: the client still holds the report');
  assert.deepEqual(Object.fromEntries(SECOND.reads), { socrata: { name: 'socrata-fixture', version: '9.9.9' } });
});

test('ruling 6: two runs at once each hold their own reads', async () => {
  const [a, b] = await Promise.all([
    inRun(async () => readServerTools('socrata')),
    inRun(async () => readServerTools('boston-opencontext')),
  ]);
  valueOf(a);
  assert.deepEqual([...a.reads.keys()], ['socrata']);
  assert.deepEqual([...b.reads.keys()], []);
});

// --- Decoys: a list that is not read whole is a failed read ---------------------------------------------

test('decoy: a cursor that repeats is a failed read, not a list', async () => {
  socrata.mode = 'repeat';
  try {
    await assert.rejects(readServerTools('socrata'), /repeated or malformed its cursor/);
  } finally {
    socrata.mode = 'paged';
  }
});

test('decoy: a list past the page bound is a failed read, after exactly twenty pages', async () => {
  dataCommons.mode = 'endless';
  const before = lists(dataCommons.seen).length;
  try {
    await assert.rejects(readServerTools('data-commons'), /ran past 20 pages/);
  } finally {
    dataCommons.mode = 'paged';
  }
  assert.equal(lists(dataCommons.seen).length - before, 20);
});

test('decoy: a page with no tools array is returned as no list, for the check to judge', async () => {
  boston.mode = 'no-tools';
  try {
    assert.equal((await readServerTools('boston-opencontext')).tools, null);
  } finally {
    boston.mode = 'paged';
  }
});
