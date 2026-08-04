import { NextRequest, NextResponse } from 'next/server';
import { grantClientUpload } from '@/lib/storage';
import { resolveRequestUser, hasScope } from '@/lib/api-auth';

/**
 * Client-upload grant endpoint for evidence blob references
 * (Phase B.6, website#75; driver seam S3b P3).
 *
 * A client that wants to publish a large field as a content-addressable
 * blob POSTs the Vercel client-upload protocol's token-mint event here
 * (e.g. via `upload(pathname, body, { handleUploadUrl: '/api/blob/upload-token', ... })`
 * from `@vercel/blob/client`). We authenticate and authorise, then the
 * active storage driver mints the grant that lets the client PUT directly
 * to storage (bypassing the Next.js 4 MB body cap on `/api/evidence`):
 *
 *   - vercel-blob driver (default): `handleUpload` returns the unchanged
 *     protocol response `{ type, clientToken }` — behavior identical to
 *     the pre-seam route.
 *   - s3 driver: the response carries `uploadMethod: 'presigned-put'` plus
 *     `url` + `headers` — the client PUTs the bytes to that URL with
 *     exactly those headers (Content-Type and Content-Length are signed,
 *     which is what enforces the caps below server-side).
 *
 * Clients may include `contentType` and `contentLength` in the token-mint
 * payload; the s3 driver requires them, the vercel driver ignores them.
 *
 * Hash-based pathname convention: the client computes SHA-256 of the
 * content beforehand and targets `evidence-refs/<hash>[.ext]`. This route
 * validates the pathname shape for EVERY driver, so grants only mint
 * uploads under the `evidence-refs/` prefix with a sha256-shaped filename.
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
  const body: unknown = await request.json();

  try {
    const jsonResponse = await grantClientUpload({
      request,
      body,
      onBeforeGrant: async (pathname) => {
        // Authentication: same pattern as /api/evidence. Reject anonymous
        // uploads before minting any grant — otherwise the evidence blob
        // store is open to the world. Accepts either a bearer token
        // (preferred, device-flow minted, website#73) or a NextAuth
        // session cookie.
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
        // actually hashes to that value. Enforced here — on every driver —
        // rather than inside any driver.
        if (!PATHNAME_PATTERN.test(pathname)) {
          throw new Error(
            'Invalid pathname: expected evidence-refs/<sha256 hex>[.ext]',
          );
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BLOB_SIZE_BYTES,
          tokenPayload: JSON.stringify({
            userId: auth.userId,
            pathname,
          }),
        };
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
