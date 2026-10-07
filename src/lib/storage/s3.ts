/**
 * S3-compatible storage driver (S3b P3) — any S3 API endpoint (AWS S3,
 * MinIO, Cloudflare R2, …). Selected with BLOB_DRIVER=s3.
 *
 * Environment:
 *   S3_ENDPOINT           endpoint URL (e.g. http://127.0.0.1:9000 for
 *                         MinIO); omit for AWS S3 proper
 *   S3_REGION             region (default us-east-1)
 *   S3_BUCKET             bucket name (required)
 *   S3_ACCESS_KEY_ID      access key — set both keys, or neither (#554)
 *   S3_SECRET_ACCESS_KEY  secret key — set both keys, or neither (#554)
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
 *
 * Credentials (#554): with both keys set, the client signs with exactly that
 * pair. With neither set, the client is built with no `credentials`, and the
 * AWS SDK's default chain resolves them: the environment's AWS_* keys, the
 * shared config files, SSO, a credential process, web identity, then the
 * container and instance metadata endpoints. An instance on a platform that
 * provides role access therefore needs no long-lived key pair; the Lambda
 * executor resolves its client the same way (src/lib/sandbox/lambda.ts).
 * Exactly one key set is refused, naming the other. Building the driver logs
 * one line naming the source in use, never a value.
 *
 * Under the default chain the presigned PUT is signed with whatever the chain
 * resolved. A temporary credential puts its session token in the URL
 * (X-Amz-Security-Token), and the URL stops working when that credential
 * expires, even before PRESIGN_EXPIRES_SECONDS. The chain re-resolves a
 * credential that has under five minutes left (`credentialsTreatedAsExpired`
 * in @aws-sdk/credential-provider-node), so a URL is signed with at least
 * that much life left. docs/deploy.md states this for operators.
 */

import {
  S3Client,
  type S3ClientConfig,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
// The SDK's own fetch transport, pinned to the version `@aws-sdk/client-s3`
// resolves so both sides use one copy. See `proxyAwareTransport` below for why
// this driver needs it at all.
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
// Importing this installs the outbound dispatcher if one is called for; the
// predicate is what decides this driver's transport.
import { isOutboundProxyConfigured } from '../outbound-proxy.ts';
import type { ClientUploadGrantContext, StorageDriver } from './driver';

export interface S3DriverConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  /**
   * The S3 key pair: both, or neither. Neither means the client is built with
   * no `credentials` and the AWS SDK's default chain supplies them (#554).
   */
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  /** No trailing slash. Object URL = `${publicBaseUrl}/${pathname}`. */
  publicBaseUrl: string;
}

/** How long a presigned client-upload PUT stays valid — mirrors the 1-hour
 *  validity of Vercel client-upload tokens. */
const PRESIGN_EXPIRES_SECONDS = 60 * 60;

/** Where the client's credentials come from (#554). */
export type S3CredentialSource = 'key-pair' | 'default-chain';

/**
 * Which source a config selects: the key pair when both keys are set, the
 * SDK's default chain when neither is. An empty string counts as unset.
 * Exactly one set throws, naming the missing variable and no value.
 */
export function s3CredentialSource(
  cfg: Pick<S3DriverConfig, 'accessKeyId' | 'secretAccessKey'>,
): S3CredentialSource {
  const hasId = Boolean(cfg.accessKeyId);
  const hasSecret = Boolean(cfg.secretAccessKey);
  if (hasId && hasSecret) return 'key-pair';
  if (!hasId && !hasSecret) return 'default-chain';
  const [missing, present] = hasId
    ? ['S3_SECRET_ACCESS_KEY', 'S3_ACCESS_KEY_ID']
    : ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  throw new Error(
    `BLOB_DRIVER=s3 requires ${missing} when ${present} is set ` +
      '(set both, or neither to use the AWS SDK default credential chain)',
  );
}

/** The one line driver construction logs: the source's name, never a value. */
export function s3CredentialSourceLine(source: S3CredentialSource): string {
  return source === 'key-pair'
    ? '[storage:s3] credential source: the S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY key pair'
    : '[storage:s3] credential source: the AWS SDK default chain (S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY unset)';
}

/**
 * Resolve driver config from the environment. Exported (with an injectable
 * env) for unit tests. Throws when a required variable is missing, or when
 * only one of the two keys is set — the driver is constructed lazily, so this
 * only fires when BLOB_DRIVER=s3.
 */
export function resolveS3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3DriverConfig {
  const endpoint = env.S3_ENDPOINT?.replace(/\/$/, '') || undefined;
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID || undefined;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || undefined;
  if (!bucket) throw new Error('BLOB_DRIVER=s3 requires S3_BUCKET');
  // Both keys, or neither (#554): throws naming the missing one.
  const source = s3CredentialSource({ accessKeyId, secretAccessKey });
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
  return {
    endpoint,
    region,
    bucket,
    ...(source === 'key-pair' ? { accessKeyId, secretAccessKey } : {}),
    forcePathStyle,
    publicBaseUrl,
  };
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

/**
 * The transport this driver's SDK client uses — and the one place in the
 * application where a proxy needs more than the global dispatcher (#468).
 *
 * THE MEASUREMENT. A global `undici` dispatcher governs `fetch`. The AWS SDK's
 * default Node transport is `@smithy/node-http-handler`, which speaks
 * `node:http(s)` directly: driven against a loopback server with all three
 * counted, this driver's writes came out `{fetch:0, nodeHttp:1}` while
 * `getText`'s fallback below (`fetch(url)`, for a URL not under this
 * instance's public base) came out `{fetch:1, nodeHttp:0}`. Under one global
 * dispatcher, half of this driver would be proxied and half would not — the
 * worst of the three outcomes, because it looks like it works.
 *
 * THE FIX SHAPE. With a proxy configured, hand the client the SDK's own fetch
 * transport. Every request the SDK makes then goes through `fetch`, which the
 * one dispatcher governs, and `NO_PROXY` still decides per destination whether
 * a given request is tunnelled or direct. Nothing here re-implements proxy
 * selection.
 *
 * WITH NO PROXY CONFIGURED THIS RETURNS NOTHING and the client keeps the SDK's
 * default Node transport — the same transport, the same sockets, the same
 * requests this driver has always made.
 *
 * WHAT AN OPERATOR MUST KNOW: a compose or Kubernetes deployment reaches its
 * object store by service name (`http://minio:9000`), and a service name is not
 * loopback. Setting a proxy without naming it in `NO_PROXY` sends the object
 * store's traffic to the egress proxy. docs/deploy.md says so beside the
 * variables.
 */
export function proxyAwareTransport(): { requestHandler?: FetchHttpHandler } {
  return isOutboundProxyConfigured() ? { requestHandler: new FetchHttpHandler() } : {};
}

/**
 * The SDK client configuration for a driver config. Exported so the storage
 * rehearsal's independent read client is built exactly as the driver's is.
 * With the key pair it carries exactly that pair; with neither key it carries
 * no `credentials` at all, which is what hands resolution to the SDK's default
 * chain (#554). A config with one key throws, as `s3CredentialSource` does.
 */
export function s3ClientConfig(cfg: S3DriverConfig): S3ClientConfig {
  const source = s3CredentialSource(cfg);
  return {
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle,
    ...proxyAwareTransport(),
    ...(source === 'key-pair' && cfg.accessKeyId && cfg.secretAccessKey
      ? { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } }
      : {}),
    // No SDK-added checksum headers: keeps bodies/headers exactly as given
    // (byte parity) and keeps presigned PUTs usable by plain HTTP clients.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

export function createS3Driver(config?: S3DriverConfig): StorageDriver {
  const cfg = config ?? resolveS3ConfigFromEnv();
  const client = new S3Client(s3ClientConfig(cfg));
  // One line per driver built (the storage module caches its driver, so once
  // per process): which source signs this instance's requests, by name only.
  console.log(s3CredentialSourceLine(s3CredentialSource(cfg)));

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
