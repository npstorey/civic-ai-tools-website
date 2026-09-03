// P3 red instrument, Wave N9 (#384), family F2, the app side: a dataset link
// is not minted with a portal the call did not name.
//
// WHAT WAS MEASURED AT d81eb76. Two run-level formatters in streaming.ts
// collect the portals the run's calls named and then hand the FIRST of them
// to any call that named none:
//
//   - `buildProvenanceLine` (:1291) — `(tool.args.portal …) || portals[0]`,
//     and links the call's dataset at `https://<that portal>/d/<dataset>`.
//   - `buildNarrativeSummary` (:1123) — `portal: p || portals[0] || ''` on the
//     dataset map, then links every dataset through it (:1150-1170).
//
// A `get_data` call whose arguments carry no portal was answered by whatever
// portal the data source defaulted to — which the record does not say. Both
// formatters then write a URL that asserts it: the borrowed portal, in the
// link a reader follows. Under this wave's property (no consumer of the record
// invents what the loop did not write) the dataset is named and left
// unlinked; a URL is minted only from a portal the same call carried.
//
// The run-level phrases are read separately, as the contract asks. In
// `buildProvenanceLine`, `${getPortalCity(portals[0])} Open Data` (:1280) is
// written only when exactly one portal was named, and it names that portal —
// a summary of what the calls said. In `buildNarrativeSummary`, "Using N
// <city> datasets (…)" (:1163) counts EVERY dataset under the one named city,
// including a dataset whose call named no portal — an attribution the record
// does not carry, so the third case asks that the phrase not make it.
//
// Pure functions, no I/O.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/streaming.portal-not-borrowed.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNarrativeSummary, buildProvenanceLine } from './streaming.ts';

const NAMED_PORTAL = 'data.cityofnewyork.us';
const NAMED_DATASET = 'erm2-nwe9';
const UNNAMED_DATASET = 'abcd-1234';

/** One call that named its portal, one that did not — both `get_data` queries with rows. */
const TOOLS = [
  {
    name: 'get_data',
    args: { type: 'query', portal: NAMED_PORTAL, dataset_id: NAMED_DATASET, select: 'count(*)' },
    resultSummary: { rows: 5, columns: 1 },
    operationType: 'query',
  },
  {
    name: 'get_data',
    args: { type: 'query', dataset_id: UNNAMED_DATASET, select: 'count(*)' },
    resultSummary: { rows: 3, columns: 1 },
    operationType: 'query',
  },
];

const MINTED_LINK = `https://${NAMED_PORTAL}/d/${UNNAMED_DATASET}`;
const HONEST_LINK = `https://${NAMED_PORTAL}/d/${NAMED_DATASET}`;

test('buildProvenanceLine: a dataset whose call named no portal is not linked through another call’s portal', () => {
  const line = buildProvenanceLine(TOOLS);
  assert.ok(line, 'two query calls with rows produce a provenance line');
  assert.ok(
    !line.includes(MINTED_LINK),
    `the line links ${UNNAMED_DATASET} on ${NAMED_PORTAL}, a portal that call never named:\n${line}`,
  );
  assert.ok(line.includes(UNNAMED_DATASET), 'the dataset is still named — absent is stated, not hidden');
  assert.ok(line.includes(HONEST_LINK), 'the call that named its portal keeps its link');
});

test('buildNarrativeSummary: a dataset whose call named no portal is not linked through another call’s portal', () => {
  const summary = buildNarrativeSummary(TOOLS);
  assert.ok(
    !summary.includes(MINTED_LINK),
    `the summary links ${UNNAMED_DATASET} on ${NAMED_PORTAL}, a portal that call never named:\n${summary}`,
  );
  assert.ok(summary.includes(UNNAMED_DATASET), 'the dataset is still named — absent is stated, not hidden');
  assert.ok(summary.includes(HONEST_LINK), 'the call that named its portal keeps its link');
});

test('buildNarrativeSummary: the run-level phrase does not count a portal-less dataset under the named city', () => {
  const summary = buildNarrativeSummary(TOOLS);
  assert.doesNotMatch(
    summary,
    /\b2 NYC datasets\b/,
    `"2 NYC datasets" attributes ${UNNAMED_DATASET} to NYC; its call named no portal:\n${summary}`,
  );
});

test('both formatters: a run whose every call named its portal is unchanged — every dataset linked', () => {
  const allNamed = TOOLS.map((t) => ({ ...t, args: { ...t.args, portal: NAMED_PORTAL } }));
  const line = buildProvenanceLine(allNamed);
  const summary = buildNarrativeSummary(allNamed);
  assert.ok(line && line.includes(HONEST_LINK) && line.includes(MINTED_LINK), 'both links, both named');
  assert.ok(summary.includes(HONEST_LINK) && summary.includes(MINTED_LINK), 'both links, both named');
  assert.match(summary, /\b2 NYC datasets\b/, 'the run-level phrase stands when every call named the city');
});
