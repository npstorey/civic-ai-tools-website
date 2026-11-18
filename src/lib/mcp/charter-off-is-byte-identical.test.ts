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
// RE-READ AT 0.5.0 (#644 W1 step 1). The router pin moved to 0.5.0, whose
// new functions (the directory, `load_source`, the in-loop composition and
// the harness definition) this composition calls none of. The prompt and
// tools hashes below are unchanged; the router's own component moves again,
// to 0.5.0, measured by W1's byte check with `SOURCE_ROUTING` unset and set
// to `all-sources`.
//
// RE-READ AT 0.6.0 (R8 W3 step 1). The router pin moved to 0.6.0, which adds
// three hosted entries (NYC Checkbook, NYC City Record, NYS Open Legislation),
// each offered by its own switch. With every switch unset, the prompt and
// tools hashes below are unchanged; the router's own component moves to
// 0.6.0, and `sourcesOffered` gains the three entries' not-configured rows
// (the W3 G0 record, 6299541942 §3), measured by W3's byte check in both
// routing modes.
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

for (const name of ['NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY', 'SITE_PORTAL_LOCKED', 'DATA_COMMONS_API_KEY']) delete process.env[name];
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

// S2-B: since router 0.8.0 NYC City Record is a pack over Socrata, offered wherever Socrata is, so the default
// composition gains its entry, block, citation and lock mention, and the tools array its two tools. The router holds
// every golden byte for byte with the pack left out of the selection (its 0.8.0 CHANGELOG); so does this criterion.
const BASE_THREE = ['socrata', 'data-commons', 'boston-opencontext'];
// CKAN-1 P3 (router 0.11.0, hub #314): Boston OpenContext's alias is `boston_opencontext` (it was `boston`, which the
// Boston pack takes), so every name it is offered under and every line naming them moves by that one rename. The
// texts are hashed with the rename undone, and only that string: any other byte still fails. The premise below shows
// the undo is exercised, and that no name of the pack (`boston__…`, offered only with `CKAN_MCP_URL` set) is there.
const OLD_ALIAS = (text: string) => text.replaceAll('boston_opencontext', 'boston');
const withoutPackText = {
  promptWithPortal: (await composeSystemPrompt({ portal: PORTAL, configured, now: NOW, selection: BASE_THREE })).prompt,
  promptNoPortal: (await composeSystemPrompt({ configured, now: NOW, selection: BASE_THREE })).prompt,
  toolsUnlocked: JSON.stringify(offeredMcpTools(mcpToolsFor(undefined), configured, BASE_THREE)),
  toolsLocked: JSON.stringify(offeredMcpTools(mcpToolsFor(PORTAL), configured, BASE_THREE)),
};
const withoutPack = {
  promptWithPortal: sha(OLD_ALIAS(withoutPackText.promptWithPortal)),
  promptNoPortal: sha(OLD_ALIAS(withoutPackText.promptNoPortal)),
  toolsUnlocked: sha(OLD_ALIAS(withoutPackText.toolsUnlocked)),
  toolsLocked: sha(OLD_ALIAS(withoutPackText.toolsLocked)),
};

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
  for (const key of ['nycCheckbookHosting', 'nysLegislationHosting']) {
    assert.equal(Object.hasOwn(configured, key), false, `premise: ${key} is unset`);
  }
  assert.deepEqual(withPortal.sourcesOffered.slice(0, 3).map((s) => s.reason), ['configured', 'configured', 'configured']);
  // S3-B W2 (npstorey/civic-ai-tools#318): router 0.10.0. Its search, its routing configuration and its lock rule for a
  // Socrata pack move nothing an unlocked composition with no search states; only the version below moves.
  // CKAN-1 P3 (hub #314): router 0.11.0. With `CKAN_MCP_URL` unset its two entries are offered nowhere; the alias
  // rename and the two not-configured rows below are what moves.
  // CKAN-2-WEB P1 (hub #329): router 0.12.0. With `CKAN_MCP_URL` unset the CKAN server is offered nowhere, and every
  // prompt and offered-tools array is 0.11.0's (its CHANGELOG); the retired pack's not-configured row leaves the
  // record's offered set, and the router component states 0.12.0. Those two are what moves.
  assert.equal(ROUTER_VERSION, '0.12.0', 'premise: the installed router is the pin this criterion is for');
  for (const [key, text] of Object.entries(withoutPackText)) {
    assert.ok(text.includes('boston_opencontext__ckan__'), `premise: ${key} names Boston OpenContext's tools under the new alias`);
    assert.ok(!text.includes('boston__'), `premise: ${key} names a tool under the old alias, or the pack's`);
  }
});

test('criterion P: the composed prompt is byte-identical to 3e9717b\'s, with and without a portal', () => {
  assert.equal(withoutPack.promptWithPortal, AT_BASE.promptWithPortal);
  assert.equal(withoutPack.promptNoPortal, AT_BASE.promptNoPortal);
});

test('criterion P: the offered tools are byte-identical to 3e9717b\'s, unlocked and locked', () => {
  assert.equal(withoutPack.toolsUnlocked, AT_BASE.toolsUnlocked);
  assert.equal(withoutPack.toolsLocked, AT_BASE.toolsLocked);
});

test('criterion P: the composition moves exactly the two named facts', async () => {
  assert.deepEqual(observed.sourcesOffered, [
    ...AT_BASE.sourcesOffered,
    { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-configured' },
    // Router 0.6.0 (R8 W3): the three new hosted entries, switches unset.
    { sourceId: 'nyc-checkbook', alias: 'nyc_checkbook', reason: 'not-configured' },
    // Router 0.8.0 (S2-B): NYC City Record, a pack over Socrata, is configured wherever Socrata is.
    { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'configured' },
    { sourceId: 'nys-legislation', alias: 'nys_legislation', reason: 'not-configured' },
    // Router 0.11.0 (CKAN-1 P3): the CKAN server and its Boston pack, `CKAN_MCP_URL` unset. Router 0.12.0
    // (CKAN-2-WEB P1) retired the pack: its row (`boston-ckan`, alias `boston`, not-configured) is gone.
    { sourceId: 'ckan-server', alias: 'ckan', reason: 'not-configured' },
  ].map((row) => (row.sourceId === 'boston-opencontext' ? { ...row, alias: 'boston_opencontext' } : row)));
  const base = AT_BASE.components;
  // S2-B: the three sources' components are as at the base; City Record's pack, offered since router 0.8.0, adds its
  // own before the router's (what it states is P3's, W6).
  // S2-B P3R: router 0.9.0 carries G0-C1 = A (hub #317 6835239767), Data Commons' new id. The base's bytes above
  // stay as captured; that one moved fact is named here, so any other change to a source's component still fails.
  const G0_C1 = { from: 'datacommons-mcp@https://github.com/datacommonsorg/agent-toolkit', to: 'Data Commons MCP Server@https://api.datacommons.org/mcp' };
  // CKAN-1 P3 (router 0.11.0): Boston OpenContext's block names its tools under the alias `boston_opencontext`, so its
  // hash moves; the block with that one rename undone hashes to the base's bytes, so nothing else in it moved.
  const { civicRouter } = await import('@typedstandards/civic-typed-router');
  const openContext = civicRouter.manifest.find((entry) => entry.sourceId === 'boston-opencontext')!;
  const block = await openContext.guidance.fetchText(
    { portal: PORTAL, publicationHost: '', fetchPrompt: async () => { throw new Error('fixture: no prompt'); }, fetchInstructions: async () => undefined } as never,
    civicRouter.aliasedView as never,
  );
  const OPENCONTEXT_ID = 'opencontext@https://data-mcp.boston.gov/mcp';
  const baseOpenContext = base.find((c) => (c as { id: string }).id === OPENCONTEXT_ID) as { guidanceHash: string };
  assert.equal(sha(OLD_ALIAS(block)), baseOpenContext.guidanceHash, 'premise: the OpenContext block is the base\'s with the alias renamed');
  assert.notEqual(sha(block), baseOpenContext.guidanceHash, 'premise: the rename moves the OpenContext block');
  const expected = base.slice(0, -1).map((c) => ((c as { id: string }).id === G0_C1.from ? { ...c, id: G0_C1.to } : c))
    .map((c) => ((c as { id: string }).id === OPENCONTEXT_ID ? { ...c, guidanceHash: sha(block) } : c));
  assert.notDeepEqual(expected, base.slice(0, -1), 'premise: the base states Data Commons by its old id');
  assert.deepEqual(observed.components.slice(0, 3), expected, 'a source\'s component moved');
  assert.equal(observed.components.length, base.length + 1);
  assert.equal((observed.components[3] as { id: string }).id, 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx');
  assert.deepEqual(base.at(-1), { id: '@typedstandards/civic-typed-router', version: '0.2.0' });
  assert.deepEqual(observed.components.at(-1), { id: '@typedstandards/civic-typed-router', version: '0.12.0' });
});
