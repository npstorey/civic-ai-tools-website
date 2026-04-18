// Unit tests for the blob-reference helper module introduced in
// Phase B.6 (website#75). Covers type-guard detection, parser edge cases,
// hash verification, and the fetch helper used by the detail page.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  isBlobRef,
  parseBlobRef,
  verifyBlobRef,
  computeBlobRefHash,
  fetchBlobRefText,
  type BlobRef,
} from './blob-ref.ts';

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// --- isBlobRef ---

test('isBlobRef: valid ref object is recognised', () => {
  const hash = sha256Hex('hello');
  const ref: BlobRef = {
    ref: `blob:sha256:${hash}`,
    url: 'https://example.public.blob.vercel-storage.com/evidence-refs/hash.txt',
    contentType: 'text/plain',
    size: 5,
  };
  assert.equal(isBlobRef(ref), true);
});

test('isBlobRef: inline string is not a ref', () => {
  assert.equal(isBlobRef('hello'), false);
  assert.equal(isBlobRef(''), false);
});

test('isBlobRef: missing fields → false', () => {
  assert.equal(isBlobRef({ ref: 'blob:sha256:' + 'a'.repeat(64) }), false);
  assert.equal(
    isBlobRef({ ref: 'blob:sha256:' + 'a'.repeat(64), url: 'https://x', contentType: 'text/plain' }),
    false,
  );
});

test('isBlobRef: malformed ref prefix → false', () => {
  assert.equal(
    isBlobRef({
      ref: 'sha256:' + 'a'.repeat(64),
      url: 'https://x',
      contentType: 'text/plain',
      size: 1,
    }),
    false,
  );
});

test('isBlobRef: wrong hash length → false', () => {
  assert.equal(
    isBlobRef({
      ref: 'blob:sha256:' + 'a'.repeat(10),
      url: 'https://x',
      contentType: 'text/plain',
      size: 1,
    }),
    false,
  );
});

test('isBlobRef: nullish inputs → false', () => {
  assert.equal(isBlobRef(null), false);
  assert.equal(isBlobRef(undefined), false);
  assert.equal(isBlobRef(123), false);
});

// --- parseBlobRef ---

test('parseBlobRef: round-trips a valid ref', () => {
  const hash = sha256Hex('content');
  const parsed = parseBlobRef(`blob:sha256:${hash}`);
  assert.equal(parsed.algo, 'sha256');
  assert.equal(parsed.hash, hash);
});

test('parseBlobRef: throws on malformed input', () => {
  assert.throws(() => parseBlobRef('not-a-ref'), /Invalid blob reference/);
  assert.throws(() => parseBlobRef('blob:md5:' + 'a'.repeat(32)), /Invalid blob reference/);
});

// --- computeBlobRefHash ---

test('computeBlobRefHash: string → sha256 hex', () => {
  const hash = computeBlobRefHash('hello');
  assert.equal(hash, sha256Hex('hello'));
});

test('computeBlobRefHash: Uint8Array → sha256 hex', () => {
  const bytes = new TextEncoder().encode('hello');
  assert.equal(computeBlobRefHash(bytes), sha256Hex('hello'));
});

// --- verifyBlobRef ---
//
// These tests replace globalThis.fetch with a stub so they run offline. Each
// test restores the original fetch in a finally block so suites interleave
// cleanly.

function withStubbedFetch<T>(
  stub: (url: string) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) =>
    stub(typeof input === 'string' ? input : input.toString())) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('verifyBlobRef: matching content → ok', async () => {
  const content = 'the quick brown fox';
  const hash = sha256Hex(content);
  const ref: BlobRef = {
    ref: `blob:sha256:${hash}`,
    url: 'https://example/test',
    contentType: 'text/plain',
    size: content.length,
  };

  await withStubbedFetch(
    async () => new Response(content, { status: 200 }),
    async () => {
      const result = await verifyBlobRef(ref);
      assert.equal(result.ok, true);
      assert.equal(result.computedHash, hash);
      assert.equal(result.computedSize, content.length);
    },
  );
});

test('verifyBlobRef: content hash mismatch → hash_mismatch', async () => {
  const content = 'the quick brown fox';
  const ref: BlobRef = {
    ref: `blob:sha256:${'0'.repeat(64)}`,
    url: 'https://example/test',
    contentType: 'text/plain',
    size: content.length,
  };

  await withStubbedFetch(
    async () => new Response(content, { status: 200 }),
    async () => {
      const result = await verifyBlobRef(ref);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'hash_mismatch');
      assert.equal(result.computedHash, sha256Hex(content));
    },
  );
});

test('verifyBlobRef: size mismatch → size_mismatch', async () => {
  const content = 'the quick brown fox';
  const ref: BlobRef = {
    ref: `blob:sha256:${sha256Hex(content)}`,
    url: 'https://example/test',
    contentType: 'text/plain',
    size: content.length + 10, // wrong
  };

  await withStubbedFetch(
    async () => new Response(content, { status: 200 }),
    async () => {
      const result = await verifyBlobRef(ref);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'size_mismatch');
      assert.equal(result.computedSize, content.length);
    },
  );
});

test('verifyBlobRef: non-200 response → fetch_failed', async () => {
  const ref: BlobRef = {
    ref: `blob:sha256:${sha256Hex('x')}`,
    url: 'https://example/missing',
    contentType: 'text/plain',
    size: 1,
  };

  await withStubbedFetch(
    async () => new Response('', { status: 404 }),
    async () => {
      const result = await verifyBlobRef(ref);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'fetch_failed');
    },
  );
});

test('verifyBlobRef: network error → fetch_failed', async () => {
  const ref: BlobRef = {
    ref: `blob:sha256:${sha256Hex('x')}`,
    url: 'https://example/down',
    contentType: 'text/plain',
    size: 1,
  };

  await withStubbedFetch(
    async () => {
      throw new TypeError('network');
    },
    async () => {
      const result = await verifyBlobRef(ref);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'fetch_failed');
    },
  );
});

test('verifyBlobRef: invalid ref string → invalid_ref before fetch', async () => {
  const ref: BlobRef = {
    ref: 'not-a-ref',
    url: 'https://example/test',
    contentType: 'text/plain',
    size: 1,
  };
  // No fetch stub — if the implementation leaked through, the real fetch
  // would be attempted. The early return protects against that.
  const result = await verifyBlobRef(ref);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_ref');
});

// --- fetchBlobRefText ---

test('fetchBlobRefText: returns text on success', async () => {
  const content = '# hello\n';
  const ref: BlobRef = {
    ref: `blob:sha256:${sha256Hex(content)}`,
    url: 'https://example/test',
    contentType: 'text/markdown',
    size: content.length,
  };

  await withStubbedFetch(
    async () => new Response(content, { status: 200 }),
    async () => {
      const text = await fetchBlobRefText(ref);
      assert.equal(text, content);
    },
  );
});

test('fetchBlobRefText: returns null on failure', async () => {
  const ref: BlobRef = {
    ref: `blob:sha256:${sha256Hex('x')}`,
    url: 'https://example/missing',
    contentType: 'text/plain',
    size: 1,
  };

  await withStubbedFetch(
    async () => new Response('', { status: 500 }),
    async () => {
      const text = await fetchBlobRefText(ref);
      assert.equal(text, null);
    },
  );
});
