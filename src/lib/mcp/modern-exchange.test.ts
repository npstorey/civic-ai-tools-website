// Sprint 238 P3 (website #537; rulings D4, D5, D7): against a MODERN server the
// client sends no `initialize`, builds every request's `_meta` and headers from
// one version value, retries an unsupported version once, caches the era per
// origin, and treats a 401 as authentication, never as an era.
//
// WHAT IS DRIVEN. The REAL client against three scripted servers on loopback,
// one per source and so one origin each:
//
//   socrata      — a modern server that VALIDATES what the 2026-07-28 revision
//                  says a server validates, and answers each failure the way
//                  the revision says it must. Every rule it enforces is cited
//                  where it is enforced, from the pages pinned at
//                  modelcontextprotocol/modelcontextprotocol@ab3a39c. A legacy
//                  `initialize` carries no `MCP-Protocol-Version`, so it is
//                  refused `400 -32020` like any request missing a required
//                  header (the Legacy/Modern row of the compatibility matrix).
//   data-commons — the same server, refusing the first probe's version with
//                  `UnsupportedProtocolVersionError` and naming its supported
//                  versions, one of which this client does not implement and
//                  listed first; later it turns into a legacy stateful server,
//                  so the cached era stops holding.
//   boston-opencontext — `401` to everything, as #537 measured the hosted
//                  source without a bearer token.
//
// RED at base: every assertion — the base client opens with `initialize` and
// knows neither `server/discover` nor any modern header. The 401 criterion is
// red at base on "no initialize was sent": base sends one and reads its 401 as
// an initialization failure.
//
// BLIND SPOTS. The fixture stands in for the specification, not for a real
// modern server: the client was also driven against the MCP SDK's own server
// at the phase gate. No `tools/list` is sent, so `x-mcp-header` mirroring is
// not exercised (a non-goal).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/modern-exchange.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CompletionResult } from '../openrouter-streaming.ts';

const MODERN = '2026-07-28';
const MODERN_INSTRUCTIONS = 'Modern fixture instructions: every call names its portal.';
const SECOND_INSTRUCTIONS = 'Second modern fixture instructions.';
const ROWS = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });
const SKILL_TEXT = 'Modern fixture skill guidance.';

interface Seen {
  method: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
  status: number;
  code?: number;
}

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

/** `=?base64?…?=` decoded, as a server MUST before comparing (streamable-http.mdx:498-504). */
function decodeHeaderValue(value: string): string {
  const m = /^=\?base64\?(.*)\?=$/.exec(value);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : value;
}

interface ModernOptions {
  supported: string[];
  instructions: string;
  /** Refuse the first `server/discover` with -32022, naming these versions. */
  refuseFirstProbe?: string[];
}

interface ModernFixture {
  server: http.Server;
  seen: Seen[];
  /** Answer `prompts/get` as a method this server does not implement. */
  promptsUnsupported: boolean;
  /** Become a legacy stateful server, shaped like the hosted Socrata source. */
  legacy: boolean;
}

function modernFixture(opts: ModernOptions): ModernFixture {
  const fixture: ModernFixture = { server: undefined as unknown as http.Server, seen: [], promptsUnsupported: false, legacy: false };
  let probeRefused = false;
  const legacySessions = new Set<string>();
  fixture.server = http.createServer(async (req, res) => {
    const raw = await bodyOf(req);
    const body = JSON.parse(raw) as { id?: unknown; method?: string; params?: Record<string, unknown> };
    const record: Seen = { method: String(body.method ?? ''), headers: req.headers, body, status: 200 };
    fixture.seen.push(record);
    const answer = (status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}) => {
      record.status = status;
      record.code = (payload.error as { code?: number } | undefined)?.code;
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
    };
    const refuse = (status: number, code: number, message: string, data?: unknown) =>
      answer(status, { error: { code, message, ...(data === undefined ? {} : { data }) } });

    if (body.id === undefined) { record.status = 202; res.writeHead(202); res.end(); return; }

    if (fixture.legacy) {
      // socrata-mcp-server src/index.ts at 9283878: `initialize` without a
      // session mints one; anything else without a known session is 400 -32000.
      const session = req.headers['mcp-session-id'] as string | undefined;
      if (!session && body.method === 'initialize') {
        const id = `turned-legacy-${legacySessions.size + 1}`;
        legacySessions.add(id);
        answer(200, { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3-turned-legacy', version: '0' } } }, { 'mcp-session-id': id });
        return;
      }
      if (!session || !legacySessions.has(session)) { refuse(400, -32000, 'Bad Request: No valid session ID provided'); return; }
      answer(200, { result: { content: [{ type: 'text', text: ROWS }] } });
      return;
    }

    const version = req.headers['mcp-protocol-version'];
    const mcpMethod = req.headers['mcp-method'];
    // streamable-http.mdx:622-625 — a required standard header is missing.
    if (typeof version !== 'string' || typeof mcpMethod !== 'string') {
      refuse(400, -32020, 'Header mismatch: a required header is missing');
      return;
    }
    // streamable-http.mdx:582-587, :626 — a header that does not match the body.
    if (mcpMethod !== body.method) { refuse(400, -32020, 'Header mismatch: Mcp-Method'); return; }
    const meta = (body.params?._meta ?? null) as Record<string, unknown> | null;
    // basic_index.mdx:367-382 — `protocolVersion` and `clientCapabilities` are
    // required in every request's `_meta`; a request without them is -32602.
    if (!meta || typeof meta['io.modelcontextprotocol/protocolVersion'] !== 'string' || typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object') {
      refuse(400, -32602, 'Invalid params: _meta');
      return;
    }
    // streamable-http.mdx:257-261 — the header MUST match `_meta`.
    if (version !== meta['io.modelcontextprotocol/protocolVersion']) { refuse(400, -32020, 'Header mismatch: MCP-Protocol-Version'); return; }
    // streamable-http.mdx:263-269, basic_versioning.mdx:48-67 — an unsupported
    // version is 400 -32022 naming the supported ones.
    const refuseNow = opts.refuseFirstProbe && !probeRefused && body.method === 'server/discover';
    if (refuseNow || !opts.supported.includes(version)) {
      probeRefused = true;
      refuse(400, -32022, 'Unsupported protocol version', { supported: opts.refuseFirstProbe ?? opts.supported, requested: version });
      return;
    }
    // streamable-http.mdx:286-297, :490-504 — `Mcp-Name` for these two methods,
    // decoded before it is compared to the body.
    if (body.method === 'tools/call' || body.method === 'prompts/get') {
      const name = req.headers['mcp-name'];
      if (typeof name !== 'string' || decodeHeaderValue(name) !== body.params?.name) { refuse(400, -32020, 'Header mismatch: Mcp-Name'); return; }
    }
    switch (body.method) {
      case 'server/discover':
        // server_discover.mdx:38-59.
        answer(200, { result: { resultType: 'complete', supportedVersions: opts.supported, capabilities: { tools: {}, prompts: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'p3-modern', version: '0' } }, instructions: opts.instructions } });
        return;
      case 'tools/call': {
        const dataset = String((body.params?.arguments as Record<string, unknown> | undefined)?.dataset_id ?? '');
        // basic_index.mdx:81-85 — `resultType`; an absent one means complete.
        if (dataset === 'input-required') { answer(200, { result: { resultType: 'input_required', inputRequests: {} } }); return; }
        const result: Record<string, unknown> = { content: [{ type: 'text', text: ROWS }] };
        if (dataset === 'complete') result.resultType = 'complete';
        answer(200, { result });
        return;
      }
      case 'prompts/get':
        // streamable-http.mdx:271-275 — an unimplemented method is 404 -32601.
        if (fixture.promptsUnsupported) { refuse(404, -32601, 'Method not found'); return; }
        answer(200, { result: { resultType: 'complete', messages: [{ role: 'user', content: { type: 'text', text: `${SKILL_TEXT} (${String(body.params?.name)})` } }] } });
        return;
      default:
        refuse(404, -32601, 'Method not found');
    }
  });
  return fixture;
}

const socrata = modernFixture({ supported: [MODERN], instructions: MODERN_INSTRUCTIONS });
const dataCommons = modernFixture({ supported: [MODERN], instructions: SECOND_INSTRUCTIONS, refuseFirstProbe: ['2027-03-01', MODERN] });

const bostonSeen: Seen[] = [];
const boston = http.createServer(async (req, res) => {
  const body = JSON.parse(await bodyOf(req)) as { method?: string };
  bostonSeen.push({ method: String(body.method ?? ''), headers: req.headers, body, status: 401 });
  res.writeHead(401, { 'content-type': 'text/plain' });
  res.end('Missing bearer token');
});

for (const k of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL', 'SITE_DEFAULT_PORTAL', 'DATA_COMMONS_API_KEY']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `${await listen(socrata.server)}/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${await listen(dataCommons.server)}/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${await listen(boston)}/mcp`;

const { callMcpTool, callMcpPrompt, getServerInstructions } = await import('./client.ts');
const { classifyStreamError } = await import('../streaming.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { carriedModelIdentity } = await import('../model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('../model-client.ts');

async function settle<T>(run: () => Promise<T>): Promise<{ value?: T; error?: Error }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error: error as Error };
  }
}

const count = (seen: Seen[], method: string) => seen.filter((s) => s.method === method).length;
const tool = (dataset: string) => () => callMcpTool('get_data', { type: 'query', dataset_id: dataset, select: 'count(*)', portal: 'data.example.org' });

// --- socrata: the modern exchange -----------------------------------------------

const INSTRUCTIONS = await settle(() => getServerInstructions('socrata'));
const TOOL = await settle(tool('no-result-type'));
const TOOL_COMPLETE = await settle(tool('complete'));
const TOOL_INPUT_REQUIRED = await settle(tool('input-required'));
const PROMPT = await settle(() => callMcpPrompt('skill-guidance', { modality: 'web' }));
const PROMPT_NON_ASCII = await settle(() => callMcpPrompt('guía-de-datos', { modality: 'web' }));
const PROMPT_SENTINEL = await settle(() => callMcpPrompt('=?base64?literal?=', { modality: 'web' }));
const discoversBefore404 = count(socrata.seen, 'server/discover');
socrata.promptsUnsupported = true;
const PROMPT_404 = await settle(() => callMcpPrompt('skill-guidance', { modality: 'web' }));
socrata.promptsUnsupported = false;
const discoversAfter404 = count(socrata.seen, 'server/discover');

// --- data-commons: the version retry, the cache, then the era changing ------------

const DC_FIRST = await settle(() => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/06' }));
const DC_SECOND = await settle(() => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' }));
const DC_INSTRUCTIONS = await settle(() => getServerInstructions('data-commons'));
const dcBeforeTurn = dataCommons.seen.length;
dataCommons.legacy = true;
const DC_TURNED = await settle(() => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/17' }));
const DC_TURNED_AGAIN = await settle(() => callMcpTool('get_observations', { variable_dcid: 'Count_Person', place_dcid: 'geoId/48' }));
const dcAfterTurn = dataCommons.seen.slice(dcBeforeTurn);
/** What the client sent socrata, read before any test sends its own request there. */
const SOCRATA_SEEN = socrata.seen.slice();

// --- boston-opencontext: 401 ---------------------------------------------------------

const BOSTON_INSTRUCTIONS = await settle(() => getServerInstructions('boston-opencontext'));
const BOSTON_DIRECT = await settle(() => callMcpTool('ckan__search_datasets', { query: 'permits' }));

const scripted = await startScriptedModelServer([
  { toolCalls: [{ id: 'c1', name: 'ckan__search_datasets', args: { query: 'building permits' } }] },
  { content: 'The source could not be reached.' },
]);
let LOOP: CompletionResult | undefined;
try {
  process.env.OPENROUTER_API_KEY = 'placeholder-model-key-p3-modern';
  process.env.MODEL_API_BASE_URL = scripted.url;
  _resetDefaultModelClientForTests();
  await queryWithMcpStreaming(
    'How many building permits were issued?',
    carriedModelIdentity('fake/model'),
    [],
    (name, args) => callMcpTool(name, args),
    'You are a fixture system prompt.',
    {
      onProgress: () => {},
      onToken: () => {},
      onComplete: (_panel, result) => { LOOP = result; },
      onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
    },
    undefined,
    { toolTimeoutMs: 10_000 },
  );
} finally {
  _resetDefaultModelClientForTests();
  await new Promise((resolve) => scripted.server.close(resolve));
}

// --- Criterion 2: modern, no initialize ----------------------------------------------

test('criterion 2: a tools/call and a prompts/get succeed with no initialize', () => {
  assert.equal(TOOL.value, ROWS, `the tool call failed: ${TOOL.error?.message}`);
  assert.equal(PROMPT.value, `${SKILL_TEXT} (skill-guidance)`, `the prompt failed: ${PROMPT.error?.message}`);
  assert.equal(count(SOCRATA_SEEN, 'initialize'), 0, 'the client sent initialize to a modern server');
  assert.equal(count(dataCommons.seen.slice(0, dcBeforeTurn), 'initialize'), 0);
});

test('criterion 2: every modern request carries _meta and MCP-Protocol-Version from one value, Mcp-Method, and no session', () => {
  const modern = [...SOCRATA_SEEN, ...dataCommons.seen.slice(0, dcBeforeTurn)];
  assert.ok(modern.length >= 8, 'premise: the modern fixtures saw the calls');
  for (const s of modern) {
    const meta = (s.body.params as { _meta?: Record<string, unknown> } | undefined)?._meta ?? {};
    assert.equal(s.headers['mcp-protocol-version'], meta['io.modelcontextprotocol/protocolVersion'], `${s.method}: header and _meta differ`);
    assert.deepEqual(meta['io.modelcontextprotocol/clientCapabilities'], {});
    assert.equal((meta['io.modelcontextprotocol/clientInfo'] as { name?: string } | undefined)?.name, 'civic-ai-tools-website');
    assert.equal(s.headers['mcp-method'], s.method);
    assert.equal(s.headers['mcp-session-id'], undefined, `${s.method} carried a session id`);
    assert.notEqual(s.code, -32020, `${s.method} was refused as a header mismatch`);
    assert.notEqual(s.code, -32602, `${s.method} was refused for its _meta`);
  }
});

test('criterion 2: tools/call and prompts/get carry Mcp-Name, Base64 where the name is not plain ASCII or looks encoded', () => {
  const calls = SOCRATA_SEEN.filter((s) => s.method === 'tools/call' || s.method === 'prompts/get');
  for (const s of calls) assert.equal(decodeHeaderValue(String(s.headers['mcp-name'])), (s.body.params as { name?: string }).name);
  assert.equal(calls.find((s) => s.method === 'tools/call')?.headers['mcp-name'], 'get_data');
  assert.equal(PROMPT_NON_ASCII.value, `${SKILL_TEXT} (guía-de-datos)`, `the non-ASCII prompt failed: ${PROMPT_NON_ASCII.error?.message}`);
  // streamable-http.mdx:483-496 and the encoding table at :512-518.
  const nonAscii = calls.find((s) => (s.body.params as { name?: string }).name === 'guía-de-datos');
  assert.equal(nonAscii?.headers['mcp-name'], `=?base64?${Buffer.from('guía-de-datos', 'utf8').toString('base64')}?=`);
  assert.equal(PROMPT_SENTINEL.value, `${SKILL_TEXT} (=?base64?literal?=)`);
  const sentinel = calls.find((s) => (s.body.params as { name?: string }).name === '=?base64?literal?=');
  assert.equal(sentinel?.headers['mcp-name'], '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
});

test('criterion 2: getServerInstructions returns the DiscoverResult\'s instructions', () => {
  assert.equal(INSTRUCTIONS.value, MODERN_INSTRUCTIONS);
});

test('criterion 2: an absent resultType is complete, "complete" is complete, and "input_required" is not an answer', () => {
  assert.equal(TOOL.value, ROWS);
  assert.equal(TOOL_COMPLETE.value, ROWS);
  assert.equal(TOOL_INPUT_REQUIRED.error?.message, 'Unexpected MCP result type');
  assert.equal(TOOL_INPUT_REQUIRED.value, undefined);
});

test('the modern server refuses a legacy initialize (the premise of "no initialize")', async () => {
  const response = await fetch(process.env.SOCRATA_MCP_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } }),
  });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error?: { code?: number } }).error?.code, -32020);
});

// --- Criterion 3: the version retry and the cache ------------------------------------

test('criterion 3: a 400 carrying -32022 is retried once, with a supported version this client implements', () => {
  assert.equal(DC_FIRST.value, ROWS, `the first call failed: ${DC_FIRST.error?.message}`);
  const probes = dataCommons.seen.slice(0, dcBeforeTurn).filter((s) => s.method === 'server/discover');
  assert.equal(probes.length, 2, 'the probe was not retried exactly once');
  assert.equal(probes[0].code, -32022);
  assert.equal(probes[1].headers['mcp-protocol-version'], MODERN, 'the retry chose a version the client does not implement');
  assert.equal(probes[1].status, 200);
});

test('criterion 3: the era is cached per origin — a second call and an instructions read send no second probe', () => {
  assert.equal(DC_SECOND.value, ROWS);
  assert.equal(DC_INSTRUCTIONS.value, SECOND_INSTRUCTIONS);
  assert.equal(count(dataCommons.seen.slice(0, dcBeforeTurn), 'server/discover'), 2);
  assert.equal(count(SOCRATA_SEEN, 'server/discover'), 1, 'the socrata origin was probed more than once');
});

test('D4: when the cached era stops holding, the origin is probed again once, and the call is made in the era found', () => {
  assert.equal(DC_TURNED.value, ROWS, `the call after the era changed failed: ${DC_TURNED.error?.message}`);
  assert.equal(DC_TURNED_AGAIN.value, ROWS);
  assert.deepEqual(
    dcAfterTurn.map((s) => s.method),
    ['tools/call', 'server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'tools/call'],
  );
  assert.equal(dcAfterTurn[0].status, 400);
});

// --- Criterion 5, modern: a 404 with -32601 -----------------------------------------

test('criterion 5: a modern 404 with -32601 is the method unknown — no initialize, no second probe, thrown', () => {
  assert.equal(PROMPT_404.error?.message, 'MCP prompt error: 404 Not Found');
  assert.equal(discoversAfter404, discoversBefore404, 'the 404 made the client probe again');
  assert.equal(count(SOCRATA_SEEN, 'initialize'), 0);
  assert.equal(SOCRATA_SEEN.filter((s) => s.method === 'prompts/get' && s.status === 404).length, 1, 'the unknown method was sent more than once');
});

// --- Criterion 5 and D7: a 401 ----------------------------------------------------------

test('D7: a 401 to the probe is reported as authentication, classified unavailable, with no initialize', () => {
  assert.ok(BOSTON_DIRECT.error, 'the call against a 401 source resolved');
  assert.match(BOSTON_DIRECT.error!.message, /authentication/i, `the error does not name authentication: ${BOSTON_DIRECT.error!.message}`);
  assert.equal(classifyStreamError(BOSTON_DIRECT.error), 'mcp_unavailable');
  assert.equal(BOSTON_INSTRUCTIONS.value, null);
  assert.equal(count(bostonSeen, 'initialize'), 0, 'a 401 was read as an era and the client fell back to initialize');
});

test('D7: no era is cached for a 401 origin — every contact probes again', () => {
  assert.ok(bostonSeen.length >= 3, 'premise: the source was contacted three times');
  assert.ok(bostonSeen.every((s) => s.method === 'server/discover'), `the 401 source saw ${bostonSeen.map((s) => s.method).join(', ')}`);
});

test('D7: through the real loop, the 401 is recorded as a failed call of kind unavailable', () => {
  const call = (LOOP?.tools_called ?? []).find((c) => c.name === 'ckan__search_datasets');
  assert.ok(call, 'the loop recorded no ckan__ call');
  assert.equal(call!.failed, true);
  assert.equal(call!.failureKind, 'unavailable');
});
