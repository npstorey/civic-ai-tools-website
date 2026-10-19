// #644 W1 — in-loop routing, driven through the real loop core.
//
// WHAT IS DRIVEN. `runToolLoop` with the options an in-loop run is given
// (`createInLoopRouting` in `src/lib/mcp/routing-mode.ts`), against the fake
// model endpoint of `./test-harness.ts`, which records every request body it
// receives, so each assertion reads what the model was SENT. The three
// sources are one loopback MCP server on three paths: Socrata refuses
// `prompts/get` (its block is the package's fallback), Data Commons
// advertises instructions at `initialize`, Boston advertises none. No live
// endpoint and no credential: every key is a placeholder, every address
// loopback.
//
// Criterion 3, the first request: the directory and one tool, `load_source`,
// and no source's tool and no source's guidance; the directory contacts no
// source. The directory set follows the consent gate's decision: while the
// gate is dormant every configured source is listed and loads as On (G0
// correction 1), and a test fails if that path ever yields an Ask-first source.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/in-loop-routing.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DATA_COMMONS_INSTRUCTIONS = 'Fixture Data Commons instructions: name places by DCID.';
const ONE_ROW = JSON.stringify({ data: [{ count: '512' }], total_rows: 1 });

// --- The loopback MCP sources, counting every request they receive -----------

const MCP_REQUESTS: Array<{ path: string; method?: string; tool?: string }> = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }) : {};
  MCP_REQUESTS.push({ path: req.url ?? '', method: msg.method, tool: msg.params?.name });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  const route = req.url ?? '';
  if (msg.method === 'initialize') {
    const instructions = route.startsWith('/dc/') ? { instructions: DATA_COMMONS_INSTRUCTIONS } : {};
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-r8-w1' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-r8-w1-fixture', version: '0' }, ...instructions } }));
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

// --- Environment, before any app module loads ----------------------------------

for (const name of ['DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION', 'SOURCE_ROUTING']) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;

const { civicRouter } = await import('@typedstandards/civic-typed-router');
const { readMcpEnvFromProcess } = await import('../mcp/registry.ts');
const { CROSS_SOURCE_PREAMBLE, SOCRATA_SKILL_FALLBACK } = await import('../mcp/socrata-skill.ts');
const { createInLoopRouting, directorySet, entersInLoop } = await import('../mcp/routing-mode.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { startScriptedModelServer } = await import('./test-harness.ts');
const { createModelClient } = await import('../model-client.ts');

const NOW = new Date('2026-10-19T12:00:00.000Z');
const TODAY = '2026-10-19';
const PROMPT = 'How many potholes were reported in 2025?';
const configured = readMcpEnvFromProcess();
const ALL_IDS = ['socrata', 'data-commons', 'boston-opencontext'];

type Json = Record<string, unknown>;
type ToolSchema = { type: string; function: { name: string; parameters?: { properties?: { alias?: { enum?: string[] } } } } };

function toolNames(request: Json): string[] {
  return ((request.tools ?? []) as ToolSchema[]).map((t) => t.function.name);
}

function systemOf(request: Json): string {
  const messages = (request.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const system = messages.find((m) => m.role === 'system');
  assert.ok(system && typeof system.content === 'string', 'premise: the request carries a system message');
  return system!.content as string;
}

/** Run the loop once with the in-loop session's options against `replies`. */
async function drive(
  session: Awaited<ReturnType<typeof createInLoopRouting>>,
  replies: Parameters<typeof startScriptedModelServer>[0],
): Promise<{ requests: Json[]; result: Awaited<ReturnType<typeof runToolLoop>> }> {
  const scripted = await startScriptedModelServer(replies);
  process.env.MODEL_API_BASE_URL = scripted.url;
  try {
    const result = await runToolLoop({
      client: createModelClient({ apiKey: 'placeholder-model-key-r8-w1' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: PROMPT,
      systemPrompt: session.firstSystemPrompt,
      tools: session.firstTools,
      executeToolCall: session.executeToolCall,
    });
    return { requests: scripted.requests, result };
  } finally {
    delete process.env.MODEL_API_BASE_URL;
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

// --- Criterion 3: the first request ------------------------------------------------

test('criterion 3: the first in-loop request carries the directory and one tool, load_source, and nothing of any source', async () => {
  const directory = directorySet(configured, { enforced: false, states: {} });
  const session = await createInLoopRouting({ configured, directory, selection: undefined, now: NOW });
  const mcpBefore = MCP_REQUESTS.length;
  const { requests } = await drive(session, [{ content: 'No data was needed to answer this.' }]);
  const first = requests[0];

  // One tool, `load_source`, its enum the directory's aliases in manifest order.
  assert.deepEqual(toolNames(first), ['load_source']);
  const tool = (first.tools as ToolSchema[])[0];
  assert.deepEqual(tool.function.parameters?.properties?.alias?.enum, ['socrata', 'data_commons', 'boston']);

  // The system prompt is the router's directory over the directory set, byte for byte.
  const system = systemOf(first);
  assert.equal(system, civicRouter.directoryPrompt({ configured, today: TODAY, selection: ALL_IDS }));
  // No guidance block of any source and no cross-source preamble.
  assert.ok(!system.includes(SOCRATA_SKILL_FALLBACK.slice(0, 120)), 'the Socrata block reached the first request');
  assert.ok(!system.includes(DATA_COMMONS_INSTRUCTIONS), 'the Data Commons instructions reached the first request');
  assert.ok(!system.includes(CROSS_SOURCE_PREAMBLE.slice(0, 120)), 'the cross-source preamble reached the first request');
  // The directory contacted no source.
  assert.equal(MCP_REQUESTS.length, mcpBefore, `the directory contacted a source: ${JSON.stringify(MCP_REQUESTS.slice(mcpBefore))}`);
});

test('criterion 3: under the one-portal lock, the lock section follows the directory', async () => {
  const directory = directorySet(configured, { enforced: false, states: {} });
  const session = await createInLoopRouting({ configured, directory, selection: undefined, lockedPortal: 'data.example.org', now: NOW });
  const expected =
    `${civicRouter.directoryPrompt({ configured, today: TODAY, selection: ALL_IDS })}\n\n---\n\n` +
    civicRouter.aliasedPortalLockGuidance('data.example.org', configured, ALL_IDS);
  assert.equal(session.firstSystemPrompt, expected);
  assert.deepEqual(session.firstTools.map((t) => (t as ToolSchema).function.name), ['load_source']);
});

test('criterion 3: while the consent gate is dormant the directory lists every configured source as On, never Ask first', () => {
  const configurations = [
    configured,
    { ...configured, bostonOpencontextUrl: undefined },
    { ...configured, nycCharterHosting: 'sandbox' as const },
  ];
  // Whatever states a dormant decision carried, it is dormant: the gate
  // answers `states: {}`, and a stale state must not leak through either.
  const dormantStates: Array<Record<string, string>> = [{}, { socrata: 'ask-first', 'data-commons': 'off' }];
  for (const states of dormantStates) {
    for (const env of configurations) {
      const directory = directorySet(env, { enforced: false, states });
      assert.deepEqual(directory.map((d) => d.sourceId), civicRouter.offeredSkillSources(env));
      const askFirst = directory.filter((d) => d.state !== 'on');
      assert.deepEqual(askFirst, [], `the dormant path yielded a source that is not On: ${JSON.stringify(askFirst)}`);
    }
  }
});

test('criterion 3: once the gate is enforced, the directory is configured ∩ (On ∪ Ask first), and no stored state is Ask first', () => {
  assert.deepEqual(
    directorySet(configured, { enforced: true, states: {} }).map((d) => [d.sourceId, d.state]),
    [['socrata', 'ask-first'], ['data-commons', 'ask-first'], ['boston-opencontext', 'ask-first']],
  );
  assert.deepEqual(
    directorySet(configured, { enforced: true, states: { socrata: 'on', 'data-commons': 'off', 'boston-opencontext': 'ask-first', 'nyc-charter': 'on' } })
      .map((d) => [d.sourceId, d.alias, d.state]),
    [['socrata', 'socrata', 'on'], ['boston-opencontext', 'boston', 'ask-first']],
  );
});

test('criterion 3: in-loop is never entered with an empty directory set', () => {
  const all = directorySet(configured, { enforced: false, states: {} });
  const allOff = directorySet(configured, { enforced: true, states: { socrata: 'off', 'data-commons': 'off', 'boston-opencontext': 'off' } });
  assert.deepEqual(allOff, []);
  assert.equal(entersInLoop('in-loop', all), true);
  assert.equal(entersInLoop('in-loop', allOff), false);
  assert.equal(entersInLoop('all-sources', all), false);
});
