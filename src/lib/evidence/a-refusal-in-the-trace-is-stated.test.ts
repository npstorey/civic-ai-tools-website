// A record whose request list does not mark refusals, but whose trace does,
// states those refusals from the trace (Wave N11 #434 F-W, ruling D1).
//
// THE DEFECT, measured at b42acdf. Two published records — created 2026-05-13
// and 2026-05-21, before the loop wrote `failed` onto a `queries[]` entry —
// carry refused calls that their request list cannot show. Each entry records
// neither `failed` nor, for the refused ones, `resultRows`. Their trace does
// show it: one `mcp_tool_call` span per entry, in entry order, with the same
// arguments, and the refused call's span carries `error: true`. The page read
// only the entry, so a refused call read "No result summary was recorded for
// this request", and because another entry in each record carries a row count,
// the record-level statement (`describeUnrecordedOutcomes`) returned null too.
//
// WHY THE TRACE AND NOT A WIDER ENTRY PREDICATE. At entry level a pre-marking
// refusal and an answered metadata or `search` call written TODAY are the same
// shape: the loop sets `resultRows` only for a row-shaped result and `failed`
// only on its failure path. No predicate over the entry can tell them apart,
// so the entry alone must keep reading "unrecorded" (PREMISE below).
//
// THE SEAT'S RIDERS, as acceptance.
//   1. A refusal is stated from the span's `error` flag ALONE. The raw source
//      text those old spans carry in `error.message` is never rendered, quoted
//      or classified. Fixtures here carry a synthetic marker in that attribute,
//      and every string the formatters return is asserted not to contain it.
//   2. The matcher declines on any disagreement in count, position, tool or
//      arguments, and a decline is PER RECORD: no entry of that record is
//      stated as refused from its trace. A declined record, or an entry whose
//      span carries no error flag, keeps "No result summary was recorded",
//      never "answered".
//   3. A package the current producer writes — driven through the real loop
//      and the real packager — with an answered metadata call gains no line
//      and no refusal, and the matcher is shown to have READ that trace rather
//      than declined it, so the "nothing" cannot be a decline in disguise.
//
// THE FIXTURES. `F5F90D` and `2317C5` are minimal copies of the two live
// packages (`/api/records/<slug>/package`): the same entries (tool, operation
// type, arguments, row counts, elapsed), the same span sequence with the model
// spans between tool spans left in, the same refused positions, the same
// creation dates. The raw source text is NOT copied; the marker replaces it.
//
// BLIND SPOTS. The React components are not rendered (this repository has no
// component-render tests); the two renderers are held to the formatters by the
// derived scan in `a-record-states-its-unrecorded-outcomes.test.ts`. The live
// records are not fetched here, so CI needs no network.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EvidencePackage, PackageInput, ToolCallInput } from './packager.ts';
import type { CompletionResult } from '../openrouter-streaming.ts';

const { REFERENCE_IDENTITY_ENV } = await import('./reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
// Test input only; no signing key is generated, displayed or handled here.
process.env.EVIDENCE_KEY_ID ??= 'adopter:n11-fw-fixture';
// The model client refuses to construct without one. The endpoint is a
// loopback server this file starts; the value is written so it cannot be
// mistaken for key material.
process.env.MODEL_API_KEY = 'not-a-key-n11-fw-fixture';

const { describeQueryOutcome, describeUnrecordedOutcomes, readRefusalsFromTrace } = await import('./query-step.ts');
const { buildEvidencePackage } = await import('./packager.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('./trace.ts');
const { sourceIdForToolName } = await import('../mcp/operation-types.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { carriedModelIdentity } = await import('../model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('../model-client.ts');

/** Stands in for the source's raw text. Nothing the page renders may contain it. */
const RAW_MARKER = 'N11FW-SYNTHETIC-RAW-SOURCE-TEXT';

type Attr = { key: string; value: Record<string, unknown> };
const str = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });
const int = (key: string, v: number): Attr => ({ key, value: { intValue: v } });
const bool = (key: string, v: boolean): Attr => ({ key, value: { boolValue: v } });

interface Entry {
  tool: string;
  operationType: string;
  arguments: Record<string, unknown>;
  portal?: string;
  datasetId?: string;
  resultRows?: number;
  resultColumns?: number;
  duration_ms?: number;
  failed?: boolean;
}

interface Span { name: string; attributes: Attr[] }

function toolSpan(e: Entry, refused: boolean): Span {
  return {
    name: 'mcp_tool_call',
    attributes: [
      str('tool.name', e.tool),
      str('tool.operation_type', e.operationType),
      str('tool.arguments', JSON.stringify(e.arguments)),
      str('mcp.source', 'socrata'),
      ...(refused
        ? [bool('error', true), str('error.message', `${RAW_MARKER}: upstream said no`)]
        : [int('tool.duration_ms', e.duration_ms ?? 1)]),
    ],
  };
}
const modelSpan = (): Span => ({ name: 'llm_inference', attributes: [str('gen_ai.system', 'openai')] });

/** A package in the shape the live pre-marking records carry. */
function prePackage(createdAt: string, entries: Entry[], refused: number[], modelSpanBefore: number[]) {
  const spans: Span[] = [
    { name: 'analysis', attributes: [] },
    { name: 'skill_fetch', attributes: [] },
  ];
  entries.forEach((e, i) => {
    if (modelSpanBefore.includes(i)) spans.push(modelSpan());
    spans.push(toolSpan(e, refused.includes(i)));
  });
  spans.push(modelSpan(), { name: 'synthesis', attributes: [] });
  return {
    metadata: { createdAt, captureMethod: 'chat-flow-stream' },
    queries: entries,
    trace: { resourceSpans: [{ scopeSpans: [{ spans }] }] },
  };
}

const NYC = 'data.cityofnewyork.us';
const base = { query: '', dataset_id: '', limit: 3, offset: 0, select: '', where: '', order: '', group: '' };
const q = (operationType: string, over: Record<string, unknown>, rest: Partial<Entry> = {}): Entry => ({
  tool: 'get_data',
  operationType,
  arguments: { type: operationType, portal: NYC, ...base, ...over },
  portal: NYC,
  ...rest,
});

/** Shaped after the 2026-05-21 record: 9 entries, 2 row counts, refused at 0 and 3. */
const F5F90D_ENTRIES: Entry[] = [
  q('query', { dataset_id: 'h9gi-nx95', limit: 3 }),
  q('catalog', { query: 'NYC schools locations', limit: 5 }, { resultRows: 5, resultColumns: 31, duration_ms: 369 }),
  q('query', { query: 'sample', dataset_id: 'h9gi-nx95', select: '*' }, { duration_ms: 849 }),
  q('query', { query: 'sample', dataset_id: '3bkj-34v2', select: '*' }),
  q('metadata', { query: '3bkj-34v2', dataset_id: '3bkj-34v2', limit: 10 }, { duration_ms: 572 }),
  q('query', { query: 'ped crashes 11217', dataset_id: 'h9gi-nx95', limit: 500, select: 'collision_id, crash_date', where: "zip_code = '11217'", order: 'crash_date ASC' }, { duration_ms: 2043 }),
  q('catalog', { query: 'DOE school location latitude longitude dataset', limit: 10 }, { resultRows: 10, resultColumns: 31, duration_ms: 681 }),
  q('query', { query: 'schools sample', dataset_id: 'wg9x-4ke6', limit: 20, select: 'location_name', where: 'latitude IS NOT NULL' }, { duration_ms: 1831 }),
  q('query', { query: 'schools 11217', dataset_id: 'wg9x-4ke6', limit: 200, select: 'location_name', where: "upper(primary_address_line_1) LIKE '%11217%'", order: 'location_name' }, { duration_ms: 1900 }),
];
const F5F90D = prePackage('2026-05-21T14:48:59.489Z', F5F90D_ENTRIES, [0, 3], [2, 4, 6, 7]);

/** Shaped after the 2026-05-13 record: 4 entries, 1 row count, refused at 1. */
const E2317C5_ENTRIES: Entry[] = [
  q('catalog', { query: 'DCWP business license applications', limit: 5 }, { resultRows: 5, resultColumns: 31, duration_ms: 555 }),
  q('query', { dataset_id: 'ptev-4hud', limit: 10, select: 'application_type, borough', where: "submission_date >= '2026-01-01'", order: 'submission_date DESC' }),
  q('query', { query: 'sample Q1 2026 applications', dataset_id: 'ptev-4hud', limit: 10, select: 'application_type, borough', where: "submission_date >= '2026-01-01'", order: 'submission_date DESC' }, { duration_ms: 6613 }),
  q('query', { query: 'Q1 2026 new applications in Queens by industry', dataset_id: 'ptev-4hud', limit: 100, select: 'business_category, COUNT(*) AS application_count', where: "borough = 'Queens'", group: 'business_category' }, { duration_ms: 1154 }),
];
const E2317C5 = prePackage('2026-05-13T10:15:47.255Z', E2317C5_ENTRIES, [1], [1, 2, 3]);

type Pkg = ReturnType<typeof prePackage>;
const clone = (p: Pkg): Pkg => JSON.parse(JSON.stringify(p)) as Pkg;
function toolSpansOf(p: Pkg): Span[] {
  return p.trace.resourceSpans[0].scopeSpans[0].spans.filter((s) => s.name === 'mcp_tool_call');
}

/** Everything the two renderers print from these formatters, for one record. */
function rendered(p: Pkg): { entries: ReturnType<typeof describeQueryOutcome>[]; record: string | null } {
  const reading = readRefusalsFromTrace(p);
  return {
    entries: p.queries.map((e, i) => describeQueryOutcome(e, { refusedInTrace: reading.refused.has(i) })),
    record: describeUnrecordedOutcomes(p),
  };
}

// --- Premises ---------------------------------------------------------------

test('PREMISE: each fixture has the live shape — refusals only in the trace, entries and tool spans aligned', () => {
  for (const [p, n, rows, refused] of [[F5F90D, 9, 2, [0, 3]], [E2317C5, 4, 1, [1]]] as const) {
    assert.equal(p.queries.length, n);
    assert.equal(p.queries.filter((e) => e.resultRows !== undefined).length, rows);
    assert.equal(p.queries.some((e) => 'failed' in e), false, 'no entry marks a refusal');
    const spans = toolSpansOf(p);
    assert.equal(spans.length, n, 'one tool span per entry');
    assert.ok(p.trace.resourceSpans[0].scopeSpans[0].spans.length > n, 'model spans sit between the tool spans');
    spans.forEach((s, i) => {
      const args = s.attributes.find((a) => a.key === 'tool.arguments')!.value.stringValue as string;
      assert.equal(args, JSON.stringify(p.queries[i].arguments), `span ${i} carries entry ${i}'s arguments`);
      assert.equal(s.attributes.some((a) => a.key === 'error'), (refused as readonly number[]).includes(i));
    });
  }
});

test('PREMISE: the entry alone cannot state the refusal — without the trace it stays unrecorded', () => {
  for (const i of [0, 3]) assert.equal(describeQueryOutcome(F5F90D.queries[i]).kind, 'unrecorded');
  assert.equal(describeQueryOutcome(E2317C5.queries[1]).kind, 'unrecorded');
});

// --- D1: the two records ----------------------------------------------------

test('D1: the 2026-05-21 record states its two refused calls as refused, and nothing else as refused', () => {
  const { entries } = rendered(F5F90D);
  assert.deepEqual(
    entries.map((o) => o.kind),
    ['failed', 'returned', 'unrecorded', 'failed', 'unrecorded', 'unrecorded', 'returned', 'unrecorded', 'unrecorded'],
  );
  for (const i of [0, 3]) {
    assert.match(entries[i].text, /did not complete/);
    assert.match(entries[i].text, /trace marks it as refused/);
  }
});

test('D1: the 2026-05-13 record states its one refused call as refused', () => {
  const { entries } = rendered(E2317C5);
  assert.deepEqual(entries.map((o) => o.kind), ['returned', 'failed', 'unrecorded', 'unrecorded']);
});

test('D1: each record carries a dated record-level statement naming how many requests the trace marks refused', () => {
  const f = rendered(F5F90D).record;
  assert.ok(f, 'the 2026-05-21 record must carry a record-level statement');
  assert.match(f, /May 21, 2026/);
  assert.match(f, /2 of its 9 requests are marked there as refused/);
  const e = rendered(E2317C5).record;
  assert.ok(e, 'the 2026-05-13 record must carry a record-level statement');
  assert.match(e, /May 13, 2026/);
  assert.match(e, /1 of its 4 requests is marked there as refused/);
  // No reason is asserted, and absence is not turned into "answered".
  for (const s of [f, e]) assert.match(s, /not stated as answered/);
});

test('D1 rider 1: the raw text a refused span carries reaches no rendered string', () => {
  for (const p of [F5F90D, E2317C5]) {
    const { entries, record } = rendered(p);
    const all = [...entries.map((o) => o.text), record ?? ''];
    for (const s of all) {
      assert.ok(!s.includes(RAW_MARKER), `a rendered string quotes the span's error text: ${s}`);
      assert.doesNotMatch(s, /upstream said no/);
    }
  }
});

test('D1 rider 1: the refusal is read from the flag alone — the same span with no error text still reads refused', () => {
  const p = clone(E2317C5);
  const span = toolSpansOf(p)[1];
  span.attributes = span.attributes.filter((a) => a.key !== 'error.message');
  assert.equal(rendered(p).entries[1].kind, 'failed');
  // And a span carrying error TEXT but no flag is not a refusal.
  const q2 = clone(E2317C5);
  const s2 = toolSpansOf(q2)[1];
  s2.attributes = s2.attributes.filter((a) => a.key !== 'error');
  assert.equal(rendered(q2).entries[1].kind, 'unrecorded');
  assert.equal(rendered(q2).record, null);
});

// --- Rider 2: the matcher declines, per record ------------------------------

function assertDeclined(p: Pkg, reason: string): void {
  const reading = readRefusalsFromTrace(p);
  assert.equal(reading.declined, reason);
  assert.equal(reading.refused.size, 0, 'a declined record states no refusal from its trace');
  const { entries, record } = rendered(p);
  for (const [i, o] of entries.entries()) {
    if (p.queries[i].resultRows === undefined) {
      assert.equal(o.kind, 'unrecorded', `entry ${i} of a declined record must read unrecorded`);
      assert.equal(o.text, 'No result summary was recorded for this request.');
    }
    assert.notEqual(o.kind, 'failed');
  }
  assert.equal(record, null, 'a declined record gains no record-level statement');
}

test('rider 2: a count mismatch declines — one tool span missing', () => {
  const p = clone(F5F90D);
  const spans = p.trace.resourceSpans[0].scopeSpans[0].spans;
  // Drop an ANSWERED entry's span, after both refused ones: a per-position
  // reader that stopped at the shorter list would still find both flags.
  const idx = spans.indexOf(toolSpansOf(p)[7]);
  spans.splice(idx, 1);
  assertDeclined(p, 'count');
});

test('rider 2: a count mismatch declines — one tool span too many', () => {
  const p = clone(E2317C5);
  p.trace.resourceSpans[0].scopeSpans[0].spans.push(toolSpan(E2317C5_ENTRIES[3], false));
  assertDeclined(p, 'count');
});

test('rider 2: an argument mismatch declines — one answered span carries different arguments', () => {
  const p = clone(F5F90D);
  const span = toolSpansOf(p)[8];
  const args = span.attributes.find((a) => a.key === 'tool.arguments')!;
  args.value = { stringValue: JSON.stringify({ ...F5F90D_ENTRIES[8].arguments, limit: 201 }) };
  assertDeclined(p, 'arguments');
});

test('rider 2: a position mismatch declines — two spans swapped, counts still equal', () => {
  const p = clone(F5F90D);
  const spans = p.trace.resourceSpans[0].scopeSpans[0].spans;
  const [a, b] = [spans.indexOf(toolSpansOf(p)[0]), spans.indexOf(toolSpansOf(p)[2])];
  [spans[a], spans[b]] = [spans[b], spans[a]];
  assertDeclined(p, 'arguments');
});

test('rider 2: a tool-name mismatch declines', () => {
  const p = clone(E2317C5);
  const span = toolSpansOf(p)[2];
  span.attributes.find((a) => a.key === 'tool.name')!.value = { stringValue: 'search' };
  assertDeclined(p, 'tool');
});

test('rider 2: unparseable span arguments decline', () => {
  const p = clone(E2317C5);
  toolSpansOf(p)[0].attributes.find((a) => a.key === 'tool.arguments')!.value = { stringValue: '{not json' };
  assertDeclined(p, 'arguments');
});

test('rider 2: a record with no readable trace declines (a trace stored by reference, or none)', () => {
  const p = clone(E2317C5) as unknown as Record<string, unknown>;
  p.trace = { ref: 'blob:sha256:0000', size: 1 };
  assertDeclined(p as unknown as Pkg, 'trace');
  delete p.trace;
  assertDeclined(p as unknown as Pkg, 'trace');
});

test('rider 2: an entry that states a row count while its span carries the error flag declines the record', () => {
  const p = clone(E2317C5);
  const span = toolSpansOf(p)[0];
  span.attributes.push(bool('error', true));
  assertDeclined(p, 'outcome');
});

test('rider 2: key order is not an argument disagreement; a value is', () => {
  const p = clone(E2317C5);
  const reordered = Object.fromEntries(Object.entries(E2317C5_ENTRIES[2].arguments).reverse());
  toolSpansOf(p)[2].attributes.find((a) => a.key === 'tool.arguments')!.value = { stringValue: JSON.stringify(reordered) };
  assert.equal(readRefusalsFromTrace(p).declined, null, 'the same arguments in another key order still match');
  assert.deepEqual([...readRefusalsFromTrace(p).refused], [1]);
});

// --- Rider 3: what the current producer writes -------------------------------

async function currentProducerPackage(refuse: boolean): Promise<Record<string, unknown>> {
  const METADATA = { type: 'metadata', portal: NYC, dataset_id: 'aaaa-1111' };
  const QUERY = { type: 'query', portal: NYC, dataset_id: 'aaaa-1111', select: 'count(*)' };
  const REFUSED = { type: 'query', portal: NYC, dataset_id: 'bbbb-2222', select: 'count(*)' };
  const server = await startScriptedModelServer([
    {
      toolCalls: [
        { id: 'c1', name: 'get_data', args: METADATA },
        { id: 'c2', name: 'get_data', args: QUERY },
        ...(refuse ? [{ id: 'c3', name: 'get_data', args: REFUSED }] : []),
      ],
    },
    { content: 'About 412,000.' },
  ]);
  process.env.MODEL_API_BASE_URL = server.url;
  _resetDefaultModelClientForTests();
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.portal': NYC });
  let completion: CompletionResult | undefined;
  await queryWithMcpStreaming(
    'How many 311 noise complaints were filed last year?',
    carriedModelIdentity('fake/model'),
    [],
    async (_name, args) => {
      if (args.dataset_id === 'bbbb-2222') throw new Error(`${RAW_MARKER}: upstream said no`);
      if (args.type === 'metadata') return JSON.stringify({ name: 'Noise complaints', columns: [{ name: 'created_date' }] });
      return '[{"count":"412093"}]';
    },
    'You are a fixture system prompt.',
    {
      onProgress: () => {},
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
  const pkg: EvidencePackage = buildEvidencePackage({
    trace: builder.finalize() as unknown as PackageInput['trace'],
    prompt: 'How many 311 noise complaints were filed last year?',
    output: 'About 412,000.',
    toolCalls: (completion!.tools_called ?? []) as unknown as ToolCallInput[],
    model: 'fake/model',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'A refusal in the trace is stated',
    summary: 'Driven fixture for ruling D1.',
    type: 'content/analysis/v1',
  }).pkg;
  return JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
}

const CURRENT = await currentProducerPackage(false);
const CURRENT_WITH_REFUSAL = await currentProducerPackage(true);

test('rider 3 PREMISE: the current producer wrote an answered metadata call with no outcome keys, and its trace aligns', () => {
  const entries = CURRENT.queries as Entry[];
  assert.equal(entries.length, 2);
  assert.equal(entries[0].operationType, 'metadata');
  assert.equal('failed' in entries[0], false);
  assert.equal('resultRows' in entries[0], false, 'an answered metadata call records no row count');
  assert.equal(entries[1].resultRows, 1);
});

test('rider 3: that package gains no line and no refusal — and the trace was READ, not declined', () => {
  const reading = readRefusalsFromTrace(CURRENT as never);
  assert.equal(reading.declined, null, 'the matcher must align this trace; a decline would make "nothing" untestable');
  assert.equal(reading.refused.size, 0);
  const { entries, record } = rendered(CURRENT as unknown as Pkg);
  assert.deepEqual(entries.map((o) => o.kind), ['unrecorded', 'returned']);
  assert.equal(record, null);
});

test('rider 3: with a refusal the current producer marks on the entry, the list is the authority and the trace is not consulted', () => {
  const entries = CURRENT_WITH_REFUSAL.queries as Entry[];
  assert.equal(entries[2].failed, true, 'PREMISE: the current producer marks the refusal on the entry');
  assert.equal(readRefusalsFromTrace(CURRENT_WITH_REFUSAL as never).declined, 'marked');
  const { entries: out, record } = rendered(CURRENT_WITH_REFUSAL as unknown as Pkg);
  assert.deepEqual(out.map((o) => o.kind), ['unrecorded', 'returned', 'failed']);
  assert.doesNotMatch(out[2].text, /trace/, 'the entry-marked refusal keeps its own sentence');
  assert.equal(record, null);
  for (const o of out) assert.ok(!o.text.includes(RAW_MARKER));
});
