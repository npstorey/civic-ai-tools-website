// #617 P3 criterion P — with NYC_CHARTER_HOSTING unset, the router pin to
// 0.3.0 leaves the composed prompt and the offered tools exactly as they were
// at 3e9717b (router 0.2.0), and moves only the two composition facts the
// anchor names: `sourcesOffered` gains the `nyc-charter` not-configured row,
// and the router package's component states 0.3.0.
//
// HOW IT CAN FAIL. The prompt and the tools are hashed — every byte counts —
// and compared with hashes captured by running this same file against a tree
// of 3e9717b (`P3_PRINT=1` prints what it observes). The three sources are a
// loopback MCP server on three paths, made to give the three guidance origins
// (Socrata refuses `prompts/get`: fallback; Data Commons advertises
// instructions: endpoint; Boston none: inline), so all three blocks are in
// the prompt; the date is fixed. Composed both with and without a portal, and
// the tools both unlocked and locked. The instrument was seen failing on a
// planted one-byte change (phase record, #617 P3).
//
// A record package is compared too, by a separate instrument run against both
// trees (phase record): it differs in those two facts and nothing else.
//
// RE-READ AT 0.4.0 (#632 W2 step 1). The router pin moved to 0.4.0, which
// replaces the manifest's `hosting` with hosting variants the router reads
// none of (ADR-0036). The prompt and tools hashes below are unchanged; the
// router's own component is the one fact that moves again, to 0.4.0 (rider
// item 3), measured across the move by W2's byte check on a package and the
// composition, both with the switch unset and set.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/charter-off-is-byte-identical.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

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
  res.writeHead(200, { 'content-type': 'application/json' });
  if (msg.method === 'initialize') {
    const instructions = (req.url ?? '').startsWith('/dc/') ? { instructions: 'Fixture Data Commons instructions.' } : {};
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'r7-p3-fixture', version: '0' }, ...instructions } }));
    return;
  }
  res.end(reply({ error: { code: -32603, message: 'fixture: no guidance here' } }));
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of ['NYC_CHARTER_HOSTING', 'SITE_PORTAL_LOCKED', 'DATA_COMMONS_API_KEY']) delete process.env[name];
process.env.SOCRATA_MCP_URL = `${ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${ORIGIN}/boston/mcp`;
for (const level of ['log', 'warn'] as const) console[level] = () => {};

const { composeSystemPrompt } = await import('./socrata-skill.ts');
const { offeredMcpTools, mcpToolsFor } = await import('./tools.ts');
const { readMcpEnvFromProcess } = await import('./registry.ts');

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const NOW = new Date('2026-10-16T12:00:00Z');
const PORTAL = 'data.cityofnewyork.us';

const configured = readMcpEnvFromProcess();
const withPortal = await composeSystemPrompt({ portal: PORTAL, configured, now: NOW });
const noPortal = await composeSystemPrompt({ configured, now: NOW });
const observed = {
  promptWithPortal: sha(withPortal.prompt),
  promptNoPortal: sha(noPortal.prompt),
  toolsUnlocked: sha(JSON.stringify(offeredMcpTools(mcpToolsFor(undefined), configured))),
  toolsLocked: sha(JSON.stringify(offeredMcpTools(mcpToolsFor(PORTAL), configured))),
  sourcesOffered: withPortal.sourcesOffered,
  components: withPortal.components,
};
if (process.env.P3_PRINT === '1') process.stderr.write(`${JSON.stringify(observed, null, 2)}\n`);

/** Captured at 3e9717b (router 0.2.0) by this file with `P3_PRINT=1`. */
const AT_BASE: typeof observed = {
  promptWithPortal: '85ac42933e9c0180537dbb21df78868efa550a49d1265992054b494850216ef3',
  promptNoPortal: '0fad76593f447d6bb7c67393e0610e326a789c0fe1bc8099bfa407aa02123efd',
  toolsUnlocked: '94c493ee67859a7eaf9f268d8da0d3afb303ee73f4fb67ff5cb576b01b8be7e8',
  toolsLocked: '34a3371cb9f85237b253fc54bda51fb69f37b29874dde08f24298385b91913d3',
  sourcesOffered: [
    {
      "sourceId": "socrata",
      "alias": "socrata",
      "reason": "configured"
    },
    {
      "sourceId": "data-commons",
      "alias": "data_commons",
      "reason": "configured"
    },
    {
      "sourceId": "boston-opencontext",
      "alias": "boston",
      "reason": "configured"
    }
  ],
  components: [
    {
      "id": "socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server",
      "guidanceHash": "58e670ec94e794d88df8b07d35cdad4c5e0eea602f42578d40469c7205da6b9d",
      "guidanceOrigin": "fallback"
    },
    {
      "id": "datacommons-mcp@https://github.com/datacommonsorg/agent-toolkit",
      "guidanceHash": "30f34974b4cdb237b87e5e54e3d7539344146495c3756cf73dfcf99781169d9c",
      "guidanceOrigin": "endpoint"
    },
    {
      "id": "opencontext@https://data-mcp.boston.gov/mcp",
      "guidanceHash": "d253d94f9b0d784bc0de4cb6e2af02f6b113ab48ef5d366410f025524b7a531d",
      "guidanceOrigin": "inline"
    },
    {
      "id": "@typedstandards/civic-typed-router",
      "version": "0.2.0"
    }
  ],
};

const ROUTER_VERSION = (JSON.parse(readFileSync(path.join(process.cwd(), 'node_modules/@typedstandards/civic-typed-router/package.json'), 'utf8')) as { version: string }).version;

test('premise: the three sources are configured and the switch is unset', () => {
  assert.equal(Object.hasOwn(configured, 'nycCharterHosting'), false);
  assert.deepEqual(withPortal.sourcesOffered.slice(0, 3).map((s) => s.reason), ['configured', 'configured', 'configured']);
  assert.equal(ROUTER_VERSION, '0.4.0', 'premise: the installed router is the pin this criterion is for');
});

test('criterion P: the composed prompt is byte-identical to 3e9717b\'s, with and without a portal', () => {
  assert.equal(observed.promptWithPortal, AT_BASE.promptWithPortal);
  assert.equal(observed.promptNoPortal, AT_BASE.promptNoPortal);
});

test('criterion P: the offered tools are byte-identical to 3e9717b\'s, unlocked and locked', () => {
  assert.equal(observed.toolsUnlocked, AT_BASE.toolsUnlocked);
  assert.equal(observed.toolsLocked, AT_BASE.toolsLocked);
});

test('criterion P: the composition moves exactly the two named facts', () => {
  assert.deepEqual(observed.sourcesOffered, [
    ...AT_BASE.sourcesOffered,
    { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-configured' },
  ]);
  const base = AT_BASE.components;
  assert.deepEqual(observed.components.slice(0, -1), base.slice(0, -1), 'a source\'s component moved');
  assert.deepEqual(base.at(-1), { id: '@typedstandards/civic-typed-router', version: '0.2.0' });
  assert.deepEqual(observed.components.at(-1), { id: '@typedstandards/civic-typed-router', version: '0.4.0' });
});
