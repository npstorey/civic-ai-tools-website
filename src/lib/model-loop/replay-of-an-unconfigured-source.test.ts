// Sprint 238, ruling D2 — replaying a record that called a source this
// instance does not configure.
//
// Replay keeps the full tool vocabulary (`mcpTools`, unchanged by D2): it is a
// reader of published records, and a record that used Boston's OpenContext
// tools is replayed with those schemas offered. On an instance where
// `BOSTON_OPENCONTEXT_MCP_URL` is unset, the replayed `ckan__` call must be
// refused PER CALL, with no request sent, and recorded as a failed call — not
// routed to a coded default.
//
// WHAT IS DRIVEN. `replayLoopOptionsForPackage` with its PRODUCTION defaults —
// the real `buildSystemPrompt` and the real MCP client as the transport — into
// the real loop core, against a scripted loopback model and loopback Socrata
// and Data Commons sources. Every outbound `fetch` of the file is recorded; a
// non-loopback one is refused without being sent.
//
// WHAT MAKES IT ABLE TO FAIL. At the base (b38556f) the unset variable meant
// `https://data-mcp.boston.gov/mcp`: composing the replay's prompt called that
// server's `initialize`, and the replayed call was routed there — the recorder
// sees both attempts, and the call is recorded `unavailable`. The premise
// assertion below shows the model really was offered the tool it calls.
//
// WHAT THIS PINS THAT IS A CHANGE. Replay's prompt comes from
// `buildSystemPrompt`, so with the variable unset it no longer carries the
// Boston source's guidance either, while its tool list still offers the
// tools. That is asserted here so it cannot drift unannounced.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const NEEDLES = ['Boston OpenContext', 'ckan__', 'data-mcp.boston.gov'] as const;

const realFetch = globalThis.fetch;
const OUTBOUND: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  OUTBOUND.push(`${url.host}${url.pathname}`);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-238-p2-replay', version: '0' } } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture skill guidance.' } }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH']) delete process.env[name];
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;

const { startScriptedModelServer } = await import('./test-harness.ts');
const { replayLoopOptionsForPackage } = await import('./replay-loop.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { createModelClient } = await import('../model-client.ts');

const scripted = await startScriptedModelServer([
  { toolCalls: [{ id: 'r1', name: 'ckan__query_data', args: { resource_id: '00000000-0000-0000-0000-000000000000', limit: 5 } }] },
  { content: 'The Boston figure could not be retrieved.' },
]);
process.env.MODEL_API_BASE_URL = scripted.url;
const options = await replayLoopOptionsForPackage({
  // A record whose only data source was the Boston server: no portal to replay on.
  pkg: { queries: [], dataSources: [] },
  client: createModelClient({ apiKey: 'placeholder-model-key-238-p2-replay' }),
  endpointModel: 'fake/model',
  prompt: 'How many 311 requests did Boston receive last month?',
});
const result = await runToolLoop(options);
await new Promise<void>((resolve) => scripted.server.close(() => resolve()));

test('replay still offers the Boston tools the record used (its tool list is unchanged)', () => {
  const offered = ((scripted.requests[0]?.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name);
  assert.ok(offered.includes('ckan__query_data'), 'premise: the replayed model was offered the tool it calls');
});

test('the replayed ckan__ call is one failed call, not_configured, and nothing is sent anywhere but the fixtures', () => {
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'ckan__query_data');
  assert.equal(result.toolCalls[0].failed, true, 'the replayed call is recorded as answered');
  assert.equal(result.toolCalls[0].failureKind, 'not_configured');
  const mcpHost = new URL(MCP_ORIGIN).host;
  assert.ok(OUTBOUND.includes(`${mcpHost}/socrata/mcp`), `premise: the recorder never saw the Socrata fixture:\n${OUTBOUND.join('\n')}`);
  const elsewhere = OUTBOUND.filter((u) => !u.startsWith(`${mcpHost}/`) && !u.startsWith(`${new URL(scripted.url).host}/`));
  assert.deepEqual(elsewhere, [], 'the replay attempted a request to a host other than the fixtures');
});

test('the replay\'s composed prompt carries none of the Boston source\'s text', () => {
  const system = ((scripted.requests[0]?.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
  assert.ok(system && typeof system.content === 'string' && system.content.includes('Tools: get_data.'), 'premise: the replay composed the real prompt');
  for (const needle of NEEDLES) assert.ok(!(system!.content as string).includes(needle), `the replay's prompt carries "${needle}"`);
});
