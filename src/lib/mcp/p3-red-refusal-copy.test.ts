// THROWAWAY red instrument — Wave N11 P3 (#434), ruling R6 (the owner's, 2026-09-11). Never merged.
//
// R6 = A. When the server ANSWERED with the failure — a JSON-RPC `error`
// envelope, or a result carrying `isError: true` — and it classifies as nothing
// more specific, the model receives ONE fixed refusal string: no interpolation,
// no instruction to retry, the anti-fabrication preamble kept, and no word of the
// server's message. The recorded kind stays `unknown`; #154's rule is unchanged.
//
// Two refusals in one run, through the REAL client and loop; the scripted model
// server's `requests[]` is the model channel:
//   c1 — the server's own portal-less refusal, byte for byte: socrata-mcp-server
//        `c07978a`, `resolvePortalDomain` (`src/utils/portal-config.ts:50-57`)
//        with `GET_DATA_NAMES_A_PORTAL` (`src/tools/socrata-tools.ts:33`), code
//        -32602, framed as SSE the way the SDK sends it;
//   c2 — a third-party result carrying `isError: true` and a distinctive marker.
//
// RED at f32b679, on today's copy for both: c1 is told "…Suggest trying again."
// — and a literal "try again" substring check PASSES on that, so the pattern
// below matches the inflected forms; c2's marker reaches the model verbatim,
// with no preamble, and the call is recorded as answered.
//
// Run with: node --test --experimental-strip-types src/lib/mcp/p3-red-refusal-copy.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CompletionResult } from '../openrouter-streaming.ts';

const PORTAL = 'data.example.org';
const ISERROR_DATASET = 'mnop-2468';
const SERVER_REFUSAL =
  'This call names no portal, and this server has no default portal configured, so it will not choose one on your behalf. ' +
  'Pass "domain" with the host of the Socrata portal to query, then call again. ' +
  '(An operator can set a default portal with DATA_PORTAL_URL.)';
const ISERROR_MARKER = 'Refusal-marker-QV7: this source does not publish the requested table.';
/** Distinctive substrings of the two server messages; none may reach the model. */
const SERVER_WORDS = [
  'will not choose one on your behalf',
  'DATA_PORTAL_URL',
  'then call again',
  'Refusal-marker-QV7',
  'does not publish the requested table',
];
const RETRY = /\btr(y|ying|ies|ied) again\b|\bretry/i;
const PREAMBLE = 'Do not estimate, guess, or fabricate';
const ANSWER = 'Neither request returned data, so no figure can be given.';

// --- The scripted MCP server --------------------------------------------------

const toolCallsReceived: Array<Record<string, unknown>> = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? JSON.parse(body) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'p3-red-refusal-session' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3-red-refusal-stub', version: '0' } } }));
    return;
  }
  const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
  toolCallsReceived.push(args);
  const payload = args.dataset_id === ISERROR_DATASET
    ? { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: ISERROR_MARKER }], isError: true } }
    : { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: SERVER_REFUSAL } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
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
const { classifyStreamError } = await import('../streaming.ts');

// --- One run, shared by every assertion below ----------------------------------

interface Run { completion: CompletionResult; requests: Record<string, unknown>[] }

async function run(): Promise<Run> {
  const { server, url, requests } = await startScriptedModelServer([
    {
      toolCalls: [
        // No run-level portal is passed below, so the loop injects none and this call names none.
        { id: 'c1', name: 'get_data', args: { type: 'catalog', query: 'noise complaints' } },
        { id: 'c2', name: 'get_data', args: { type: 'query', dataset_id: ISERROR_DATASET, select: 'count(*)', portal: PORTAL } },
      ],
    },
    { content: ANSWER },
  ]);
  try {
    process.env.OPENROUTER_API_KEY = 'not-a-real-key-p3-red-refusal-fixture';
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
    await new Promise((resolve) => server.close(resolve));
  }
}

let once: Promise<Run> | undefined;
const runOnce = (): Promise<Run> => (once ??= run());

/** The tool message the model was sent for one call — read off the wire, not inferred. */
function toolMessage(requests: Record<string, unknown>[], callId: string): string {
  for (let i = requests.length - 1; i >= 0; i--) {
    const messages = (requests[i].messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: unknown }>;
    const m = messages.find((x) => x.role === 'tool' && x.tool_call_id === callId);
    if (m) return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  }
  assert.fail(`the model was never sent a tool message for ${callId}`);
}

// --- Premise, green at base -----------------------------------------------------

test('premise: both calls went out once, and the server’s refusal classifies as nothing more specific', async () => {
  const { completion } = await runOnce();
  assert.equal(completion.content, ANSWER);
  assert.equal(toolCallsReceived.length, 2, `the stub received ${toolCallsReceived.length} tools/call requests for 2 calls`);
  assert.equal(classifyStreamError(new Error(SERVER_REFUSAL)), 'generic');
});

// --- The reds -------------------------------------------------------------------

for (const [shape, callId] of [['JSON-RPC refusal', 'c1'], ['isError result', 'c2']] as const) {
  test(`R6 RED (${shape}): the model is told with the anti-fabrication preamble, and not told to retry`, async () => {
    const text = toolMessage((await runOnce()).requests, callId);
    assert.ok(text.includes(PREAMBLE), `the ${shape} reached the model without the anti-fabrication preamble:\n${text}`);
    assert.doesNotMatch(text, RETRY, `the ${shape} tells the model to retry:\n${text}`);
  });

  test(`R6 (${shape}): the call is recorded as rejected, kind unknown`, async () => {
    const calls = (await runOnce()).completion.tools_called ?? [];
    const record = callId === 'c1'
      ? calls.find((c) => c.args.type === 'catalog')
      : calls.find((c) => c.args.dataset_id === ISERROR_DATASET);
    assert.ok(record, `no recorded call for ${callId}`);
    assert.equal(record!.failed, true, `the ${shape} was recorded as ANSWERED`);
    assert.equal(record!.failureKind, 'unknown');
  });
}

test('R6 RED: both refusals reach the model as the same fixed string', async () => {
  const { requests } = await runOnce();
  assert.equal(toolMessage(requests, 'c1'), toolMessage(requests, 'c2'));
});

test('R6 RED: no word of either server message reaches the model channel', async () => {
  const channel = JSON.stringify((await runOnce()).requests);
  const leaked = SERVER_WORDS.filter((w) => channel.includes(w));
  assert.deepEqual(leaked, [], `server words in the model channel: ${leaked.join(' | ')}`);
});
