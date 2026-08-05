// Server-side SQL predicate for the visibility vocabulary (ADR-0016 §A).
//
// Split out of `visibility.ts` so that module stays dependency-free: three
// CLIENT components normalize visibility labels, and pulling `drizzle-orm` into
// their bundles to do it would be a real cost for no gain.

import { sql, type SQL, type Column } from 'drizzle-orm';
import {
  SEALED_DB_VALUES,
  PUBLIC_DB_VALUES,
  type Visibility,
} from './visibility.ts';

/**
 * Match a `visibility` enum column against every DB label that denotes
 * `state` — both the legacy label and the ADR-0016 label — so a query keeps
 * selecting the right rows on either side of the M2 row flip, and on a replica
 * or fork that is part-way through the migration.
 *
 * WHY THE `::text` CAST. Comparing an enum column against a label the enum does
 * not (yet) hold is a hard Postgres error at coercion time —
 * `invalid input value for enum visibility: "public"` — not a non-match. Before
 * the M1 expand migration runs, `sealed` and `public` are exactly that: labels
 * the type does not hold. Casting the column to `text` makes both sides text,
 * so the predicate is a plain string comparison that is valid at every point in
 * the migration: it selects the same rows before M1 as `= '<legacy>'` did, and
 * the same rows after M2 without a second edit. There is no index on
 * `visibility` for the cast to defeat.
 */
export function visibilityMatches(column: Column, state: Visibility): SQL {
  const labels: readonly string[] =
    state === 'sealed' ? SEALED_DB_VALUES : PUBLIC_DB_VALUES;
  return sql`${column}::text in (${sql.join(
    labels.map((label) => sql`${label}`),
    sql`, `,
  )})`;
}
