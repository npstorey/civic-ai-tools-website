// P8 red instrument, Wave N9 (#384), stage 1 — the cold read's F1 and F2.
//
// THE PROPERTY (D2, restated for a failure): a rejected call is a rejected
// call on every surface that reads the record — the progress stream, the SSE
// frame, the captured trace and its replay, the step card, the run-level
// narrative, the signed package's `dataSources`, and the list the summarizer
// is told the analysis "used". Absent is absent: a call the loop did not
// record as failed carries no failure key anywhere.
//
// WHAT WAS MEASURED AT 4ec45c0 (P7's record, findings F1 and F2; re-measured
// here by driving the same run through the real loop):
//
//   F1  `packager.ts:424` hands every tool call, `failed: true` included, to
//       the harness's `buildDataSources`, whose input type is `{ name; args }`
//       (`node_modules/@typedstandards/civic-typed-harness/dist/capture/
//       data-sources.d.ts:6-9`) and which reads `args.dataset_id` and
//       `args.portal` alone. So `queries[3]` says `failed: true` while
//       `dataSources[1]` says the same dataset was accessed, with an
//       `accessTimestamp` — in bytes this instance signs. The summarizer is
//       told the same: `generate-summary/route.ts:53-62` lists a rejected
//       call's dataset under "Data sources used", and the dialog that calls
//       it (`PublishEvidenceDialog.tsx:135`) projects each record down to
//       `{ name, args }` first, so the route could not read `failed` even if
//       it looked. For a datHere publish that summary is promoted into
//       canonical JSON.
//
//   F2  `LoopEvent` (`run-tool-loop.ts:97-104`) has no failure variant; the
//       catch site (`:851-870`) sets `failed`/`failureKind` on the record and
//       emits nothing, so `reportLoopEvent` (`openrouter-streaming.ts:141-170`)
//       cannot: four `tool_start`, three `tool_complete`. `TraceEvent`
//       (`bpmn/traces.ts`) and `createTraceCapture` carry no `failed`, so the
//       replay's `ToolCall` has none. `ToolCallCard.tsx:8-17` has no `failed`
//       prop and `ProgressLog.tsx:443-451`, `:500-508` pass none, so on
//       home, ask and explore a rejected `get_data` renders like a `search`.
//       Three run-level formatters in `streaming.ts` read `tools_called` —
//       which has carried `failed` since P3 — and ignore it:
//       `buildNarrativeSummary` (`:1121`) narrates the rejected call as done
//       ("…then counted records in QUEENS", "Using 2 NYC datasets"),
//       `buildProvenanceLine` (`:1288`) links its dataset as a source,
//       `buildStatsSummary` (`:1256`) counts it ("2 queries").
//
// THE EVENT SHAPE, chosen here so stage 2 implements exactly this:
//   - At the loop: a new `LoopEvent` variant, `tool_failed`, emitted at the
//     catch site with the record, `priorCalls`, the elapsed time and the
//     kind. Not `tool_complete` with a flag: `LoopEvent` is the loop's
//     structural report, "complete" is a claim, and a new variant makes the
//     one renderer's exhaustive switch (`reportLoopEvent`) refuse to compile
//     until it renders the failure.
//   - On the wire: the END event keeps phase `tool_complete` and carries
//     `failed: true` and `failureKind`; a `tool_result`-phase event follows
//     with the outcome in the reader's words, carrying both keys too. Every
//     consumer pairs an end to its start by `(phase === 'tool_complete',
//     message)` — `useStreamingComparison.ts:388-405`, `useLiveTrace.ts:140-
//     165`, `bpmn/trace-progress.ts:60-80` — so that pairing works unchanged
//     and each reads the failure off the entry it already builds. A new wire
//     phase would widen `ProgressPhase` and `TraceEvent.phase` and duplicate
//     that pairing three times. The assertions below are on the property (an
//     end event exists for every start; the rejected one's says so), not on
//     the phase name.
//   - The words: `describeQueryOutcome` (`evidence/query-step.ts`) is the one
//     formatter for a call's outcome and `FAILURE_REASON`
//     (`notebook-author/tool-to-cell.ts`) the one sentence per kind. The
//     wire's statement and the narrative use those words; nothing here
//     writes a second sentence for the same fact.
//
// SCOPE, and against what universe. One run through the real loop
// (`queryWithMcpStreaming` → `runToolLoop`, the scripted endpoint in
// `model-loop/test-harness.ts`, a real `TraceBuilder`): `get_data` on one
// dataset, `search`, `fetch` on a `record:` id naming another portal, and a
// second `get_data` ON A DIFFERENT DATASET whose executor throws the timeout
// text — the configuration P6's read-back fixture could not see (its
// rejected call hit the same dataset, so `dataSources` de-duplicated the
// defect away; that fixture is amended alongside this file). Covered: the
// third argument of `onProgress` (what `/api/compare-stream` spreads onto
// the frame), `encodeSSE`, `createTraceCapture` → `traceEventsToProgressData`,
// the three formatters, `buildEvidencePackage` over the run's own trace, and
// — read as source, because `node --test` renders no JSX and invokes no route
// handler — the card's props, the two card sites, the summarizer route and
// the dialog's request body. Not covered: a browser render; the live route;
// the hooks' React state (they pair by the same key `trace-progress.ts`
// does, which IS driven here).
//
// The summarizer's list has no pure function at 4ec45c0 (the route builds it
// inline), so (F1 b) asserts on a PROPOSED SEAM and is red by its absence —
// the pattern `evidence/query-step.test.ts` used for the page's outcome line.
//
// BLIND SPOTS, stated. (F2 f) and (F1 c) are source scans: a site retyped or
// re-shaped out from under a pattern reads as red until the pattern is
// re-anchored, and a prop that is passed but never rendered would pass them.
// No live endpoint, no credential, no MCP server, no database, no signing
// key; every key value is a placeholder string and every address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/rejected-call-every-surface.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { queryWithMcpStreaming, type CompletionResult, type ProgressOpts } from './openrouter-streaming.ts';
import { carriedModelIdentity } from './model-catalog.ts';
import { _resetDefaultModelClientForTests } from './model-client.ts';
import { startScriptedModelServer } from './model-loop/test-harness.ts';
import type { ToolCallRecord } from './model-loop/run-tool-loop.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './evidence/trace.ts';
import { sourceIdForToolName } from './mcp/operation-types.ts';
import { mcpTools } from './mcp/tools.ts';
import {
  encodeSSE,
  buildNarrativeSummary,
  buildStatsSummary,
  buildProvenanceLine,
  type CompleteEvent,
  type PanelType,
  type StreamEvent,
} from './streaming.ts';
import { createTraceCapture } from './bpmn/capture-trace.ts';
import { traceEventsToProgressData } from './bpmn/trace-progress.ts';
import { buildEvidencePackage, type ToolCallInput } from './evidence/packager.ts';
import { REFERENCE_IDENTITY_ENV } from './evidence/reference-identity-fixture.ts';
import { describeQueryOutcome } from './evidence/query-step.ts';
import { FAILURE_REASON } from './notebook-author/tool-to-cell.ts';

// --- Fixtures ---------------------------------------------------------------

const PLACEHOLDER_KEY = 'placeholder-model-key-for-tests';
const PORTAL = 'data.cityofnewyork.us';
const OTHER_PORTAL = 'data.other-portal.example';
const ANSWERED = 'erm2-nwe9';
const REJECTED = 'efgh-5678';
const FETCH_ID = `record:${OTHER_PORTAL}:abcd-1234:row-1`;
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'About 412,000 noise complaints were filed.';
/** Classified `mcp_timeout` by `classifyStreamError`, so the loop records `failureKind: 'timeout'`. */
const TIMEOUT_TEXT = 'MCP tool "get_data" timed out after 45s';
/** A rejection stated in the reader's words — the outcome formatter's vocabulary, any kind. */
const STATED_REJECTION = /did not complete|returned no data|could not be completed|did not respond/i;

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

/** `ProgressOpts` widened by the two keys this instrument is red about. */
type WireOpts = ProgressOpts & { failed?: boolean; failureKind?: string };

interface Recorded {
  panel: PanelType;
  message: string;
  opts?: WireOpts;
}

interface Run {
  completion: CompletionResult;
  progress: Recorded[];
  trace: Record<string, unknown>;
}

const ENV_KEYS = ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL'] as const;

/**
 * The cold read's run, once: the model asks for four calls in one turn, the
 * transport answers three and rejects the fourth the way an unresponsive
 * source does, and the model answers. Recorded: every `onProgress` call, the
 * `onComplete` result, and the trace the loop wrote.
 */
async function run(): Promise<Run> {
  const { server, url } = await startScriptedModelServer([
    {
      toolCalls: [
        { id: 'c1', name: 'get_data', args: { type: 'query', dataset_id: ANSWERED, select: 'count(*)' } },
        { id: 'c2', name: 'search', args: { query: 'noise complaints' } },
        { id: 'c3', name: 'fetch', args: { id: FETCH_ID } },
        { id: 'c4', name: 'get_data', args: { type: 'query', dataset_id: REJECTED, select: 'count(*)', where: "borough='QUEENS'" } },
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
    const progress: Recorded[] = [];
    let completion: CompletionResult | undefined;
    await queryWithMcpStreaming(
      QUESTION,
      carriedModelIdentity('fake/model'),
      mcpTools,
      async (name, args) => {
        if (name === 'get_data' && args.dataset_id === ANSWERED) return '[{"count":"412093"}]';
        if (name === 'search') {
          return JSON.stringify({ results: [{ id: `dataset:${PORTAL}:${ANSWERED}`, title: '311 Service Requests' }] });
        }
        if (name === 'fetch') return JSON.stringify({ id: FETCH_ID, title: 'one row', text: 'x', metadata: {} });
        throw new Error(TIMEOUT_TEXT);
      },
      'fixture system prompt',
      {
        onProgress: (panel, message, opts) => progress.push({ panel, message, opts }),
        onToken: () => {},
        onComplete: (_panel, result) => { completion = result; },
        onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
      },
      { builder, parentSpanId: builder.rootSpanId, resolveToolSource: sourceIdForToolName },
      { portal: PORTAL, toolTimeoutMs: 45_000 },
    );
    builder.endRoot();
    assert.ok(completion, 'onComplete must fire');
    return { completion: completion!, progress, trace: builder.finalize() as unknown as Record<string, unknown> };
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
assert.equal(TOOLS.length, 4, 'the run shape: four calls on the record');
assert.equal(TOOLS[3].failed, true, 'the run shape: the loop recorded the fourth call as rejected (P3, green at base)');
assert.equal(TOOLS[3].failureKind, 'timeout');

// --- Reading the stream -----------------------------------------------------

const TOOL_PHASES = new Set(['tool_start', 'tool_complete', 'tool_result']);
const isToolPhase = (r: Recorded): boolean => r.opts?.phase !== undefined && TOOL_PHASES.has(r.opts.phase);
const starts = (): Recorded[] => RUN.progress.filter((r) => r.opts?.phase === 'tool_start');

/**
 * The events of one call, after its `tool_start`: those the consumers pair to
 * it by message (`tool_complete`), and those that carry its arguments
 * (`tool_result`, which `reportLoopEvent` writes with `args: event.call.args`).
 */
function eventsOf(start: Recorded): Recorded[] {
  const from = RUN.progress.indexOf(start) + 1;
  const argsKey = JSON.stringify(start.opts?.args);
  return RUN.progress
    .slice(from)
    .filter(isToolPhase)
    .filter((r) => r.opts?.phase !== 'tool_start')
    .filter((r) => r.message === start.message || (r.opts?.args !== undefined && JSON.stringify(r.opts.args) === argsKey));
}

/** The end events the consumers pair to a start: same message, not a start. */
const endsOf = (start: Recorded): Recorded[] => eventsOf(start).filter((r) => r.message === start.message);

const describe = (r: Recorded): string =>
  `${r.opts?.phase ?? '-'} | ${r.opts?.toolName ?? '-'} | failed=${String(r.opts?.failed)} | ${JSON.stringify(r.message)}`;

// --- F2 (a) the progress stream ---------------------------------------------

test('F2 (a) the progress stream: every started call ends on the wire, and the rejected call’s end says failed and why', () => {
  const started = starts();
  assert.deepEqual(
    started.map((s) => s.opts?.toolName),
    ['get_data', 'search', 'fetch', 'get_data'],
    'the run shape: four starts, named (P2, green at base)',
  );
  const unended = started.filter((s) => endsOf(s).length === 0);
  assert.equal(
    unended.length,
    0,
    `${unended.length} of ${started.length} started calls never end on the wire — ` +
      `${unended.map((s) => JSON.stringify(s.message)).join(', ')}. A reader watching the stream sees the ` +
      'rejected call still running when the answer arrives; the catch site (run-tool-loop.ts:851-870) emits nothing.',
  );
  const rejected = started[3];
  const end = endsOf(rejected)[0];
  assert.equal(
    end.opts?.failed,
    true,
    `the rejected call’s end event does not say it failed: ${describe(end)}`,
  );
  assert.equal(end.opts?.failureKind, 'timeout', `the end event does not say why: ${describe(end)}`);
});

test('F2 (a′) absent is absent: no event of an answered call carries a failure key', () => {
  const started = starts();
  for (const start of started.slice(0, 3)) {
    for (const event of [start, ...eventsOf(start)]) {
      assert.equal(event.opts?.failed, undefined, `an answered call’s event carries failed: ${describe(event)}`);
      assert.equal(event.opts?.failureKind, undefined, `an answered call’s event carries failureKind: ${describe(event)}`);
    }
  }
  assert.equal(starts()[3].opts?.failed, undefined, 'the rejected call’s START carries no failure key — the rejection is not known yet');
});

// --- F2 (b) the reader is told, in words ------------------------------------

test('F2 (b) an event of the rejected call states the rejection in the outcome formatter’s words, and no event carries the raw error', () => {
  const rejected = starts()[3];
  const events = eventsOf(rejected);
  const stated = events.filter((e) => STATED_REJECTION.test(e.message));
  assert.ok(
    stated.length > 0,
    `no event of the rejected call says, in words, that the request did not complete. Its events: ` +
      `[${events.map(describe).join('; ')}]`,
  );
  const outcome = describeQueryOutcome({ failed: true, failureKind: 'timeout' });
  assert.equal(outcome.kind, 'failed');
  assert.ok(
    stated.some((e) => e.message === outcome.text || e.message.includes(FAILURE_REASON.timeout)),
    `the statement uses another vocabulary than the one formatter’s (${JSON.stringify(outcome.text)}): ` +
      stated.map((e) => JSON.stringify(e.message)).join(', '),
  );
  for (const e of stated) {
    assert.equal(e.opts?.failed, true, `the statement travels on an event that does not say failed: ${describe(e)}`);
  }
  assert.ok(
    !RUN.progress.some((r) => JSON.stringify(r).includes(TIMEOUT_TEXT)),
    'raw error text reached the progress wire (#154) — green at base, pinned',
  );
});

// --- F2 (c) the SSE frame ----------------------------------------------------

test('F2 (c) the SSE frame /api/compare-stream writes for that end event carries failed and failureKind', () => {
  const end = endsOf(starts()[3])[0];
  assert.ok(end, 'no end event for the rejected call (F2 a)');
  // compare-stream/route.ts:186-187: `{ type: 'progress', panel, message, ...opts }`.
  const frame = JSON.parse(
    encodeSSE({ type: 'progress', panel: 'withMcp', message: end.message, ...end.opts } as StreamEvent).slice('data: '.length),
  ) as Record<string, unknown>;
  assert.equal(frame.toolName, 'get_data');
  assert.equal(frame.failed, true, `the frame does not say the call failed: ${JSON.stringify(frame)}`);
  assert.equal(frame.failureKind, 'timeout', `the frame does not say why: ${JSON.stringify(frame)}`);
});

// --- F2 (d) the trace capture and the replay --------------------------------

test('F2 (d) the trace capture records the rejection and the replay’s ToolCall carries it', () => {
  const capture = createTraceCapture(QUESTION, 'fake/model', PORTAL);
  for (const r of RUN.progress) {
    const o = r.opts ?? {};
    // As `useLiveTrace.ts:347` records a frame — every field the frame carries.
    const event: Parameters<typeof capture.recordEvent>[0] & { failed?: boolean; failureKind?: string } = {
      phase: o.phase,
      message: r.message,
      iteration: o.iteration,
      args: o.args,
      duration_ms: o.duration_ms,
      toolName: o.toolName,
      operationType: o.operationType,
      ...(o.failed !== undefined ? { failed: o.failed } : {}),
      ...(o.failureKind !== undefined ? { failureKind: o.failureKind } : {}),
    };
    capture.recordEvent(event);
  }
  const exported = capture.exportTrace();
  const recorded = exported.events.filter((e) => (e as { failed?: boolean }).failed === true);
  assert.ok(
    recorded.length > 0,
    'the captured trace records no rejection: `TraceEvent` (bpmn/traces.ts) has no failed field and ' +
      '`createTraceCapture` copies none, so a replay of this run can only show four calls that ran',
  );

  const replay = traceEventsToProgressData(exported.events, exported.events.length - 1, true);
  assert.deepEqual(replay.toolsCalled.map((t) => t.name), ['get_data', 'search', 'fetch', 'get_data']);
  assert.equal(
    replay.toolsCalled[3].failed,
    true,
    `the replayed fourth call does not say it failed: ${JSON.stringify(replay.toolsCalled[3])}`,
  );
  assert.equal(replay.toolsCalled[3].failureKind, 'timeout');
  for (const i of [0, 1, 2]) {
    assert.equal(replay.toolsCalled[i].failed, undefined, `replayed call ${i} was answered and must carry no failure key`);
  }
});

// --- F2 (e) the run-level formatters ----------------------------------------

test('F2 (e) buildNarrativeSummary, buildStatsSummary and buildProvenanceLine neither count nor link the rejected call as done, and the narrative says it did not complete', () => {
  const narrative = buildNarrativeSummary(TOOLS);
  const stats = buildStatsSummary(TOOLS, RUN.completion.duration_ms);
  const provenance = buildProvenanceLine(TOOLS) ?? '';

  // The narrative: the dataset the rejected call named is not one the AI
  // "used", not linked, and the call is not narrated as an action that
  // happened; the rejection is stated in the reader's words.
  const usedClause = narrative.slice(0, Math.max(0, narrative.indexOf('the AI')));
  assert.ok(
    !usedClause.includes(REJECTED),
    `the narrative counts the rejected call’s dataset among the datasets used: ${JSON.stringify(narrative)}`,
  );
  assert.doesNotMatch(narrative, /\bUsing 2\b/, `"Using 2 … datasets" counts a dataset no data came from: ${JSON.stringify(narrative)}`);
  assert.ok(
    !narrative.includes(`/d/${REJECTED}`),
    `the narrative links the rejected call’s dataset: ${JSON.stringify(narrative)}`,
  );
  assert.doesNotMatch(
    narrative,
    /counted records in QUEENS/,
    `the narrative says the rejected call counted records: ${JSON.stringify(narrative)}`,
  );
  assert.match(narrative, STATED_REJECTION, `the narrative never says a request did not complete: ${JSON.stringify(narrative)}`);
  assert.ok(narrative.includes(`/d/${ANSWERED}`), 'control: the answered call’s dataset stays linked');

  // The stats line: one query returned data, not two.
  assert.match(stats, /\b1 query\b/, `the stats line does not count one query: ${JSON.stringify(stats)}`);
  assert.doesNotMatch(stats, /\b2 queries\b/, `the stats line counts the rejected call as a query: ${JSON.stringify(stats)}`);

  // The provenance line: a request that returned nothing is not a source.
  assert.ok(
    !provenance.includes(REJECTED),
    `the provenance line lists the rejected call’s dataset as a source: ${JSON.stringify(provenance)}`,
  );
  assert.ok(provenance.includes(`/d/${ANSWERED}`), `control: the answered call’s dataset stays a linked source: ${JSON.stringify(provenance)}`);
});

// --- F2 (f) the card, read as source ----------------------------------------

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

function extract(site: string, source: string, pattern: RegExp): string {
  const m = source.match(pattern);
  assert.ok(m, `${site}: the declaration this instrument reads is no longer where it was — re-anchor the pattern`);
  return m[1] ?? m[0];
}

test('F2 (f) declared: ToolCallCard takes the failure and states it through the one outcome formatter, and both card sites pass it', () => {
  const card = sourceOf('../components/ToolCallCard.tsx');
  const props = extract('ToolCallCardProps', card, /interface ToolCallCardProps \{([\s\S]*?)\n\}/);
  assert.match(props, /\bfailed\?: boolean\b/, `ToolCallCard has no failed prop: on home, ask and explore a rejected call renders like a search.\n${props.trim()}`);
  assert.match(props, /\bfailureKind\?:/, 'ToolCallCard has no failureKind prop');
  assert.match(
    card,
    /describeQueryOutcome/,
    'ToolCallCard does not render the outcome through describeQueryOutcome (src/lib/evidence/query-step.ts) — ' +
      'the one formatter for a call’s outcome; the record page and ProvenanceChain already read it',
  );
  const log = sourceOf('../components/ProgressLog.tsx');
  const sites = log.match(/<ToolCallCard\b[\s\S]*?\/>/g) ?? [];
  assert.equal(sites.length, 2, `ProgressLog.tsx renders ToolCallCard at ${sites.length} sites; this instrument knows two — re-anchor`);
  for (const site of sites) {
    assert.match(site, /\bfailed=\{/, `a ToolCallCard site passes no failed:\n${site}`);
    assert.match(site, /\bfailureKind=\{/, `a ToolCallCard site passes no failureKind:\n${site}`);
  }
});

// --- F1 (a) the package ----------------------------------------------------

/** `encodeSSE` → the bytes on the wire → `JSON.parse`, as `sse-client.ts` reads a frame. */
function throughTheWire(completion: CompletionResult): CompleteEvent {
  const frame = encodeSSE({ type: 'complete', panel: 'withMcp', data: completion });
  return JSON.parse(frame.slice('data: '.length).trimEnd()) as CompleteEvent;
}

/** The list the client posts (PublishEvidenceDialog.tsx:194) and the route hands the packager (evidence/route.ts:285). */
const posted = (): ToolCallInput[] => throughTheWire(RUN.completion).data.tools_called as ToolCallInput[];

test('F1 (a) the package: dataSources holds no entry for the rejected call’s dataset, while queries[] still says the call failed', () => {
  const { pkg } = buildEvidencePackage({
    trace: RUN.trace,
    prompt: QUESTION,
    output: ANSWER,
    toolCalls: posted(),
    model: 'fake/model',
    portal: PORTAL,
    tokenUsage: { promptTokens: 40, completionTokens: 10 },
    promptVisibility: 'full_text',
    title: 'Noise complaints',
    summary: 'About 412,000 noise complaints were filed.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  });
  const readBack = JSON.parse(JSON.stringify(pkg)) as {
    queries: Array<Record<string, unknown>>;
    dataSources: Array<Record<string, unknown>>;
  };
  assert.equal(readBack.queries.length, 4);
  assert.equal(readBack.queries[3].datasetId, REJECTED);
  assert.equal(readBack.queries[3].failed, true, 'P3’s half holds: the package says the call failed');
  assert.equal(readBack.queries[3].failureKind, 'timeout');

  const datasetKeyed = readBack.dataSources.filter((e) => typeof e.datasetId === 'string');
  const asserted = datasetKeyed.find((e) => e.datasetId === REJECTED);
  assert.equal(
    asserted,
    undefined,
    `the same package that says queries[3] failed says its dataset was accessed: ${JSON.stringify(asserted)} — ` +
      'packager.ts:424 hands every call to buildDataSources, which reads args.dataset_id/args.portal and never failed',
  );
  assert.equal(datasetKeyed.length, 1, `expected one dataset-keyed entry, got ${JSON.stringify(datasetKeyed)}`);
  assert.equal(datasetKeyed[0].datasetId, ANSWERED);
  assert.equal(datasetKeyed[0].portalUrl, `https://${PORTAL}`);
  assert.ok(!JSON.stringify(readBack.dataSources).includes(OTHER_PORTAL), 'control (P6): the fetch id’s portal reaches no entry');
});

// --- F1 (b) the summarizer's list: a proposed seam ---------------------------

/**
 * Typed as `string`, not as the literal, so the compiler does not resolve the
 * specifier: the module is what stage 2 adds, and this file must compile at
 * the base. Proposed: `summaryDataSources(toolCalls)` → `{ portal, datasetId }[]`,
 * one entry per dataset that a call THE LOOP DID NOT RECORD AS FAILED carried
 * together with a portal, first-seen order — the route's own rule
 * (`generate-summary/route.ts:53-62`) with the one condition it lacks.
 */
const SUMMARY_SOURCES_MODULE: string = './evidence/summary-sources.ts';

interface SummarySourcesModule {
  summaryDataSources?: (toolCalls: ToolCallInput[]) => Array<{ portal: string; datasetId: string }>;
}

test('F1 (b) the summarizer’s "Data sources used" list is built by one pure function, and it lists no rejected call’s dataset', async () => {
  const mod = (await import(SUMMARY_SOURCES_MODULE).catch(() => null)) as SummarySourcesModule | null;
  assert.ok(
    mod && typeof mod.summaryDataSources === 'function',
    `no pure function builds the summarizer’s source list: generate-summary/route.ts:53-62 builds it inline, ` +
      `where node --test cannot call it, and lists a rejected call’s dataset under "Data sources used". ` +
      `Proposed seam: ${SUMMARY_SOURCES_MODULE} exporting summaryDataSources(toolCalls).`,
  );
  const list = mod!.summaryDataSources!(posted());
  assert.deepEqual(
    list.map((s) => s.datasetId),
    [ANSWERED],
    `the summarizer is told the analysis used ${JSON.stringify(list)}; the rejected call’s dataset is not a source`,
  );
  assert.equal(list[0].portal, PORTAL);
});

test('F1 (c) declared: the route reads that function, and the publish dialog posts the failure it was handed', () => {
  const route = sourceOf('../app/api/evidence/generate-summary/route.ts');
  assert.match(
    route,
    /summary-sources/,
    'generate-summary/route.ts builds "Data sources used" inline (:53-62) from `{ name; args }` and cannot see failed',
  );
  const dialog = sourceOf('../components/PublishEvidenceDialog.tsx');
  const body = extract('summary request body', dialog, /generate-summary'[\s\S]*?body: JSON\.stringify\(\{([\s\S]*?)\}\),/);
  const projection = body.match(/toolCalls:\s*toolCalls\.map\(\s*\(?\s*tc\s*\)?\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/);
  if (projection) {
    assert.ok(
      /\bfailed\b/.test(projection[1]) && /\bfailureKind\b/.test(projection[1]),
      `PublishEvidenceDialog projects each record down before asking for a summary, and the projection drops the ` +
        `rejection: ${projection[0].trim()}`,
    );
  } else {
    assert.match(body, /\btoolCalls\b/, 'the summary request no longer posts toolCalls — re-anchor');
  }
});
