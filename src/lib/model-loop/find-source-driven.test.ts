// S3-B W2 (npstorey/civic-ai-tools#318; criteria W2-3, W2-4, W2-5 and W2-9, anchor B1 to B3 and B11's server half):
// the model's search, `find_source`, driven through the real loop core over the router's real manifest, with a
// listed set smaller than the searchable set passed to the routing under the test rule `test-listed-subset`.
//
// WHAT IS DRIVEN. `runToolLoop` with the options `createInLoopRouting` gives, against the scripted model server of
// `./test-harness.ts` (it records every request body), the real MCP client against one loopback MCP server for
// Socrata (it records every request it receives), and a recording seam around the router's search. The model:
//   1. searches with words aimed at NYC Checkbook, which is configured but Off, so outside the searchable set;
//   2. calls a City Record tool before loading it;
//   3. loads City Record, which is Ask first, through the pause;
//   4. searches again, for words whose one hit is already listed (the directory does not grow);
//   5. searches a third time (the limit is two);
//   6. answers.
//
// THE FIXTURE IS SHAPED SO IT CAN FAIL. The listed set is Socrata and NYS Open Legislation, the first and last
// sources of the configuration in manifest order, so City Record, a hit, must land between them: a directory that
// appended hits would place it last. The first search's words rank NYC Checkbook first when no space is passed (the
// control asserts it), so a search that ignored the space would return it. The second search adds nothing, so a
// prompt rebuilt on every search fails the "unchanged" assertion. The third would run a search if the limit were not
// kept. A distinctive word, `zephyrquill`, is in the first query and nowhere else, so B11's scan can tell where the
// words travelled.
//
// RED at 2d649c4: the routing ignores the searchable set and offers `load_source` alone; the loop hands
// `find_source` to the transport, which refuses it as an unknown tool and records `mcp.source` `unknown`; City
// Record's load answers `not-offered`; the routing does not refuse `directory-set` over unequal sets.
//
// No live endpoint, no credential: every key is a placeholder and every address loopback.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// --- The loopback Socrata server, recording every request ----------------------------------------------------------

const MCP_REQUESTS: Array<{ path: string; method?: string; tool?: string; body: string }> = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }) : {};
  MCP_REQUESTS.push({ path: req.url ?? '', method: msg.method, tool: msg.params?.name, body });
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's3b-w2' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 's3b-w2-fixture', version: '0' } } }));
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

const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';

const routerModule = (await import('@typedstandards/civic-typed-router')) as unknown as Record<string, unknown>;
const { civicRouter } = await import('@typedstandards/civic-typed-router');
const routerSearch = (civicRouter as unknown as { searchSources?: (input: unknown) => Array<{ sourceId: string; alias: string }> }).searchSources;
const { readMcpEnvFromProcess } = await import('../mcp/registry.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, hash, runRecordAttributes } = await import('../evidence/trace.ts');
const routingMode = await import('../mcp/routing-mode.ts');
const { createInLoopRouting, directorySet } = routingMode;
const { runToolLoop } = await import('./run-tool-loop.ts');
const { startScriptedModelServer } = await import('./test-harness.ts');
const { createModelClient } = await import('../model-client.ts');

const NOW = new Date('2026-11-15T12:00:00.000Z');
const TODAY = '2026-11-15';
const WORD = 'zephyrquill';
const Q1 = `city spending payments to vendors checkbook ${WORD}`;
const Q2 = 'procurement notices contract awards';
const Q3 = 'school enrollment';
const TEST_RULE = { id: 'test-listed-subset', version: '1' };

// Five sources configured: Socrata, Data Commons, NYC Checkbook (hosted), City Record (a pack over Socrata) and NYS
// Open Legislation (hosted). Listing a source contacts nothing, so no hosted source is woken.
const configured = { ...readMcpEnvFromProcess(), nycCheckbookHosting: 'sandbox' as const, nysLegislationHosting: 'sandbox' as const };
const STATES = { socrata: 'on', 'data-commons': 'on', 'nyc-checkbook': 'off', 'nyc-record': 'ask-first', 'nys-legislation': 'on' };
const searchable = directorySet(configured, { enforced: true, states: STATES });
const listed = searchable.filter((entry) => entry.sourceId === 'socrata' || entry.sourceId === 'nys-legislation');
const SEARCHABLE_IDS = ['socrata', 'data-commons', 'nyc-record', 'nys-legislation'];
const GROWN_IDS = ['socrata', 'data-commons', 'nyc-record', 'nys-legislation'];

type Json = Record<string, unknown>;
type Span = { name: string; attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }> };
type ToolSchema = { function: { name: string; parameters?: { properties?: { alias?: { enum?: string[] } } } } };

const toolNames = (request: Json): string[] => ((request.tools ?? []) as ToolSchema[]).map((t) => t.function.name);
const loadEnum = (request: Json): string[] | undefined => ((request.tools ?? []) as ToolSchema[]).find((t) => t.function.name === 'load_source')?.function.parameters?.properties?.alias?.enum;
function systemOf(request: Json): string {
  const system = ((request.messages ?? []) as Array<{ role?: string; content?: unknown }>).find((m) => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : '';
}
function toolMessages(request: Json): string[] {
  return ((request.messages ?? []) as Array<{ role?: string; content?: string }>).filter((m) => m.role === 'tool').map((m) => m.content ?? '');
}
function spansOf(trace: unknown): Span[] {
  return (trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans[0].scopeSpans[0].spans;
}
function attrs(span: Span): Record<string, string | boolean | undefined> {
  return Object.fromEntries(span.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.boolValue]));
}

// --- The drive, once -------------------------------------------------------------------------------------------------

const SEARCH_CALLS: Array<{ query: string; space?: readonly string[]; top?: number }> = [];
const TRANSPORT_CALLS: string[] = [];
const TRANSPORT_ARGS: string[] = [];
const PAUSED: string[] = [];
const FETCHES: Array<{ url: string; body: string }> = [];

const session = await createInLoopRouting({
  configured,
  directory: listed,
  searchable,
  rule: TEST_RULE,
  selection: searchable.filter((entry) => entry.state === 'on').map((entry) => entry.sourceId),
  now: NOW,
  pause: { async ask(sourceId) { PAUSED.push(sourceId); return { decision: 'allow', held: true }; } },
  search: (input) => {
    SEARCH_CALLS.push({ query: input.query, space: input.space, top: input.top });
    return routerSearch!(input);
  },
});

const scripted = await startScriptedModelServer([
  { toolCalls: [{ id: 'search-1', name: 'find_source', args: { query: Q1 } }] },
  { toolCalls: [{ id: 'early', name: 'nyc_record__get_data', args: { type: 'query', dataset_id: 'dg92-zbpx', query: 'SELECT 1' } }] },
  { toolCalls: [{ id: 'load', name: 'load_source', args: { alias: 'nyc_record' } }] },
  { toolCalls: [{ id: 'search-2', name: 'find_source', args: { query: Q2 } }] },
  { toolCalls: [{ id: 'search-3', name: 'find_source', args: { query: Q3 } }] },
  { content: 'Nothing could be checked.' },
]);
process.env.MODEL_API_BASE_URL = scripted.url;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  FETCHES.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
  return realFetch(input, init);
}) as typeof fetch;
const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
builder.startRoot('analysis', {});
let RESULT!: Awaited<ReturnType<typeof runToolLoop>>;
try {
  RESULT = await runToolLoop({
    client: createModelClient({ apiKey: 'placeholder-model-key-s3b-w2' }),
    endpointModel: 'fake/model',
    requestSettings: undefined,
    prompt: 'What did the city spend with its vendors last year?',
    systemPrompt: session.firstSystemPrompt,
    tools: session.firstTools,
    executeToolCall: async (name, args) => { TRANSPORT_CALLS.push(name); TRANSPORT_ARGS.push(JSON.stringify(args)); return session.executeToolCall(name, args); },
    dispatchTarget: session.dispatchTarget,
    loadStep: session.loadStep,
    searchStep: session.searchStep,
    checkBase: async () => {},
    trace: { builder, parentSpanId: builder.rootSpanId, systemPromptHash: hash(session.firstSystemPrompt), resolveToolSource: session.resolveToolSource },
  });
  // The root's record, as a route writes it after an in-loop run.
  builder.endRoot(runRecordAttributes({
    assertedDate: session.assertedDate,
    mcpServers: [],
    sourcesOffered: session.sourcesOffered,
    // The tools and the components are the run's last state, from the record, as a route writes them.
    ...session.record(),
  }));
} finally {
  globalThis.fetch = realFetch;
  delete process.env.MODEL_API_BASE_URL;
  await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
}
const REQUESTS = scripted.requests;
const TRACE = builder.finalize();
const TOOL_SPANS = spansOf(TRACE).filter((span) => span.name === 'mcp_tool_call');
const RESULT_TEXT = routerModule.FIND_SOURCE_RESULT_TEXT as { found(aliases: readonly string[]): string; none: string; limit: string } | undefined;

// --- W2-3 (B1): what the first request offers ----------------------------------------------------------------------

test('W2-3: a run whose searchable set is larger than its listed set carries exactly load_source and find_source', () => {
  assert.deepEqual(toolNames(REQUESTS[0]), ['load_source', 'find_source']);
  assert.deepEqual(loadEnum(REQUESTS[0]), ['socrata', 'nys_legislation']);
});

// --- W2-4 (B2): the search is the instance's own step ----------------------------------------------------------------

test('W2-4: no find_source call reaches the transport, and the third search runs no search', () => {
  assert.ok(!TRANSPORT_CALLS.includes('find_source'), `the transport saw find_source: ${TRANSPORT_CALLS.join(', ')}`);
  assert.equal(SEARCH_CALLS.length, 2, `the search ran ${SEARCH_CALLS.length} times`);
});

test('W2-4: each answer is the router\'s one line of plain text with no "{", and the third is the limit text', () => {
  assert.ok(RESULT_TEXT, 'the installed router exports no FIND_SOURCE_RESULT_TEXT');
  const answers = toolMessages(REQUESTS[REQUESTS.length - 1]);
  const searchAnswers = [answers[0], answers[3], answers[4]];
  for (const text of searchAnswers) {
    assert.ok(!text.includes('{') && !text.includes('\n'), `not one plain line: ${text}`);
  }
  // The first search's hits in rank order, measured over router 0.10.0's manifest with the searchable set as space.
  assert.equal(searchAnswers[0], RESULT_TEXT!.found(['nyc_record', 'data_commons', 'socrata', 'nys_legislation']));
  assert.equal(searchAnswers[1], RESULT_TEXT!.found(['nyc_record']));
  assert.equal(searchAnswers[2], RESULT_TEXT!.limit);
});

test('W2-4: each call is in the call list and the span list, at the same position', () => {
  const names = ['find_source', 'nyc_record__get_data', 'load_source', 'find_source', 'find_source'];
  assert.deepEqual(RESULT.toolCalls.map((call) => call.name), names);
  assert.deepEqual(TOOL_SPANS.map((span) => attrs(span)['tool.name']), names);
  assert.deepEqual(RESULT.toolCalls.map((call) => call.operationType), ['find_source', 'query', 'load_source', 'find_source', 'find_source']);
  assert.deepEqual(RESULT.toolCalls.map((call) => call.searchOutcome), ['searched', undefined, undefined, 'searched', 'limit-reached']);
});

test('W2-4: a search span carries exactly what harness 0.14.0 reads, and none of the six refused attributes', () => {
  const searches = TOOL_SPANS.filter((span) => attrs(span)['tool.operation_type'] === 'find_source');
  assert.equal(searches.length, 3);
  const searchedKeys = ['tool.name', 'tool.operation_type', 'tool.arguments', 'tool.search_query', 'tool.search_outcome', 'tool.search_hits', 'tool.duration_ms'];
  assert.deepEqual(searches[0].attributes.map((a) => a.key), searchedKeys);
  assert.deepEqual(searches[2].attributes.map((a) => a.key), searchedKeys.filter((key) => key !== 'tool.search_hits'));
  assert.deepEqual([0, 1, 2].map((i) => attrs(searches[i])['tool.search_outcome']), ['searched', 'searched', 'limit-reached']);
  assert.deepEqual([0, 1, 2].map((i) => attrs(searches[i])['tool.search_query']), [Q1, Q2, Q3]);
  assert.equal(attrs(searches[1])['tool.search_hits'], '["nyc-record"]');
  for (const span of searches) {
    for (const refused of ['error', 'mcp.source', 'mcp.server.id', 'mcp.alias', 'mcp.pack_id', 'tool.upstream_name']) {
      assert.ok(!span.attributes.some((a) => a.key === refused), `a search span carries ${refused}`);
    }
  }
});

test('W2-4: the search always passes the searchable set as its space, at the router\'s default cut', () => {
  assert.equal(SEARCH_CALLS.length, 2);
  for (const call of SEARCH_CALLS) {
    assert.deepEqual(call.space, SEARCHABLE_IDS);
    assert.equal(call.top, undefined);
  }
  assert.equal(routerModule.SEARCH_DEFAULT_TOP, 10);
});

// --- W2-5 (B3): the directory grows, and the found source loads through the pause --------------------------------------

test('W2-5: a hit outside the listed set is in the next request\'s directory text and enum, at its manifest position', () => {
  assert.deepEqual(loadEnum(REQUESTS[1]), ['socrata', 'data_commons', 'nyc_record', 'nys_legislation']);
  assert.deepEqual(toolNames(REQUESTS[1]), ['load_source', 'find_source']);
  assert.equal(systemOf(REQUESTS[1]), civicRouter.directoryPrompt({ configured, today: TODAY, selection: GROWN_IDS }));
  assert.notEqual(systemOf(REQUESTS[1]), systemOf(REQUESTS[0]), 'the system prompt was not rebuilt after the search that grew the directory');
});

test('W2-5: no call reaches a found source before its load', () => {
  const early = RESULT.toolCalls[1];
  assert.equal(early.failed, true);
  assert.equal(early.failureKind, 'not_offered');
  assert.equal(MCP_REQUESTS.filter((r) => r.method === 'tools/call').length, 0, 'a tools/call reached the Socrata server');
});

test('W2-5: the found Ask-first source loads through the pause, and its tools and components follow', () => {
  assert.deepEqual(PAUSED, ['nyc-record']);
  assert.equal(RESULT.toolCalls[2].loadOutcome, 'loaded');
  assert.ok(toolNames(REQUESTS[3]).some((name) => name.startsWith('nyc_record__')), `the loaded source's tools are absent: ${toolNames(REQUESTS[3]).join(', ')}`);
  assert.deepEqual(toolNames(REQUESTS[3]).slice(0, 2), ['load_source', 'find_source']);
  const entryId = (civicRouter.manifest.find((entry) => entry.sourceId === 'nyc-record') as unknown as { id: string }).id;
  assert.ok(session.components().some((component) => component.id === entryId), 'the components do not name the loaded found source');
});

test('W2-5: a search whose hits add nothing leaves the next request\'s system prompt and tools unchanged', () => {
  assert.equal(systemOf(REQUESTS[4]), systemOf(REQUESTS[3]));
  assert.deepEqual(toolNames(REQUESTS[4]), toolNames(REQUESTS[3]));
});

test('W2-5: a source outside the searchable set is never a hit, though the words aim at it', () => {
  assert.equal(typeof routerSearch, 'function', 'the installed router has no searchSources');
  // Control: with no space, NYC Checkbook is the best match for the first search's words.
  assert.equal(routerSearch!({ configured, query: Q1 })[0]?.sourceId, 'nyc-checkbook');
  for (const call of RESULT.toolCalls.filter((c) => c.name === 'find_source')) {
    assert.ok(!(call.searchHits ?? []).includes('nyc-checkbook'), 'NYC Checkbook was a hit');
  }
  assert.ok((RESULT.toolCalls[0].searchHits ?? []).includes('nyc-record'), 'premise: City Record is a hit of the first search');
});

test('W2-5: the run records the test rule, and its routing configuration states the search', () => {
  const record = session.record() as unknown as { considered: Json; routingConfiguration?: Json };
  assert.deepEqual(record.considered.rule, 'test-listed-subset');
  assert.deepEqual(record.considered.ruleVersion, '1');
  assert.equal(record.considered.listed, 2);
  assert.ok(record.routingConfiguration, 'the record states no routing configuration');
  assert.deepEqual(record.routingConfiguration!.rule, TEST_RULE);
  assert.deepEqual(record.routingConfiguration!.search, { method: 'bm25', version: '1' });
  assert.equal(record.routingConfiguration!.cap, 'none');
});

test('W2-5: the routing refuses directory-set with a listed set smaller than the searchable set', async () => {
  await assert.rejects(
    createInLoopRouting({ configured, directory: listed, searchable, rule: routingMode.DIRECTORY_SET_RULE, selection: undefined, now: NOW }),
    /directory-set/,
  );
  // And a listed source the searchable set does not hold.
  await assert.rejects(
    createInLoopRouting({ configured, directory: searchable, searchable: listed, rule: TEST_RULE, selection: undefined, now: NOW }),
  );
});

// --- W2-9 (B11, the server half): the words reach no source and no other host ------------------------------------------

test('W2-9: no request to a source or any other host holds the search\'s words; the model\'s own arguments are the one place', () => {
  assert.ok(REQUESTS.some((r) => JSON.stringify(r).includes(WORD)), 'premise: the word never reached the model server');
  // The site's tool transport, the MCP client's door to every source, never receives them.
  for (const args of TRANSPORT_ARGS) assert.ok(!args.includes(WORD), `the tool transport received the words: ${args}`);
  for (const request of MCP_REQUESTS) assert.ok(!request.body.includes(WORD), `a request to the source held the words: ${request.method}`);
  const modelOrigin = new URL(scripted.url).origin;
  for (const sent of FETCHES) {
    if (sent.url.startsWith(modelOrigin) || sent.url.startsWith(MCP_ORIGIN)) continue;
    assert.fail(`a request went to another host: ${sent.url}`);
  }
  for (const sent of FETCHES.filter((f) => f.url.startsWith(MCP_ORIGIN))) assert.ok(!sent.body.includes(WORD), 'a request to the source held the words');
  // At the model server: only inside an assistant message's tool-call arguments.
  for (const request of REQUESTS) {
    const messages = (request.messages ?? []) as Array<{ role?: string; content?: unknown; tool_calls?: Array<{ function: { arguments: string } }> }>;
    const outside = messages.map((m) => ({ ...m, tool_calls: m.tool_calls?.map((c) => ({ ...c, function: { ...c.function, arguments: '' } })) }));
    assert.ok(!JSON.stringify({ ...request, messages: outside }).includes(WORD), 'the words reached the model server outside the model\'s own arguments');
  }
});

// --- W2-3 (B1), the pin: listed equals searchable, as every route passes them --------------------------------------------

/** The first request's bytes (system prompt, then tools) for the searchable set listed whole, measured at 2d649c4. */
const EQUAL_SETS_FIRST_REQUEST_SHA256 = '8b6a9b1940943d48d3132a658f1d65a5aa9c1e15f54141b59b5e99f1a7fbbc72';

test('W2-3 pin: a run whose listed set equals its searchable set carries exactly load_source, and its first request does not move', async () => {
  const equal = await createInLoopRouting({
    configured, directory: searchable, searchable, rule: routingMode.DIRECTORY_SET_RULE,
    selection: searchable.filter((entry) => entry.state === 'on').map((entry) => entry.sourceId), now: NOW,
  });
  assert.deepEqual(equal.firstTools.map((tool) => (tool as ToolSchema).function.name), ['load_source']);
  assert.equal(equal.searchStep, undefined);
  assert.equal(hash(`${equal.firstSystemPrompt}\n${JSON.stringify(equal.firstTools)}`), EQUAL_SETS_FIRST_REQUEST_SHA256);
});

// --- W2-7 (B5): the driven run, packaged, verified and read ------------------------------------------------------------

const { buildEvidencePackage } = await import('../evidence/packager.ts');
const verifyCore = await import('@typedstandards/verify-core');
const { ed25519ph } = await import('@noble/curves/ed25519.js');
const { chooserFromPackage, chooserLines } = await import('../flows/source-chooser.ts');
const verifyCoreVersion = (await import('@typedstandards/verify-core/package.json', { with: { type: 'json' } })).default.version;

function packaged(): { pkg: Json; hash: string } {
  const built = buildEvidencePackage({
    trace: TRACE as unknown as Json,
    prompt: 'What did the city spend with its vendors last year?',
    output: 'Nothing could be checked.',
    toolCalls: RESULT.toolCalls as never,
    model: 'fake/model',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'Vendors',
    summary: 'Vendors.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
  } as never);
  return { pkg: built.pkg as unknown as Json, hash: built.hash };
}

test('W2-7: the packaged record of the driven run names no unknown source', () => {
  const { pkg } = packaged();
  const dataSources = (pkg.dataSources ?? []) as Array<{ sourceId?: string }>;
  assert.ok(!dataSources.some((entry) => entry.sourceId === 'unknown'), `a dataSources entry names unknown: ${JSON.stringify(dataSources)}`);
  assert.ok(!JSON.stringify(pkg.provenance ?? {}).includes('mcp-server:unknown'), 'the graph mints an unknown source agent');
});

test('W2-7: the packaged record verifies at the pinned verify-core 0.15.4', async () => {
  assert.equal(verifyCoreVersion, '0.15.4');
  const { pkg, hash: packageHash } = packaged();
  const seed = Uint8Array.from(Array.from({ length: 32 }, (_unused, i) => (i * 13 + 7) & 0xff));
  const raw = (await import('@noble/curves/ed25519.js')).ed25519.getPublicKey(seed);
  const spki = Buffer.concat([Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), Buffer.from(raw)]).toString('base64');
  const kid = String((pkg.metadata as Json).signingKeyId);
  const signature = { signature: Buffer.from(ed25519ph.sign(new TextEncoder().encode(packageHash), seed)).toString('base64'), publicKey: spki, algorithm: 'Ed25519ph', kid };
  const registry = { keys: [{ kid, publicKey: spki, status: 'active', activatedAt: '2026-01-01T00:00:00.000Z', deprecatedAt: null, revokedAt: null, signerIdentity: pkg.signer }] };
  const failFetch = (() => { throw new Error('verify-core touched the network'); }) as never;
  const result = await verifyCore.verifyEvidence(
    { package: pkg as never, packageHash, signature: signature as never, rekorEntryId: null, lifecycle: null },
    { registry: registry as never, fetch: failFetch },
  );
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureValid, true);
  assert.equal(result.keyTrust?.status, 'active');
  assert.equal(result.contentHash?.status, 'ok');
});

test('W2-7: the analysis page states the search in revision 5\'s words, names the test rule as written, and not directory-set\'s sentence', () => {
  const text = chooserLines(chooserFromPackage(packaged().pkg)).map((line) => line.text).join('\n');
  assert.ok(text.includes('The model was first shown 2 of the 7 sources'), text);
  assert.ok(text.includes('They were chosen by a rule recorded as test-listed-subset, version 1, which this site has no words for.'), text);
  assert.ok(!text.includes('Those were the sources set up on the site'), text);
  assert.ok(text.includes(`The model searched for sources, using the words: “${Q1}”. The search returned 4 sources. They are listed in the search's order, its best match first: NYC City Record; Google Data Commons; Socrata; NYS Open Legislation. The site that ran this question did the search itself. It did not send the search to any source.`), text);
  assert.ok(text.includes(`The model asked for another search, using the words: “${Q3}”. The site that ran this question did not run this search.`), text);
});

// --- W2-8 (B6): replaying a record that states a search ----------------------------------------------------------------

test('W2-8: a record that states a search replays in loop over the narrowed set with no search tool; its configuration is shown, not applied', async () => {
  const replayLoop = (await import('./replay-loop.ts')) as unknown as Record<string, unknown> & typeof import('./replay-loop.ts');
  const { pkg } = packaged();
  const options = await replayLoop.replayLoopOptionsForPackage({
    pkg: pkg as never,
    client: createModelClient({ apiKey: 'placeholder-model-key-s3b-w2' }),
    endpointModel: 'fake/model',
    requestSettings: undefined,
    prompt: 'What did the city spend with its vendors last year?',
  });
  // In loop over the narrowed set, as today: load_source alone, and no search step.
  assert.ok(options.loadStep, 'premise: the record replays in loop');
  assert.deepEqual(options.tools.map((tool) => (tool as ToolSchema).function.name), ['load_source']);
  assert.equal(options.searchStep, undefined);
  // The recorded routing configuration is read for showing, from the record, and is the record's.
  assert.equal(typeof replayLoop.recordRoutingConfiguration, 'function', 'replay-loop.ts has no recordRoutingConfiguration');
  const shown = (replayLoop.recordRoutingConfiguration as (p: unknown) => unknown)(pkg);
  const composition = (pkg.extensions as Json)['org.civicaitools.composition'] as Json;
  assert.ok(shown, 'no routing configuration was read from the record');
  assert.deepEqual(shown, composition.routingConfiguration);
  assert.deepEqual((shown as Json).search, { method: 'bm25', version: '1' }, 'premise: the record states a search');
});

// --- A1: the loop's guard -----------------------------------------------------------------------------------------------

test('A1: the loop refuses, before any request, a tools array that names find_source with no search step', async () => {
  // A closed loopback port: a request that escaped the guard fails to connect rather than reaching any host.
  process.env.MODEL_API_BASE_URL = 'http://127.0.0.1:9/v1';
  try {
    await assert.rejects(
      runToolLoop({
        client: createModelClient({ apiKey: 'placeholder-model-key-s3b-w2' }),
        endpointModel: 'fake/model',
        requestSettings: undefined,
        prompt: 'q',
        systemPrompt: session.firstSystemPrompt,
        tools: [...session.firstTools, { type: 'function', function: { name: 'find_source', parameters: { type: 'object', properties: {} } } }],
        executeToolCall: async () => '',
        loadStep: session.loadStep,
      }),
      /find_source/,
    );
  } finally {
    delete process.env.MODEL_API_BASE_URL;
  }
});
