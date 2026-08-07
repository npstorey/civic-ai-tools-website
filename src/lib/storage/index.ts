import type { BlobListPage, ClientUploadGrantContext, StorageDriver } from './driver';
import crypto from 'crypto';

const EVIDENCE_PREFIX = 'evidence-packages';

let _driver: StorageDriver | null = null;

/**
 * Driver selection (BLOB_DRIVER env var), mirroring the DB_DRIVER pattern in
 * `src/lib/db/index.ts`:
 *   - 'vercel-blob' (default): Vercel Blob — the demo deployment's behavior,
 *     unchanged when the var is unset.
 *   - 's3': any S3-compatible endpoint (AWS S3, MinIO, R2, …) via
 *     `@aws-sdk/client-s3`; see `./s3.ts` for the S3_* environment contract.
 *
 * Drivers are loaded lazily (dynamic import inside the factory) so the
 * non-selected driver's SDK never loads, and module import stays safe when
 * storage env vars are absent (e.g. during `next build`).
 */
async function createDriver(): Promise<StorageDriver> {
  const driver = process.env.BLOB_DRIVER || 'vercel-blob';
  if (driver === 's3') {
    const { createS3Driver } = await import('./s3.ts');
    return createS3Driver();
  }
  if (driver !== 'vercel-blob') {
    throw new Error(`Unsupported BLOB_DRIVER "${driver}" (expected "vercel-blob" or "s3")`);
  }
  const { createVercelBlobDriver } = await import('./vercel-blob.ts');
  return createVercelBlobDriver();
}

async function getDriver(): Promise<StorageDriver> {
  if (!_driver) {
    _driver = await createDriver();
  }
  return _driver;
}

/**
 * Store an immutable evidence package blob keyed by its content hash.
 * Returns the public URL of the stored blob (save this as the storage_key in the DB).
 */
export async function putPackage(
  hash: string,
  data: Record<string, unknown>
): Promise<string> {
  const pathname = `${EVIDENCE_PREFIX}/${hash}.json`;
  const driver = await getDriver();
  const blob = await driver.put(pathname, JSON.stringify(data), {
    contentType: 'application/json',
  });
  return blob.url;
}

/**
 * Store a SEALED evidence package blob under a random, non-hash-derivable
 * key (Phase 2 hard requirement, civic-ai-tools#71): the package hash is
 * public in the Rekor log, so a hash-derived pathname would let anyone with
 * the commitment fetch sealed content. 128 bits of randomness make the
 * URL a capability held by the creator (and whoever they hand it to) until
 * publication moves the content to the canonical hash-addressed key.
 *
 * DELIBERATELY NOT RENAMED by the ADR-0016 §A sweep: the `committed/` path
 * segment below is a FROZEN STORAGE LITERAL, not a state label.
 *
 * Renaming it would NOT strand existing packages — every consumer reads the
 * stored key off the row (`base_package_storage_key`) and hands it to
 * `getPackage()`, and the GC selects stored keys from the database; nothing
 * reconstructs the path from visibility state. What renaming would actually
 * produce is a split storage layout for no benefit, plus a hazard for future
 * code that DOES try to derive the path. The freeze is worth keeping for a
 * simpler reason: a stored capability URL is a value someone already holds.
 *
 * The function name tracks the path it writes so the two cannot drift apart.
 * The state label that used to spell this word now reads `sealed` everywhere
 * it is a state label — see `src/lib/evidence/visibility.ts`.
 */
export async function putCommittedPackage(
  data: Record<string, unknown>
): Promise<string> {
  const randomKey = crypto.randomBytes(16).toString('hex');
  const pathname = `${EVIDENCE_PREFIX}/committed/${randomKey}.json`;
  const driver = await getDriver();
  const blob = await driver.put(pathname, JSON.stringify(data), {
    contentType: 'application/json',
  });
  return blob.url;
}

/**
 * Best-effort delete of a blob by URL. Used when publication re-homes a
 * sealed package to its canonical hash-addressed key — the old random-key
 * blob is removed so the capability URL stops working. Failures are swallowed
 * (the canonical copy is already live; a stale duplicate is a cleanup concern,
 * not a correctness one).
 */
export async function deletePackageBlob(url: string): Promise<void> {
  try {
    const driver = await getDriver();
    await driver.delete(url);
  } catch (err) {
    console.warn('[storage] blob delete failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/**
 * Retrieve an evidence package blob by its stored URL (from the DB storage_key column).
 * Returns null if the fetch fails.
 */
export async function getPackage(
  url: string
): Promise<Record<string, unknown> | null> {
  const driver = await getDriver();
  const text = await driver.getText(url);
  if (text === null) return null;
  return JSON.parse(text);
}

/**
 * Delete a blob by URL, PROPAGATING failures (unlike `deletePackageBlob`).
 * Used by the GC cron, whose error accounting depends on the throw.
 */
export async function deleteBlob(url: string): Promise<void> {
  const driver = await getDriver();
  await driver.delete(url);
}

/** Page through stored blobs under a prefix (GC cron). */
export async function listBlobs(opts: {
  prefix: string;
  cursor?: string;
  limit?: number;
}): Promise<BlobListPage> {
  const driver = await getDriver();
  return driver.list(opts);
}

/**
 * Mint a client-upload grant via the active driver. The route supplies the
 * policy callback (auth + pathname lock + caps); the driver supplies the
 * protocol (Vercel client-upload token vs. presigned S3 PUT).
 */
export async function grantClientUpload(
  ctx: ClientUploadGrantContext,
): Promise<Record<string, unknown>> {
  const driver = await getDriver();
  return driver.grantClientUpload(ctx);
}

export type { BlobListItem, BlobListPage, ClientUploadCaps, ClientUploadGrantContext, StorageDriver } from './driver';
