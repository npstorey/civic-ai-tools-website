import { NextRequest, NextResponse } from 'next/server';
import { list, del } from '@vercel/blob';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { getPackage } from '@/lib/storage';
import { isBlobRef } from '@/lib/evidence/blob-ref';

/**
 * Orphan-blob garbage collection (Phase B.6 / website#75).
 *
 * Invoked by Vercel Cron per `vercel.json` on a daily schedule. Lists
 * every blob stored under `evidence-refs/`, builds the set of URLs
 * currently referenced by any published evidence package, and deletes
 * blobs that are (a) not referenced and (b) older than the orphan
 * threshold. This limits storage cost from abandoned preflight uploads
 * without racing the publish API — a publisher uploading a blob right
 * now hasn't had a chance to persist the reference yet, so the threshold
 * provides a grace window.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every
 * invocation. Requests missing or failing that check are rejected so the
 * endpoint can't be invoked externally.
 */

const BLOB_PREFIX = 'evidence-refs/';
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(request: NextRequest) {
  // Auth: cron secret header. See https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const referenced = await collectReferencedBlobUrls();
    const stats = await sweepOrphans(referenced);
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error('[blob-gc] run failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

/** Walk every published evidence package and collect the set of blob URLs
 *  referenced in any of the `BLOB_REF_FIELDS`. Fetches in parallel because
 *  the registry is small today (<1000 records); if that changes this loop
 *  becomes a chunked sweep or a dedicated `referenced_blobs` table. */
async function collectReferencedBlobUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  const records = await db
    .select({ storageKey: evidenceRecords.basePackageStorageKey })
    .from(evidenceRecords);

  const pkgFetches = records
    .filter((r): r is { storageKey: string } => !!r.storageKey)
    .map((r) => getPackage(r.storageKey));
  const pkgs = await Promise.all(pkgFetches);

  for (const pkg of pkgs) {
    if (!pkg) continue;
    collectRefsFromPackage(pkg, urls);
  }
  return urls;
}

function collectRefsFromPackage(
  pkg: Record<string, unknown>,
  urls: Set<string>,
): void {
  if (isBlobRef(pkg.output)) urls.add(pkg.output.url);
  if (isBlobRef(pkg.trace)) urls.add(pkg.trace.url);
  const skill = (pkg as { skillMetadata?: Record<string, unknown> })
    .skillMetadata;
  if (skill && isBlobRef(skill.skillText)) urls.add(skill.skillText.url);
}

interface SweepStats {
  scanned: number;
  deleted: number;
  skippedReferenced: number;
  skippedFresh: number;
}

/** Page through `evidence-refs/` and delete anything not referenced and
 *  past the grace window. Uses `allowOverwrite: true` on the upload side
 *  to keep identical-content uploads idempotent, so delete-and-republish
 *  is safe even if another client is about to reference the same hash. */
async function sweepOrphans(referenced: Set<string>): Promise<SweepStats> {
  const now = Date.now();
  let cursor: string | undefined;
  const stats: SweepStats = { scanned: 0, deleted: 0, skippedReferenced: 0, skippedFresh: 0 };

  do {
    const page = await list({ prefix: BLOB_PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      stats.scanned++;
      if (referenced.has(blob.url)) {
        stats.skippedReferenced++;
        continue;
      }
      const uploadedAt = new Date(blob.uploadedAt).getTime();
      if (Number.isFinite(uploadedAt) && now - uploadedAt < ORPHAN_GRACE_MS) {
        stats.skippedFresh++;
        continue;
      }
      await del(blob.url);
      stats.deleted++;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return stats;
}
