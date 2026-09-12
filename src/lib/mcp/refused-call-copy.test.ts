// Ruling R6 (the owner's, 2026-09-11; Wave N11 P3, criterion A6): what the
// model is told when a data source REFUSED a call.
//
// When the source answered with the failure — a JSON-RPC `error` envelope, or a
// result carrying `isError: true` — and it classifies as nothing more specific,
// the model receives ONE fixed string: the anti-fabrication preamble kept; that
// the source received the request and refused it as made; not to send it again
// unchanged; to make a differently formed request if one could answer, or else
// tell the user plainly. No word of the source's message, no tool name, nothing
// interpolated, and nothing that tells the model to retry. A failure that
// classifies as timeout, unavailable or not-configured keeps its own copy, and
// #154's rule — no raw error text on the model channel — is unchanged.
//
// WHAT IS DRIVEN. One run through the REAL client (`callMcpTool`) and the REAL
// loop (`queryWithMcpStreaming`); the scripted model endpoint's `requests[]` is
// the model channel, read off the wire. Four calls:
//   c1 — the hosted data source's own portal-less refusal, byte for byte:
//        socrata-mcp-server `c07978a`, `resolvePortalDomain`
//        (`src/utils/portal-config.ts:50-57`) with `GET_DATA_NAMES_A_PORTAL`
//        (`src/tools/socrata-tools.ts:33`), thrown as a `McpError` that keeps
//        the message unprefixed, code -32602, framed as SSE as the SDK sends it;
//   c2 — a third-party result carrying `isError: true` and a distinctive
//        marker, on a DIFFERENT tool (`fetch`), so the fixed string is shown
//        independent of the tool, the message and the shape at once;
//   c3, c4 — JSON-RPC errors the source worded "timed out" and "unavailable":
//        answered by the source, and classified as something more specific.
//
// THE RETRY PATTERN. The rider says the words "try again" must not appear, and
// a literal "try again" check PASSES on the copy this replaces ("Suggest
// try-ing again") — a criterion that cannot fail on the one shape it is for.
// So the pattern matches the inflected forms.
//
// RED at f32b679: c1 is told "…Suggest trying again."; c2's marker reaches the
// model verbatim with no preamble, and c2 is recorded as answered; the two
// reach the model as different strings; the fixed string is not exported.
// GREEN at f32b679, pinned: the send counts, c1's recorded kind, and the three
// specific copies and the not-a-source-answer copy, each byte-identical to base.
//
// BLIND SPOT. Whether a model OBEYS the copy is not measured here; what it is
// sent is. The not-configured kind is shown through the function, not driven:
// it is this instance's own configuration failure, raised before any request
// leaves (`routeTool`), so no source can answer it.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/refused-call-copy.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CompletionResult } from '../openrouter-streaming.ts';

const PORTAL = 'data.example.org';
const FETCH_ID = 'record:data.example.org:mnop-2468:7';
const TIMEOUT_DATASET = 'tttt-1111';
const UNAVAILABLE_DATASET = 'uuuu-2222';

const SERVER_REFUSAL =
  'This call names no portal, and this server has no default portal configured, so it will not choose one on your behalf. ' +
  'Pass "domain" with the host of the Socrata portal to query, then call again. ' +
  '(An operator can set a default portal with DATA_PORTAL_URL.)';
const ISERROR_MARKER = 'Refusal-marker-QV7: this source does not publish the requested table.';
const TIMEOUT_WORDS = 'The upstream query timed out before completing.';
const UNAVAILABLE_WORDS = 'The dataset service is temporarily unavailable.';

/** Distinctive substrings of the four server messages; none may reach the model. */
const SERVER_WORDS = [
  'will not choose one on your behalf',
  'DATA_PORTAL_URL',
  'then call again',
  'Refusal-marker-QV7',
  'does not publish the requested table',
  'upstream query',
  'dataset service',
];
const RETRY = /\btr(y|ying|ies|ied) again\b|\bretry/i;
const PREAMBLE = 'Do not estimate, guess, or fabricate';
const ANSWER = 'None of the requests returned data, so no figure can be given.';

/** The copy at f32b679 for the three specific kinds and for a failure no source answered — R6 moves none of them. */
const TAIL =
  ' In your answer, briefly tell the user in plain language that the live data could not be retrieved, and do not include any raw error text, status codes, server names, or system details.';
const HEAD = 'This data request returned no data. Do not estimate, guess, or fabricate any values to fill the gap. ';
const BASE_TIMEOUT_COPY = `${HEAD}The live data source did not respond in time and the request timed out. Suggest trying again or narrowing the query (for example, adding a date range).${TAIL}`;
const BASE_UNAVAILABLE_COPY = `${HEAD}The live data source is temporarily unavailable. Suggest trying again shortly.${TAIL}`;
const BASE_NOT_CONFIGURED_COPY = `${HEAD}This server has no live data source configured, so no data can be retrieved. Suggest contacting whoever operates this instance.${TAIL}`;
const BASE_NOT_A_SOURCE_ANSWER_COPY = `${HEAD}The request could not be completed. Suggest trying again.${TAIL}`;

// --- The scripted MCP server --------------------------------------------------

const received = new Map<string, number>();
const keyOf = (args: Record<string, unknown>): string => String(args.dataset_id ?? args.id ?? args.type);

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? JSON.parse(body) : {};
  if (msg.id === undefined) {
    res.writeHead(202);
    res.end();
    return;
  }
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'p3-refusal-copy-session' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3-refusal-copy-stub', version: '0' } } }));
    return;
  }
  const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
  const key = keyOf(args);
  received.set(key, (received.get(key) ?? 0) + 1);
  const payload =
    key === FETCH_ID ? { result: { content: [{ type: 'text', text: ISERROR_MARKER }], isError: true } }
    : key === TIMEOUT_DATASET ? { error: { code: -32001, message: TIMEOUT_WORDS } }
    : key === UNAVAILABLE_DATASET ? { error: { code: -32603, message: UNAVAILABLE_WORDS } }
    : { error: { code: -32602, message: SERVER_REFUSAL } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();

for (const k of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL', 'SITE_DEFAULT_PORTAL']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;

const { callMcpTool } = await import('./client.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { carriedModelIdentity } = await import('../model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('../model-client.ts');
const streaming = await import('../streaming.ts');

// --- One run --------------------------------------------------------------------

interface Run {
  completion: CompletionResult;
  requests: Record<string, unknown>[];
}

async function run(): Promise<Run> {
  const { server, url, requests } = await startScriptedModelServer([
    {
      toolCalls: [
        // No run-level portal is passed below, so the loop injects none and this call names none.
        { id: 'c1', name: 'get_data', args: { type: 'catalog', query: 'noise complaints' } },
        { id: 'c2', name: 'fetch', args: { id: FETCH_ID } },
        { id: 'c3', name: 'get_data', args: { type: 'query', dataset_id: TIMEOUT_DATASET, select: 'count(*)', portal: PORTAL } },
        { id: 'c4', name: 'get_data', args: { type: 'query', dataset_id: UNAVAILABLE_DATASET, select: 'count(*)', portal: PORTAL } },
      ],
    },
    { content: ANSWER },
  ]);
  try {
    process.env.OPENROUTER_API_KEY = 'placeholder-model-key-p3-refusal-copy';
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();
    let completion: CompletionResult | undefined;
    await queryWithMcpStreaming(
      'How many noise complaints were filed last year?',
      carriedModelIdentity('fake/model'),
      [],
      callMcpTool,
      'You are a fixture system prompt.',
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, result) => { completion = result; },
        onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
      },
      undefined,
      { toolTimeoutMs: 10_000 },
    );
    assert.ok(completion, 'onComplete must fire');
    return { completion: completion!, requests };
  } finally {
    _resetDefaultModelClientForTests();
    await new Promise((resolve) => server.close(resolve));
  }
}

const RUN = await run();

/** The tool message the model was sent for one call — read off the wire, not inferred. */
function toolMessage(callId: string): string {
  const messages = (RUN.requests.at(-1)?.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: unknown }>;
  const m = messages.find((x) => x.role === 'tool' && x.tool_call_id === callId);
  assert.ok(m, `the model was never sent a tool message for ${callId}`);
  return typeof m!.content === 'string' ? m!.content : JSON.stringify(m!.content);
}

function recordOf(callIndex: number) {
  const record = (RUN.completion.tools_called ?? [])[callIndex];
  assert.ok(record, `no recorded call at ${callIndex}`);
  return record!;
}

// --- Premise, green at base -----------------------------------------------------

test('premise: every call went out once, and the server’s refusal classifies as nothing more specific', () => {
  assert.equal(RUN.completion.content, ANSWER);
  for (const key of ['catalog', FETCH_ID, TIMEOUT_DATASET, UNAVAILABLE_DATASET]) {
    assert.equal(received.get(key), 1, `${key} was sent ${received.get(key) ?? 0} times`);
  }
  assert.equal(streaming.classifyStreamError(new Error(SERVER_REFUSAL)), 'generic');
});

// --- The refusal copy ---------------------------------------------------------------

test('A6: both refusals — the JSON-RPC one and the isError one — reach the model as one fixed string', () => {
  const fixed = (streaming as Record<string, unknown>).SOURCE_REFUSAL_FOR_LLM;
  assert.equal(typeof fixed, 'string', 'streaming.ts exports no SOURCE_REFUSAL_FOR_LLM: there is no one refusal string');
  assert.equal(toolMessage('c1'), fixed, `the JSON-RPC refusal reached the model as:\n${toolMessage('c1')}`);
  assert.equal(toolMessage('c2'), fixed, `the isError refusal reached the model as:\n${toolMessage('c2')}`);
});

for (const [shape, callId] of [['JSON-RPC refusal', 'c1'], ['isError result', 'c2']] as const) {
  test(`A6 (${shape}): the copy keeps the anti-fabrication preamble and the no-raw-detail rule, and says nothing that reads as retry`, () => {
    const text = toolMessage(callId);
    assert.ok(text.includes(PREAMBLE), `the ${shape} reached the model without the anti-fabrication preamble:\n${text}`);
    assert.match(text, /do not include any raw error text/, `the ${shape} copy drops #154's rule:\n${text}`);
    assert.doesNotMatch(text, RETRY, `the ${shape} tells the model to retry:\n${text}`);
  });
}

test('A6: no distinctive word of any server message reaches any request the model received', () => {
  const channel = JSON.stringify(RUN.requests);
  const leaked = SERVER_WORDS.filter((w) => channel.includes(w));
  assert.deepEqual(leaked, [], `server words in the model channel: ${leaked.join(' | ')}`);
});

test('A6: both refused calls are recorded as rejected, kind unknown — R6 moves no recorded kind', () => {
  for (const [i, shape] of [[0, 'JSON-RPC refusal'], [1, 'isError result']] as const) {
    const record = recordOf(i);
    assert.equal(record.failed, true, `the ${shape} was recorded as ANSWERED`);
    assert.equal(record.failureKind, 'unknown');
  }
});

// --- What R6 does not move -------------------------------------------------------------

test('A6: a refusal the source worded "timed out" or "unavailable" keeps its own copy, byte-identical to base', () => {
  assert.equal(recordOf(2).failureKind, 'timeout');
  assert.equal(toolMessage('c3'), BASE_TIMEOUT_COPY);
  assert.equal(recordOf(3).failureKind, 'unavailable');
  assert.equal(toolMessage('c4'), BASE_UNAVAILABLE_COPY);
});

test('A6: the not-configured kind keeps its own copy, byte-identical to base', () => {
  assert.equal(streaming.describeToolFailureForLlm('get_data', { code: 'mcp_not_configured' }), BASE_NOT_CONFIGURED_COPY);
});

test('scope: a failure no source answered — nothing refused it — keeps the copy it had, byte-identical to base', () => {
  // R6 covers what a source ANSWERED with. A request that failed on this side
  // (arguments that never parsed, a body that never parsed, a thrown error) was
  // not refused by anyone, and "the source refused it" would be false of it.
  assert.equal(streaming.describeToolFailureForLlm('get_data', new Error('obscure non-mcp failure')), BASE_NOT_A_SOURCE_ANSWER_COPY);
});
