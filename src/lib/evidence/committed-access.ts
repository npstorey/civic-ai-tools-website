// Creator-only read gate for committed records (civic-ai-tools#71 Phase 2).
//
// A committed record's COMMITMENT (hash, signature, timestamp, Rekor proof) is
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

type VisibilityColumns = Pick<
  typeof evidenceRecords.$inferSelect,
  'visibility' | 'creatorId'
>;

export function isCommittedRecord(record: VisibilityColumns): boolean {
  return record.visibility === 'committed';
}

/**
 * Route-layer gate. Published records are readable by anyone (true without an
 * auth lookup). Committed records require the requester to resolve — via
 * bearer token or session cookie (`resolveRequestUser` handles both) — to the
 * record's creator.
 */
export async function canReadRecord(
  request: NextRequest,
  record: VisibilityColumns,
): Promise<boolean> {
  if (!isCommittedRecord(record)) return true;
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
