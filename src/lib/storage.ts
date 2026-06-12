import { put, del } from '@vercel/blob';
import crypto from 'crypto';

const EVIDENCE_PREFIX = 'evidence-packages';

/**
 * Store an immutable evidence package blob keyed by its content hash.
 * Returns the public URL of the stored blob (save this as the storage_key in the DB).
 */
export async function putPackage(
  hash: string,
  data: Record<string, unknown>
): Promise<string> {
  const pathname = `${EVIDENCE_PREFIX}/${hash}.json`;
  const blob = await put(pathname, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
  return blob.url;
}

/**
 * Store a COMMITTED evidence package blob under a random, non-hash-derivable
 * key (Phase 2 hard requirement, civic-ai-tools#71): the package hash is
 * public in the Rekor log, so a hash-derived pathname would let anyone with
 * the commitment fetch committed content. 128 bits of randomness make the
 * URL a capability held by the creator (and whoever they hand it to) until
 * publication moves the content to the canonical hash-addressed key.
 */
export async function putCommittedPackage(
  data: Record<string, unknown>
): Promise<string> {
  const randomKey = crypto.randomBytes(16).toString('hex');
  const pathname = `${EVIDENCE_PREFIX}/committed/${randomKey}.json`;
  const blob = await put(pathname, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
  return blob.url;
}

/**
 * Best-effort delete of a blob by URL. Used when publication re-homes a
 * committed package to its canonical hash-addressed key — the old random-key
 * blob is removed so the capability URL stops working. Failures are swallowed
 * (the canonical copy is already live; a stale duplicate is a cleanup concern,
 * not a correctness one).
 */
export async function deletePackageBlob(url: string): Promise<void> {
  try {
    await del(url);
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
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}
