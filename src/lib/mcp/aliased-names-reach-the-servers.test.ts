// #599 W3: the eleven tools are offered as `<alias>__<upstream name>`, and the
// servers are still called by their own names.
//
// WHAT IS DRIVEN. The REAL client (`callMcpTool`, `callMcpPrompt`,
// `getServerInstructions`, through `buildSystemPrompt`) against two scripted
// legacy MCP servers on loopback, one for Socrata and one for Data Commons.
// Boston OpenContext is left unconfigured, so its two spellings meet the
// configuration refusal. Every request each server receives is recorded.
//
//   1. Dispatch. `socrata__get_data` reaches the Socrata server with `get_data`
//      on the wire; a bare `get_data` (a name exactly one offered source has)
//      is accepted and sends the same bytes. The wire is the server's own name
//      whichever spelling the model used.
//   2. Configuration. A tool of an unconfigured source is refused with the
//      typed `McpConfigurationError`, naming the variable, for BOTH spellings,
//      before any request (#258 C4's path, kept).
//   3. The composed prompt. `buildSystemPrompt` is the router's aliased view of
//      exactly the text the two servers sent: equal to
//      `civicRouter.aliasedBuildSystemPrompt` over the same fetched texts, and
//      `unaliasText` with the router's dispatch map gives the bare view's bytes.
//      The scripted guidance names tools at the anchors the rewrite reaches
//      (a backtick token, a bold token, a table cell) and at one it does not (a
//      fenced `Tool: get_data` line), so both halves are exercised.
//
// RED at 617b18b (W2): the aliased spellings resolve to no server ("No MCP
// server registered"), and the composed prompt is the bare view.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/aliased-names-reach-the-servers.test.ts)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { civicRouter, readMcpEnv, unaliasText } from '@typedstandards/civic-typed-router';

interface Received {
  method: string;
  body: string;
}

/** Fixture guidance. Anchored names: `get_data` (backtick), **search**
 *  (bold), `| fetch |` (a table cell). Unanchored: the fenced `Tool: get_data`. */
const GUIDANCE = [
  '# Fixture Socrata guidance',
  '',
  'Start with `get_data` and type `catalog`; **search** finds datasets by text.',
  '',
  '| Tool | Use |',
  '|------|-----|',
  '| fetch | one dataset or record by id |',
  '',
  '```',
  'Tool: get_data',
  '```',
].join('\n');

const DC_INSTRUCTIONS = 'Fixture Data Commons instructions: call `search_indicators` first, then `get_observations`.';

function legacyServer(options: { session: string | null; instructions: string | null; record: Received[] }): http.Server {
  return http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let message: { method?: string; id?: unknown } = {};
    try { message = JSON.parse(body); } catch { /* recorded as sent */ }
    const method = String(message.method ?? '');
    options.record.push({ method, body: body.replace(/"id":\d+/, '"id":"<Date.now()>"') });
    const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };
    if (method === 'server/discover') { res.writeHead(404); res.end(); return; }
    if (method === 'initialize') {
      json(200, {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: 'fixture', version: '0.0.0' },
          ...(options.instructions ? { instructions: options.instructions } : {}),
        },
      }, options.session ? { 'mcp-session-id': options.session } : {});
      return;
    }
    if (method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (method === 'tools/call') {
      json(200, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: '{"rows":[{"n":1}]}' }] } });
      return;
    }
    if (method === 'prompts/get') {
      json(200, { jsonrpc: '2.0', id: message.id, result: { messages: [{ role: 'user', content: { type: 'text', text: GUIDANCE } }] } });
      return;
    }
    json(200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not scripted' } });
  });
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    server.unref();
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }));
}

const socrataRequests: Received[] = [];
const dataCommonsRequests: Received[] = [];
const socrata = legacyServer({ session: 'fixture-session', instructions: null, record: socrataRequests });
const dataCommons = legacyServer({ session: null, instructions: DC_INSTRUCTIONS, record: dataCommonsRequests });
const socrataUrl = await listen(socrata);
const dataCommonsUrl = `${await listen(dataCommons)}/mcp`;
after(() => { socrata.close(); dataCommons.close(); });

// The registry is built from the environment at module evaluation.
process.env.SOCRATA_MCP_URL = socrataUrl;
process.env.DATA_COMMONS_MCP_URL = dataCommonsUrl;
delete process.env.DATA_COMMONS_API_KEY;
delete process.env.BOSTON_OPENCONTEXT_MCP_URL;
delete process.env.PUBLISHER_PUBLICATION_HOST;

const { callMcpTool } = await import('./client.ts');
const { McpConfigurationError } = await import('./registry.ts');
const { buildSystemPrompt } = await import('./socrata-skill.ts');
const { DATA_COMMONS_PUBLICATION_HOST } = await import('./data-commons-skill.ts');

const ARGS = { type: 'query', dataset_id: 'abcd-1234', select: 'count(*)', portal: 'data.example.org' };

function toolCallsSince(start: number): Received[] {
  return socrataRequests.slice(start).filter((r) => r.method === 'tools/call');
}

test('socrata__get_data reaches the Socrata server with get_data on the wire', async () => {
  const start = socrataRequests.length;
  const text = await callMcpTool('socrata__get_data', ARGS);
  assert.equal(text, '{"rows":[{"n":1}]}');
  const calls = toolCallsSince(start);
  assert.equal(calls.length, 1, 'one tools/call reached the Socrata server');
  const params = (JSON.parse(calls[0].body) as { params: { name: string; arguments: unknown } }).params;
  assert.equal(params.name, 'get_data', 'the wire carries the server\'s own name');
  assert.deepEqual(params.arguments, ARGS);
});

test('a bare get_data, which exactly one offered source has, is accepted and sends the same bytes', async () => {
  let start = socrataRequests.length;
  await callMcpTool('socrata__get_data', ARGS);
  const aliased = toolCallsSince(start);
  start = socrataRequests.length;
  await callMcpTool('get_data', ARGS);
  const bare = toolCallsSince(start);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].body, aliased[0].body, 'the bare and aliased spellings send different bytes');
});

test('the other two Socrata tools and the Data Commons tools go out under their own names too', async () => {
  const sStart = socrataRequests.length;
  await callMcpTool('socrata__search', { query: '311' });
  await callMcpTool('socrata__fetch', { id: 'abcd-1234' });
  const dStart = dataCommonsRequests.length;
  await callMcpTool('data_commons__get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' });
  const sNames = toolCallsSince(sStart).map((r) => (JSON.parse(r.body) as { params: { name: string } }).params.name);
  const dNames = dataCommonsRequests.slice(dStart).filter((r) => r.method === 'tools/call')
    .map((r) => (JSON.parse(r.body) as { params: { name: string } }).params.name);
  assert.deepEqual(sNames, ['search', 'fetch']);
  assert.deepEqual(dNames, ['get_observations']);
});

test('an unconfigured source refuses both spellings with McpConfigurationError, naming the variable, before any request', async () => {
  const before = socrataRequests.length + dataCommonsRequests.length;
  for (const name of ['boston__ckan__query_data', 'ckan__query_data']) {
    let caught: unknown;
    try {
      await callMcpTool(name, { resource_id: 'x' });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof McpConfigurationError, `${name}: expected McpConfigurationError, got ${caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)}`);
    assert.match((caught as Error).message, /BOSTON_OPENCONTEXT_MCP_URL/);
  }
  assert.equal(socrataRequests.length + dataCommonsRequests.length, before, 'a request was sent for a refused call');
});

test('a name no source has keeps the generic refusal', async () => {
  await assert.rejects(() => callMcpTool('socrata__no_such_tool', {}), (error: unknown) =>
    error instanceof Error && !(error instanceof McpConfigurationError) && /No MCP server registered/.test(error.message));
});

test('the composed prompt is the router\'s aliased view of what the servers sent, and un-aliases to the bare view', async () => {
  const portal = 'data.cityofnewyork.us';
  const prompt = await buildSystemPrompt(portal);
  const configured = readMcpEnv({ SOCRATA_MCP_URL: socrataUrl, DATA_COMMONS_MCP_URL: dataCommonsUrl });
  const input = {
    portal,
    configured,
    today: new Date().toISOString().split('T')[0],
    publicationHost: DATA_COMMONS_PUBLICATION_HOST,
    fetchPrompt: async () => GUIDANCE,
    fetchInstructions: async (sourceId: string) => (sourceId === 'data-commons' ? DC_INSTRUCTIONS : null),
  };
  const routerAliased = await civicRouter.aliasedBuildSystemPrompt(input);
  const routerBare = await civicRouter.buildSystemPrompt(input);

  assert.ok(prompt.includes('# Fixture Socrata guidance'), 'the fetched guidance is not in the prompt');
  assert.ok(prompt.includes(DC_INSTRUCTIONS.replace('`search_indicators`', '`data_commons__search_indicators`').replace('`get_observations`', '`data_commons__get_observations`')),
    'the Data Commons instructions are not in the prompt with their anchored names rewritten');
  assert.equal(prompt, routerAliased, 'the app\'s prompt is not the router\'s aliased output for the same inputs');
  assert.equal(unaliasText(civicRouter.dispatchMap, prompt), routerBare, 'un-aliasing the prompt does not give the bare bytes');

  // The fetched guidance: anchored names renamed, the fenced line left bare.
  assert.ok(prompt.includes('Start with `socrata__get_data` and type `catalog`; **socrata__search** finds datasets by text.'));
  assert.ok(prompt.includes('| socrata__fetch | one dataset or record by id |'));
  assert.ok(prompt.includes('```\nTool: get_data\n```'), 'the unanchored fenced name was rewritten');
});
