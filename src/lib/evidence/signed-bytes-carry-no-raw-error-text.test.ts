// P1 red instrument, Wave N10 (#409, #404) — criterion 3.
//
// THE PROPERTY: no signed trace carries `error.message`. When a source
// rejects a call, the span records the CLASSIFIED kind the loop already
// computed — one of the four closed `ToolFailureKind` values — and nothing
// else. A rejection's raw text is written by the source, not by this app: it
// can name a host, a port, a query fragment or a stack frame, and once it is
// on a span it is inside the bytes this instance signs.
//
// WHAT WAS MEASURED AT c517ba9 (by the ORCH, 2026-09-04, before this file):
//
//   The catch site is `run-tool-loop.ts:870-877`. It computes
//   `failureKind = toolFailureKindOf(error)` at `:870`, writes it to the
//   record at `:871-872`, and then ends the span at `:874-877` with
//
//       { 'error': true, 'error.message': error instanceof Error ? error.message : 'Unknown error' }
//
//   so the classified value it just computed is NOT on the span and the raw
//   text IS. Repo-wide, `git grep -n "'error.message'"` returns exactly two
//   lines: that producer (`:876`) and one fixture
//   (`graph-states-what-the-span-carried.test.ts:223`). No consumer reads
//   `error.message` off a span — which is the point: the text is carried,
//   signed, and never used.
//
//   `packager.ts:534` assigns `trace: input.trace` — the trace goes INLINE
//   into the package. That is what makes this criterion able to fail rather
//   than vacuous, and it is why the fixture below passes an inline trace
//   object rather than a BlobRef: a publisher shipping trace-as-BlobRef puts
//   the same raw text in the blob instead, where this assertion could not see
//   it. The shape that could fail is the shape driven here.
//
// THE FIXTURE NAMES THE SHAPE THAT COULD FAIL (Wave N9's finding). The run
// below rejects one call with a message that NAMES A HOST. A rejection
// message with no host in it would let every assertion here pass while the
// raw text still travelled — the same trap P6 fell into when it put the
// rejected call on the dataset that had already succeeded. `guard` below
// asserts the fixture actually has the shape that can fail, and it is green
// at the base; the three assertions after it are red at the base.
//
// EXPECTED AT c517ba9: `guard` passes; `no raw message`, `classified kind`
// and `no host in the package` all fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryWithMcpStreaming, type CompletionResult } from '../openrouter-streaming.ts';
import { carriedModelIdentity } from '../model-catalog.ts';
import { _resetDefaultModelClientForTests } from '../model-client.ts';
import { startScriptedModelServer } from '../model-loop/test-harness.ts';
import type { ToolCallRecord } from '../model-loop/run-tool-loop.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { sourceIdForToolName } from '../mcp/operation-types.ts';
import { mcpTools } from '../mcp/tools.ts';
import { buildEvidencePackage, type ToolCallInput } from './packager.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// --- Fixtures ---------------------------------------------------------------

const PLACEHOLDER_KEY = 'placeholder-model-key-for-tests';
const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = 'erm2-nwe9';
const REJECTED = 'efgh-5678';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'About 412,000 noise complaints were filed.';

/**
 * The host the rejection names. `.example` is reserved (RFC 2606) and names
 * no deployment. This string is the whole point of the fixture: it is written
 * by the source, it is in the `Error` the transport throws, and it must not
 * appear anywhere in the signed package.
 */
const REJECTION_HOST = 'mcp-gateway.internal.example';

/**
 * Classified `mcp_timeout` by `classifyStreamError`, so the loop records
 * `failureKind: 'timeout'` — AND it names a host, a port and an upstream
 * path. Every one of those is text this app did not author.
 */
const REJECTION_TEXT =
  `MCP tool "get_data" timed out after 45s ` +
  `(upstream ${REJECTION_HOST}:8443/v1/query did not respond)`;

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

interface Run {
  completion: CompletionResult;
  trace: Record<string, unknown>;
}

const ENV_KEYS = ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL'] as const;

/**
 * Two calls in one turn: the transport answers the first and rejects the
 * second the way an unresponsive source does. The rejected call is on a
 * DATASET NOTHING ELSE TOUCHED (`REJECTED` ≠ `ANSWERED`) — the second shape
 * this wave exists for, and the one P6's fixture lacked.
 */
async function run(): Promise<Run> {
  const { server, url } = await startScriptedModelServer([
    {
      toolCalls: [
        { id: 'c1', name: 'get_data', args: { type: 'query', dataset_id: ANSWERED, select: 'count(*)' } },
        { id: 'c2', name: 'get_data', args: { type: 'query', dataset_id: REJECTED, select: 'count(*)', where: "borough='QUEENS'" } },
      ],
    },
    { content: ANSWER },
  ]);
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    process.env.OPENROUTER_API_KEY = PLACEHOLDER_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
    builder.startRoot('analysis', { 'analysis.portal': PORTAL });
    let completion: CompletionResult | undefined;
    await queryWithMcpStreaming(
      QUESTION,
      carriedModelIdentity('fake/model'),
      mcpTools,
      async (name, args) => {
        if (name === 'get_data' && args.dataset_id === ANSWERED) return '[{"count":"412093"}]';
        throw new Error(REJECTION_TEXT);
      },
      'fixture system prompt',
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, result) => { completion = result; },
        onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
      },
      { builder, parentSpanId: builder.rootSpanId, resolveToolSource: sourceIdForToolName },
      { portal: PORTAL, toolTimeoutMs: 45_000 },
    );
    builder.endRoot();
    assert.ok(completion, 'onComplete must fire');
    return { completion: completion!, trace: builder.finalize() as unknown as Record<string, unknown> };
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    _resetDefaultModelClientForTests();
    await new Promise((resolve) => server.close(resolve));
  }
}

const RUN = await run();
const TOOLS: ToolCallRecord[] = RUN.completion.tools_called ?? [];

// --- Reading the trace ------------------------------------------------------

interface OTelAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean };
}
interface OTelSpan {
  name: string;
  attributes: OTelAttribute[];
}

/** Every span in the finalized trace, in document order. */
function spans(trace: Record<string, unknown>): OTelSpan[] {
  const resourceSpans = (trace.resourceSpans ?? []) as Array<{
    scopeSpans?: Array<{ spans?: OTelSpan[] }>;
  }>;
  return resourceSpans.flatMap((rs) => (rs.scopeSpans ?? []).flatMap((ss) => ss.spans ?? []));
}

/** The one attribute of `span` with this key, or undefined. */
function attr(span: OTelSpan, key: string): OTelAttribute | undefined {
  return (span.attributes ?? []).find((a) => a.key === key);
}

/** The tool-call span the loop ended with `error: true`. */
function rejectedSpan(): OTelSpan {
  const found = spans(RUN.trace).filter((s) => attr(s, 'error')?.value.boolValue === true);
  assert.equal(found.length, 1, `expected exactly one span ended with error: true, got ${found.length}`);
  return found[0];
}

// --- The guard: the fixture has the shape that could fail --------------------

test('guard: the run rejected one call, on a dataset nothing else touched, with a message that names a host', () => {
  assert.equal(TOOLS.length, 2, 'the run shape: two calls on the record');
  assert.equal(TOOLS[0].failed, undefined, 'absent is absent: the answered call carries no failure key');
  assert.equal(TOOLS[1].failed, true, 'the loop recorded the second call as rejected (green since N9 P3)');
  assert.equal(TOOLS[1].failureKind, 'timeout', 'the loop classified it');
  assert.notEqual(REJECTED, ANSWERED, 'the rejected call is on a dataset nothing else touched');

  assert.ok(
    REJECTION_TEXT.includes(REJECTION_HOST),
    'the fixture is pointless unless the rejection message names a host',
  );
  assert.equal(
    typeof RUN.trace.resourceSpans,
    'object',
    'the trace is an inline object, not a BlobRef — a BlobRef would put the raw text where these assertions cannot see it',
  );
  assert.ok(spans(RUN.trace).length > 0, 'the finalized trace carries spans to assert over');
});

// --- Red at c517ba9 ---------------------------------------------------------

test('no signed trace carries error.message', () => {
  const carrying = spans(RUN.trace).filter((s) => attr(s, 'error.message') !== undefined);
  assert.deepEqual(
    carrying.map((s) => s.name),
    [],
    `spans carry the source's raw rejection text: ${JSON.stringify(
      carrying.map((s) => ({ span: s.name, value: attr(s, 'error.message')?.value })),
    )} — run-tool-loop.ts:874-877 writes error.message onto the span it just classified`,
  );
});

test('the span carries the classified kind the record carries', () => {
  const span = rejectedSpan();
  const kind = attr(span, 'error.kind');
  assert.notEqual(
    kind,
    undefined,
    `the span ended with error: true carries no error.kind; its attributes are ${JSON.stringify(
      span.attributes.map((a) => a.key),
    )} — the loop computed failureKind at run-tool-loop.ts:870 and did not put it on the span`,
  );
  assert.equal(
    kind?.value.stringValue,
    TOOLS[1].failureKind,
    'the span states the same kind the record states — D5 (A) names this attribute error.kind for both repositories',
  );
});

test('a rejection message that names a host puts no host in the signed package', () => {
  const { pkg } = buildEvidencePackage({
    trace: RUN.trace,
    prompt: QUESTION,
    output: ANSWER,
    toolCalls: TOOLS as unknown as ToolCallInput[],
    model: 'fake/model',
    portal: PORTAL,
    tokenUsage: { promptTokens: 40, completionTokens: 10 },
    promptVisibility: 'full_text',
    title: 'Noise complaints',
    summary: ANSWER,
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  });
  const bytes = JSON.stringify(pkg);

  assert.ok(
    bytes.includes(REJECTED),
    'control: the rejected call IS in the package (queries[]) — otherwise the assertion below is vacuous',
  );
  assert.equal(
    bytes.includes(REJECTION_HOST),
    false,
    `the signed package names ${REJECTION_HOST}, a host this app never authored — it reached the bytes ` +
      'through the span attribute run-tool-loop.ts:876 writes',
  );
});
