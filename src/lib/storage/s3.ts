/**
 * S3-compatible storage driver (S3b P3) — any S3 API endpoint (AWS S3,
 * MinIO, Cloudflare R2, …). Selected with BLOB_DRIVER=s3.
 *
 * Environment:
 *   S3_ENDPOINT           endpoint URL (e.g. http://127.0.0.1:9000 for
 *                         MinIO); omit for AWS S3 proper
 *   S3_REGION             region (default us-east-1)
 *   S3_BUCKET             bucket name (required)
 *   S3_ACCESS_KEY_ID      access key (required)
 *   S3_SECRET_ACCESS_KEY  secret key (required)
 *   S3_FORCE_PATH_STYLE   'true'/'false' — default: true when S3_ENDPOINT is
 *                         set (MinIO needs path-style), false otherwise
 *   S3_PUBLIC_BASE_URL    public URL base for stored objects — default is
 *                         path-style `<endpoint>/<bucket>` when S3_ENDPOINT
 *                         is set, else the AWS virtual-hosted-style URL
 *
 * Byte discipline: bodies are passed to the SDK as raw bytes and read back
 * with UTF-8 decoding only — no re-encoding or content transforms. Flexible
 * checksums are set to WHEN_REQUIRED so the SDK adds no checksum headers
 * (some S3-compatibles reject them, and presigned PUTs must stay curl-able).
 *
 * Client-upload grant: a presigned PUT honoring the same contract as the
 * Vercel client-upload protocol — pathname locked by the route's policy
 * callback, content type restricted, and the size cap enforced by signing
 * the Content-Length and Content-Type headers into the URL (a PUT whose
 * headers differ from the granted values fails the signature check).
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ClientUploadGrantContext, StorageDriver } from './driver';

export interface S3DriverConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** No trailing slash. Object URL = `${publicBaseUrl}/${pathname}`. */
  publicBaseUrl: string;
}

/** How long a presigned client-upload PUT stays valid — mirrors the 1-hour
 *  validity of Vercel client-upload tokens. */
const PRESIGN_EXPIRES_SECONDS = 60 * 60;

/**
 * Resolve driver config from the environment. Exported (with an injectable
 * env) for unit tests. Throws when a required variable is missing — the
 * driver is constructed lazily, so this only fires when BLOB_DRIVER=s3.
 */
export function resolveS3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3DriverConfig {
  const endpoint = env.S3_ENDPOINT?.replace(/\/$/, '') || undefined;
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!bucket) throw new Error('BLOB_DRIVER=s3 requires S3_BUCKET');
  if (!accessKeyId) throw new Error('BLOB_DRIVER=s3 requires S3_ACCESS_KEY_ID');
  if (!secretAccessKey) throw new Error('BLOB_DRIVER=s3 requires S3_SECRET_ACCESS_KEY');
  const region = env.S3_REGION || 'us-east-1';
  const forcePathStyle = env.S3_FORCE_PATH_STYLE
    ? env.S3_FORCE_PATH_STYLE !== 'false'
    : Boolean(endpoint);
  const publicBaseUrl = (
    env.S3_PUBLIC_BASE_URL?.replace(/\/$/, '') ||
    (endpoint
      ? `${endpoint}/${bucket}`
      : `https://${bucket}.s3.${region}.amazonaws.com`)
  );
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, publicBaseUrl };
}

/**
 * Map a stored public URL back to its object key. Returns null when the URL
 * is not under the configured public base (e.g. a legacy Vercel Blob URL in
 * a record created before a driver switch).
 */
export function keyFromUrl(url: string, publicBaseUrl: string): string | null {
  const base = `${publicBaseUrl}/`;
  if (!url.startsWith(base)) return null;
  const key = url.slice(base.length).split('?')[0];
  return key.length > 0 ? decodeURIComponent(key) : null;
}

/** Shape of the token-mint POST body the s3 grant accepts — the Vercel
 *  client-upload protocol's `blob.generate-client-token` event, extended
 *  with `contentType`/`contentLength` payload fields (which the vercel
 *  driver's `handleUpload` ignores, so clients can always send them). */
interface GrantRequestBody {
  type?: string;
  payload?: {
    pathname?: unknown;
    contentType?: unknown;
    contentLength?: unknown;
  };
}

export function createS3Driver(config?: S3DriverConfig): StorageDriver {
  const cfg = config ?? resolveS3ConfigFromEnv();
  const client = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // No SDK-added checksum headers: keeps bodies/headers exactly as given
    // (byte parity) and keeps presigned PUTs usable by plain HTTP clients.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const objectUrl = (key: string): string => `${cfg.publicBaseUrl}/${key}`;

  const requireKey = (url: string): string => {
    const key = keyFromUrl(url, cfg.publicBaseUrl);
    if (!key) {
      throw new Error(`[storage:s3] URL is not under the configured public base: ${url}`);
    }
    return key;
  };

  return {
    name: 's3',

    async put(pathname, body, { contentType }) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: pathname,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return { url: objectUrl(pathname) };
    },

    async delete(url) {
      await client.send(
        new DeleteObjectCommand({ Bucket: cfg.bucket, Key: requireKey(url) }),
      );
    },

    async list({ prefix, cursor, limit }) {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: prefix,
          ContinuationToken: cursor,
          MaxKeys: limit,
        }),
      );
      return {
        items: (page.Contents ?? [])
          .filter((o): o is typeof o & { Key: string } => typeof o.Key === 'string')
          .map((o) => ({
            url: objectUrl(o.Key),
            pathname: o.Key,
            uploadedAt: o.LastModified?.toISOString() ?? '',
            size: o.Size ?? 0,
          })),
        cursor: page.NextContinuationToken,
        hasMore: Boolean(page.IsTruncated),
      };
    },

    async getText(url) {
      const key = keyFromUrl(url, cfg.publicBaseUrl);
      if (!key) {
        // Not one of ours (e.g. pre-switch Vercel Blob URL) — plain fetch,
        // matching the vercel driver's retrieval semantics.
        const response = await fetch(url);
        if (!response.ok) return null;
        return response.text();
      }
      try {
        const out = await client.send(
          new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
        );
        return (await out.Body?.transformToString('utf-8')) ?? null;
      } catch (err) {
        // Service-reported errors (NoSuchKey, AccessDenied, …) map to null —
        // the "fetch failed" contract of getPackage. Anything without S3
        // error metadata is a programming/transport bug and propagates.
        if (err && typeof err === 'object' && '$metadata' in err) return null;
        throw err;
      }
    },

    async grantClientUpload({ body, onBeforeGrant }: ClientUploadGrantContext) {
      const parsed = (body ?? {}) as GrantRequestBody;
      if (parsed.type !== 'blob.generate-client-token') {
        // The s3 driver has no upload-completed callback leg — orphan
        // handling is the GC cron's job on every driver.
        throw new Error('Invalid event type');
      }
      const pathname = parsed.payload?.pathname;
      if (typeof pathname !== 'string' || pathname.length === 0) {
        throw new Error('Missing pathname');
      }

      // Route-owned policy: auth + evidence-refs/<sha256> pathname lock.
      const caps = await onBeforeGrant(pathname);

      const contentType =
        typeof parsed.payload?.contentType === 'string' && parsed.payload.contentType
          ? parsed.payload.contentType
          : 'application/octet-stream';
      if (!caps.allowedContentTypes.includes(contentType)) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const contentLength = Number(parsed.payload?.contentLength);
      if (!Number.isInteger(contentLength) || contentLength <= 0) {
        throw new Error('contentLength (exact byte count) is required for presigned uploads');
      }
      if (contentLength > caps.maximumSizeInBytes) {
        throw new Error(`Content exceeds maximum size of ${caps.maximumSizeInBytes} bytes`);
      }

      // Sign Content-Type and Content-Length into the URL: the storage
      // backend rejects any PUT whose headers differ from the granted
      // values, which is what enforces the size/type caps server-side.
      const command = new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: pathname,
        ContentType: contentType,
        ContentLength: contentLength,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: PRESIGN_EXPIRES_SECONDS,
        signableHeaders: new Set(['host', 'content-type', 'content-length']),
      });

      return {
        type: 'blob.generate-client-token',
        // Discriminator for driver-aware clients: presence of
        // `uploadMethod: 'presigned-put'` (and absence of `clientToken`)
        // means "PUT the bytes to `url` with exactly these headers".
        uploadMethod: 'presigned-put',
        url,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(contentLength),
        },
        pathname,
        // Where the object will live once uploaded — what the client should
        // record as the BlobRef url.
        blobUrl: objectUrl(pathname),
        maximumSizeInBytes: caps.maximumSizeInBytes,
      };
    },
  };
}
