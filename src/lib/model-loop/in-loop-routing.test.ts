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
// Criterion 4, the load step: the loop intercepts `load_source` before the
// transport. A load of an On source answers one plain line and sets the next
// request's system prompt to the router's in-loop prompt over the loaded set
// (then the lock section) and its tools to `[load_source, ...that set's
// tools]`; a second load recomposes over the union; a repeat recomposes
// nothing. An Ask-first source is declined; an alias naming no source of the
// directory set is `not-offered`. A tool of a source in the directory that is
// not loaded is refused `not_offered`, with R6's reader copy and R8's model
// variant naming `load_source`. Each load is a tool call at its position,
// with a span carrying its outcome and never `error`.
//
// THE FIXTURE IS SHAPED SO IT CAN FAIL (CLAUDE.md, "a criterion demonstrated
// on a fixture shaped so it cannot fail"): the run loads two of the three
// sources, so the loaded set is a strict subset of the directory; the refused
// call is to Boston, which no successful call touches; and one not-offered
// load names an alias holding a `{`, so a result text that echoed its alias
// would carry one.
//
// Criterion 6, replay (C2): a record whose composition states `routing.method`
// `in-loop` replays in loop over the record's offered set, so its first
// request is the directory over that set and `load_source`; a record with no
// `routing` replays as today. The record's offered set is a strict subset of
// what this instance configures, so a replay over the instance's set would
// fail the assertion.
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
const { DATA_COMMONS_PUBLICATION_HOST } = await import('../mcp/data-commons-skill.ts');
const { NOT_LOADED_FOR_LLM, friendlyStreamError } = await import('../streaming.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, hash } = await import('../evidence/trace.ts');
const { createInLoopRouting, directorySet, entersInLoop } = await import('../mcp/routing-mode.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { replayLoopOptionsForPackage } = await import('./replay-loop.ts');
const { buildSystemPrompt } = await import('../mcp/socrata-skill.ts');
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
): Promise<{ requests: Json[]; result: Awaited<ReturnType<typeof runToolLoop>>; trace: ReturnType<InstanceType<typeof TraceBuilder>['finalize']> }> {
  const scripted = await startScriptedModelServer(replies);
  process.env.MODEL_API_BASE_URL = scripted.url;
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  try {
    const result = await runToolLoop({
      client: createModelClient({ apiKey: 'placeholder-model-key-r8-w1' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: PROMPT,
      systemPrompt: session.firstSystemPrompt,
      tools: session.firstTools,
      executeToolCall: session.executeToolCall,
      loadStep: session.loadStep,
      trace: { builder, parentSpanId: builder.rootSpanId, systemPromptHash: hash(session.firstSystemPrompt), resolveToolSource: session.resolveToolSource },
    });
    builder.endRoot();
    return { requests: scripted.requests, result, trace: builder.finalize() };
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

// --- Criterion 4: the load step ------------------------------------------------------

/** The in-loop prompt the router composes for `loaded`, from the answers the
 *  loopback sources give: independent of the app's composition code. */
async function expectedInLoopPrompt(loaded: string[], lockedPortal?: string): Promise<string> {
  const prompt = await civicRouter.aliasedInLoopSystemPrompt({
    portal: undefined,
    configured,
    today: TODAY,
    publicationHost: DATA_COMMONS_PUBLICATION_HOST,
    fetchPrompt: async (): Promise<string> => { throw new Error('refused'); },
    fetchInstructions: async (sourceId: string) => (sourceId === 'data-commons' ? DATA_COMMONS_INSTRUCTIONS : null),
    selection: ALL_IDS,
    loaded,
  });
  return lockedPortal ? `${prompt}\n\n---\n\n${civicRouter.aliasedPortalLockGuidance(lockedPortal, configured, ALL_IDS)}` : prompt;
}

/** The tools a request after loading `loaded` carries, from the package alone. */
function expectedTools(loaded: string[]): unknown[] {
  return [
    civicRouter.aliasedLoadSourceTool({ configured, selection: ALL_IDS }),
    ...civicRouter.aliasedOfferedMcpTools(civicRouter.aliasedMcpTools, configured, loaded),
  ];
}

type Span = { name: string; spanId: string; attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }> };
function spansOf(trace: unknown): Span[] {
  return (trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
}
function attrs(span: Span): Record<string, string | boolean | undefined> {
  return Object.fromEntries(span.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.boolValue]));
}
function toolMessages(request: Json): Array<{ tool_call_id: string; content: string }> {
  return ((request.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: string }>)
    .filter((m) => m.role === 'tool')
    .map((m) => ({ tool_call_id: m.tool_call_id ?? '', content: m.content ?? '' }));
}

const LOAD_RUN_SCRIPT = [
  { toolCalls: [{ id: 'load-socrata', name: 'load_source', args: { alias: 'socrata' } }] },
  {
    toolCalls: [
      { id: 'get-socrata', name: 'socrata__get_data', args: { type: 'query', dataset_id: 'aaaa-1111', limit: 1 } },
      { id: 'query-boston', name: 'boston__ckan__query_data', args: { resource_id: 'r-1', limit: 1 } },
      { id: 'load-charter', name: 'load_source', args: { alias: 'nyc_charter' } },
      { id: 'load-brace', name: 'load_source', args: { alias: '{"alias":"socrata"}' } },
    ],
  },
  { toolCalls: [{ id: 'load-dc', name: 'load_source', args: { alias: 'data_commons' } }] },
  { toolCalls: [{ id: 'load-socrata-again', name: 'load_source', args: { alias: 'socrata' } }] },
  { content: 'There were 512 potholes reported (dataset aaaa-1111); Boston could not be checked.' },
];

const loadRun = await (async () => {
  const directory = directorySet(configured, { enforced: false, states: {} });
  const session = await createInLoopRouting({ configured, directory, selection: undefined, now: NOW });
  const mcpFrom = MCP_REQUESTS.length;
  const run = await drive(session, LOAD_RUN_SCRIPT);
  return { ...run, session, mcp: MCP_REQUESTS.slice(mcpFrom) };
})();

test('criterion 4: after a load, the next request\'s system prompt is the router\'s in-loop prompt over the loaded set, byte for byte', async () => {
  assert.equal(systemOf(loadRun.requests[1]), await expectedInLoopPrompt(['socrata']));
  // A second load recomposes over the union; a repeat recomposes nothing.
  assert.equal(systemOf(loadRun.requests[3]), await expectedInLoopPrompt(['socrata', 'data-commons']));
  assert.equal(systemOf(loadRun.requests[4]), systemOf(loadRun.requests[3]));
});

test('criterion 4: after a load, the next request\'s tools are load_source and the loaded sources\' tools', () => {
  assert.equal(JSON.stringify(loadRun.requests[1].tools), JSON.stringify(expectedTools(['socrata'])));
  assert.equal(JSON.stringify(loadRun.requests[3].tools), JSON.stringify(expectedTools(['socrata', 'data-commons'])));
  assert.equal(JSON.stringify(loadRun.requests[4].tools), JSON.stringify(loadRun.requests[3].tools));
  assert.ok(!toolNames(loadRun.requests[4]).some((n) => n.startsWith('boston__')), 'a tool of an unloaded source was offered');
  assert.deepEqual(loadRun.session.loaded(), ['socrata', 'data-commons']);
});

test('criterion 4: under the lock, the lock section follows the in-loop prompt', async () => {
  const directory = directorySet(configured, { enforced: false, states: {} });
  const session = await createInLoopRouting({ configured, directory, selection: undefined, lockedPortal: 'data.example.org', now: NOW });
  const loaded = await session.loadStep.load('socrata', { iteration: 1 });
  assert.equal(loaded.outcome, 'loaded');
  assert.equal(loaded.systemPrompt, await expectedInLoopPrompt(['socrata'], 'data.example.org'));
});

test('criterion 4: no load\'s tool message contains a brace, and each is one line', () => {
  const loads = new Set(['load-socrata', 'load-charter', 'load-brace', 'load-dc', 'load-socrata-again']);
  const last = loadRun.requests[loadRun.requests.length - 1];
  const messages = toolMessages(last).filter((m) => loads.has(m.tool_call_id));
  assert.equal(messages.length, 5, 'premise: the five load results reached the model');
  // They are the load step's own lines, each naming what it loaded.
  const byId = Object.fromEntries(messages.map((m) => [m.tool_call_id, m.content]));
  assert.match(byId['load-socrata'], /\bsocrata\b/);
  assert.match(byId['load-dc'], /\bdata_commons\b/);
  for (const { tool_call_id, content } of messages) {
    assert.ok(content.length > 0, `${tool_call_id}: empty`);
    assert.ok(!content.includes('{'), `${tool_call_id} carries a brace: ${content}`);
    assert.ok(!content.includes('\n'), `${tool_call_id} is more than one line`);
  }
});

test('criterion 4: a tool of a source in the directory that is not loaded is refused not_offered, with R6\'s reader copy and R8\'s model variant', () => {
  const boston = loadRun.result.toolCalls.find((c) => c.name === 'boston__ckan__query_data');
  assert.equal(boston?.failed, true);
  assert.equal(boston?.failureKind, 'not_offered');
  const message = toolMessages(loadRun.requests[2]).find((m) => m.tool_call_id === 'query-boston')?.content;
  assert.equal(message, NOT_LOADED_FOR_LLM);
  assert.match(NOT_LOADED_FOR_LLM, /load_source/);
  assert.match(NOT_LOADED_FOR_LLM, /not loaded/);
  assert.equal(friendlyStreamError({ code: 'not_offered' }), 'This question did not use that data source, so nothing was sent to it.');
  // Nothing was sent to Boston; the Socrata call, made after its load, was.
  assert.deepEqual(loadRun.mcp.filter((r) => r.method === 'tools/call').map((r) => [r.path, r.tool]), [['/socrata/mcp', 'get_data']]);
  const socrata = loadRun.result.toolCalls.find((c) => c.name === 'socrata__get_data');
  assert.equal(socrata?.failed, undefined);
});

test('criterion 4: each load is a tool call at its position, with its outcome; loaded and not-offered are driven', () => {
  assert.deepEqual(
    loadRun.result.toolCalls.map((c) => [c.name, c.operationType, c.loadOutcome ?? null]),
    [
      ['load_source', 'load_source', 'loaded'],
      ['socrata__get_data', 'query', null],
      ['boston__ckan__query_data', 'query', null],
      ['load_source', 'load_source', 'not-offered'],
      ['load_source', 'load_source', 'not-offered'],
      ['load_source', 'load_source', 'loaded'],
      ['load_source', 'load_source', 'loaded'],
    ],
  );
});

test('criterion 4: each load span carries its outcome, names no source, and is never marked an error', () => {
  const toolSpans = spansOf(loadRun.trace).filter((s) => s.name === 'mcp_tool_call');
  assert.equal(toolSpans.length, loadRun.result.toolCalls.length, 'a tool call has no span, or a span no call');
  const loads = toolSpans.map(attrs).filter((a) => a['tool.operation_type'] === 'load_source');
  assert.deepEqual(loads.map((a) => a['tool.load_outcome']), ['loaded', 'not-offered', 'not-offered', 'loaded', 'loaded']);
  for (const a of loads) {
    assert.equal(a.error, undefined, 'a load span is marked an error');
    for (const key of ['mcp.source', 'mcp.alias', 'mcp.server.id', 'tool.upstream_name']) {
      assert.equal(a[key], undefined, `a load span names a source: ${key}`);
    }
  }
});

test('criterion 4: an Ask-first source is declined, its span says so, and nothing is loaded or sent', async () => {
  const directory = directorySet(configured, { enforced: true, states: { socrata: 'on', 'boston-opencontext': 'ask-first' } });
  const session = await createInLoopRouting({ configured, directory, selection: ['socrata'], now: NOW });
  const mcpFrom = MCP_REQUESTS.length;
  const run = await drive(session, [
    { toolCalls: [{ id: 'load-boston', name: 'load_source', args: { alias: 'boston' } }] },
    { content: 'Boston could not be checked for this question.' },
  ]);
  const text = toolMessages(run.requests[1]).find((m) => m.tool_call_id === 'load-boston')?.content ?? '';
  assert.ok(!text.includes('{') && !text.includes('\n'), `the declined text: ${text}`);
  assert.match(text, /unavailable for this question/);
  assert.match(text, /Do not call load_source for it again/);
  assert.match(text, /say what could not be checked/);
  assert.deepEqual(run.result.toolCalls.map((c) => [c.name, c.loadOutcome ?? null, c.failed ?? null]), [['load_source', 'declined', null]]);
  const span = spansOf(run.trace).filter((s) => s.name === 'mcp_tool_call').map(attrs)[0];
  assert.equal(span['tool.load_outcome'], 'declined');
  assert.equal(span.error, undefined);
  // The next request is the first one's prompt and tools: nothing was loaded.
  assert.equal(systemOf(run.requests[1]), session.firstSystemPrompt);
  assert.deepEqual(toolNames(run.requests[1]), ['load_source']);
  assert.deepEqual(session.loaded(), []);
  assert.deepEqual(MCP_REQUESTS.slice(mcpFrom), [], 'a declined load contacted a source');
});

// --- Criterion 5: each request's prompt hash ------------------------------------------

test('criterion 5: under in-loop, each llm_inference span states its own request\'s system prompt hash', () => {
  const inference = spansOf(loadRun.trace).filter((s) => s.name === 'llm_inference')
    .map(attrs)
    .sort((x, y) => Number(x['gen_ai.inference_index']) - Number(y['gen_ai.inference_index']));
  assert.equal(inference.length, loadRun.requests.length, 'premise: one inference span per request');
  inference.forEach((a, i) => {
    assert.equal(a['gen_ai.system_prompt_hash'], hash(systemOf(loadRun.requests[i])), `request ${i}`);
  });
  // The prompts did change across the run, so the hashes can differ.
  assert.notEqual(inference[0]['gen_ai.system_prompt_hash'], inference[1]['gen_ai.system_prompt_hash']);
});

// --- Criterion 6: replay ------------------------------------------------------------

/** A stored package's two fields replay reads, for a record offered Socrata
 *  and Data Commons (Boston, configured here, was not offered to it). */
function recordStating(routing?: { method: string; version: string }) {
  return {
    queries: [],
    dataSources: [],
    extensions: {
      'org.civicaitools.composition': {
        assertedDate: TODAY,
        sourcesOffered: [
          { sourceId: 'socrata', alias: 'socrata', reason: 'configured' },
          { sourceId: 'data-commons', alias: 'data_commons', reason: 'configured' },
          { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
          { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-configured' },
        ],
        components: [{ id: '@typedstandards/civic-typed-router', version: '0.5.0' }],
        ...(routing ? { routing, definitionHash: '0'.repeat(64) } : {}),
      },
    },
  };
}

async function replayFirstRequest(pkg: ReturnType<typeof recordStating>): Promise<Json> {
  const scripted = await startScriptedModelServer([{ content: 'No data was needed to answer this.' }]);
  process.env.MODEL_API_BASE_URL = scripted.url;
  try {
    const options = await replayLoopOptionsForPackage({
      pkg,
      client: createModelClient({ apiKey: 'placeholder-model-key-r8-w1' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: PROMPT,
    });
    await runToolLoop(options);
    return scripted.requests[0];
  } finally {
    delete process.env.MODEL_API_BASE_URL;
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

test('criterion 6: a replay of an in-loop record sends the directory first, over the record\'s offered set', async () => {
  const first = await replayFirstRequest(recordStating({ method: 'in-loop', version: '0.5.0' }));
  assert.deepEqual(toolNames(first), ['load_source']);
  const tool = (first.tools as ToolSchema[])[0];
  assert.deepEqual(tool.function.parameters?.properties?.alias?.enum, ['socrata', 'data_commons']);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(systemOf(first), civicRouter.directoryPrompt({ configured, today, selection: ['socrata', 'data-commons'] }));
});

test('criterion 6: a replay of a record with no routing sends today\'s request', async () => {
  const first = await replayFirstRequest(recordStating());
  assert.ok(!toolNames(first).includes('load_source'), 'a record with no routing was replayed in loop');
  assert.deepEqual(
    toolNames(first),
    civicRouter.aliasedOfferedMcpTools(civicRouter.aliasedMcpTools, configured, ['socrata', 'data-commons']).map((t) => t.function.name),
  );
  assert.equal(systemOf(first), await buildSystemPrompt(undefined, configured, ['socrata', 'data-commons']));
});
