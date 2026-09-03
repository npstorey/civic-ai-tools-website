// P3 red instrument, Wave N9 (#384), family F5: a rejected call is a rejected
// call everywhere the record is read — the wire, the publish body, the
// package, and the type each of those readers is written against.
//
// WHAT WAS MEASURED AT d81eb76, and where the premise moved. The anchor's
// census says the failure is "dropped across six declarations". At the base
// that is true of the TYPES and only partly true of the BYTES:
//
//   - `queryWithMcpStreaming` hands `onComplete` the loop's own
//     `ToolCallRecord[]` as `tools_called` (openrouter-streaming.ts:321,
//     :336, :347), `/api/compare-stream` writes that object onto the `complete`
//     event unchanged (compare-stream/route.ts:193), the client stores it
//     unchanged (useStreamingComparison.ts:533), the publish dialog posts it
//     unchanged (PublishEvidenceDialog.tsx:194) and the publish route hands
//     it to the packager unchanged (evidence/route.ts:285). On the chat-flow
//     path the failure therefore travels, as bytes, all the way to the
//     packager — and dies there, in the eight-key mapping (packager.ts:395)
//     and again in produce-core 0.3.0's re-emission.
//   - On the notebook path it dies earlier, at three field-picking sites:
//     the route's `phase_a_tool_call` emission (query-notebook/route.ts:412),
//     the hook's `phase_a_tool_call` case (useNotebookStream.ts:159) and the
//     publish props (NotebookOutput.tsx:207).
//   - Every declaration in between — `CompleteEvent.data.tools_called`
//     (streaming.ts:50), the client `ToolCall` (useStreamingComparison.ts:13),
//     the `phase_a_tool_call` event (query-notebook/route.ts:59), the publish
//     route's `PublishRequest.toolCalls` (evidence/route.ts:74), the packager's
//     `ToolCallInput` (packager.ts:102) and `EvidencePackage.queries`
//     (packager.ts:266), the hook's `CapturedToolCall` (useNotebookStream.ts:25)
//     — omits the two keys, so no consumer written against any of them can
//     read `failed` and compile, and a mapping that drops it type-checks.
//
// So this file carries three instruments:
//
//   1. THE WIRE, driven: the real loop through the scripted endpoint with one
//      call the source rejects. The first case is GREEN at the base and pins
//      the corrected premise — the `complete` event's `tools_called[i]` already
//      carries `failed: true` and a `failureKind`. The second is RED: the same
//      event, SSE-encoded exactly as the route encodes it and decoded exactly
//      as the client decodes it, handed to the packager as the publish route
//      hands it, yields a `queries[]` entry that no longer says the call failed.
//   2. THE DECLARATIONS, read as source: each of the sites above names both
//      keys — inline, or by being typed as a carrier that names them
//      (`ToolCallRecord`, `PhaseAToolCall`, `ToolCallInput`, `EnvelopeQuery`).
//      RED at the base on every site. This is the type-level check the route
//      handlers, which `node --test` cannot invoke, get instead of a call.
//   3. THE INSTALLED produce-core: its `EnvelopeQuery` names both keys. RED at
//      0.3.0; green once the pin moves to 0.4.0. It pins the bump to the
//      property the bump exists for.
//
// BLIND SPOTS, stated. Instrument 2 is a source scan: it can see a site that
// is retyped to a carrier it does not know by name, and would call that red;
// add the carrier here. It cannot see a runtime mapping that names both keys
// and still writes `undefined` — instrument 1 and packager.failed-call.test.ts
// hold that end. No live endpoint, no credential, no MCP server, no database;
// every key value is an obviously fake fixture and every address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/rejected-call-carried.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { queryWithMcpStreaming, type CompletionResult } from './openrouter-streaming.ts';
import { encodeSSE, type CompleteEvent } from './streaming.ts';
import { startScriptedModelServer } from './model-loop/test-harness.ts';
import { carriedModelIdentity } from './model-catalog.ts';
import { _resetDefaultModelClientForTests } from './model-client.ts';
import { buildEvidencePackage, type EvidencePackage, type PackageInput, type ToolCallInput } from './evidence/packager.ts';
import { REFERENCE_IDENTITY_ENV } from './evidence/reference-identity-fixture.ts';

// --- Fixtures ---------------------------------------------------------------

const FIXTURE_KEY = 'not-a-real-key-p3-rejected-call-fixture';
const PORTAL = 'data.cityofnewyork.us';
const PROMPT = 'How many noise complaints were filed in Queens last year?';
const SYSTEM = 'You are a fixture system prompt.';
const REAL_ANSWER = 'The portal recorded 4,812 noise complaints in Queens (dataset abcd-1234).';
const ONE_ROW = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });
const ANSWERED_DATASET = 'abcd-1234';
const REJECTED_DATASET = 'efgh-5678';
/** Classified `mcp_timeout` by `classifyStreamError`, so the loop records `failureKind: 'timeout'`. */
const TIMEOUT_TEXT = 'MCP tool "get_data" timed out after 45s';

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL'];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetDefaultModelClientForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetDefaultModelClientForTests();
});

/**
 * One run: the model asks for two `get_data` calls in one turn, the transport
 * answers the first and rejects the second the way an unresponsive source
 * does, and the model answers. What comes back is what `onComplete` was
 * handed — the object `/api/compare-stream` writes onto the `complete` event.
 */
async function runWithOneRejectedCall(): Promise<CompletionResult> {
  const { server, url } = await startScriptedModelServer([
    {
      toolCalls: [
        { id: 'call_1', name: 'get_data', args: { type: 'query', dataset_id: ANSWERED_DATASET, select: 'count(*)' } },
        { id: 'call_2', name: 'get_data', args: { type: 'query', dataset_id: REJECTED_DATASET, select: 'count(*)' } },
      ],
    },
    { content: REAL_ANSWER },
  ]);
  try {
    process.env.OPENROUTER_API_KEY = FIXTURE_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    let completion: CompletionResult | undefined;
    await queryWithMcpStreaming(
      PROMPT,
      carriedModelIdentity('fake/model'),
      [],
      async (_name, args) => {
        if (args.dataset_id === REJECTED_DATASET) throw new Error(TIMEOUT_TEXT);
        return ONE_ROW;
      },
      SYSTEM,
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, result) => { completion = result; },
        onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
      },
      undefined,
      { portal: PORTAL, toolTimeoutMs: 45_000 },
    );
    assert.ok(completion, 'onComplete must fire');
    return completion!;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** `encodeSSE` → the bytes on the wire → `JSON.parse`, as `sse-client.ts` reads a frame. */
function throughTheWire(completion: CompletionResult): CompleteEvent {
  const frame = encodeSSE({ type: 'complete', panel: 'withMcp', data: completion });
  assert.ok(frame.startsWith('data: ') && frame.endsWith('\n\n'), 'one SSE frame');
  return JSON.parse(frame.slice('data: '.length).trimEnd()) as CompleteEvent;
}

/** The publish route's `PackageInput`, with the posted `toolCalls` as the client posts them. */
function publishInput(toolCalls: ToolCallInput[]): PackageInput {
  return {
    trace: { resourceSpans: [] },
    prompt: PROMPT,
    output: REAL_ANSWER,
    toolCalls,
    model: 'fake/model',
    portal: PORTAL,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'Test',
    summary: 'Test summary.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  };
}

type QueryEntry = EvidencePackage['queries'][number] & { failed?: boolean; failureKind?: string };

// --- 1. The wire, driven ----------------------------------------------------

test('the wire: the complete event’s tools_called[i] already carries failed and failureKind (corrected premise, green at base)', async () => {
  const completion = await runWithOneRejectedCall();
  assert.equal(completion.content, REAL_ANSWER, 'one rejected call is not a failed run');
  const calls = completion.tools_called ?? [];
  assert.equal(calls.length, 2, 'both calls are on the record');
  assert.equal(calls[0].args.dataset_id, ANSWERED_DATASET);
  assert.equal(calls[0].failed, undefined, 'the answered call carries no failure key');
  assert.equal(calls[1].args.dataset_id, REJECTED_DATASET);
  assert.equal(calls[1].failed, true, 'the loop recorded the rejection on the record it hands the wire');
  assert.equal(calls[1].failureKind, 'timeout');
  assert.ok(
    !JSON.stringify(completion).includes(TIMEOUT_TEXT),
    'the raw error text never reaches the reader (#154)',
  );
});

test('the wire → the package: a call the loop rejected is a rejected call in the package the chat-flow path publishes', async () => {
  const completion = await runWithOneRejectedCall();
  const event = throughTheWire(completion);
  // The client posts this list verbatim (PublishEvidenceDialog.tsx:194) and
  // the route hands it to the packager verbatim (evidence/route.ts:285).
  const posted = event.data.tools_called as ToolCallInput[] | undefined;
  assert.ok(posted && posted.length === 2, 'the decoded frame carries both calls');
  assert.equal((posted[1] as ToolCallInput & { failed?: boolean }).failed, true, 'the bytes on the wire still say it failed');

  const { pkg } = buildEvidencePackage(publishInput(posted));
  const answered: QueryEntry = pkg.queries[0];
  const rejected: QueryEntry = pkg.queries[1];
  assert.equal(answered.datasetId, ANSWERED_DATASET);
  assert.equal(answered.failed, undefined, 'absent is absent on the call that was answered');
  assert.equal(rejected.datasetId, REJECTED_DATASET);
  assert.equal(
    rejected.failed,
    true,
    'the package lost the failure the wire carried: queries[1] reads like a call that returned nothing',
  );
  assert.equal(rejected.failureKind, 'timeout');
});

// --- 2. The declarations, read as source -----------------------------------

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** Take the first match's first capture group, or fail naming the site. */
function extract(site: string, source: string, pattern: RegExp): string {
  const m = source.match(pattern);
  assert.ok(m, `${site}: the declaration this instrument reads is no longer where it was — re-anchor the pattern`);
  return m[1] ?? m[0];
}

const namesBothKeys = (text: string): boolean => /\bfailed\b/.test(text) && /\bfailureKind\b/.test(text);

/**
 * The types a site may be retyped to instead of naming the keys inline. Each
 * is verified itself, so "typed as a carrier" is only a pass when the
 * carrier carries.
 */
const CARRIERS: Record<string, () => string> = {
  ToolCallRecord: () => extract('ToolCallRecord', sourceOf('./model-loop/run-tool-loop.ts'), /export interface ToolCallRecord \{([\s\S]*?)\n\}/),
  PhaseAToolCall: () => extract('PhaseAToolCall', sourceOf('./notebook-author/tool-to-cell.ts'), /export interface PhaseAToolCall \{([\s\S]*?)\n\}/),
  ToolCallInput: () => extract('ToolCallInput', sourceOf('./evidence/packager.ts'), /export interface ToolCallInput \{([\s\S]*?)\n\}/),
  EnvelopeQuery: () => extract('EnvelopeQuery', sourceOf('../../node_modules/@typedstandards/produce-core/dist/envelope.d.ts'), /export interface EnvelopeQuery \{([\s\S]*?)\n\}/),
};

function carriesTheFailure(site: string, block: string): void {
  if (namesBothKeys(block)) return;
  const carrier = Object.keys(CARRIERS).find((name) => new RegExp(`\\b${name}\\b`).test(block));
  if (carrier) {
    assert.ok(
      namesBothKeys(CARRIERS[carrier]()),
      `${site} is typed as ${carrier}, and ${carrier} does not name failed/failureKind`,
    );
    return;
  }
  assert.fail(
    `${site} drops the failure: it names neither \`failed\` nor \`failureKind\` and is not typed as a ` +
      `carrier that does. A reader written against it cannot say a rejected call was rejected.\n${block.trim()}`,
  );
}

const DECLARATIONS: { site: string; block: () => string }[] = [
  {
    site: 'streaming.ts CompleteEvent.data.tools_called[] (the SSE complete event)',
    // The declaration through its closing `[];` — one line or many.
    block: () => extract('CompleteEvent', sourceOf('./streaming.ts'), /interface CompleteEvent[\s\S]*?tools_called\?:\s*([\s\S]*?\[\];)/),
  },
  {
    site: 'useStreamingComparison.ts ToolCall (the client’s record, posted to /api/records)',
    block: () => extract('ToolCall', sourceOf('./../hooks/useStreamingComparison.ts'), /export interface ToolCall \{([\s\S]*?)\n\}/),
  },
  {
    site: 'query-notebook/route.ts phase_a_tool_call (the notebook stream’s event type)',
    block: () => extract('phase_a_tool_call type', sourceOf('./../app/api/query-notebook/route.ts'), /(\{ type: 'phase_a_tool_call';[^\n]*\})/),
  },
  {
    site: 'query-notebook/route.ts phase_a_tool_call emission (the fields the route copies onto it)',
    block: () => extract('phase_a_tool_call emit', sourceOf('./../app/api/query-notebook/route.ts'), /void emit\(\{\s*type: 'phase_a_tool_call',([\s\S]*?)\}\);/),
  },
  {
    site: 'evidence/route.ts PublishRequest.toolCalls[] (the publish body)',
    block: () => extract('PublishRequest.toolCalls', sourceOf('./../app/api/evidence/route.ts'), /\n  toolCalls: ([^\n]*(?:\n(?!  \w)[^\n]*)*)/),
  },
  {
    site: 'packager.ts ToolCallInput (the packager’s input)',
    block: () => CARRIERS.ToolCallInput(),
  },
  {
    site: 'packager.ts EvidencePackage.queries[] (the envelope entry the pages render)',
    block: () => extract('EvidencePackage.queries', sourceOf('./evidence/packager.ts'), /\n  queries: ([^\n]*(?:\n(?!  \w)[^\n]*)*)/),
  },
  {
    site: 'useNotebookStream.ts CapturedToolCall (the notebook client’s record)',
    block: () => extract('CapturedToolCall', sourceOf('./../hooks/useNotebookStream.ts'), /export interface CapturedToolCall \{([\s\S]*?)\n\}/),
  },
  {
    site: 'useNotebookStream.ts phase_a_tool_call case (the fields the hook keeps)',
    block: () => extract('phase_a_tool_call case', sourceOf('./../hooks/useNotebookStream.ts'), /case 'phase_a_tool_call': \{([\s\S]*?)break;/),
  },
  {
    site: 'NotebookOutput.tsx toolCalls prop (the fields the notebook page hands the publish dialog)',
    block: () => extract('NotebookOutput toolCalls', sourceOf('./../components/notebook/NotebookOutput.tsx'), /toolCalls=\{state\.toolCalls\.map\(\(tc\) => \(\{([\s\S]*?)\}\)\)\}/),
  },
];

for (const { site, block } of DECLARATIONS) {
  test(`declared: ${site} names failed and failureKind`, () => {
    carriesTheFailure(site, block());
  });
}

// --- 3. The installed produce-core -----------------------------------------

test('the installed @typedstandards/produce-core types EnvelopeQuery with failed and failureKind (the pin bump)', () => {
  const pkgJson = JSON.parse(sourceOf('../../node_modules/@typedstandards/produce-core/package.json')) as { version: string };
  const entry = CARRIERS.EnvelopeQuery();
  assert.ok(
    namesBothKeys(entry),
    `@typedstandards/produce-core@${pkgJson.version} is installed and its EnvelopeQuery names neither key; ` +
      `its buildEnvelope re-emits a fixed key list, so the packager cannot carry the failure through it.\n${entry.trim()}`,
  );
});
