// THROWAWAY — Wave N11 (#434) P4's red on a runner. Not for merge.
//
// Two properties, both driven rather than asserted over a hand-written shape,
// and both read from the STORED package rather than from a builder's return
// value.
//
//   A. #413 — a rejected call's elapsed is MEASURED and then discarded. The
//      loop starts its clock outside the `try` precisely so "the time until a
//      rejection is measured the same way as the time until a result"
//      (run-tool-loop.ts:835-836, #384 P8), and the number reaches the
//      progress wire as `tool_failed`'s `durationMs`
//      (openrouter-streaming.ts:177). It reaches nothing permanent: the catch
//      site never sets `toolEntry.duration_ms`, and the span it ends
//      (`:891-894`) carries `error` and `error.kind` and nothing else.
//
//   B. #411 per D3 — the whole composed skill prompt is written onto the
//      `skill_fetch` span as `skill.text` (compare-stream/route.ts:177) and
//      travels into the signed bytes, because the harness's
//      `extractSkillMetadata` reads that attribute into
//      `skillMetadata.skillText` and the trace goes inline into the package.
//
// THE FIXTURE SHAPE IS CHOSEN SO EACH ASSERTION CAN FAIL. The rejected call is
// on a dataset NOTHING else touches, so nothing it should or should not mint
// can be masked by de-duplication against the answered call's entries — the
// shape #384 P6 was caught without.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompletionResult, ProgressOpts } from '../openrouter-streaming.ts';
import type { EvidencePackage, PackageInput, ToolCallInput } from '../evidence/packager.ts';

// The reference deployment's declared identity, as every byte-parity test
// injects it — the packager refuses to emit a signed graph without one.
const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] = value;
process.env.PUBLISHER_KEY_ID = 'adopter:n11-p4-red-fixture';
process.env.EVIDENCE_KEY_ID = 'adopter:n11-p4-red-fixture';
// The model client refuses to construct without one. The endpoint this test
// talks to is a loopback server it starts itself, so the value is never sent
// anywhere else; it is written so it cannot be mistaken for key material.
process.env.MODEL_API_KEY = 'not-a-key-n11-p4-red-fixture';

const { startScriptedModelServer } = await import('./test-harness.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { carriedModelIdentity } = await import('../model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('../model-client.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, hash } = await import('../evidence/trace.ts');
const { sourceIdForToolName } = await import('../mcp/operation-types.ts');

const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = 'aaaa-1111';
/** Touched by the rejected call and by nothing else. */
const REJECTED = 'bbbb-2222';
const QUESTION = 'How many 311 noise complaints were filed last year?';
const ANSWER = 'About 412,000.';

interface Recorded { message: string; opts?: ProgressOpts & { failed?: boolean; failureKind?: string } }

// --- A: drive the real loop, one answered call and one rejected -------------

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
    if (args.dataset_id === REJECTED) {
      // A rejection the loop classifies. Deliberately slow enough that a
      // discarded elapsed and a recorded zero cannot be confused.
      await new Promise((r) => setTimeout(r, 25));
      throw new Error('the source did not answer');
    }
    await new Promise((r) => setTimeout(r, 25));
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

const P4_INPUT: PackageInput = {
  trace: TRACE as unknown as PackageInput['trace'],
  prompt: QUESTION,
  output: ANSWER,
  toolCalls: CALLS,
  model: 'fake/model',
  portal: PORTAL,
  tokenUsage: { promptTokens: 10, completionTokens: 5 },
  promptVisibility: 'full_text',
  title: 'N11 P4 red',
  summary: 'N11 P4 red.',
  type: 'content/analysis/v1',
};
const PKG: EvidencePackage = buildEvidencePackage(P4_INPUT).pkg;
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
  const spans = rs[0].scopeSpans[0].spans;
  const s = spans.find((sp) => {
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

// --- A: premises. Green at base, or nothing below can fail for the right reason.

test('PREMISE: the fixture drove one answered call and one rejected, on different datasets', () => {
  assert.equal(CALLS.length, 2, 'both calls must be on the record');
  assert.equal(callFor(REJECTED).failed, true, 'the rejected call must be recorded failed');
  assert.ok(callFor(REJECTED).failureKind, 'and classified');
  assert.notEqual(callFor(ANSWERED).failed, true, 'the answered call must not be');
  const touchingRejected = CALLS.filter((c) => (c.args as Record<string, unknown>)?.dataset_id === REJECTED);
  assert.equal(touchingRejected.length, 1, 'the rejected dataset must be touched by exactly one call');
});

test('PREMISE: the answered call records and spans its elapsed — so the absence below is about the rejection, not about the loop', () => {
  assert.ok((callFor(ANSWERED).duration_ms as number) > 0, 'the answered call records an elapsed');
  assert.ok(Number(attrOf(spanFor(ANSWERED), 'tool.duration_ms')) > 0, 'and its span carries one');
});

test('PREMISE: the elapsed for the REJECTED call is measured — it reaches the progress wire and is then discarded', () => {
  const failedEvent = progress.find((p) => p.opts?.failed === true && p.opts?.phase === 'tool_complete');
  assert.ok(failedEvent, 'the rejection must reach the progress wire');
  assert.ok(
    (failedEvent!.opts!.duration_ms as number) > 0,
    'openrouter-streaming.ts:177 carries the elapsed for a rejected call, so the number exists; ' +
      'everything red below is about it not reaching anything permanent',
  );
});

// --- A: the reds ------------------------------------------------------------

test('RED A1: the rejected call carries the elapsed on the record', () => {
  assert.ok(
    (callFor(REJECTED).duration_ms as number) > 0,
    'run-tool-loop.ts:871-872 sets failed/failureKind on the catch side and never duration_ms, ' +
      'though the elapsed is in hand at :906',
  );
});

test('RED A2: the rejected call\'s span carries the elapsed', () => {
  assert.ok(
    Number(attrOf(spanFor(REJECTED), 'tool.duration_ms')) > 0,
    'run-tool-loop.ts:891-894 ends a rejected span with error and error.kind and nothing else',
  );
});

test('RED A3: the STORED package\'s entry for the rejected call carries duration_ms', () => {
  assert.ok(
    (storedEntry(REJECTED).duration_ms as number) > 0,
    'packager.ts:438 passes duration_ms through unconditionally, so the entry is silent only ' +
      'because the record was',
  );
});

test('RED A4: the STORED graph states the rejected activity\'s duration BESIDE its rejection', () => {
  const spanId = String(spanFor(REJECTED).spanId);
  const activity = storedActivityForSpan(spanId);
  assert.equal(activity['civic:failed'], true, 'PREMISE: the activity states the rejection (0.4.1)');
  assert.ok(
    typeof activity['civic:durationMs'] === 'number' && (activity['civic:durationMs'] as number) > 0,
    'the harness emits civic:durationMs from tool.duration_ms (capture/provenance.ts:454,493) and ' +
      'the attribute is absent, so a rejected activity says how it ended and not how long it took',
  );
});

// --- B: #411 per D3 — the skill text in the signed bytes --------------------

const SKILL_TEXT = 'You are a civic data analyst. SENTINEL-SKILL-TEXT-N11-P4. Use the tools provided.';

function packageWithSkillSpan(): Record<string, unknown> {
  const b = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  b.startRoot('analysis', { 'analysis.portal': PORTAL });
  // compare-stream/route.ts:172-179, the one producer of this span.
  const skillSpan = b.startSpan('skill_fetch', b.rootSpanId);
  b.endSpan(skillSpan, { 'skill.text_hash': hash(SKILL_TEXT), 'skill.text': SKILL_TEXT });
  b.endRoot();
  const input: PackageInput = {
    trace: b.finalize() as unknown as PackageInput['trace'],
    prompt: QUESTION,
    output: ANSWER,
    toolCalls: [],
    model: 'fake/model',
    portal: PORTAL,
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'N11 P4 red B',
    summary: 'N11 P4 red B.',
    type: 'content/analysis/v1',
  };
  const built = buildEvidencePackage(input).pkg;
  return JSON.parse(JSON.stringify(built)) as Record<string, unknown>;
}

const SKILL_PKG = packageWithSkillSpan();

test('PREMISE: the hash of the composed prompt IS in the signed bytes, and is what D3 keeps', () => {
  const meta = SKILL_PKG.skillMetadata as Record<string, unknown>;
  assert.equal(meta.systemPromptHash, hash(SKILL_TEXT), 'the hash identifies the prompt without carrying it');
});

test('RED B1: the composed skill prompt does not appear anywhere in the signed bytes', () => {
  const bytes = JSON.stringify(SKILL_PKG);
  assert.equal(
    bytes.includes('SENTINEL-SKILL-TEXT-N11-P4'),
    false,
    'the whole prompt is in the package: extractSkillMetadata (harness capture/skill-metadata.ts:39) ' +
      'reads skill.text into skillMetadata.skillText, and the trace travels inline. ' +
      'NOTE for the IMPL: the record detail page RENDERS this — SkillSection at ' +
      '(app)/evidence/[slug]/page.tsx:519 and :787 — so removing the attribute retires a ' +
      'reader-facing section for records published after the fix.',
  );
});

test('RED B2: no tracked non-test file writes the composed prompt onto a span', async () => {
  const { execFileSync } = await import('node:child_process');
  const files = execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx', '*.mjs'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.includes('.test.'));
  const offenders: string[] = [];
  const { readFileSync } = await import('node:fs');
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (/['"]skill\.text['"]\s*:/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'a span attribute carries the whole composed prompt; D3 keeps the hash, the name and the version',
  );
});
