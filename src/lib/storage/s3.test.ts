// Unit tests for the pure helpers of the S3 storage driver (S3b P3):
// env-config resolution defaults and public-URL → object-key mapping.
// Driver behavior against a live endpoint is exercised separately with a
// local MinIO container; these tests stay network-free.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveS3ConfigFromEnv, keyFromUrl } from './s3.ts';

// Guard-safe fixture credentials — obviously fake, local-only values.
const BASE_ENV = {
  S3_BUCKET: 'evidence-test',
  S3_ACCESS_KEY_ID: 'minio-local-admin',
  S3_SECRET_ACCESS_KEY: 'minio-local-admin-secret',
};

test('resolveS3ConfigFromEnv: MinIO-style endpoint defaults to path style + path-style public base', () => {
  const cfg = resolveS3ConfigFromEnv({
    ...BASE_ENV,
    S3_ENDPOINT: 'http://127.0.0.1:9000',
  });
  assert.equal(cfg.endpoint, 'http://127.0.0.1:9000');
  assert.equal(cfg.region, 'us-east-1');
  assert.equal(cfg.forcePathStyle, true);
  assert.equal(cfg.publicBaseUrl, 'http://127.0.0.1:9000/evidence-test');
});

test('resolveS3ConfigFromEnv: trailing slashes are normalized off', () => {
  const cfg = resolveS3ConfigFromEnv({
    ...BASE_ENV,
    S3_ENDPOINT: 'http://127.0.0.1:9000/',
    S3_PUBLIC_BASE_URL: 'https://blobs.example.org/',
  });
  assert.equal(cfg.endpoint, 'http://127.0.0.1:9000');
  assert.equal(cfg.publicBaseUrl, 'https://blobs.example.org');
});

test('resolveS3ConfigFromEnv: no endpoint (AWS proper) → virtual-hosted base, no path style', () => {
  const cfg = resolveS3ConfigFromEnv({ ...BASE_ENV, S3_REGION: 'eu-west-1' });
  assert.equal(cfg.endpoint, undefined);
  assert.equal(cfg.forcePathStyle, false);
  assert.equal(cfg.publicBaseUrl, 'https://evidence-test.s3.eu-west-1.amazonaws.com');
});

test('resolveS3ConfigFromEnv: S3_FORCE_PATH_STYLE=false overrides the endpoint default', () => {
  const cfg = resolveS3ConfigFromEnv({
    ...BASE_ENV,
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_FORCE_PATH_STYLE: 'false',
  });
  assert.equal(cfg.forcePathStyle, false);
});

test('resolveS3ConfigFromEnv: missing required vars throw with the var named', () => {
  assert.throws(() => resolveS3ConfigFromEnv({}), /S3_BUCKET/);
  assert.throws(
    () => resolveS3ConfigFromEnv({ S3_BUCKET: 'evidence-test' }),
    /S3_ACCESS_KEY_ID/,
  );
  assert.throws(
    () =>
      resolveS3ConfigFromEnv({
        S3_BUCKET: 'evidence-test',
        S3_ACCESS_KEY_ID: 'minio-local-admin',
      }),
    /S3_SECRET_ACCESS_KEY/,
  );
});

test('keyFromUrl: maps stored URLs back to object keys', () => {
  const base = 'http://127.0.0.1:9000/evidence-test';
  assert.equal(
    keyFromUrl(`${base}/evidence-refs/${'a'.repeat(64)}.md`, base),
    `evidence-refs/${'a'.repeat(64)}.md`,
  );
  // Query strings (e.g. a presigned URL pasted back) are stripped.
  assert.equal(
    keyFromUrl(`${base}/evidence-packages/x.json?X-Amz-Signature=abc`, base),
    'evidence-packages/x.json',
  );
});

test('keyFromUrl: foreign URLs return null', () => {
  const base = 'http://127.0.0.1:9000/evidence-test';
  assert.equal(keyFromUrl('https://example.blob.vercel-storage.com/evidence-refs/x', base), null);
  // Same host, different bucket prefix.
  assert.equal(keyFromUrl('http://127.0.0.1:9000/other-bucket/key', base), null);
  // Base URL alone, no key.
  assert.equal(keyFromUrl(`${base}/`, base), null);
});
