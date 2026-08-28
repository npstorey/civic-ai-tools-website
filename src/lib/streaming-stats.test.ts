// Tests for the two reader-facing volume claims in `streaming.ts` —
// `buildStatsSummary`'s "N records analyzed" and `buildProvenanceLine`'s
// "N rows returned" (#339, wave N8 criterion 6).
//
// WHY THIS FILE EXISTS
//
// "N records analyzed" is the most prominent number on the answer surface, it
// is carried into the copy-to-clipboard block, and through the published
// package it becomes part of what a signed record says about how much data
// backed a claim. Before this phase it was a sum of `resultSummary.rows` over
// EVERY tool call, with no operation-type filter: a catalog search that
// returned 40 dataset DESCRIPTIONS contributed 40 "records" beside a query
// that returned 12 actual rows, and the line read "52 records analyzed". The
// provenance line one component over already filtered to query calls and said
// "12 rows returned", so the same run described itself two ways and the more
// prominent description was the wrong one.
//
// That is `docs/design-principles.md` principle 3 (no false precision) failing
// in the direction that matters: a specific number, rendered confidently,
// larger than the truth.
//
// RED AT THE BASE (`96c4f76`): `streaming.ts:1083` was
//   `toolsCalled.reduce((sum, t) => sum + (t.resultSummary?.rows || 0), 0)`
// and the first test below rendered "52 records analyzed".
//
// These tests take fixture tool-call arrays straight to the two exported pure
// functions — no model server, no MCP client, no database. The end-to-end
// coverage of the same helpers over a real `queryWithMcpStreaming` run lives
// in `openrouter-streaming.test.ts`; this file is the unit-level guard on the
// filter itself, and on the property that the two lines cannot drift apart.
//
// Run with: npm test  (or: node --test --experimental-strip-types src/lib/streaming-stats.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStatsSummary, buildProvenanceLine, isQueryCall } from './streaming.ts';

type Fixture = {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  operationType?: string;
};

/** The digits the "records analyzed" segment actually rendered, or null. */
function recordsAnalyzed(stats: string): number | null {
  const m = stats.match(/([\d,]+) records analyzed/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** The digits the "rows returned" segment actually rendered, or null. */
function rowsReturned(provenance: string | null): number | null {
  if (!provenance) return null;
  const m = provenance.match(/([\d,]+) rows returned/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

// The defect fixture, exactly as #339 describes it: one catalog search whose
// 40 hits are dataset descriptions, one query whose 12 rows are civic data.
const CATALOG_40_THEN_QUERY_12: Fixture[] = [
  {
    name: 'get_data',
    args: { type: 'catalog', portal: 'data.cityofnewyork.us', q: 'noise complaints' },
    resultSummary: { rows: 40, columns: 4 },
    operationType: 'catalog',
  },
  {
    name: 'get_data',
    args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
    resultSummary: { rows: 12, columns: 6 },
    operationType: 'query',
  },
];

test('#339: a catalog search returning 40 hits beside a query returning 12 rows renders "12 records analyzed"', () => {
  const stats = buildStatsSummary(CATALOG_40_THEN_QUERY_12, 3200);

  assert.equal(recordsAnalyzed(stats), 12, `stats line was: ${stats}`);
  assert.match(stats, /\b12 records analyzed\b/);
  // The pre-fix total. Asserted by value, not just by the correct number being
  // present, so a future change that renders both cannot pass.
  assert.doesNotMatch(stats, /\b52\b/, `catalog hits leaked into the total: ${stats}`);
  // The catalog call is still a tool call and still counts as work done — only
  // the RECORDS claim is filtered.
  assert.match(stats, /\b1 query\b/);
});

test('#339: the two lines report the SAME row count for the same run', () => {
  // The property, not two literals: whatever number the volume claim carries,
  // the provenance claim under it carries that same number. At the base these
  // disagreed (52 vs 12) and the more prominent one overcounted.
  const stats = buildStatsSummary(CATALOG_40_THEN_QUERY_12, 3200);
  const provenance = buildProvenanceLine(CATALOG_40_THEN_QUERY_12);

  assert.ok(provenance, 'a run with a query call must produce a provenance line');
  assert.equal(
    recordsAnalyzed(stats),
    rowsReturned(provenance),
    `the two reader-facing counts disagree — stats: ${stats} / provenance: ${provenance}`,
  );
  assert.equal(rowsReturned(provenance), 12);
});

test('#339: `args.type` alone still identifies a query, on both lines', () => {
  // A recorded call read back off a published package can predate
  // `operationType`. `deriveOperationType` resolves Socrata's operation FROM
  // `args.type`, so the fallback is the same value by another route — and both
  // lines must take it, or a legacy record shows a count with no source.
  const legacy: Fixture[] = [
    { name: 'get_data', args: { type: 'catalog', portal: 'data.cityofnewyork.us' }, resultSummary: { rows: 40, columns: 4 } },
    { name: 'get_data', args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' }, resultSummary: { rows: 12, columns: 6 } },
  ];

  const stats = buildStatsSummary(legacy, 3200);
  const provenance = buildProvenanceLine(legacy);

  assert.equal(recordsAnalyzed(stats), 12, `stats line was: ${stats}`);
  assert.ok(provenance, 'a legacy call carrying only args.type must still produce a provenance line');
  assert.equal(recordsAnalyzed(stats), rowsReturned(provenance));
});

test('#339: `operationType` wins over `args.type` when the two disagree', () => {
  // `operationType` is the RESOLVED value; `args.type` is only the fallback.
  // A call the resolver classified as a search is not counted as records even
  // if the raw arguments say otherwise.
  const conflicting: Fixture[] = [
    {
      name: 'get_data',
      args: { type: 'query', portal: 'data.cityofnewyork.us' },
      resultSummary: { rows: 40, columns: 4 },
      operationType: 'catalog',
    },
  ];

  assert.equal(isQueryCall(conflicting[0]), false);
  assert.doesNotMatch(buildStatsSummary(conflicting, 900), /records analyzed/);
  assert.equal(buildProvenanceLine(conflicting), null);
});

test('#339: a run that only searched the catalog claims no records at all', () => {
  // Not "0 records analyzed" — the segment is absent. Nothing was analyzed,
  // and the honest rendering of "nothing" is silence, not a zero (the same
  // no-false-precision judgment the index projection makes for an
  // uncomputed attestation count).
  const catalogOnly: Fixture[] = [
    {
      name: 'get_data',
      args: { type: 'catalog', portal: 'data.cityofnewyork.us', q: 'parking' },
      resultSummary: { rows: 40, columns: 4 },
      operationType: 'catalog',
    },
  ];

  const stats = buildStatsSummary(catalogOnly, 1200);
  assert.equal(recordsAnalyzed(stats), null, `stats line was: ${stats}`);
  assert.doesNotMatch(stats, /records analyzed/);
  assert.doesNotMatch(stats, /\b40\b/);
  // The work is still reported, as tool calls rather than as queries.
  assert.match(stats, /\b1 tool call\b/);
  assert.equal(buildProvenanceLine(catalogOnly), null);
});

test('#339: the filter is by operation, not by server — a Data Commons run counts the same way', () => {
  // Data Commons carries no `args.type`; `deriveOperationType` maps the TOOL
  // NAME (`search_indicators` -> search, `get_observations` -> query). The
  // predicate must read the resolved operation, so the filter holds for every
  // source, not just Socrata's unified tool.
  const dataCommons: Fixture[] = [
    { name: 'search_indicators', args: { query: 'median income' }, resultSummary: { rows: 25, columns: 3 }, operationType: 'search' },
    { name: 'get_observations', args: { variable: 'Count_Person' }, resultSummary: { rows: 7, columns: 5 }, operationType: 'query' },
  ];

  const stats = buildStatsSummary(dataCommons, 2100);
  assert.equal(recordsAnalyzed(stats), 7, `stats line was: ${stats}`);
  assert.doesNotMatch(stats, /\b32\b/);
});

test('#339: metadata reads contribute no records', () => {
  const withMetadata: Fixture[] = [
    { name: 'get_data', args: { type: 'metadata', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' }, resultSummary: { rows: 18, columns: 2 }, operationType: 'metadata' },
    { name: 'get_data', args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' }, resultSummary: { rows: 12, columns: 6 }, operationType: 'query' },
  ];

  const stats = buildStatsSummary(withMetadata, 2400);
  assert.equal(recordsAnalyzed(stats), 12, `stats line was: ${stats}`);
  assert.equal(rowsReturned(buildProvenanceLine(withMetadata)), 12);
});

test('#339: the agreement holds across every mix of operation types', () => {
  // Exhaustive over the operation labels this codebase produces, in every
  // one-and-two-call combination. The two lines are computed by two different
  // functions on two different surfaces; the property is that no input
  // separates them.
  const OPS = ['query', 'catalog', 'metadata', 'metrics', 'search', undefined] as const;
  const call = (op: string | undefined, rows: number): Fixture => ({
    name: 'get_data',
    args: { type: op, portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9' },
    resultSummary: { rows, columns: 3 },
    operationType: op,
  });

  for (const a of OPS) {
    for (const b of OPS) {
      const tools = [call(a, 11), call(b, 13)];
      const stats = buildStatsSummary(tools, 1000);
      const provenance = buildProvenanceLine(tools);
      assert.equal(
        recordsAnalyzed(stats),
        rowsReturned(provenance),
        `${a} + ${b} split the two counts — stats: ${stats} / provenance: ${provenance}`,
      );
    }
  }
});
