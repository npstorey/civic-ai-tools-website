// #413 (Wave N11 P4): a rejected call's elapsed reaches the record, the span,
// the signed package and the signed graph — measured once, by the clock the
// loop already starts.
//
// WHAT WAS WRONG, measured at 689e509. `run-tool-loop.ts` starts its clock
// OUTSIDE the `try` precisely so "the time until a rejection is measured the
// same way as the time until a result" (#384 P8). The success path records
// that elapsed on the tool-call record and ends the span with
// `tool.duration_ms`. The catch path read the same clock once, to fill the
// `tool_failed` progress event, and then threw the number away: it set
// `failed`/`failureKind` and no `duration_ms`, and ended the span with
// `error` and `error.kind` and nothing else. So a signed record could say a
// call was rejected and never say how long the source took to reject it —
// while the measurement existed, in hand, one line above.
//
// WHAT IS DRIVEN, and how far down. The REAL loop, through
// `queryWithMcpStreaming` → `runToolLoop`, against the scripted model
// endpoint (`./test-harness.ts`) and a real `TraceBuilder`, and then through
// `buildEvidencePackage` the way the publish route hands it: the run's own
// trace inline, the run's own recorded calls as `toolCalls`. Every assertion
// below reads the STORED bytes — `JSON.parse(JSON.stringify(pkg))`, the way
// storage round-trips a package — not a builder's return value. Four
// surfaces, because #413's criterion is read from the record and not from the
// span:
//   A1 the loop's own record          A2 the trace span
//   A3 the stored `queries[]` entry   A4 the stored PROV-O activity
// A4 is the one that could not be reached by asserting over the producer: the
// harness emits `civic:durationMs` from `tool.duration_ms`
// (`capture/provenance.ts`), so before this the graph stated `civic:failed`
// with no duration beside it — a combination the graph had never emitted, and
// which the harness's own comment cited this issue by number as the reason
// for.
//
// THE FIXTURE SHAPE IS CHOSEN SO EACH ASSERTION CAN FAIL (CLAUDE.md).
//   - The rejected call is on a dataset NOTHING else in the run touches, so
//     no entry, node or attribute it should or should not mint can be
//     supplied, or masked, by the answered call's. (The shape #384 P6 was
//     caught without.)
//   - The answered call is asserted first, as a premise: if it did not record
//     and span its own elapsed, an absence below would be about the loop
//     rather than about the rejection.
//   - Both the executor's answer and its rejection sleep, so a discarded
//     elapsed and a recorded zero cannot be confused. Every assertion demands
//     a POSITIVE number; `> 0` is what fails on a hard-coded 0 or an
//     `undefined` coerced to `NaN`.
//   - The elapsed is asserted to be the SAME number on all four surfaces, so
//     a second clock — a second `Date.now()` anywhere on the catch path —
//     fails this file even though every individual number would look
//     plausible.
//
// THE READER'S HALF. The record page and `ProvenanceChain` both render a
// `queries[]` entry through `describeQueryOutcome`, and the entry now carries
// a duration where it did not before. The last two cases hold that line: the
// rejected entry's sentence states the elapsed in words, and the bare
// numeric label `ProvenanceChain` prints for a returned call is NOT also
// printed beside "did not complete".
//
// BLIND SPOTS, stated so the next reader does not assume otherwise.
//   - No live model endpoint, no live MCP server, no credential: the model
//     endpoint is a loopback script and the executor is a closure in this
//     file. What a real source does with a slow rejection is not measured
//     here.
//   - The React components are not rendered. `ProvenanceChain`'s label is
//     asserted through the formatter it delegates to plus a source read of
//     the one line that builds the numeric label; this repository has no
//     component-render tests.
//   - Packages published BEFORE this change carry no duration on a rejected
//     entry and are not in view here. Absence stays absence for them — the
//     formatter says nothing rather than a zero, which the last case pins.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types \
//        src/lib/model-loop/a-rejected-call-carries-its-elapsed.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CompletionResult, ProgressOpts } from '../openrouter-streaming.ts';
import type { EvidencePackage, PackageInput, ToolCallInput } from '../evidence/packager.ts';

// The reference deployment's declared identity, as every byte-parity test
// injects it — the packager refuses to emit a signed graph without one.
const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] = value;
process.env.PUBLISHER_KEY_ID = 'adopter:n11-p4-fixture';
process.env.EVIDENCE_KEY_ID = 'adopter:n11-p4-fixture';
// The model client refuses to construct without one. The endpoint this test
// talks to is a loopback server it starts itself, so the value is never sent
// anywhere else; it is written so it cannot be mistaken for key material.
process.env.MODEL_API_KEY = 'not-a-key-n11-p4-fixture';

const { startScriptedModelServer } = await import('./test-harness.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { carriedModelIdentity } = await import('../model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('../model-client.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');
const { sourceIdForToolName } = await import('../mcp/operation-types.ts');
const { describeQueryOutcome } = await import('../evidence/query-step.ts');

const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = 'aaaa-1111';
/** Touched by the rejected call and by nothing else. */
const REJECTED = 'bbbb-2222';
const QUESTION = 'How many 311 noise complaints were filed last year?';
const ANSWER = 'About 412,000.';
/** Long enough that a recorded zero and a real measurement cannot be confused. */
const SLEEP_MS = 25;

interface Recorded { message: string; opts?: ProgressOpts & { failed?: boolean; failureKind?: string } }

// --- Drive the real loop: one answered call and one rejected ----------------

const server = await startScriptedModelServer([
  {
    toolCalls: [
      { id: 'c1', name: 'get_data', args: { type: 'query', dataset_id: ANSWERED, select: 'count(*)', portal: PORTAL } },
      { id: 'c2', name: 'get_data', args: { type: 'query', dataset_id: REJECTED, select: 'count(*)', portal: PORTAL } },
    ],
  },
  { content: ANSWER },
]);

process.env.MODEL_API_BASE_URL = server.url;
_resetDefaultModelClientForTests();

const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
builder.startRoot('analysis', { 'analysis.portal': PORTAL });
const progress: Recorded[] = [];
let completion: CompletionResult | undefined;

await queryWithMcpStreaming(
  QUESTION,
  carriedModelIdentity('fake/model'),
  [],
  async (_name, args) => {
    await new Promise((r) => setTimeout(r, SLEEP_MS));
    if (args.dataset_id === REJECTED) throw new Error('the source did not answer');
    return '[{"count":"412093"}]';
  },
  'You are a fixture system prompt.',
  {
    onProgress: (_panel, message, opts) => { progress.push({ message, opts }); },
    onToken: () => {},
    onComplete: (_panel, result) => { completion = result; },
    onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
  },
  { builder, parentSpanId: builder.rootSpanId, resolveToolSource: sourceIdForToolName },
  { toolTimeoutMs: 10_000 },
);
builder.endRoot();
await new Promise((resolve) => server.server.close(resolve));
_resetDefaultModelClientForTests();

assert.ok(completion, 'onComplete must fire');
const TRACE = builder.finalize() as unknown as Record<string, unknown>;
const CALLS = (completion!.tools_called ?? []) as unknown as ToolCallInput[];

const PKG: EvidencePackage = buildEvidencePackage({
  trace: TRACE as unknown as PackageInput['trace'],
  prompt: QUESTION,
  output: ANSWER,
  toolCalls: CALLS,
  model: 'fake/model',
  portal: PORTAL,
  tokenUsage: { promptTokens: 10, completionTokens: 5 },
  promptVisibility: 'full_text',
  title: 'A rejected call carries its elapsed',
  summary: 'Driven fixture for #413.',
  type: 'content/analysis/v1',
}).pkg;
/** The package as storage hands it back — the stored bytes, not the return value. */
const STORED = JSON.parse(JSON.stringify(PKG)) as Record<string, unknown>;

type Recordish = ToolCallInput & { duration_ms?: number; failed?: boolean; failureKind?: string };
function callFor(dataset: string): Recordish {
  const c = (CALLS as Recordish[]).find((x) => x.args?.dataset_id === dataset);
  assert.ok(c, `no recorded call for ${dataset}`);
  return c!;
}
interface SpanShape { spanId?: string; attributes?: { key: string; value?: Record<string, unknown> }[] }
function spanFor(dataset: string): SpanShape {
  const rs = TRACE.resourceSpans as { scopeSpans: { spans: SpanShape[] }[] }[];
  const s = rs[0].scopeSpans[0].spans.find((sp) => {
    const a = (sp.attributes ?? []).find((x) => x.key === 'tool.arguments');
    return String((a?.value as { stringValue?: string } | undefined)?.stringValue ?? '').includes(dataset);
  });
  assert.ok(s, `no span for ${dataset}`);
  return s!;
}
function attrOf(span: SpanShape, key: string): unknown {
  const a = (span.attributes ?? []).find((x) => x.key === key);
  if (!a) return undefined;
  const v = a.value ?? {};
  return v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue;
}
function storedEntry(dataset: string): Record<string, unknown> {
  const qs = STORED.queries as Record<string, unknown>[];
  const q = qs.find((x) => (x.arguments as Record<string, unknown>)?.dataset_id === dataset);
  assert.ok(q, `no stored queries[] entry for ${dataset}`);
  return q!;
}
function storedActivityForSpan(spanId: string): Record<string, unknown> {
  const graph = ((STORED.provenance as Record<string, unknown>)['@graph']) as Record<string, unknown>[];
  const node = graph.find((n) => String(n['@id']).endsWith(`:tool-call:${spanId}`));
  assert.ok(node, `no activity node for span ${spanId}`);
  return node!;
}

// --- Premises. Green at the base too, or nothing below fails for its reason.

test('PREMISE: the run made one answered call and one rejected, on different datasets', () => {
  assert.equal(CALLS.length, 2, 'both calls must be on the record');
  assert.equal(callFor(REJECTED).failed, true, 'the rejected call must be recorded failed');
  assert.ok(callFor(REJECTED).failureKind, 'and classified');
  assert.notEqual(callFor(ANSWERED).failed, true, 'the answered call must not be');
  const touchingRejected = CALLS.filter((c) => (c.args as Record<string, unknown>)?.dataset_id === REJECTED);
  assert.equal(touchingRejected.length, 1, 'the rejected dataset must be touched by exactly one call');
});

test('PREMISE: the answered call records and spans its elapsed — so an absence below is about the rejection, not the loop', () => {
  assert.ok((callFor(ANSWERED).duration_ms as number) > 0, 'the answered call records an elapsed');
  assert.ok(Number(attrOf(spanFor(ANSWERED), 'tool.duration_ms')) > 0, 'and its span carries one');
});

test('PREMISE: the elapsed for the rejected call reaches the progress wire — the measurement exists', () => {
  const failedEvent = progress.find((p) => p.opts?.failed === true && p.opts?.phase === 'tool_complete');
  assert.ok(failedEvent, 'the rejection must reach the progress wire');
  assert.ok(
    (failedEvent!.opts!.duration_ms as number) > 0,
    'the tool_failed event carries the elapsed for a rejected call, so the number exists; ' +
      'everything below is about whether it reaches anything permanent',
  );
});

// --- A1-A4: the four surfaces ------------------------------------------------

test('A1: the rejected call carries the elapsed on the loop’s own record', () => {
  assert.ok(
    (callFor(REJECTED).duration_ms as number) > 0,
    'the catch site sets failed/failureKind and no duration_ms, though the elapsed is in hand',
  );
  assert.ok(
    (callFor(REJECTED).duration_ms as number) >= SLEEP_MS,
    'the recorded elapsed is smaller than the time the executor actually took before rejecting — ' +
      'it is not the clock the attempt started on',
  );
});

test('A2: the rejected call’s span carries the elapsed, under the name the success path uses', () => {
  assert.ok(
    Number(attrOf(spanFor(REJECTED), 'tool.duration_ms')) > 0,
    'the rejected span ends with error and error.kind and nothing else',
  );
  // The classified kind is still the only thing said about the CAUSE (#404),
  // and the raw text still reaches no span. Asserted here because this case
  // adds an attribute to that endSpan call and must not loosen it.
  assert.equal(attrOf(spanFor(REJECTED), 'error'), true, 'the span still states the rejection');
  assert.equal(attrOf(spanFor(REJECTED), 'error.kind'), callFor(REJECTED).failureKind);
  assert.equal(attrOf(spanFor(REJECTED), 'error.message'), undefined, 'no raw rejection text on the span');
  assert.equal(
    attrOf(spanFor(REJECTED), 'tool.response_hash'),
    undefined,
    'a rejected span still has no response to hash',
  );
});

test('A3: the STORED package’s queries[] entry for the rejected call carries duration_ms', () => {
  assert.ok(
    (storedEntry(REJECTED).duration_ms as number) > 0,
    'the packager passes duration_ms through unconditionally, so the entry is silent only ' +
      'because the record was',
  );
  assert.equal(storedEntry(REJECTED).failed, true, 'and still states the rejection');
});

test('A4: the STORED graph states the rejected activity’s duration BESIDE its rejection', () => {
  const activity = storedActivityForSpan(String(spanFor(REJECTED).spanId));
  assert.equal(activity['civic:failed'], true, 'PREMISE: the activity states the rejection (harness 0.4.x)');
  assert.ok(
    typeof activity['civic:durationMs'] === 'number' && (activity['civic:durationMs'] as number) > 0,
    'the harness emits civic:durationMs from tool.duration_ms, and the attribute is absent — so a ' +
      'rejected activity says how it ended and not how long it took',
  );
});

test('A1-A4: all four state the SAME number — one clock, read once', () => {
  const onTheRecord = callFor(REJECTED).duration_ms as number;
  assert.equal(Number(attrOf(spanFor(REJECTED), 'tool.duration_ms')), onTheRecord, 'the span disagrees with the record');
  assert.equal(storedEntry(REJECTED).duration_ms, onTheRecord, 'the stored entry disagrees with the record');
  assert.equal(
    storedActivityForSpan(String(spanFor(REJECTED).spanId))['civic:durationMs'],
    onTheRecord,
    'the signed graph disagrees with the record — a second Date.now() on the catch path is the ' +
      'only way these can differ, and the elapsed must be measured once',
  );
  const wireEvent = progress.find((p) => p.opts?.failed === true && p.opts?.phase === 'tool_complete');
  assert.equal(wireEvent?.opts?.duration_ms, onTheRecord, 'the progress wire disagrees with the record');
});

// --- The reader's half: what a duration beside a rejection reads like --------

test('A5: the shared outcome formatter states the rejected entry’s elapsed in words', () => {
  const outcome = describeQueryOutcome(storedEntry(REJECTED) as { failed?: boolean; failureKind?: string; duration_ms?: number });
  assert.equal(outcome.kind, 'failed', 'the entry still reads as a rejection');
  assert.match(
    outcome.text,
    /did not complete/,
    'the sentence must still say the request did not complete before it says anything else',
  );
  assert.match(
    outcome.text,
    /took [\d,]+ms/,
    'the elapsed is a real measurement and is disclosed — but in words, because a bare number ' +
      'beside "did not complete" reads as how long the call took to succeed',
  );
});

test('A5 CONTROL: an entry that recorded no elapsed says nothing about one — absence is not a zero', () => {
  const outcome = describeQueryOutcome({ failed: true, failureKind: 'timeout' });
  assert.equal(outcome.kind, 'failed');
  assert.doesNotMatch(
    outcome.text,
    /took/,
    'a package published before #413 carries no duration on a rejected entry; stating one would ' +
      'be inventing a measurement (design principle 3)',
  );
});

test('A5: ProvenanceChain prints no bare duration label beside a rejection', () => {
  // Read as source: this repository has no component-render tests, and the
  // line that builds the label is the whole of the behaviour. The condition
  // must be gated on the outcome, so the number is stated once, by the
  // formatter, in words.
  const source = readFileSync(
    fileURLToPath(new URL('../../components/evidence/ProvenanceChain.tsx', import.meta.url)),
    'utf8',
  );
  const line = source.split('\n').find((l) => l.includes('const durationLabel'));
  assert.ok(line, 'ProvenanceChain no longer builds a durationLabel — re-read this case');
  assert.match(
    line!,
    /outcome\.kind !== 'failed'/,
    'the compact "· N.Ns" label is built for every entry carrying a duration, which now ' +
      'includes a rejected one: it would print immediately before "This request did not ' +
      'complete", in a second unit, saying the opposite of what it means',
  );
});
