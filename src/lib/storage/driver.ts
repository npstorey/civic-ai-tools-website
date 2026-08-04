/**
 * Object-storage driver seam (S3b P3).
 *
 * Everything the app asks of blob storage goes through this interface:
 * content-addressed puts, deletes by stored URL, prefix listing (GC cron),
 * byte retrieval, and the client-upload grant that lets a browser or script
 * upload directly to storage without routing bytes through a Next.js body.
 *
 * Drivers sit BELOW package construction: they receive and return opaque
 * bytes. No re-encoding, no content-type-driven transforms — evidence bytes
 * must be identical regardless of which driver stored them.
 *
 * Driver selection lives in `./index.ts` (BLOB_DRIVER env var, mirroring the
 * DB_DRIVER pattern in `src/lib/db/index.ts`).
 */

/** Result of storing bytes: the public URL, saved as the DB storage key. */
export interface StoredBlob {
  url: string;
}

export interface BlobListItem {
  /** Public URL of the object (what `delete` and referenced-sets use). */
  url: string;
  /** Storage key relative to the store root, e.g. `evidence-refs/<sha256>`. */
  pathname: string;
  /** Upload timestamp, ISO-8601. Empty string when the backend omits it. */
  uploadedAt: string;
  /** Object size in bytes. */
  size: number;
}

export interface BlobListPage {
  items: BlobListItem[];
  /** Opaque pagination cursor — pass back to `list` to continue. */
  cursor?: string;
  hasMore: boolean;
}

/** Caps the route's policy layer hands to the driver for a client upload. */
export interface ClientUploadCaps {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  /** Opaque payload echoed through the driver's grant/callback machinery. */
  tokenPayload: string;
}

export interface ClientUploadGrantContext {
  /** The incoming token-mint request (the Vercel client-upload protocol
   *  needs it verbatim for callback-URL derivation and signature checks). */
  request: Request;
  /** Parsed JSON body of the token-mint POST. */
  body: unknown;
  /**
   * Policy callback owned by the route: authentication, authorization, and
   * the `evidence-refs/<sha256>` pathname lock all happen here, so the
   * invariant is enforced server-side identically on every driver. Drivers
   * MUST call this before granting anything and let its throw propagate.
   */
  onBeforeGrant(pathname: string): Promise<ClientUploadCaps>;
}

export interface StorageDriver {
  readonly name: string;

  /**
   * Store bytes at an exact pathname (no random suffix — pathnames are
   * content-addressed identifiers). Returns the public URL.
   */
  put(
    pathname: string,
    body: string | Uint8Array,
    opts: { contentType: string },
  ): Promise<StoredBlob>;

  /** Delete by stored URL. Throws on failure — callers decide whether to
   *  swallow (best-effort cleanup) or propagate (GC accounting). */
  delete(url: string): Promise<void>;

  /** Page through stored objects under a prefix. */
  list(opts: {
    prefix: string;
    cursor?: string;
    limit?: number;
  }): Promise<BlobListPage>;

  /** Retrieve stored content by URL as text (UTF-8). Returns null when the
   *  object is missing or the backend reports an error for the fetch. */
  getText(url: string): Promise<string | null>;

  /**
   * Mint a client-upload grant. The response body is JSON-serializable and
   * driver-shaped: the vercel-blob driver returns the Vercel client-upload
   * protocol response (`{ type, clientToken }`), the s3 driver returns a
   * presigned-PUT descriptor (`{ uploadMethod: 'presigned-put', url,
   * headers, pathname, blobUrl }`). Clients branch on `uploadMethod`.
   */
  grantClientUpload(ctx: ClientUploadGrantContext): Promise<Record<string, unknown>>;
}
