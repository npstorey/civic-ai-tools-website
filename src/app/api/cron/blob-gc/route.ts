import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { getPackage } from '@/lib/storage';
import { collectRefsFromPackage, sweepOrphans } from '@/lib/evidence/blob-gc';

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
 * The sweep itself lives in `@/lib/evidence/blob-gc` (S3b P3), running on
 * the storage-driver interface — the route contributes cron auth and the
 * DB walk that builds the referenced set.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every
 * invocation. Requests missing or failing that check are rejected so the
 * endpoint can't be invoked externally.
 */

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
