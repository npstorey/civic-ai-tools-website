// A record that states no outcome for any of its requests says so, dated
// (Wave N11 #434 P5, #430 F4, ruling D8).
//
// THE DEFECT. A package whose `queries[]` entries carry neither `failed` nor
// `resultRows` asserts nothing about how any of its calls ended — while its
// `dataSources` list goes on asserting, with timestamps, that those datasets
// were accessed. A reader is told what was reached and nothing about whether
// any of it answered, and the page offered no sentence saying so. The
// per-entry formatter's "No result summary was recorded for this request" is
// correct and is not that sentence: it is a fact about one request, repeated N
// times, undated, under a sources list that still reads as access.
//
// WHAT IS DRIVEN, and against which universe. Every package below is built by
// THIS repository's `buildEvidencePackage` from a trace written by its own
// span builder, then serialized and parsed back the way storage round-trips
// it. Nothing is hand-written, so the shapes asserted are shapes the producer
// can actually emit.
//
// THE SHAPES THAT MUST BE ABLE TO FAIL. A statement that fires on every
// package is worthless, so three of the five packages below are built to
// receive NO statement, each for a different reason, and each differing from
// the first in exactly one respect:
//
//   (b) one entry records a row count      -> the record DOES state outcomes
//   (c) one entry records a rejection      -> likewise
//   (d) no requests at all                 -> no unstated outcome to disclose
//
// (b) and (c) are the pair that catches the obvious wrong implementation —
// "any entry with no outcome triggers the line" — which would fire on almost
// every record in the registry, since a metadata or `search` call routinely
// records neither.
//
// THE DATE IS THE RECORD'S OWN. Asserted by recomputing it from the built
// package's `metadata.createdAt` rather than by matching a literal, so the
// test cannot pass against a hardcoded or a fabricated date. Ruling D8 says
// dated; it does not say "dated from the clock".
//
// THE DERIVED SCAN (D10). Every surface holding a stored `EvidencePackage`
// and reading its `queries` also renders the record-level line. The universe
// is derived from the tree — every tracked non-test `.ts`/`.tsx` under `src/`
// that reads a stored record's queries — not from a list of the two files that
// do so today, so a third renderer is in scope the day it is written.
//
// The obvious derivation, "everything that calls `describeQueryOutcome`", was
// tried first and is WRONG: four live surfaces call it over an in-flight tool
// call, which carries no record date and has no record-level absence to state.
// The scan says so at its site.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildEvidencePackage, type PackageInput, type ToolCallInput } from './packager.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { describeQueryOutcome, describeUnrecordedOutcomes } from './query-step.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// Test input only; no signing key is generated, displayed or handled here.
process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const RUN_PORTAL = 'data.cityofnewyork.us';

function trace(): Record<string, unknown> {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.portal': RUN_PORTAL });
  builder.endRoot();
  return builder.finalize() as unknown as Record<string, unknown>;
}

function built(toolCalls: ToolCallInput[]): Record<string, unknown> {
  const input: PackageInput = {
    trace: trace() as unknown as PackageInput['trace'],
    prompt: 'How many 311 noise complaints were filed last year?',
    output: 'About 412,000.',
    toolCalls,
    model: 'openai/gpt-4o',
    portal: RUN_PORTAL,
    tokenUsage: { promptTokens: 100, completionTokens: 20 },
    promptVisibility: 'full_text',
    title: 'Noise complaints, 2025',
    summary: 'About 412,000 noise complaints were filed.',
    type: 'content/analysis/v1',
  };
  return JSON.parse(JSON.stringify(buildEvidencePackage(input).pkg)) as Record<string, unknown>;
}

/** The shape of a package written before outcomes were recorded: two calls,
 *  neither stating how it ended. */
const NO_OUTCOMES = built([
  { name: 'get_data', args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'erm2-nwe9', select: 'count(*)' } },
  { name: 'get_data', args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'efgh-5678', select: 'count(*)' } },
]);

/** One entry away from NO_OUTCOMES: a row count was recorded. */
const ONE_ROW_COUNT = built([
  {
    name: 'get_data',
    args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'erm2-nwe9', select: 'count(*)' },
    resultSummary: { rows: 1, columns: 1 },
  },
  { name: 'get_data', args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'efgh-5678', select: 'count(*)' } },
]);

/** One entry away from NO_OUTCOMES: a rejection was recorded. */
const ONE_REJECTION = built([
  { name: 'get_data', args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'erm2-nwe9', select: 'count(*)' } },
  {
    name: 'get_data',
    args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'efgh-5678', select: 'count(*)' },
    failed: true,
    failureKind: 'timeout',
    duration_ms: 47,
  },
]);

/** A record with no requests at all. */
const NO_REQUESTS = built([]);

/** One request, no outcome — the singular of NO_OUTCOMES. */
const ONE_UNRECORDED = built([
  { name: 'get_data', args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'erm2-nwe9', select: 'count(*)' } },
]);

function entries(pkg: Record<string, unknown>): Record<string, unknown>[] {
  return pkg.queries as Record<string, unknown>[];
}

// --- Premises ---------------------------------------------------------------

test('PREMISE: the no-outcome fixture really records no outcome on any entry', () => {
  assert.equal(entries(NO_OUTCOMES).length, 2);
  for (const q of entries(NO_OUTCOMES)) {
    assert.equal(Object.prototype.hasOwnProperty.call(q, 'failed'), false, 'absent stays absent');
    assert.equal(Object.prototype.hasOwnProperty.call(q, 'resultRows'), false);
  }
});

test('PREMISE: the two contrast fixtures really DO record an outcome, on one entry', () => {
  // Without this the nulls asserted below would be nulls for the wrong reason.
  const rows = entries(ONE_ROW_COUNT);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].resultRows, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[1], 'resultRows'), false);

  const rejected = entries(ONE_REJECTION);
  assert.equal(rejected.length, 2);
  assert.equal(rejected[1].failed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(rejected[0], 'failed'), false);
});

test('PREMISE: the per-entry formatter states the absence per entry, and undated', () => {
  const perEntry = entries(NO_OUTCOMES).map((q) => describeQueryOutcome(q).text);
  assert.deepEqual(new Set(perEntry), new Set(['No result summary was recorded for this request.']));
  for (const text of perEntry) assert.doesNotMatch(text, /\d{4}/);
});

// --- The statement, driven --------------------------------------------------

test('a record stating no outcome for any request says so, dated, at record level', () => {
  const stated = describeUnrecordedOutcomes(NO_OUTCOMES as never);
  assert.ok(stated, 'a package whose every entry records no outcome must state that');
  assert.match(stated, /states no outcome/);
  assert.match(stated, /2 requests/);
  // The date is the RECORD's, recomputed from its own bytes.
  const createdAt = new Date((NO_OUTCOMES.metadata as { createdAt: string }).createdAt);
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][createdAt.getUTCMonth()];
  assert.ok(
    stated.includes(`${month} ${createdAt.getUTCDate()}, ${createdAt.getUTCFullYear()}`),
    `the stated date must be the package's own createdAt: ${stated}`,
  );
  // And it names the thing that keeps asserting while the outcomes do not.
  assert.match(stated, /data sources/i);
});

test('one request, stated in the singular', () => {
  const stated = describeUnrecordedOutcomes(ONE_UNRECORDED as never);
  assert.ok(stated);
  assert.match(stated, /1 request:/);
});

test('a record that DOES state an outcome gains no such line', () => {
  assert.equal(
    describeUnrecordedOutcomes(ONE_ROW_COUNT as never),
    null,
    'one recorded row count means the record states outcomes; the entries that record none are ' +
      'the per-entry formatter\'s job, not a record-level claim',
  );
  assert.equal(describeUnrecordedOutcomes(ONE_REJECTION as never), null);
});

test('a record with no requests gains no such line', () => {
  assert.equal(entries(NO_REQUESTS).length, 0);
  assert.equal(describeUnrecordedOutcomes(NO_REQUESTS as never), null);
});

test('a package carrying no readable date states nothing rather than an invented one', () => {
  const queries = entries(NO_OUTCOMES);
  assert.equal(describeUnrecordedOutcomes({ metadata: {}, queries } as never), null);
  assert.equal(describeUnrecordedOutcomes({ metadata: { createdAt: 'not a date' }, queries } as never), null);
});

// --- The derived scan -------------------------------------------------------

test('every surface that reads a stored record\'s queries[] states the record-level absence', () => {
  const sources = execFileSync('git', ['ls-files', '--', 'src/**/*.ts', 'src/**/*.tsx'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('.test.'))
    .filter((f) => !f.endsWith('src/lib/evidence/query-step.ts'));

  // Derived by what a file READS, not by what it calls. `describeQueryOutcome`
  // is the wrong derivation and was measured to be: four LIVE surfaces call it
  // over an in-flight tool call (`ToolCallCard`, `DiagramAnnotations`,
  // `buildChatEvidenceView`, `openrouter-streaming`), which is not a stored
  // package, has no `metadata.createdAt`, and has no record-level absence to
  // state. What this statement belongs to is a surface holding a stored
  // `EvidencePackage` and reading its `queries` — which is what is matched.
  const recordSurfaces = sources.filter((file) => {
    const source = readFileSync(file, 'utf8');
    return /\bEvidencePackage\b/.test(source) && /\.queries\b/.test(source);
  });
  assert.ok(
    recordSurfaces.length >= 2,
    'PREMISE: fewer than two surfaces reading a stored record\'s queries[] were found, so this ' +
      `scan is not reading the tree it thinks it is. Found: ${recordSurfaces.join(', ') || 'none'}`,
  );

  const silent = recordSurfaces.filter(
    (f) => !/describeUnrecordedOutcomes\s*\(/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(
    silent,
    [],
    'These read a stored record\'s queries[] and never state the record-level absence, so a ' +
      'record that states no outcome at all reads there as N requests that each happen to be ' +
      'missing a summary, under a sources list that still asserts access (#430 F4, ruling D8). ' +
      'A new consumer that legitimately renders nothing belongs in this set with the statement ' +
      'made reachable, not outside it by narrowing the scan (ruling D10).',
  );
});
