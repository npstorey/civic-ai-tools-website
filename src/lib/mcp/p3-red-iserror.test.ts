// THROWAWAY red instrument — Wave N11 P3 (#434), criterion 4 (#429). Never merged.
//
// A scripted MCP server on loopback answers `tools/call` three ways: one call
// with an ordinary result, and two with a result carrying `isError: true` — the
// MCP specification's tool-level failure signal — one framed as SSE and one as
// plain JSON, because `client.ts` has a branch for each (`:351-365`, `:332-349`).
// The website's REAL client (`callMcpTool`) is the executor under the REAL loop
// (`queryWithMcpStreaming`) with a scripted model; the recorded calls go over the
// wire as the route encodes them and into the packager as the publish route hands
// them.
//
// RED at f32b679: each isError result is recorded as ANSWERED — no `failed` on
// the loop's record or on the package's `queries[]` entry, and `dataSources[]`
// mints an entry for a dataset the source refused, with an access timestamp.
//
// Fixture shape (CLAUDE.md: a criterion demonstrated on a fixture shaped so it
// cannot fail is not demonstrated): each refused call's dataset is touched by
// nothing else in the run, so `dataSources[]` cannot de-duplicate the assertion
// away; and an answered call on a third dataset shows the instrument can tell an
// answered call from a refused one. The refusal's words carry none of
// `classifyStreamError`'s matcher substrings and none of `session`, `400` or
// `parse` (the client's retry and rewrite triggers), so a green is not a kind
// guessed from prose.
//
// Run with: node --test --experimental-strip-types src/lib/mcp/p3-red-iserror.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CompletionResult } from '../openrouter-streaming.ts';
import type { CompleteEvent } from '../streaming.ts';
import type { EvidencePackage, PackageInput, ToolCallInput } from '../evidence/packager.ts';

const PORTAL = 'data.example.org';
const ANSWERED_DATASET = 'abcd-1234';
const REFUSED_SSE_DATASET = 'wxyz-9876';
const REFUSED_JSON_DATASET = 'qrst-5432';
const REFUSAL_TEXT = 'This source holds no dataset with that identifier.';
const ONE_ROW = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });
const ANSWER = 'One figure was retrieved; two requests were refused by the source.';

// --- The scripted MCP server --------------------------------------------------

const toolCallsReceived: Array<Record<string, unknown>> = [];
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? JSON.parse(body) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'p3-red-session' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3-red-stub', version: '0' } } }));
    return;
  }
  const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
  toolCallsReceived.push(args);
  if (args.dataset_id === REFUSED_JSON_DATASET) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: REFUSAL_TEXT }], isError: true } }));
    return;
  }
  const result = args.dataset_id === REFUSED_SSE_DATASET
    ? { content: [{ type: 'text', text: REFUSAL_TEXT }], isError: true }
    : { content: [{ type: 'text', text: ONE_ROW }], isError: false };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();

// The registry captures its environment at module load, so every app module is
// imported after the endpoint is set (client-unreachable.test.ts, same reason).
for (const k of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL', 'SITE_DEFAULT_PORTAL']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;

const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { callMcpTool } = await import('./client.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { carriedModelIdentity } = await import('../model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('../model-client.ts');
const { encodeSSE } = await import('../streaming.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');

// --- One run, shared by every assertion below ----------------------------------

async function run(): Promise<CompletionResult> {
  const { server, url } = await startScriptedModelServer([
    {
      toolCalls: [
        { id: 'c1', name: 'get_data', args: { type: 'query', dataset_id: ANSWERED_DATASET, select: 'count(*)', portal: PORTAL } },
        { id: 'c2', name: 'get_data', args: { type: 'query', dataset_id: REFUSED_SSE_DATASET, select: 'count(*)', portal: PORTAL } },
        { id: 'c3', name: 'get_data', args: { type: 'query', dataset_id: REFUSED_JSON_DATASET, select: 'count(*)', portal: PORTAL } },
      ],
    },
    { content: ANSWER },
  ]);
  try {
    process.env.OPENROUTER_API_KEY = 'not-a-real-key-p3-red-fixture';
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
      { portal: PORTAL, toolTimeoutMs: 10_000 },
    );
    assert.ok(completion, 'onComplete must fire');
    return completion!;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

let once: Promise<CompletionResult> | undefined;
const runOnce = (): Promise<CompletionResult> => (once ??= run());

type Recorded = NonNullable<CompletionResult['tools_called']>[number];
function recordFor(completion: CompletionResult, datasetId: string): Recorded {
  const record = (completion.tools_called ?? []).find((c) => c.args.dataset_id === datasetId);
  assert.ok(record, `no recorded call for ${datasetId}`);
  return record!;
}

type QueryEntry = EvidencePackage['queries'][number] & { failed?: boolean; failureKind?: string };

function builtPackage(completion: CompletionResult): EvidencePackage {
  // `encodeSSE` → the bytes on the wire → `JSON.parse`, as `sse-client.ts` reads a frame.
  const frame = encodeSSE({ type: 'complete', panel: 'withMcp', data: completion });
  const event = JSON.parse(frame.slice('data: '.length).trimEnd()) as CompleteEvent;
  const input: PackageInput = {
    trace: { resourceSpans: [] },
    prompt: 'How many noise complaints were filed last year?',
    output: ANSWER,
    toolCalls: (event.data.tools_called ?? []) as ToolCallInput[],
    model: 'fake/model',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'P3 red',
    summary: 'P3 red.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  };
  return buildEvidencePackage(input).pkg;
}

// --- Premises, green at base: the instrument can see what it claims to --------

test('premise: the answered call is answered, and every call went out exactly once (no session retry)', async () => {
  const completion = await runOnce();
  assert.equal(completion.content, ANSWER);
  assert.equal(recordFor(completion, ANSWERED_DATASET).failed, undefined);
  assert.equal(toolCallsReceived.length, 3, `the stub received ${toolCallsReceived.length} tools/call requests for 3 calls`);
  assert.ok(JSON.stringify(builtPackage(completion).dataSources).includes(ANSWERED_DATASET), 'the answered dataset reaches dataSources — the instrument can see an entry');
});

// --- The reds -------------------------------------------------------------------

for (const [framing, datasetId] of [['SSE', REFUSED_SSE_DATASET], ['plain-JSON', REFUSED_JSON_DATASET]] as const) {
  test(`#429 RED (${framing} branch): a result carrying isError: true is recorded on the loop's record as a rejected call`, async () => {
    const record = recordFor(await runOnce(), datasetId);
    assert.equal(record.failed, true, `the ${framing}-framed isError result was recorded as ANSWERED (failed: ${String(record.failed)})`);
    assert.equal(record.failureKind, 'unknown');
  });

  test(`#429 RED (${framing} branch): the built package's queries[] entry states the refused call as rejected`, async () => {
    const pkg = builtPackage(await runOnce());
    const entry = (pkg.queries as QueryEntry[]).find((q) => q.datasetId === datasetId);
    assert.ok(entry, `queries[] carries no entry for ${datasetId}`);
    assert.equal(entry!.failed, true, `queries[] states the ${framing}-framed isError call as answered — in signed bytes`);
    assert.equal(entry!.failureKind, 'unknown');
  });

  test(`#429 RED (${framing} branch): the built package's dataSources[] asserts no access to the refused dataset`, async () => {
    const pkg = builtPackage(await runOnce());
    assert.ok(
      !JSON.stringify(pkg.dataSources).includes(datasetId),
      `dataSources[] asserts access to ${datasetId}, a dataset the source refused:\n${JSON.stringify(pkg.dataSources, null, 1)}`,
    );
  });
}
