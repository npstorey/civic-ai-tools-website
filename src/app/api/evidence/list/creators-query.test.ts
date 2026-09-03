// Guard: the record index's creator lookup does not read every user row
// (#366, Wave N9).
//
// WHAT'S WRONG, MEASURED AT `c342fe0`. `route.ts:119-124` computes
// `creatorIds` from the page's records and then ignores it:
//
//   const creatorIds = [...new Set(records.map(r => r.creatorId))];
//   const creators = creatorIds.length > 0
//     ? await db.select().from(users)
//     : [];
//
// `creatorIds` is used only as a `length > 0` guard. `db.select().from(users)`
// has no `.where(...)`, so this public listing endpoint reads every column
// of every user row in the database on every page load. The projection that
// actually reaches the response, `buildRecordListItems` in
// `@/lib/evidence/record-list`, reads only `.displayName` off the map
// (`RecordListCreator = Pick<typeof users.$inferSelect, 'displayName'>`), so
// none of the other columns — email, provider ids, whatever else `users`
// carries — needs to leave the database at all.
//
// The attestation-count query three lines below (`:150-155`) already filters
// by the page's ids with `sql\`... IN (${sql.join(...)})\``, and
// `@/lib/db/creator-evidence.ts`'s `findDbUserByAccountKey` already projects
// `{ id: users.id, displayName: users.displayName }` with drizzle's typed
// `.select({...})` — either idiom fixes this; stage 2 picks one.
//
// WHY THIS FILE, NOT AN IMPORT OF THE ROUTE. `route.ts` imports `@/lib/db` at
// module scope, and this repository's rule (CLAUDE.md's evidence-surfaces
// rule, and the phase rider) is: never import the database in a test, never
// connect to a database. `record-list.test.ts` established the pattern this
// file follows — read the route as text and assert on its shape — for
// exactly the same reason (`#307`, see its "the route half" section).
//
// WHY IT LIVES HERE AND NOT BESIDE record-list.ts. This guard is about the
// route's own query text (the `db.select()...from(users)` call), not about
// the projection function `record-list.test.ts` already covers — the two
// probes read different statements in the same file for different reasons.
// Keeping it beside the route (`src/app/api/evidence/list/`) mirrors that:
// other `.test.ts` files already sit directly under `src/app/api/` (e.g.
// `rate-limit-split.test.ts`), so a test file here is not a new pattern.
//
// BLIND SPOT, STATED. This is a text-level instrument: it can see that the
// query has a `.where(...)` and that its `.select(...)` argument mentions
// `displayName`, but it cannot see what SQL actually executes, and it cannot
// tell a correct filter from one that merely resembles it (e.g. a `.where(...)`
// that filters on the wrong column). A database-backed test is the honest
// instrument for that, and it is not available here for the reason above —
// this repository's established pattern in exactly this situation is a
// fixture test of an extracted, database-free projection (`record-list.ts`,
// `creator-evidence.ts`), not a live-database test. If stage 2 extracts this
// query into `@/lib/db/creator-evidence.ts` beside `findDbUserByAccountKey`,
// this guard is written to keep passing either way — it reads the file where
// the query text lives, not a fixed one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROUTE_PATH = fileURLToPath(new URL('./route.ts', import.meta.url));
const EXTRACTED_PATH = fileURLToPath(
  new URL('../../../../lib/db/creator-evidence.ts', import.meta.url),
);

/** One `.from(users)` occurrence's statement and the `.select(...)` before it. */
function extractAt(path: string, text: string, idx: number): { path: string; statement: string; selectCall: string } {
  const stmtEnd = text.indexOf(';', idx);
  const statement = text.slice(idx, stmtEnd === -1 ? text.length : stmtEnd);
  const selectIdx = text.lastIndexOf('.select(', idx);
  const selectCall = selectIdx >= 0 ? text.slice(selectIdx, idx) : '';
  return { path, statement, selectCall };
}

/**
 * The creators-batch query's `.from(users)` occurrence, wherever it lives.
 *
 * NOT simply "the first `.from(users)` found": `creator-evidence.ts` already
 * has one, at `c342fe0`, for a wholly different purpose —
 * `findDbUserByAccountKey`'s session-to-user lookup, keyed on
 * `eq(users.githubId, accountKey)`, already correctly filtered and
 * projected. An early version of this guard picked THAT occurrence whenever
 * `creator-evidence.ts` existed and contained `.from(users)` at all — which
 * is always, since that lookup predates this phase — and so reported the
 * already-correct query as evidence the defect was fixed. Silent false
 * green: the actual defect in `route.ts` went unchecked.
 *
 * The fix: prefer `route.ts`'s occurrence if it still has one (the defect's
 * location at `c342fe0`); only look in `creator-evidence.ts` if `route.ts`'s
 * is gone (the query moved there), and even then skip any occurrence whose
 * statement mentions `githubId` — that is the pre-existing, unrelated,
 * already-correct lookup, not the moved batch query.
 */
function creatorsBatchQuery(): { path: string; statement: string; selectCall: string } {
  const routeText = readFileSync(ROUTE_PATH, 'utf8');
  const routeIdx = routeText.indexOf('.from(users)');
  if (routeIdx >= 0) {
    return extractAt(ROUTE_PATH, routeText, routeIdx);
  }

  if (!existsSync(EXTRACTED_PATH)) {
    throw new Error(
      `.from(users) is not in ${ROUTE_PATH} and ${EXTRACTED_PATH} does not exist — ` +
        'update this guard if the query moved somewhere else',
    );
  }
  const extractedText = readFileSync(EXTRACTED_PATH, 'utf8');
  let searchFrom = 0;
  for (;;) {
    const idx = extractedText.indexOf('.from(users)', searchFrom);
    if (idx === -1) {
      throw new Error(
        `.from(users) is not in ${ROUTE_PATH}, and ${EXTRACTED_PATH} has no occurrence beyond ` +
          'the pre-existing findDbUserByAccountKey lookup (keyed on githubId) — update this guard ' +
          'if the batch query moved somewhere else',
      );
    }
    const candidate = extractAt(EXTRACTED_PATH, extractedText, idx);
    if (!candidate.statement.includes('githubId')) return candidate;
    searchFrom = idx + 1;
  }
}

test('#366: the creators query has a .where(...) in its own statement', () => {
  const { statement, path } = creatorsBatchQuery();
  assert.ok(
    /\.where\(/.test(statement),
    `db.select(...).from(users) in ${path} has no .where(...) in its statement — every column ` +
      'of every user in the database ships on a public endpoint (#366). Filter by the page\'s ' +
      'creator ids, e.g. inArray(users.id, creatorIds) or the file\'s existing sql.join idiom.',
  );
});

test('#366: the creators query projects displayName rather than every column', () => {
  const { selectCall, path } = creatorsBatchQuery();
  assert.ok(
    /\.select\(\s*\{/.test(selectCall),
    `the creators query in ${path} is .select() with no projection — it selects every column. ` +
      'Project { id: users.id, displayName: users.displayName } — the only field ' +
      '@/lib/evidence/record-list.ts reads off the creator map.',
  );
  assert.ok(
    selectCall.includes('displayName'),
    `the creators query's projection in ${path} does not mention displayName`,
  );
});
