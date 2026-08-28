// Tests for the `GET /api/evidence/list` row → response projection
// (record-list.ts) and for the property #307 turns on: the public index never
// states an attestation count it did not compute.
//
// WHY THIS FILE EXISTS
//
// The route ran the attestation-count query only when `sort=attested`, then
// emitted `attestationCount: map.get(id) || 0` under every sort. Measured
// against production, every record on the public list reported `0` while the
// database held nine attestation rows across seven records. A count reading
// zero tells a reader nobody reviewed an analysis when someone did — on the
// page whose entire job is scrutiny.
//
// The issue notes that this defect is invisible without a test, and it is
// right: `0` is a plausible-looking value, the endpoint returns 200, nothing
// logs, and the number is correct on the one sort anybody exercising the
// feature would use. Nothing short of an assertion catches it.
//
// The route could not carry that assertion, because it imports `db` at module
// scope and the test runner resolves no path aliases and cannot load a route
// module. So the projection was extracted, in the shape `visibility.test.ts`
// already uses for `buildRecordReadback` / `buildCommitmentView`: fixture rows,
// the schema imported for types only, and no database anywhere.
//
// Two halves, and both are needed:
//
//   1. the PROJECTION never turns "not computed" into `0` — asserted below
//      against the pure function;
//   2. the ROUTE computes on every listing — asserted below by reading the
//      route's source, because the sort gate is a property of the route and
//      the projection cannot see it.
//
// Run with: npm test  (or: node --test --experimental-strip-types src/lib/evidence/record-list.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildRecordListItem,
  buildRecordListItems,
  sortByAttestationCount,
  SUMMARY_PREVIEW_CHARS,
  UNKNOWN_CREATOR_NAME,
  type RecordListRow,
  type RecordListCreator,
} from './record-list.ts';

const CREATOR_ID = '11111111-1111-4111-8111-111111111111';

function makeRow(overrides: Partial<RecordListRow> = {}): RecordListRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'noise-complaints-2025',
    title: 'Noise complaints by borough, 2025',
    summary: 'A short summary.',
    model: 'anthropic/claude-sonnet-4',
    verificationStatus: 'unverified',
    withdrawnAt: null,
    reinstatedAt: null,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    creatorId: CREATOR_ID,
    ...overrides,
  };
}

const creators = new Map<string, RecordListCreator>([
  [CREATOR_ID, { displayName: 'A Publisher' }],
]);

// --- 1. The projection: a computed count is stated, an uncomputed one is not ---

test('#307: a record with two attestations lists `attestationCount: 2`', () => {
  const row = makeRow();
  const item = buildRecordListItem(row, {
    creators,
    attestationCounts: new Map([[row.id, 2]]),
  });

  assert.equal(item.attestationCount, 2);
});

test('#307: an UNCOMPUTED count is ABSENT, never `0`', () => {
  // The whole defect in one assertion. `null` means the caller did not run the
  // count query; the only honest rendering of that is to say nothing. Before
  // the fix this path emitted `0`, which is a claim — and a false one.
  const item = buildRecordListItem(makeRow(), {
    creators,
    attestationCounts: null,
  });

  assert.equal(
    'attestationCount' in item,
    false,
    'an uncomputed count must be absent from the object, not present as 0',
  );
  assert.equal(item.attestationCount, undefined);
  // And absent from the wire, not merely undefined-valued.
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(item)), 'attestationCount'), false);
});

test('#307: a COMPUTED zero is stated — the two zeros are different facts', () => {
  // A record genuinely absent from a computed map has no attestations, and
  // saying so is correct. The distinction the type carries is "we counted and
  // found none" versus "we never counted", and only the first may render 0.
  const computed = buildRecordListItem(makeRow(), {
    creators,
    attestationCounts: new Map(),
  });
  const uncomputed = buildRecordListItem(makeRow(), {
    creators,
    attestationCounts: null,
  });

  assert.equal(computed.attestationCount, 0);
  assert.equal('attestationCount' in computed, true);
  assert.notDeepEqual(computed, uncomputed, 'a counted zero and an uncounted one must not serialize alike');
});

test('#307: counts are matched per record, not spread across the page', () => {
  const a = makeRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'a' });
  const b = makeRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', slug: 'b' });
  const c = makeRow({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', slug: 'c' });

  const items = buildRecordListItems([a, b, c], {
    creators,
    attestationCounts: new Map([[a.id, 3], [c.id, 1]]),
  });

  assert.deepEqual(items.map(i => [i.slug, i.attestationCount]), [
    ['a', 3],
    ['b', 0],
    ['c', 1],
  ]);
});

// --- 2. The rest of the projection, pinned so the extraction changed nothing ---

test('the extracted projection emits exactly the keys the route emitted inline', () => {
  const row = makeRow();
  const item = buildRecordListItem(row, {
    creators,
    attestationCounts: new Map([[row.id, 0]]),
  });

  assert.deepEqual(Object.keys(item).sort(), [
    'attestationCount',
    'createdAt',
    'creatorName',
    'id',
    'model',
    'reinstatedAt',
    'slug',
    'summary',
    'title',
    'verificationStatus',
    'withdrawnAt',
  ]);
});

test('summary is elided at the preview length, and only when it is longer', () => {
  const exact = 'x'.repeat(SUMMARY_PREVIEW_CHARS);
  const long = 'y'.repeat(SUMMARY_PREVIEW_CHARS + 1);
  const ctx = { creators, attestationCounts: new Map<string, number>() };

  assert.equal(buildRecordListItem(makeRow({ summary: exact }), ctx).summary, exact);
  assert.equal(
    buildRecordListItem(makeRow({ summary: long }), ctx).summary,
    'y'.repeat(SUMMARY_PREVIEW_CHARS) + '...',
  );
});

test('timestamps serialize as ISO-8601 strings and a null stays null', () => {
  const ctx = { creators, attestationCounts: new Map<string, number>() };
  const withdrawn = buildRecordListItem(
    makeRow({
      withdrawnAt: new Date('2026-08-02T00:00:00.000Z'),
      reinstatedAt: new Date('2026-08-03T00:00:00.000Z'),
    }),
    ctx,
  );

  assert.equal(withdrawn.createdAt, '2026-08-01T12:00:00.000Z');
  assert.equal(withdrawn.withdrawnAt, '2026-08-02T00:00:00.000Z');
  assert.equal(withdrawn.reinstatedAt, '2026-08-03T00:00:00.000Z');

  const live = buildRecordListItem(makeRow(), ctx);
  assert.equal(live.withdrawnAt, null);
  assert.equal(live.reinstatedAt, null);
});

test('a record whose creator row is missing falls back to the placeholder name', () => {
  const item = buildRecordListItem(makeRow({ creatorId: 'no-such-user' }), {
    creators,
    attestationCounts: null,
  });
  assert.equal(item.creatorName, UNKNOWN_CREATOR_NAME);
});

test('`sort=attested` orders by count descending, and an absent count sorts last', () => {
  const rows = [
    makeRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'one' }),
    makeRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', slug: 'two' }),
    makeRow({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', slug: 'three' }),
  ];
  const items = buildRecordListItems(rows, {
    creators,
    attestationCounts: new Map([[rows[0].id, 1], [rows[2].id, 5]]),
  });

  assert.deepEqual(sortByAttestationCount(items).map(i => i.slug), ['three', 'one', 'two']);

  // Uncounted items are ordered as if they had none rather than throwing —
  // which is exactly why the route counts unconditionally instead of relying
  // on this function to be reached only on the counted path.
  const uncounted = buildRecordListItems(rows, { creators, attestationCounts: null });
  assert.equal(sortByAttestationCount(uncounted).length, 3);
});

// --- 3. The route half: the count query is not gated on the sort ---
//
// The projection cannot see `sort`; the gate that caused #307 lives in the
// route, and the route cannot be imported here (module-scope `db`). So this
// reads the route's source and asserts the shape of the guard. It is a
// text-level instrument and it says so — but it is the only thing standing
// between the fix and a future edit that re-gates the query and leaves the
// projection emitting a computed-looking zero for every record.

const ROUTE_PATH = fileURLToPath(
  new URL('../../app/api/evidence/list/route.ts', import.meta.url),
);
const ROUTE_SOURCE = fs.readFileSync(ROUTE_PATH, 'utf8');

test('#307: the attestation-count query in the list route is not gated on the sort', () => {
  const declaration = ROUTE_SOURCE.indexOf('let attestationCountMap');
  const query = ROUTE_SOURCE.indexOf('.from(attestationPackages)');
  assert.ok(declaration >= 0, 'the count map declaration moved — update this guard');
  assert.ok(query > declaration, 'the count query moved — update this guard');

  const guard = ROUTE_SOURCE.slice(declaration, query);
  assert.ok(
    /if \(records\.length > 0\)/.test(guard),
    'the count query should run whenever the page has rows',
  );
  assert.ok(
    !/\bsort\b/.test(guard.replace(/\/\/[^\n]*/g, '')),
    'the count query must not be gated on `sort` — that gate IS #307: it left ' +
      'every record on every other sort reporting a count nobody computed',
  );
});

test('#307: the list route never substitutes 0 for an uncounted attestation count', () => {
  // The literal that shipped the defect: `attestationCountMap.get(r.id) || 0`
  // inline in the route, reached whether or not the map had been filled.
  assert.ok(
    !/attestationCount\s*:/.test(ROUTE_SOURCE),
    'the route must not assemble `attestationCount` itself — the projection in ' +
      '@/lib/evidence/record-list owns the computed/uncomputed distinction',
  );
  assert.ok(
    /attestationCounts:\s*attestationCountMap/.test(ROUTE_SOURCE),
    'the route should hand the map (or null) to the projection',
  );
});
