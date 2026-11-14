// S2-B F1 (npstorey/civic-ai-tools#309), criterion 6, the eval harness: a pack's call is decided once, from the
// target the dispatch sends to.
//
// WHAT IS DRIVEN. A row as `runRow` in `eval-models.mjs` runs it: `routingFor` (the app's `createInLoopRouting` at
// the row's directory and scripted pause), `recordedLoadStep`, `loopOptions`, and the real loop core, with the
// routing's own transport, against the scripted model endpoint and a loopback base that counts every request. The
// row's consent is the harness's own Ask-first shape with Socrata as the Ask-first source; the model loads City
// Record alone and calls a bare `get_data` naming a portal and a dataset outside City Record's.
//
// SHAPED TO FAIL. The dispatch resolves that bare name to City Record, whose calls go to the base, and the base
// answers every call: a row whose options carried no decision sends it, and the base counts a `tools/call`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const received = [];
const base = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  received.push({ method: String(body.method), tool: body.params?.name });
  const answer = (payload, headers = {}) => {
    res.writeHead(200, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
  };
  if (body.id === undefined) { res.writeHead(202); res.end(); return; }
  if (body.method === 'server/discover') {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } }));
    return;
  }
  if (body.method === 'initialize') {
    answer({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 's2b-f1-eval-fixture', version: '0' } } }, { 'mcp-session-id': 's-1' });
    return;
  }
  answer({ result: { content: [{ type: 'text', text: JSON.stringify({ data: [{ value: 1 }], total_rows: 1 }) }] } });
});
await new Promise((resolve) => base.listen(0, '127.0.0.1', resolve));
base.unref();

for (const name of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'SOURCE_ROUTING', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[name];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${base.address().port}/mcp`;
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/mcp';
process.env.OPENROUTER_API_KEY = 'not-a-credential-s2b-f1-eval';

const { routingFor, recordedLoadStep, loopOptions } = await import('./eval-models.mjs');
const { runToolLoop } = await import('../src/lib/model-loop/run-tool-loop.ts');
const { startScriptedModelServer } = await import('../src/lib/model-loop/test-harness.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../src/lib/model-client.ts');
const { readMcpEnvFromProcess } = await import('../src/lib/mcp/registry.ts');

const configured = readMcpEnvFromProcess();
const spec = { consent: { mode: 'ask-first', sourceId: 'socrata', alias: 'socrata', decision: 'off' } };
const query = { id: 'F1', query: 'What public hearings are there in NYC this week?', portal: undefined };
const model = { id: 'fake/model', requestSettings: undefined };
const askedSources = new Set();
const loads = [];
const routing = await routingFor(spec, query, configured, new Date('2026-11-14T12:00:00Z'), askedSources);

const scripted = await startScriptedModelServer([
  { toolCalls: [{ id: 'l1', name: 'load_source', args: { alias: 'nyc_record' } }] },
  { toolCalls: [{ id: 'c1', name: 'get_data', args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.sfgov.org', query: 'SELECT * LIMIT 1' } }] },
  { content: 'An answer.' },
]);
process.env.MODEL_API_BASE_URL = scripted.url;
_resetDefaultModelClientForTests();
const receivedFrom = received.length;
let result;
try {
  result = await runToolLoop({
    client: getModelClient(),
    ...loopOptions({
      model,
      query,
      routing,
      loadStep: recordedLoadStep(routing, askedSources, loads),
      executeToolCall: (name, args) => routing.executeToolCall(name, args),
    }),
  });
} finally {
  await new Promise((resolve) => scripted.server.close(resolve));
  _resetDefaultModelClientForTests();
}
const during = received.slice(receivedFrom);
const bare = result.toolCalls.find((c) => c.name === 'get_data');

test('premise: the row lists Socrata Ask first, loads City Record alone, and calls the bare name', () => {
  assert.equal(routing.directory.find((d) => d.sourceId === 'socrata')?.state, 'ask-first');
  assert.deepEqual(routing.loaded(), ['nyc-record']);
  assert.ok(bare, 'the row recorded no bare get_data');
});

test('an eval row: a bare get_data the dispatch resolves to City Record, outside its portal and dataset, reaches no server', () => {
  assert.deepEqual(during.filter((r) => r.method === 'tools/call').map((r) => r.tool), [], 'the row sent the call to the base');
  assert.equal(bare.failed, true);
  assert.equal(bare.failureKind, 'unknown');
});
