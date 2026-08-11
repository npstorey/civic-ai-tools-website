// The dashboard's evidence-records-by-creator data path, extracted so other
// server components can key on it without duplicating the join logic (#239).
//
// Two steps every by-creator surface shares:
//   1. session account key (`users.githubId` — the provider-account key
//      column; see src/lib/auth-providers.ts) → internal user row;
//   2. `evidenceRecords.creatorId` keyed on that row's id.
//
// `(app)/dashboard/page.tsx` consumes step 1 (`findDbUserByAccountKey`) and
// runs the full record selection itself — it needs every column of every
// record. The `/ask` first-run orientation block consumes
// `hasPublishedEvidence`: the same keying narrowed to an existence probe —
// one row, one column — because "has this user ever published" must not pay
// for the dashboard's full listing on every `/ask` render.

import { db } from '@/lib/db';
import { users, evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/** The internal user row for a session's provider-account key, or null. */
export async function findDbUserByAccountKey(
  accountKey: string,
): Promise<{ id: string; displayName: string } | null> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.githubId, accountKey))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Has this account ever published an evidence record? The dashboard's
 * by-creator keying, narrowed to existence. ANY record counts — withdrawn,
 * sealed, and public alike — because each is a publish the user performed:
 * the #239 block orients a user who has never published, not one whose
 * records are merely private or since withdrawn.
 */
export async function hasPublishedEvidence(accountKey: string): Promise<boolean> {
  const user = await findDbUserByAccountKey(accountKey);
  if (user === null) return false;
  const rows = await db
    .select({ id: evidenceRecords.id })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.creatorId, user.id))
    .limit(1);
  return rows.length > 0;
}
