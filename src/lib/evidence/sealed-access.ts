// Creator-only read gate for sealed records (civic-ai-tools#71 Phase 2).
//
// A sealed record's COMMITMENT (hash, signature, timestamp, Rekor proof) is
// public by design — it sits on a public transparency log. Its CONTENT, title,
// summary, and location are not: every content-bearing surface ([slug] read-back,
// package, bundle, verify, evaluate, replay, attestations, the detail page) is
// gated to the record's creator until publication. The commitment endpoint is
// the one public surface, served redacted (see commitment.ts).

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users, type evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveRequestUser } from '@/lib/api-auth';
import { isSealedDbValue } from '@/lib/evidence/visibility';

type VisibilityColumns = Pick<
  typeof evidenceRecords.$inferSelect,
  'visibility' | 'creatorId'
>;

/**
 * True for the not-yet-disclosed state, under EITHER label — the row may hold
 * the legacy `committed` or the ADR-0016 §A `sealed` (see
 * `@/lib/evidence/visibility`). Historical rows keep the legacy label
 * indefinitely, so this gate must never be keyed on one spelling.
 */
export function isSealedRecord(record: VisibilityColumns): boolean {
  return isSealedDbValue(record.visibility);
}

/**
 * Route-layer gate. Public records are readable by anyone (true without an
 * auth lookup). Sealed records require the requester to resolve — via
 * bearer token or session cookie (`resolveRequestUser` handles both) — to the
 * record's creator.
 */
export async function canReadRecord(
  request: NextRequest,
  record: VisibilityColumns,
): Promise<boolean> {
  if (!isSealedRecord(record)) return true;
  const auth = await resolveRequestUser(request).catch(() => null);
  return !!auth && auth.userId === record.creatorId;
}

/**
 * Server-component gate (no NextRequest available). Resolves the NextAuth
 * session's GitHub id to the internal user row and compares to the creator.
 */
export async function sessionUserIsCreator(
  record: VisibilityColumns,
): Promise<boolean> {
  const session = await getServerSession(authOptions);
  const githubId = session?.user?.id;
  if (!githubId) return false;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  return rows.length > 0 && rows[0].id === record.creatorId;
}
