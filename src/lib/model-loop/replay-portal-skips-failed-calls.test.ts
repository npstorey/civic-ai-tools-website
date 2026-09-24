/**
 * A replay's portal comes from a call that reached a portal (Wave N16 P5,
 * the cold read's F1 on anchor #518).
 *
 * WHAT WAS MEASURED AT 60a1b75. `replayPortalForPackage` took the FIRST
 * `queries[]` entry naming a portal and did not read `failed`. The packager
 * writes `portal` onto a failed entry too (`packager.ts`, the `queries` map),
 * so a run whose first call was refused for naming portal B, and which then
 * answered on portal A, replayed on B: the replay's system prompt named B, B was
 * injected into every replayed `get_data` naming none, and through
 * `canonicalizeToolCall` a signed consistency attestation compared a run on A
 * with a replay on B. On an instance with `SITE_PORTAL_LOCKED` on, that is a
 * replay reaching the portal the lock refused. Unlocked, the same shape arises
 * whenever the first portal-bearing call failed on a portal the run never
 * reached.
 *
 * WHY NONE OF THE EARLIER SUITES SAW IT. `replay-portal.test.ts`,
 * `replay-portal-is-addressable.test.ts`,
 * `derived-replay-portal-reaches-the-record.test.ts` and `replay-loop.test.ts`
 * never put a failed entry in `queries[]` at all; `portal-lock.test.ts` put
 * the answered call first in its plan, and its replay case used a hand-built
 * one-query package. Every fixture was a shape on which the first-entry rule
 * gives the right answer.
 *
 * WHAT MAKES EACH ASSERTION ABLE TO FAIL. In every failed-first case the failed
 * entry's portal is one NO answered entry and NO `dataSources[]` entry names,
 * so a derivation that reads the failed entry returns a value the expected one
 * cannot equal (it did, at the base: B, not A; B, not `undefined`). The
 * no-failed invariance case compares the derivation with a verbatim copy of the
 * base's rule over every fixture shape the earlier suites drive, plus shapes
 * where the two clauses disagree, so a fix that moved any of them (say, one
 * that stopped reading `queries[]` at all) is red there.
 *
 * Run with: npm test
 *   (or: node --test --experimental-strip-types src/lib/model-loop/replay-portal-skips-failed-calls.test.ts)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isGetDataAddressableSource, replayPortalForPackage } from './replay-loop.ts';

type Pkg = Parameters<typeof replayPortalForPackage>[0];

const A = 'records.city-a.example';
const B = 'records.city-b.example';
const C = 'records.city-c.example';

function pkg(queries: unknown[], dataSources: unknown[] = []): Pkg {
  return { queries, dataSources } as unknown as Pkg;
}

// --- Criterion 1: a failed entry never supplies the portal ------------------

test('a failed call on B ahead of an answered call on A replays on A', () => {
  const p = pkg(
    [
      { tool: 'get_data', datasetId: 'bbbb-2222', portal: B, failed: true, failureKind: 'unknown' },
      { tool: 'get_data', datasetId: 'aaaa-1111', portal: A, resultRows: 1 },
    ],
    [{ sourceId: 'socrata', catalogType: 'socrata', portalUrl: `https://${A}`, datasetId: 'aaaa-1111' }],
  );
  assert.equal(
    replayPortalForPackage(p),
    A,
    'the replay ran on the portal of a call that was refused — one the run never reached',
  );
});

test('several failed calls, on more than one portal, ahead of the answered one: still A', () => {
  const p = pkg(
    [
      { tool: 'search', arguments: { query: 'noise' } },
      { tool: 'get_data', portal: B, failed: true, failureKind: 'unavailable' },
      { tool: 'get_data', portal: C, failed: true, failureKind: 'timeout' },
      { tool: 'get_data', portal: A },
      { tool: 'get_data', portal: B },
    ],
    [{ catalogType: 'socrata', portalUrl: `https://${A}` }, { catalogType: 'socrata', portalUrl: `https://${B}` }],
  );
  assert.equal(replayPortalForPackage(p), A);
});

test('only `failed: true` disqualifies an entry: an entry marked `failed: false` still supplies its portal', () => {
  assert.equal(replayPortalForPackage(pkg([{ portal: A, failed: false }])), A);
});

// --- Criterion 2: every portal-bearing entry failed ---------------------------
//
// THE STATED BEHAVIOUR. Failed entries are skipped, and the derivation falls
// through to its existing second clause: the first `dataSources[]` entry a
// `get_data` could address, else no portal. `dataSources[]` never lists a
// failed call (the harness skips one before resolving a source), so it names
// only portals the run reached.
//
// Measured for a package this repository's packager builds: a Socrata
// `dataSources[]` entry exists only for an ANSWERED call that carried a
// portal, and that call's `queries[]` entry carries the same portal (a call
// with no portal, answered, mints no entry). So when every portal-bearing
// `queries[]` entry failed, the fall-through finds nothing and the answer is
// `undefined`. The second clause still decides for packages whose `queries[]`
// carry no portal field (the shape it was written for, #384 F2).

test('every portal-bearing call failed and nothing was accessed: no portal', () => {
  const p = pkg([
    { tool: 'get_data', datasetId: 'bbbb-2222', portal: B, failed: true, failureKind: 'unknown' },
    { tool: 'fetch', arguments: { id: 'ffff-6666' } },
  ]);
  assert.equal(
    replayPortalForPackage(p),
    undefined,
    'every call that named a portal failed, and the replay still names one of them',
  );
});

test('every portal-bearing call failed; the only accessed source is not addressable by get_data: no portal', () => {
  const p = pkg(
    [{ tool: 'get_data', portal: B, failed: true }, { tool: 'get_observations' }],
    [{ sourceId: 'data-commons', catalogType: 'data-commons', portalUrl: 'https://api.datacommons.org/mcp' }],
  );
  assert.equal(replayPortalForPackage(p), undefined);
});

test('every portal-bearing call failed; an addressable accessed source is listed: that source', () => {
  // Not a shape this packager emits (see above); a package from another
  // producer, or one whose answered call's queries[] entry carries no portal
  // field. The source it names was accessed; the failed call's portal was not.
  const p = pkg(
    [{ tool: 'get_data', portal: B, failed: true }, { tool: 'get_data' }],
    [{ catalogType: 'socrata', portalUrl: `https://${C}` }],
  );
  assert.equal(replayPortalForPackage(p), C);
});

// --- Criterion 3: no failed entry, no change ----------------------------------

/** The base's rule, verbatim from `replay-loop.ts` at 60a1b75: the oracle for
 *  "a package with no failed entry derives exactly what it derived before". */
function baseRule(p: Pkg): string | undefined {
  const named = (p.queries as ReadonlyArray<{ portal?: string }>).find(
    (q) => typeof q.portal === 'string' && q.portal.length > 0,
  )?.portal;
  if (named) return named;
  const sourceUrl = p.dataSources.find(
    (d) => isGetDataAddressableSource(d) && typeof d.portalUrl === 'string' && d.portalUrl.length > 0,
  )?.portalUrl;
  if (!sourceUrl) return undefined;
  return sourceUrl.replace(/^https?:\/\//, '');
}

test('a package with no failed entry derives exactly what the base derived, over every earlier suite\'s fixture shape', () => {
  const fixtures: Array<[string, Pkg]> = [
    // replay-portal.test.ts
    ['search/fetch only', pkg([{ tool: 'search', arguments: { query: 'noise complaints' } }, { tool: 'fetch', arguments: { id: 'record:abcd' } }])],
    ['a query named a portal', pkg([{ portal: 'data.sfgov.org' }])],
    ['socrata source, no query portal', pkg([{}], [{ catalogType: 'socrata', portalUrl: 'https://data.sfgov.org' }])],
    ['source with no catalogType', pkg([{}], [{ portalUrl: 'https://data.sfgov.org' }])],
    // replay-portal-is-addressable.test.ts
    ['data-commons only', pkg([{}, {}], [{ catalogType: 'data-commons', portalUrl: 'https://api.datacommons.org/mcp' }])],
    ['ckan only', pkg([{}, {}], [{ catalogType: 'ckan', portalUrl: 'https://data.boston.gov' }])],
    ['socrata only', pkg([{}, {}], [{ catalogType: 'socrata', portalUrl: 'https://data.cityofnewyork.us' }])],
    ['query portal beside an aggregate source', pkg([{ portal: 'data.sfgov.org' }], [{ catalogType: 'data-commons', portalUrl: 'https://api.datacommons.org/mcp' }])],
    ['unknown catalogue', pkg([{}, {}], [{ catalogType: 'some-future-catalogue', portalUrl: 'https://example.org' }])],
    // derived-replay-portal-reaches-the-record.test.ts
    ['aggregate record', pkg([{}, {}], [{ sourceId: 'data-commons', catalogType: 'data-commons', portalUrl: 'https://api.datacommons.org/mcp' }])],
    ['socrata record', pkg([{}], [{ sourceId: 'socrata', catalogType: 'socrata', portalUrl: 'https://data.cityofnewyork.us', datasetId: 'erm2-nwe9' }])],
    // replay-loop.test.ts, portal-lock.test.ts
    ['one query, no sources', pkg([{}])],
    ['one foreign query portal', pkg([{ portal: B }])],
    // Shapes where the two clauses disagree, so an oracle that ignored either is caught.
    ['query portal differs from the source', pkg([{ portal: A }, { portal: B }], [{ catalogType: 'socrata', portalUrl: `https://${C}` }])],
    ['empty-string query portal, then a real one', pkg([{ portal: '' }, { portal: B }], [{ catalogType: 'socrata', portalUrl: `https://${C}` }])],
    ['explicit failed:false first', pkg([{ portal: B, failed: false }, { portal: A }], [{ catalogType: 'socrata', portalUrl: `https://${A}` }])],
  ];
  // Premise: the table is not all one answer, so agreement is not a coincidence.
  const answers = new Set(fixtures.map(([, p]) => String(baseRule(p))));
  assert.ok(answers.size >= 4, `the fixture table collapses to ${[...answers].join(', ')}`);
  for (const [name, p] of fixtures) {
    assert.equal(replayPortalForPackage(p), baseRule(p), `${name}: the derivation moved for a package with no failed entry`);
  }
});
