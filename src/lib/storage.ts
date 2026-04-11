import { put } from '@vercel/blob';

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
