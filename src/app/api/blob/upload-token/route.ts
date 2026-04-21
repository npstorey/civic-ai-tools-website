import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { resolveRequestUser, hasScope } from '@/lib/api-auth';

/**
 * Presigned client-upload endpoint for evidence blob references
 * (Phase B.6, website#75).
 *
 * A client that wants to publish a large field as a content-addressable
 * blob calls `upload(pathname, body, { handleUploadUrl: '/api/blob/upload-token', ... })`
 * from `@vercel/blob/client`. That package sends a token-mint POST to this
 * route, we authenticate and authorise, then return a presigned token that
 * lets the browser PUT directly to Vercel Blob (bypassing the Next.js 4 MB
 * body cap on `/api/evidence`).
 *
 * Hash-based pathname convention: the client computes SHA-256 of the
 * content beforehand and targets `evidence-refs/<hash>[.ext]`. The server
 * validates the pathname shape so presigned tokens only mint URLs under
 * the `evidence-refs/` prefix and with a sha256-shaped filename.
 *
 * Auth pattern matches `/api/evidence`: NextAuth session cookie + matching
 * `users` row. Programmatic clients (Claude Code publish skill, etc.) reuse
 * the same session cookie they already present to `/api/evidence`.
 */

const PATHNAME_PATTERN = /^evidence-refs\/[0-9a-f]{64}(?:\.[a-z0-9]+)?$/;

// 100 MB covers the realistic content types we anticipate (full outputs,
// traces, multi-turn transcripts). Individual Vercel Blob objects can be
// up to 5 TB, so the cap is deliberately conservative to contain the blast
// radius if a session cookie is leaked.
const MAX_BLOB_SIZE_BYTES = 100 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'text/plain',
  'text/markdown',
  // Permissive fallback for uploaders that don't set content-type.
  'application/octet-stream',
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Authentication: same pattern as /api/evidence. Reject anonymous
        // uploads before minting the presigned token — otherwise the
        // evidence blob store is open to the world. Accepts either a
        // bearer token (preferred, device-flow minted, website#73) or a
        // NextAuth session cookie.
        const auth = await resolveRequestUser(request);
        if (!auth) {
          throw new Error('Authentication required');
        }
        if (!hasScope(auth, 'evidence:publish')) {
          throw new Error('Token missing required scope: evidence:publish');
        }

        // Pathname validation: lock uploads to `evidence-refs/<sha256>[.ext]`.
        // The 64-hex segment is the content hash the client advertises;
        // the final proof is the verifier downstream checking the content
        // actually hashes to that value.
        if (!PATHNAME_PATTERN.test(pathname)) {
          throw new Error(
            'Invalid pathname: expected evidence-refs/<sha256 hex>[.ext]',
          );
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BLOB_SIZE_BYTES,
          // addRandomSuffix: false — the 64-hex pathname IS the content-
          // addressable identifier. Adding a random suffix would break the
          // "same content always lives at the same URL" invariant.
          addRandomSuffix: false,
          // Allow the same content to be re-uploaded harmlessly (same hash
          // → same bytes → same blob). Prevents spurious "blob already
          // exists" errors when a user republishes similar content.
          allowOverwrite: true,
          tokenPayload: JSON.stringify({
            userId: auth.userId,
            pathname,
          }),
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
    return NextResponse.json(jsonResponse);
  } catch (error) {
    // handleUpload relies on a non-200 for its retry contract on the
    // onUploadCompleted leg; 400 is the convention surfaced in the docs.
    const message = error instanceof Error ? error.message : 'Upload token error';
    const status = message === 'Authentication required' ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
