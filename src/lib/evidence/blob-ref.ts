import crypto from 'crypto';

/**
 * Content-addressable blob references for evidence package fields.
 *
 * Large fields (full output text, OpenTelemetry trace JSON, composed skill
 * guidance, multi-turn transcripts) can be stored as a separate Vercel Blob
 * and referenced from the package JSON rather than inlined. The package hash
 * still binds the reference (because the BlobRef object is part of the
 * canonical JSON), and the referenced content has its own SHA-256 so
 * consumers can verify each piece independently.
 *
 * Format of `ref`: `blob:sha256:<64 hex chars>`.
 *
 * The `url` is the Vercel Blob public URL returned by the upload-token flow.
 * `contentType` and `size` are metadata hints for renderers so they can
 * decide whether to fetch eagerly or lazily without a preflight HEAD.
 */
export interface BlobRef {
  ref: string;
  url: string;
  contentType: string;
  size: number;
}

const REF_PATTERN = /^blob:sha256:([0-9a-f]{64})$/;

/**
 * Detect whether a field value is a BlobRef object. Used by the packager,
 * verifier, and detail-page renderer to branch between inline content and
 * blob-referenced content.
 */
export function isBlobRef(value: unknown): value is BlobRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ref === 'string' &&
    REF_PATTERN.test(v.ref) &&
    typeof v.url === 'string' &&
    typeof v.contentType === 'string' &&
    typeof v.size === 'number'
  );
}

export interface ParsedBlobRef {
  algo: 'sha256';
  hash: string;
}

/**
 * Parse a `blob:sha256:<hash>` reference string into its components.
 * Throws if the format is invalid.
 */
export function parseBlobRef(ref: string): ParsedBlobRef {
  const match = REF_PATTERN.exec(ref);
  if (!match) {
    throw new Error(`Invalid blob reference: expected "blob:sha256:<64 hex>", got "${ref}"`);
  }
  return { algo: 'sha256', hash: match[1] };
}

// Source-of-truth array (not just a type) so the trust-signal vocabulary
// (civic-ai-tools-website#110) can enumerate every BlobRef failure reason at
// runtime. Each reason is a sub-explanation of a failed (Alarm-tier) BlobRef
// integrity check (#9). Behavior-preserving: the derived type is identical to
// the prior hand-written union.
export const BLOB_REF_VERIFY_REASONS = [
  'invalid_ref',
  'fetch_failed',
  'size_mismatch',
  'hash_mismatch',
] as const;
export type BlobRefVerifyReason = (typeof BLOB_REF_VERIFY_REASONS)[number];

export interface BlobRefVerifyResult {
  ok: boolean;
  reason?: BlobRefVerifyReason;
  /** SHA-256 of the fetched blob content, if fetched. Lets callers surface
   *  both the expected (ref) and actual hash when they mismatch. */
  computedHash?: string;
  /** Byte length of the fetched blob. */
  computedSize?: number;
}

/**
 * Fetch a blob and verify that its SHA-256 matches the reference hash and
 * that its byte size matches the metadata. Returns a structured result;
 * never throws.
 *
 * Used by the server-side verifier and by offline consumers walking the
 * evidence record. Fetches over HTTPS without auth (Vercel Blob public
 * access is the storage default for evidence content).
 */
export async function verifyBlobRef(
  ref: BlobRef,
  options: { signal?: AbortSignal } = {},
): Promise<BlobRefVerifyResult> {
  let parsed: ParsedBlobRef;
  try {
    parsed = parseBlobRef(ref.ref);
  } catch {
    return { ok: false, reason: 'invalid_ref' };
  }

  let response: Response;
  try {
    response = await fetch(ref.url, {
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'fetch_failed' };
  }

  let bytes: Uint8Array;
  try {
    const buffer = await response.arrayBuffer();
    bytes = new Uint8Array(buffer);
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }

  const computedSize = bytes.byteLength;
  if (computedSize !== ref.size) {
    return { ok: false, reason: 'size_mismatch', computedSize };
  }

  const computedHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (computedHash !== parsed.hash) {
    return { ok: false, reason: 'hash_mismatch', computedHash, computedSize };
  }

  return { ok: true, computedHash, computedSize };
}

/**
 * Compute the canonical `blob:sha256:<hash>` reference string for content
 * bytes. Used by uploaders that are about to stash content in Vercel Blob
 * and need to construct the matching BlobRef object.
 */
export function computeBlobRefHash(content: string | Uint8Array): string {
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Fetch a BlobRef's content as a UTF-8 string. Used by the detail-page
 * renderer to resolve output-level BlobRefs for server-side rendering.
 * Returns null on any failure; callers can fall back to showing only the
 * reference metadata rather than blocking the page render.
 */
export async function fetchBlobRefText(
  ref: BlobRef,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  try {
    const response = await fetch(ref.url, {
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
