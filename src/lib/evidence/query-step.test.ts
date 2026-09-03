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
//   - `ProvenanceChain` (src/components/evidence/ProvenanceChain.tsx:130-137)
//     composes `${opLabel}${datasetLabel}${portalLabel}${durationLabel}
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
      'src/lib/evidence/query-step.ts does not exist: the record page and ProvenanceChain build the ' +
        `query line inline and neither states a failed call as failed (${(error as Error).message})`,
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

// --- Both renderers read the one formatter ---------------------------------

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

test('query-step: the record page and ProvenanceChain both render queries[] through describeQueryOutcome', () => {
  for (const [name, source] of [
    ['evidence/[slug]/page.tsx', sourceOf('../../app/(app)/evidence/[slug]/page.tsx')],
    ['ProvenanceChain.tsx', sourceOf('../../components/evidence/ProvenanceChain.tsx')],
  ] as [string, string][]) {
    assert.ok(
      source.includes('describeQueryOutcome'),
      `${name} renders queries[] without describeQueryOutcome — its query line is built inline and a ` +
        'failed call reads like one that returned nothing',
    );
  }
});
