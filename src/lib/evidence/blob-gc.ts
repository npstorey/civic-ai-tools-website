// Orphan-blob GC sweep logic (Phase B.6 / website#75), extracted from the
// cron route in S3b P3 so it runs on the storage-driver interface and can be
// exercised directly (the route module can only export handlers).
//
// Semantics are unchanged from the original in-route implementation: list
// everything under `evidence-refs/`, keep anything referenced by a published
// package or younger than the grace window, delete the rest.

import { listBlobs, deleteBlob } from '../storage/index.ts';
import { isBlobRef } from './blob-ref.ts';

export const BLOB_PREFIX = 'evidence-refs/';
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SweepStats {
  scanned: number;
  deleted: number;
  skippedReferenced: number;
  skippedFresh: number;
}

/** Collect the blob URLs a single evidence package references in any of the
 *  BlobRef-capable fields (`output`, `trace`, `skillMetadata.skillText`). */
export function collectRefsFromPackage(
  pkg: Record<string, unknown>,
  urls: Set<string>,
): void {
  if (isBlobRef(pkg.output)) urls.add(pkg.output.url);
  if (isBlobRef(pkg.trace)) urls.add(pkg.trace.url);
  const skill = (pkg as { skillMetadata?: Record<string, unknown> })
    .skillMetadata;
  if (skill && isBlobRef(skill.skillText)) urls.add(skill.skillText.url);
}

/** Page through `evidence-refs/` and delete anything not referenced and
 *  past the grace window. Uses overwrite-tolerant uploads on the grant side
 *  to keep identical-content uploads idempotent, so delete-and-republish
 *  is safe even if another client is about to reference the same hash. */
export async function sweepOrphans(referenced: Set<string>): Promise<SweepStats> {
  const now = Date.now();
  let cursor: string | undefined;
  const stats: SweepStats = { scanned: 0, deleted: 0, skippedReferenced: 0, skippedFresh: 0 };

  do {
    const page = await listBlobs({ prefix: BLOB_PREFIX, cursor, limit: 1000 });
    for (const blob of page.items) {
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
      await deleteBlob(blob.url);
      stats.deleted++;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return stats;
}
