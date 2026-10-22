// P3 red instrument, Wave N9 (#384), family F5, the reader's end: the page
// that renders `queries[]` states a failed query as failed.
//
// WHAT WAS MEASURED AT d81eb76. Two surfaces render the envelope's tool-call
// list, and both build their reader-facing line inline, from the eight keys
// the entry carries today:
//
//   - the record page's "D · Deliberative trace" section
//     (src/app/(app)/evidence/[slug]/page.tsx:576-597) prints the tool, the
//     arguments and — only when `resultRows` is defined — a "Result: N rows"
//     line. A call the source rejected has no `resultRows`, so it renders as
//     a call with arguments and nothing else: the same rendering a metadata
//     call or a `search` gets, and nothing says it did not complete.
//   - the record page's per-call timeline component (removed since, #601)
//     composed `${opLabel}${datasetLabel}${portalLabel}${durationLabel}
//     ${resultLabel}` the same way, with the same silence.
//
// Neither exposes a pure formatter `node --test` can call — both are JSX, one
// a server component — so this instrument asserts the property at the
// formatter stage 2 adds, and is red at the base by that module's absence.
//
// THE PROPOSED SEAM: `src/lib/evidence/query-step.ts`, exporting
// `describeQueryOutcome(entry)` → `{ kind, text }`, where `kind` is one of
// `'failed'` (the loop recorded a rejection), `'returned'` (a row count was
// recorded — zero rows is a returned result, not a failure), or
// `'unrecorded'` (neither: the call completed and no tabular summary was
// taken, as for metadata, `search` and `fetch`). `text` is the reader-facing
// line for that state, in the reader's language (docs/design-principles.md,
// principles 1, 3 and 9): a failure says the request did not complete and,
// where the kind is known, why — the notebook path already writes exactly
// that vocabulary (`FAILURE_REASON` in notebook-author/tool-to-cell.ts), and
// the formatter should share it rather than restate it. Both renderers then
// call the one formatter, and the last case here pins that they do.
//
// The module is loaded dynamically, through a specifier the type-checker
// does not resolve, so this file compiles at the base (`npm run typecheck`
// stays green) and fails at run time until the module exists.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/evidence/query-step.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeRefusedRequests } from './query-step.ts';

interface QueryOutcome {
  kind: 'failed' | 'returned' | 'unrecorded';
  text: string;
}

type DescribeQueryOutcome = (entry: {
  tool: string;
  operationType: string;
  arguments: Record<string, unknown>;
  resultRows?: number;
  resultColumns?: number;
  duration_ms?: number;
  failed?: boolean;
  failureKind?: string;
}) => QueryOutcome;

/** The module stage 2 adds. A joined specifier keeps the type-checker from resolving it at the base. */
const QUERY_STEP_MODULE = ['.', 'query-step.ts'].join('/');

async function loadDescribeQueryOutcome(): Promise<DescribeQueryOutcome> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(QUERY_STEP_MODULE)) as Record<string, unknown>;
  } catch (error) {
    assert.fail(
      'src/lib/evidence/query-step.ts does not exist: the record page builds the query line inline ' +
        `and does not state a failed call as failed (${(error as Error).message})`,
    );
  }
  const fn = mod.describeQueryOutcome;
  assert.equal(typeof fn, 'function', 'query-step.ts exports describeQueryOutcome');
  return fn as DescribeQueryOutcome;
}

const BASE_ENTRY = {
  tool: 'get_data',
  operationType: 'query',
  arguments: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'abcd-1234', select: 'count(*)' },
};

test('query-step: the renderer’s formatter exists — describeQueryOutcome is exported', async () => {
  await loadDescribeQueryOutcome();
});

test('query-step: a failed query is stated as failed, and the recorded kind is said in words', async () => {
  const describe = await loadDescribeQueryOutcome();
  const outcome = describe({ ...BASE_ENTRY, failed: true, failureKind: 'timeout' });
  assert.equal(outcome.kind, 'failed');
  assert.match(
    outcome.text,
    /did not (respond|complete|finish)|could not be (completed|reached)|was not completed|failed/i,
    `a reader is told the request did not complete: ${outcome.text}`,
  );
  assert.match(
    outcome.text,
    /in time|timed? ?out/i,
    `the recorded kind (timeout) is said in the reader's language: ${outcome.text}`,
  );
  assert.doesNotMatch(outcome.text, /\b\d+ rows?\b/, 'a failed call is not given a row count');
  assert.doesNotMatch(outcome.text, /failureKind|timeout:/i, 'implementation vocabulary stays out of the line');
});

test('query-step: a failed query with no recorded kind is still stated as failed, without a cause it cannot name', async () => {
  const describe = await loadDescribeQueryOutcome();
  const outcome = describe({ ...BASE_ENTRY, failed: true });
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.text, /did not (respond|complete|finish)|could not be (completed|reached)|was not completed|failed/i);
  assert.doesNotMatch(outcome.text, /in time|timed? ?out|reached|configured/i, 'no cause is asserted that was not recorded');
});

test('query-step: a zero-row result is a returned result, not a failure — the two are never conflated', async () => {
  const describe = await loadDescribeQueryOutcome();
  const empty = describe({ ...BASE_ENTRY, resultRows: 0, resultColumns: 0, duration_ms: 80 });
  const failed = describe({ ...BASE_ENTRY, failed: true, failureKind: 'timeout' });
  assert.equal(empty.kind, 'returned');
  assert.match(empty.text, /\b0 rows\b/, `an empty result says so in rows: ${empty.text}`);
  assert.notEqual(empty.text, failed.text);
  assert.doesNotMatch(empty.text, /did not|could not|failed/i, 'an empty result is not described as a failure');
});

test('query-step: a call with neither a failure nor a row count is stated as unrecorded, never as either', async () => {
  const describe = await loadDescribeQueryOutcome();
  const outcome = describe({ tool: 'search', operationType: 'search', arguments: { query: 'noise complaints' } });
  assert.equal(outcome.kind, 'unrecorded');
  assert.doesNotMatch(outcome.text, /did not|could not|failed/i, 'absence of a summary is not a failure');
  assert.doesNotMatch(outcome.text, /\b\d+ rows?\b/, 'absence of a summary is not a row count');
  assert.ok(outcome.text.trim().length > 0, 'absence is stated, not left blank');
});

// --- The record page reads the one formatter -------------------------------

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

test('query-step: the record page renders queries[] through describeQueryOutcome', () => {
  // Since LAYOUT-WEB W3 P2 the page hands its package to the record adapter,
  // which writes section D's lines; the page renders the view it returns.
  assert.ok(sourceOf('../../app/(app)/evidence/[slug]/page.tsx').includes('adaptRecord('), 'the record page builds its view with the record adapter');
  for (const [name, source] of [
    ['answer-view/adapt-record.ts', sourceOf('../../components/answer-view/adapt-record.ts')],
  ] as [string, string][]) {
    assert.ok(
      source.includes('describeQueryOutcome'),
      `${name} renders queries[] without describeQueryOutcome — its query line is built inline and a ` +
        'failed call reads like one that returned nothing',
    );
  }
});

// --- The refused-request line outside the disclosure (LAYOUT-W1, ruling D2) --
//
// The executed run and the record page put section D behind one closed
// disclosure. A refused request is stated there per call; this line states it
// once, outside, under the status row. It is counted by `describeQueryOutcome`
// (an entry counts exactly when D states it failed), so each fixture below
// carries an UNRECORDED entry beside the failed one: a count by entry length,
// or by "not returned", would read it as refused and fail here.
//
// RED at d1919a8 + the typed stub (returns null): every non-null case fails.

const FAILED_ENTRY = { failed: true, failureKind: 'timeout' };
const RETURNED_ENTRY = { resultRows: 12, resultColumns: 3 };
const UNRECORDED_ENTRY = {};

test('D2: no request stated as failed gives no line — returned and unrecorded entries alone count for nothing', () => {
  assert.equal(describeRefusedRequests([RETURNED_ENTRY, UNRECORDED_ENTRY, { resultRows: 0 }]), null);
  assert.equal(describeRefusedRequests([]), null, 'no requests, nothing to state');
  assert.equal(describeRefusedRequests([UNRECORDED_ENTRY]), null, 'one unrecorded request is not a refused one');
});

test('D2: one failed among three — the unrecorded entry beside it is not counted', () => {
  assert.equal(
    describeRefusedRequests([RETURNED_ENTRY, FAILED_ENTRY, UNRECORDED_ENTRY]),
    '1 of 3 requests did not complete.',
  );
});

test('D2: the only request failed', () => {
  assert.equal(describeRefusedRequests([FAILED_ENTRY]), 'The only request did not complete.');
  assert.equal(describeRefusedRequests([{ failed: true }]), 'The only request did not complete.', 'with no recorded kind');
});

test('D2: several failed, each counted once', () => {
  assert.equal(
    describeRefusedRequests([FAILED_ENTRY, UNRECORDED_ENTRY, { failed: true }, RETURNED_ENTRY]),
    '2 of 4 requests did not complete.',
  );
});

test('D2: a refusal stated by the trace counts as describeQueryOutcome states it; an entry with its own outcome does not', () => {
  // Index 0 states nothing and is refused in the trace: D says it did not
  // complete, so it counts. Index 1 states a row count; the trace is never
  // consulted for it (`describeQueryOutcome`), so it does not. Index 2 is
  // unrecorded and not in the set.
  assert.equal(
    describeRefusedRequests([UNRECORDED_ENTRY, RETURNED_ENTRY, UNRECORDED_ENTRY], new Set([0, 1])),
    '1 of 3 requests did not complete.',
  );
});

test('D2: the line counts exactly the entries describeQueryOutcome states as failed', async () => {
  const describe = await loadDescribeQueryOutcome();
  const entries = [FAILED_ENTRY, UNRECORDED_ENTRY, RETURNED_ENTRY, { failed: true }, { resultRows: 0 }];
  const failed = entries.filter((e) => describe({ ...BASE_ENTRY, ...e }).kind === 'failed').length;
  assert.equal(failed, 2, 'the fixture holds two failed entries by the per-call formatter');
  assert.equal(describeRefusedRequests(entries), `${failed} of ${entries.length} requests did not complete.`);
});

// --- UX pass row 23: a duration in a reader's sentence is in seconds ------------------------------
//
// At the base: "Returned 13 rows × 2 columns · 16837ms" and "The attempt took
// 16,837ms." One helper, one decimal and a space: "16.8 s", "0.3 s" under a
// second. A measured elapsed under 0.05 s would round to "0.0 s", which reads
// as no time at all; it is stated as "under 0.1 s" (absence is never a zero,
// and neither is a measurement).

test('UX pass row 23: the returned line and both elapsed sentences state seconds, one decimal, with a space', async () => {
  const describe = await loadDescribeQueryOutcome();
  assert.equal(describe({ ...BASE_ENTRY, resultRows: 13, resultColumns: 2, duration_ms: 16837 }).text, 'Returned 13 rows × 2 columns · 16.8 s');
  assert.equal(describe({ ...BASE_ENTRY, resultRows: 7, resultColumns: 1, duration_ms: 300 }).text, 'Returned 7 rows × 1 column · 0.3 s');
  assert.ok(describe({ ...BASE_ENTRY, failed: true, failureKind: 'timeout', duration_ms: 16837 }).text.endsWith(' The attempt took 16.8 s.'));
  const { describeQueryOutcome } = (await import('./query-step.ts')) as unknown as { describeQueryOutcome: (entry: object, context: { refusedInTrace: boolean }) => { text: string } };
  assert.ok(describeQueryOutcome({ duration_ms: 16837 }, { refusedInTrace: true }).text.endsWith(' The attempt took 16.8 s.'));
  assert.ok(describe({ ...BASE_ENTRY, failed: true, failureKind: 'timeout', duration_ms: 3 }).text.endsWith(' The attempt took under 0.1 s.'));
});

test('UX pass row 23: the one helper', async () => {
  const { secondsText } = (await import('./query-step.ts')) as unknown as { secondsText: (ms: number) => string };
  assert.equal(typeof secondsText, 'function', 'query-step.ts exports no secondsText');
  assert.deepEqual([16837, 12300, 4200, 300, 95, 50, 49, 0].map(secondsText), ['16.8 s', '12.3 s', '4.2 s', '0.3 s', '0.1 s', '0.1 s', 'under 0.1 s', 'under 0.1 s']);
});
