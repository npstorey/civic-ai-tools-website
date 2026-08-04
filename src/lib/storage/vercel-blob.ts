/**
 * Vercel Blob storage driver (S3b P3) — the default.
 *
 * This is the pre-seam behavior relocated verbatim behind the driver
 * interface: `put`/`del`/`list` from `@vercel/blob`, plain `fetch` for
 * retrieval (blobs are public URLs), and `handleUpload` from
 * `@vercel/blob/client` for the client-upload grant protocol. With
 * BLOB_DRIVER unset this driver is selected and behavior is unchanged.
 *
 * This module is the ONLY place in src/ that imports `@vercel/blob`.
 */

import { put, del, list } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import type { ClientUploadGrantContext, StorageDriver } from './driver';

export function createVercelBlobDriver(): StorageDriver {
  return {
    name: 'vercel-blob',

    async put(pathname, body, { contentType }) {
      const blob = await put(pathname, typeof body === 'string' ? body : Buffer.from(body), {
        access: 'public',
        addRandomSuffix: false,
        contentType,
      });
      return { url: blob.url };
    },

    async delete(url) {
      await del(url);
    },

    async list({ prefix, cursor, limit }) {
      const page = await list({ prefix, cursor, limit });
      return {
        items: page.blobs.map((b) => ({
          url: b.url,
          pathname: b.pathname,
          uploadedAt: new Date(b.uploadedAt).toISOString(),
          size: b.size,
        })),
        cursor: page.cursor,
        hasMore: page.hasMore,
      };
    },

    async getText(url) {
      const response = await fetch(url);
      if (!response.ok) return null;
      return response.text();
    },

    async grantClientUpload({ request, body, onBeforeGrant }: ClientUploadGrantContext) {
      const jsonResponse = await handleUpload({
        body: body as HandleUploadBody,
        request,
        onBeforeGenerateToken: async (pathname) => {
          // Policy (auth + pathname lock + caps) lives in the route's
          // onBeforeGrant so it is enforced identically on every driver.
          const caps = await onBeforeGrant(pathname);
          return {
            allowedContentTypes: caps.allowedContentTypes,
            maximumSizeInBytes: caps.maximumSizeInBytes,
            // addRandomSuffix: false — the 64-hex pathname IS the content-
            // addressable identifier. Adding a random suffix would break the
            // "same content always lives at the same URL" invariant.
            addRandomSuffix: false,
            // Allow the same content to be re-uploaded harmlessly (same hash
            // → same bytes → same blob). Prevents spurious "blob already
            // exists" errors when a user republishes similar content.
            allowOverwrite: true,
            tokenPayload: caps.tokenPayload,
          };
        },
        onUploadCompleted: async ({ blob }) => {
          // No database work needed here — evidence packages are the record
          // that references a blob, and the publisher's /api/evidence call
          // will create that record. Orphan blobs are reaped by the GC cron.
          console.log('[blob-upload-token] Upload completed', {
            pathname: blob.pathname,
            url: blob.url,
          });
        },
      });
      return jsonResponse as unknown as Record<string, unknown>;
    },
  };
}
