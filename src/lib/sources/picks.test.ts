// S3-B W1 (npstorey/civic-ai-tools#318; G0-2 = A, G0-3 = A, anchor B8 and B10; the ORCH's A6 to A8): the one server
// function that computes a picked run's set (`src/lib/sources/picks.ts`), and the pause a picked Ask-first source still
// meets.
//
// WHAT MAKES IT ABLE TO FAIL. Every decoy is a source the run would otherwise list: Data Commons is On and configured,
// so a function that ignored the picks, or one that took configured ∩ picks without the states, lists it. Each kind
// of pick that must add nothing (Off, not configured, unknown, repeated, not a string) sits beside one that survives.
//
// THE PIN (B10, holds at 15a52942): a picked Ask-first source, listed by a run under rule `reader-picked`, holds at
// the pause, and its load span's `tool.load_asked` is what the pause did. Driven through the real routing and loop
// with a scripted pause; the stored states are read before and after and do not change.
//
// The module is imported through a path held in a variable, so this file type-checks where it does not exist yet
// (15a52942, where every picks test here fails at its first assertion: "src/lib/sources/picks.ts is absent").
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;

// --- A loopback source, for the pause drive ------------------------------------------------------------------------

const MCP_REQUESTS: string[] = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  MCP_REQUESTS.push(`${req.url ?? ''} ${msg.method ?? ''}`);
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Json) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's3b-w1' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 's3b-w1-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: '{"data":[],"total_rows":0}' }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

for (const name of ['DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'BOSTON_OPENCONTEXT_MCP_URL',
  'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION', 'SOURCE_ROUTING', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL']) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;

const { readMcpEnvFromProcess } = await import('../mcp/registry.ts');
const routingMode = (await import('../mcp/routing-mode.ts')) as unknown as Loose & typeof import('../mcp/routing-mode.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, hash } = await import('../evidence/trace.ts');
const { runToolLoop } = await import('../model-loop/run-tool-loop.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { createModelClient } = await import('../model-client.ts');
const consent = await import('./consent.ts');

const PICKS_MODULE = './picks.ts';
const picks = (await import(PICKS_MODULE).catch(() => null)) as Loose | null;
const need = (): Loose => {
  assert.ok(picks, 'src/lib/sources/picks.ts is absent');
  return picks!;
};

// Socrata, Data Commons and City Record (a pack over Socrata) configured; NYC Checkbook and NYS Legislation hosted.
const configured = { ...readMcpEnvFromProcess(), nycCheckbookHosting: 'sandbox' as const, nysLegislationHosting: 'sandbox' as const };
const STATES = { socrata: 'on', 'data-commons': 'on', 'nyc-checkbook': 'off', 'nyc-record': 'ask-first' } as Record<string, string>;
const enforced = { enforced: true, states: STATES };

// --- The body (A8) ---------------------------------------------------------------------------------------------------

test('A8: no picks key is Auto; a picks key that is not an array, or is empty, is a picked question with nothing picked', () => {
  const { picksFromBody } = need();
  assert.deepEqual(picksFromBody({ query: 'q' }), { kind: 'auto' });
  assert.deepEqual(picksFromBody(null), { kind: 'auto' });
  assert.deepEqual(picksFromBody({ picks: 'socrata' }), { kind: 'picked', ids: [] });
  assert.deepEqual(picksFromBody({ picks: { socrata: true } }), { kind: 'picked', ids: [] });
  assert.deepEqual(picksFromBody({ picks: null }), { kind: 'picked', ids: [] });
  assert.deepEqual(picksFromBody({ picks: [] }), { kind: 'picked', ids: [] });
});

test('A8: entries that are not strings, repeats and ids the manifest does not hold are dropped, in the order sent', () => {
  const { picksFromBody } = need();
  assert.deepEqual(
    picksFromBody({ picks: ['nyc-record', 7, 'socrata', 'not-a-source', 'nyc-record', null, { id: 'data-commons' }, 'socrata'] }),
    { kind: 'picked', ids: ['nyc-record', 'socrata'] },
  );
});

// --- The set (task 7; B8) ----------------------------------------------------------------------------------------------

test('task 7: the run\'s set is the picks that are configured and not Off, in manifest order; a pick never adds a source', () => {
  const { pickedRunOf } = need();
  // The decoys: Data Commons (On, configured, unpicked), NYC Checkbook (Off, picked), Boston (not configured, picked).
  const run = pickedRunOf(['nyc-record', 'nyc-checkbook', 'boston-opencontext', 'socrata'], configured, enforced, true);
  assert.deepEqual(run.survivors, ['socrata', 'nyc-record']);
  assert.deepEqual(run.selection, ['socrata']);
  assert.equal(run.usable, true);
  // The directory a route lists from it: the directory set, narrowed. Data Commons would be in the unnarrowed one.
  const directory = routingMode.directorySet(configured, enforced);
  assert.ok(directory.some((e) => e.sourceId === 'data-commons'), 'premise: the Auto directory lists Data Commons');
  assert.deepEqual(directory.filter((e) => run.survivors.includes(e.sourceId)).map((e) => e.sourceId), ['socrata', 'nyc-record']);
});

test('A6: a run that cannot pause, whose surviving picks are all Ask first, is not usable; one that can pause is', () => {
  const { pickedRunOf } = need();
  assert.equal(pickedRunOf(['nyc-record'], configured, enforced, false).usable, false);
  assert.equal(pickedRunOf(['nyc-record'], configured, enforced, true).usable, true);
  // A source with no stored state is Ask first (D6).
  assert.deepEqual(pickedRunOf(['nys-legislation'], configured, enforced, false).survivors, ['nys-legislation']);
  assert.equal(pickedRunOf(['nys-legislation'], configured, enforced, false).usable, false);
});

test('task 7: no surviving pick is not usable, whatever the run can do', () => {
  const { pickedRunOf } = need();
  for (const ids of [[], ['nyc-checkbook'], ['boston-opencontext'], ['nyc-checkbook', 'boston-opencontext']]) {
    const run = pickedRunOf(ids, configured, enforced, true);
    assert.deepEqual(run.survivors, [], JSON.stringify(ids));
    assert.equal(run.usable, false, JSON.stringify(ids));
  }
});

test('B8: the reasons keep not-selected for an allowed source not picked; reader-off and not-consented as today', () => {
  const { pickedRunOf } = need();
  const run = pickedRunOf(['socrata', 'nyc-record', 'nyc-checkbook'], configured, enforced, true);
  const offered = [
    { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
    { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-selected' },
    { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
    { sourceId: 'nyc-checkbook', alias: 'nyc_checkbook', reason: 'not-selected' },
    { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'not-selected' },
    { sourceId: 'nys-legislation', alias: 'nys_legislation', reason: 'not-selected' },
  ];
  assert.deepEqual(run.recordReasons(offered).map((o: { reason: string }) => o.reason), [
    'selected', 'not-selected', 'not-configured', 'reader-off', 'not-consented', 'not-selected',
  ]);
  // Decoy: the same reasons through the Auto mapping read not-consented for both unpicked allowed sources.
  assert.deepEqual(consent.recordSourcesOffered(offered, STATES).map((o) => o.reason), [
    'selected', 'not-consented', 'not-configured', 'reader-off', 'not-consented', 'not-consented',
  ]);
});

// --- B10, the pin: a picked Ask-first source still holds at the pause ---------------------------------------------------

test('W1-4 pin (B10): a picked Ask-first source holds at the pause, tool.load_asked is what the pause did, and no stored state moves', async () => {
  const rule = (routingMode.READER_PICKED_RULE as { id: string; version: string } | undefined) ?? { id: 'reader-picked', version: '1' };
  const statesBefore = JSON.stringify(STATES);
  const directory = routingMode.directorySet(configured, enforced).filter((e) => ['socrata', 'nyc-record'].includes(e.sourceId));
  const paused: string[] = [];
  const session = await routingMode.createInLoopRouting({
    configured, directory, searchable: directory, rule, selection: ['socrata'], now: new Date('2026-11-16T12:00:00.000Z'),
    pause: { async ask(sourceId) { paused.push(sourceId); return { decision: 'allow', held: true }; } },
  });
  const scripted = await startScriptedModelServer([
    { toolCalls: [{ id: 'load', name: 'load_source', args: { alias: 'nyc_record' } }] },
    { content: 'Nothing could be checked.' },
  ]);
  process.env.MODEL_API_BASE_URL = scripted.url;
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  try {
    const result = await runToolLoop({
      client: createModelClient({ apiKey: 'placeholder-model-key-s3b-w1' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: 'Which notices did the city publish?',
      systemPrompt: session.firstSystemPrompt,
      tools: session.firstTools,
      executeToolCall: session.executeToolCall,
      dispatchTarget: session.dispatchTarget,
      loadStep: session.loadStep,
      searchStep: session.searchStep,
      checkBase: async () => {},
      trace: { builder, parentSpanId: builder.rootSpanId, systemPromptHash: hash(session.firstSystemPrompt), resolveToolSource: session.resolveToolSource },
    });
    assert.deepEqual(paused, ['nyc-record']);
    assert.equal(result.toolCalls[0].loadOutcome, 'loaded');
  } finally {
    delete process.env.MODEL_API_BASE_URL;
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
  builder.endRoot({});
  const spans = (builder.finalize() as unknown as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string; attributes: Array<{ key: string; value: { boolValue?: boolean } }> }> }> }> })
    .resourceSpans[0].scopeSpans[0].spans;
  const load = spans.find((s) => s.name === 'mcp_tool_call' && s.attributes.some((a) => a.key === 'tool.name'));
  assert.ok(load, 'premise: the load has a span');
  assert.equal(load!.attributes.find((a) => a.key === 'tool.load_asked')?.value.boolValue, true);
  assert.equal(JSON.stringify(STATES), statesBefore, 'a stored state moved');
  // The record says the reader chose the list, and offers no search (G0-4 = A).
  const record = session.record() as unknown as { considered: Json; routingConfiguration: Json };
  assert.equal(record.considered.rule, 'reader-picked');
  assert.equal(record.routingConfiguration.search, 'none');
  assert.deepEqual(session.firstTools.map((t) => (t as { function: { name: string } }).function.name), ['load_source']);
});
