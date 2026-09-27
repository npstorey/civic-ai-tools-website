// Sprint 238 P3 (website #537; ruling D4): the edges of era detection that the
// two main files do not reach — a legacy server that becomes modern-only, and
// an `UnsupportedProtocolVersionError` whose `supported` list names no modern
// version this client implements.
//
// WHAT IS DRIVEN. The REAL client against three scripted servers on loopback,
// one origin each:
//
//   socrata      — legacy and stateful (the hosted Socrata source's shape:
//                  socrata-mcp-server `src/index.ts` at 9283878), until it is
//                  switched to modern-only. A modern-only server validates the
//                  standard headers, and a legacy request carries no
//                  `Mcp-Method`, so it is refused `400 -32020`
//                  (streamable-http.mdx:622-625; the Legacy/Modern row of
//                  basic_versioning.mdx:170). -32020 is a code only a modern
//                  server emits (basic_index.mdx:122-135), so the cached legacy
//                  era no longer holds: the client probes once more and speaks
//                  modern.
//   data-commons — answers the probe -32022 naming only `2025-11-25`, a legacy
//                  revision (basic_versioning.mdx:34-37), and serves
//                  `initialize`: a dual-era server that will not serve this
//                  client's modern version. The client speaks legacy to it.
//   boston-opencontext — answers -32022 naming only a version this client
//                  does not implement. The versioning page says to surface an
//                  error when no compatible version exists
//                  (basic_versioning.mdx:69-71): the call throws, it is not
//                  sent as legacy, and nothing is cached.
//
// RED at base: every assertion that needs the probe. The base client sends
// `initialize` first and has no era to change.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/era-changes.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const ROWS = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });

interface Seen { method: string; headers: http.IncomingHttpHeaders; status: number; code?: number }

async function bodyOf(req: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    server.unref();
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }));
}

/** A scripted server: `handle` answers with a status and a JSON-RPC payload, or null for a bare 202. */
function scripted(handle: (msg: { id?: unknown; method?: string; params?: Record<string, unknown> }, req: http.IncomingMessage) => [number, Record<string, unknown> | null, Record<string, string>?]) {
  const seen: Seen[] = [];
  const server = http.createServer(async (req, res) => {
    const msg = JSON.parse(await bodyOf(req)) as { id?: unknown; method?: string; params?: Record<string, unknown> };
    const [status, payload, headers] = handle(msg, req);
    seen.push({ method: String(msg.method ?? ''), headers: req.headers, status, code: (payload?.error as { code?: number } | undefined)?.code });
    if (payload === null) { res.writeHead(status); res.end(); return; }
    res.writeHead(status, { 'content-type': 'application/json', ...(headers ?? {}) });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, ...payload }));
  });
  return { server, seen };
}

const legacyInitialize = (version: string) => ({ result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'p3-era', version: '0' } } });
const rows = { result: { content: [{ type: 'text', text: ROWS }] } };

// --- socrata: legacy, then modern-only ------------------------------------------------

let modernOnly = false;
const sessions = new Set<string>();
const socrata = scripted((msg, req) => {
  if (msg.id === undefined) return [202, null];
  if (modernOnly) {
    // streamable-http.mdx:622-626.
    if (!req.headers['mcp-protocol-version'] || req.headers['mcp-method'] !== msg.method) {
      return [400, { error: { code: -32020, message: 'Header mismatch' } }];
    }
    if (msg.method === 'server/discover') return [200, { result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } }];
    return [200, rows];
  }
  const session = req.headers['mcp-session-id'] as string | undefined;
  if (!session && msg.method === 'initialize') {
    const id = `era-session-${sessions.size + 1}`;
    sessions.add(id);
    return [200, legacyInitialize('2024-11-05'), { 'mcp-session-id': id }];
  }
  if (!session || !sessions.has(session)) return [400, { error: { code: -32000, message: 'Bad Request: No valid session ID provided' } }];
  return [200, rows];
});

// --- data-commons: -32022 naming a legacy revision only --------------------------------

const dataCommons = scripted((msg, req) => {
  if (msg.id === undefined) return [202, null];
  if (msg.method === 'server/discover') {
    return [400, { error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-11-25'], requested: req.headers['mcp-protocol-version'] } } }];
  }
  if (msg.method === 'initialize') return [200, legacyInitialize('2025-11-25')];
  return [200, rows];
});

// --- boston-opencontext: -32022 naming nothing this client implements -------------------

const boston = scripted((msg, req) => {
  if (msg.id === undefined) return [202, null];
  return [400, { error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2027-03-01'], requested: req.headers['mcp-protocol-version'] } } }];
});

delete process.env.DATA_COMMONS_API_KEY;
process.env.SOCRATA_MCP_URL = `${await listen(socrata.server)}/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${await listen(dataCommons.server)}/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${await listen(boston.server)}/mcp`;

const { callMcpTool } = await import('./client.ts');

async function settle(run: () => Promise<string>): Promise<{ value?: string; error?: Error }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error: error as Error };
  }
}

const tool = () => callMcpTool('get_data', { type: 'query', dataset_id: 'abcd-1234', select: 'count(*)', portal: 'data.example.org' });

const LEGACY_CALL = await settle(tool);
const beforeTurn = socrata.seen.length;
modernOnly = true;
const TURNED = await settle(tool);
const TURNED_AGAIN = await settle(tool);
const afterTurn = socrata.seen.slice(beforeTurn);

const DC = await settle(() => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/06' }));
const DC_AGAIN = await settle(() => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' }));

const BOSTON = await settle(() => callMcpTool('ckan__search_datasets', { query: 'permits' }));
const BOSTON_AGAIN = await settle(() => callMcpTool('ckan__search_datasets', { query: 'permits' }));

test('a legacy server that becomes modern-only: the refused legacy request makes the client probe once more, then speak modern', () => {
  assert.equal(LEGACY_CALL.value, ROWS, 'premise: the legacy call succeeded');
  assert.equal(TURNED.value, ROWS, `the call after the server changed failed: ${TURNED.error?.message}`);
  assert.equal(TURNED_AGAIN.value, ROWS);
  assert.deepEqual(afterTurn.map((s) => s.method), ['tools/call', 'server/discover', 'tools/call', 'tools/call']);
  assert.equal(afterTurn[0].code, -32020);
  assert.equal(afterTurn[2].headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(afterTurn[2].headers['mcp-session-id'], undefined);
});

test('-32022 naming only a legacy revision: the client speaks legacy, and caches it', () => {
  assert.equal(DC.value, ROWS, `the call failed: ${DC.error?.message}`);
  assert.equal(DC_AGAIN.value, ROWS);
  assert.deepEqual(dataCommons.seen.map((s) => s.method), ['server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
  // The legacy branch sends the version the server agreed (2025-11-25 lifecycle, Version Negotiation).
  assert.equal(dataCommons.seen[3].headers['mcp-protocol-version'], '2025-11-25');
});

test('-32022 naming no version this client implements: the call throws, nothing is sent as legacy, nothing is cached', () => {
  assert.ok(BOSTON.error && BOSTON_AGAIN.error, 'a call against a server with no common version resolved');
  assert.match(BOSTON.error!.message, /supports no protocol version this client implements/);
  assert.equal(boston.seen.filter((s) => s.method === 'initialize').length, 0);
  assert.equal(boston.seen.filter((s) => s.method === 'server/discover').length, 2, 'the era was cached, or the probe was retried with a version the server does not list');
});
