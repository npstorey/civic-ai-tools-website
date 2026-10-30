// A blob's text, fetched once and checked against its reference (the W3 fix,
// moved here from the record page by R10 P1b, #694, so the record page's
// output and section B's system prompt use one check).
//
// Browser-safe: `verifyBlobRef` is verify-core's, and the fetch is the global
// one unless a caller injects another.

import { verifyBlobRef, type BlobRef } from './blob-ref.ts';

/** A blob, fetched once and checked: its text only when its bytes verified. */
export type BlobTextResolution =
  | { state: 'verified'; text: string }
  | { state: 'unavailable' }
  | { state: 'mismatch' };

/** Fetch a blob ONCE, then check THOSE bytes against the reference with
 *  verify-core's own check (`verifyBlobRef`, size then SHA-256), handed the
 *  bytes already held rather than a second fetch, so the bytes that are
 *  checked are the bytes that are rendered. The request is the one
 *  `fetchBlobRefText` makes (a plain GET, 15 s), read as bytes rather than
 *  text, because the check reads bytes. A blob that cannot be fetched is
 *  `unavailable`; one whose bytes do not verify, for any of the check's
 *  reasons, is `mismatch`, and its bytes are not returned. */
export async function resolveBlobText(
  ref: BlobRef,
  options: { fetch?: typeof fetch } = {},
): Promise<BlobTextResolution> {
  const fetcher = options.fetch ?? globalThis.fetch;
  let bytes: Uint8Array;
  try {
    const response = await fetcher(ref.url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { state: 'unavailable' };
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { state: 'unavailable' };
  }
  const held = bytes;
  const check = await verifyBlobRef(ref, { fetch: async () => new Response(new Uint8Array(held)) });
  if (!check.ok) return { state: 'mismatch' };
  return { state: 'verified', text: new TextDecoder().decode(held) };
}
