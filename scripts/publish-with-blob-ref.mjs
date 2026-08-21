#!/usr/bin/env node
//
// Phase B.6 (website#75) — end-to-end BlobRef publish walkthrough.
//
// Uploads a sample output string as a content-addressable blob, then
// publishes a record package that references it instead of inlining.
// Run against production (or the Vercel preview, with a preview session
// cookie) to confirm the full upload-token → publish → verify path works.
//
// Usage:
//   export CIVICAITOOLS_SESSION_TOKEN="<__Secure-next-auth.session-token value>"
//   node scripts/publish-with-blob-ref.mjs --base-url https://...
//
// --base-url is required (civic-ai-tools#155 P1 E4): this script exists to
// smoke-test a specific deployed instance end-to-end, so it refuses to guess
// which one rather than silently defaulting to the reference production
// host — the same reasoning behind removing SOCRATA_MCP_URL's hosted-host
// default (see docs/deploy.md). For preview URLs, supply the full hostname
// (including the path-protection cookie value if the preview has SSO —
// upload flow will 401 without it).

import crypto from 'node:crypto';
import process from 'node:process';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const rawBaseUrl = arg('--base-url', undefined);
if (!rawBaseUrl) {
  console.error(
    'Missing required flag --base-url. This script targets a specific deployed ' +
      'instance and refuses to guess which one — pass e.g. --base-url https://your-instance.example.',
  );
  process.exit(2);
}
const BASE_URL = rawBaseUrl.replace(/\/$/, '');
const SESSION_TOKEN = process.env.CIVICAITOOLS_SESSION_TOKEN;
if (!SESSION_TOKEN) {
  console.error(
    'Set CIVICAITOOLS_SESSION_TOKEN to the value of __Secure-next-auth.session-token ' +
      'from a signed-in civicaitools.org browser session.',
  );
  process.exit(2);
}

// --- 1. Mint an upload token ---------------------------------------------
// The upload helper in @vercel/blob/client goes through two steps:
//   a) POST /api/blob/upload-token with `{type: "blob.generate-client-token", ...}`
//   b) PUT the content to the URL the token returns.
// Reproducing that dance with stdlib fetch keeps this script dependency-free.

const SAMPLE_OUTPUT = [
  '# BlobRef smoke-test output',
  '',
  'This package was published via the Phase B.6 content-addressable blob',
  'reference path. The `output` field below is a BlobRef pointing at this',
  'text rather than inlining the content, so the publish request body is',
  'tiny regardless of how long the analysis text is.',
  '',
  `Generated at ${new Date().toISOString()} by publish-with-blob-ref.mjs.`,
].join('\n');
const OUTPUT_BYTES = new TextEncoder().encode(SAMPLE_OUTPUT);
const OUTPUT_HASH = crypto.createHash('sha256').update(OUTPUT_BYTES).digest('hex');
// `evidence-refs/` is exempt-frozen under Appendix J (civic-ai-tools#160): the
// prefix is hash-frozen inside every already-signed BlobRef, so it's
// recorded rather than renamed. See docs/api/records-publish.md.
const OUTPUT_PATHNAME = `evidence-refs/${OUTPUT_HASH}.md`;
const OUTPUT_CONTENT_TYPE = 'text/markdown';

console.log('[1/4] Minting upload token…');
const tokenRes = await fetch(`${BASE_URL}/api/blob/upload-token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: `__Secure-next-auth.session-token=${SESSION_TOKEN}`,
  },
  body: JSON.stringify({
    type: 'blob.generate-client-token',
    payload: {
      pathname: OUTPUT_PATHNAME,
      callbackUrl: `${BASE_URL}/api/blob/upload-token`,
      clientPayload: null,
      multipart: false,
      // Driver-seam extension (S3b P3): instances running BLOB_DRIVER=s3
      // need the exact content type + byte count to mint a presigned PUT
      // (both get signed into the URL). The default vercel-blob driver
      // ignores these two fields, so it is always safe to send them.
      contentType: OUTPUT_CONTENT_TYPE,
      contentLength: OUTPUT_BYTES.byteLength,
    },
  }),
});
if (!tokenRes.ok) {
  const text = await tokenRes.text();
  console.error(`Token mint failed (${tokenRes.status}): ${text.slice(0, 500)}`);
  process.exit(1);
}
const tokenJson = await tokenRes.json();
if (tokenJson.uploadMethod !== 'presigned-put') {
  if (!tokenJson.clientToken) {
    console.error('No clientToken in response:', tokenJson);
    process.exit(1);
  }
  console.log('  ✓ token received');
}

// --- 2. Upload the blob directly -----------------------------------------
// The grant response is driver-shaped:
//   - vercel-blob (default): `{ clientToken }` — PUT to blob.vercel-storage.com
//     with Authorization: Bearer <clientToken>, mirroring what
//     @vercel/blob/client does internally; documented at
//     https://vercel.com/docs/vercel-blob/using-blob-sdk.
//   - s3: `{ uploadMethod: 'presigned-put', url, headers, blobUrl }` — a
//     plain PUT of the bytes to the presigned URL with exactly the granted
//     headers.

console.log(`[2/4] Uploading ${OUTPUT_BYTES.byteLength} bytes to ${OUTPUT_PATHNAME}…`);
let BLOB_URL;
if (tokenJson.uploadMethod === 'presigned-put') {
  const uploadRes = await fetch(tokenJson.url, {
    method: 'PUT',
    headers: tokenJson.headers,
    body: OUTPUT_BYTES,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    console.error(`Presigned upload failed (${uploadRes.status}): ${text.slice(0, 500)}`);
    process.exit(1);
  }
  BLOB_URL = tokenJson.blobUrl;
  if (!BLOB_URL) {
    console.error('No blobUrl in presigned-put grant:', tokenJson);
    process.exit(1);
  }
} else {
  const clientToken = tokenJson.clientToken;
  const uploadRes = await fetch(`https://blob.vercel-storage.com/${OUTPUT_PATHNAME}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      'Content-Type': OUTPUT_CONTENT_TYPE,
      'x-content-type': OUTPUT_CONTENT_TYPE,
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
    },
    body: OUTPUT_BYTES,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    console.error(`Blob upload failed (${uploadRes.status}): ${text.slice(0, 500)}`);
    process.exit(1);
  }
  const uploadJson = await uploadRes.json();
  BLOB_URL = uploadJson.url;
  if (!BLOB_URL) {
    console.error('No url in upload response:', uploadJson);
    process.exit(1);
  }
}
console.log(`  ✓ stored at ${BLOB_URL}`);

// Build the BlobRef object. This is what the record-package schema expects in the
// `output` field (or any BlobRef-capable field).
const outputBlobRef = {
  ref: `blob:sha256:${OUTPUT_HASH}`,
  url: BLOB_URL,
  contentType: OUTPUT_CONTENT_TYPE,
  size: OUTPUT_BYTES.byteLength,
};

// --- 3. Publish the record package referencing the blob ------------------

console.log('[3/4] Publishing record package with BlobRef output…');
const publishRes = await fetch(`${BASE_URL}/api/records`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: `__Secure-next-auth.session-token=${SESSION_TOKEN}`,
  },
  body: JSON.stringify({
    trace: { resourceSpans: [] },
    prompt: 'Publish-with-blob-ref smoke test — Phase B.6 website#75',
    output: outputBlobRef,
    toolCalls: [],
    model: 'anthropic/claude-opus-4-7',
    portal: 'n/a',
    tokenUsage: { promptTokens: 0, completionTokens: 0 },
    duration_ms: 0,
    promptVisibility: 'full_text',
    title: 'BlobRef smoke test (Phase B.6)',
    summary:
      'End-to-end validation of content-addressable blob references. The output field is a BlobRef rather than inline text; the verify endpoint should follow the reference and confirm the hash matches.',
  }),
});
if (!publishRes.ok) {
  const text = await publishRes.text();
  console.error(`Publish failed (${publishRes.status}): ${text.slice(0, 500)}`);
  process.exit(1);
}
const publishJson = await publishRes.json();
console.log(`  ✓ slug: ${publishJson.slug}`);
console.log(`  ✓ url:  ${BASE_URL}${publishJson.url}`);
console.log(`  ✓ hash: ${publishJson.packageHash}`);

// --- 4. Verify the published package -------------------------------------

console.log('[4/4] Verifying the package…');
const verifyRes = await fetch(`${BASE_URL}/api/records/${publishJson.slug}/verify`);
if (!verifyRes.ok) {
  console.error(`Verify failed (${verifyRes.status}): ${await verifyRes.text()}`);
  process.exit(1);
}
const verifyJson = await verifyRes.json();
console.log(JSON.stringify(verifyJson, null, 2));

const ok =
  verifyJson.hashMatch &&
  verifyJson.signatureValid !== false &&
  verifyJson.blobRefsVerified === true &&
  Array.isArray(verifyJson.blobRefs) &&
  verifyJson.blobRefs.some((r) => r.field === 'output' && r.ok === true);
console.log(ok ? '\n✅ BlobRef publish + verify succeeded.' : '\n❌ Verify did not satisfy expectations.');
process.exit(ok ? 0 : 1);
