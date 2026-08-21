#!/usr/bin/env node
/**
 * Hosted-S3 storage rehearsal harness (S5 P2, issue #181).
 *
 * Drives the four legs proven against local MinIO in S3b P3 (PR #175)
 * through the real storage seam (`src/lib/storage/`), against whatever
 * S3-compatible endpoint the environment provides:
 *
 *   1. round-trip   — content-addressed putPackage; sha256 byte parity
 *                     across original bytes, raw GetObject, anonymous
 *                     public-URL fetch, and driver getText round-trip.
 *   2. grant        — presigned-PUT client-upload grant. Grant-time
 *                     rejections (bad pathname/prefix, oversize, bad type,
 *                     missing length) reuse the policy semantics of
 *                     src/app/api/blob/upload-token/route.ts; PUT-time
 *                     signature failures (mismatched Content-Type, extra
 *                     bytes, re-targeted key) prove the caps are enforced
 *                     server-side; one accepted upload retrieves
 *                     byte-identical.
 *   3. public-read  — stored objects fetchable anonymously at the driver's
 *                     resolved public URL; keyFromUrl mapping consistent.
 *   4. gc           — the extracted sweep (`src/lib/evidence/blob-gc.ts`)
 *                     run hermetically: harness-created fixtures only, a
 *                     stubbed referenced-set (no production DB), fresh run
 *                     deletes nothing, aged run (+25h one-shot clock shim)
 *                     deletes exactly the orphans and keeps the referenced
 *                     object. Every pre-existing object under the prefix is
 *                     shielded (marked referenced) so the sweep can never
 *                     touch anything the harness did not create.
 *
 * Harness discipline:
 *   - Config from env only; refuses to run unless BLOB_DRIVER=s3. Prints
 *     variable NAMES and non-secret config (endpoint, bucket, region,
 *     path-style) — never a credential value.
 *   - Touches only objects it creates this run (per-run unique content →
 *     per-run unique content-addressed keys) and deletes them all in a
 *     best-effort teardown, even when a leg fails.
 *   - Per-leg PASS/FAIL output, final summary line, non-zero exit on any
 *     failure — the transcript is the phase evidence.
 *
 * Intended invocation for the real-bucket run. `op run` is recommended for
 * credentials; any env-injection mechanism is acceptable (CI secrets,
 * container secrets, a secret manager) — never a plaintext literal in a
 * dot-file:
 *
 *   op run --env-file=<file> -- node scripts/rehearse-storage-s3.mjs
 *
 * Self-verification against a disposable local MinIO (obviously fake,
 * local-only creds — the fixture convention of src/lib/storage/s3.test.ts):
 *
 *   docker network create s5-rehearsal-net
 *   docker run -d --name s5-rehearsal-minio --network s5-rehearsal-net \
 *     -p 127.0.0.1:9000:9000 \
 *     -e MINIO_ROOT_USER=minio-local-admin \
 *     -e MINIO_ROOT_PASSWORD=minio-local-admin-secret \
 *     -v s5-rehearsal-minio-data:/data minio/minio server /data
 *   docker run --rm --network s5-rehearsal-net --entrypoint sh minio/mc -c '\
 *     mc alias set local http://s5-rehearsal-minio:9000 \
 *       minio-local-admin minio-local-admin-secret && \
 *     mc mb local/evidence-rehearsal && \
 *     mc anonymous set download local/evidence-rehearsal'
 *   BLOB_DRIVER=s3 S3_ENDPOINT=http://127.0.0.1:9000 \
 *     S3_BUCKET=evidence-rehearsal S3_ACCESS_KEY_ID=minio-local-admin \
 *     S3_SECRET_ACCESS_KEY=minio-local-admin-secret \
 *     node scripts/rehearse-storage-s3.mjs
 *   docker rm -f s5-rehearsal-minio && \
 *     docker volume rm s5-rehearsal-minio-data && \
 *     docker network rm s5-rehearsal-net
 */

// The harness imports TypeScript modules from src/ (the real storage seam).
// Node 22 needs --experimental-strip-types for that; re-exec once when type
// stripping is not active (no-op on Node >= 23.6, where it is the default).
if (!process.features.typescript) {
  if (process.execArgv.includes('--experimental-strip-types')) {
    console.error('error: this Node build cannot strip TypeScript types (need >= 22.6)');
    process.exit(2);
  }
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', ...process.argv.slice(1)],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
}

import crypto from 'node:crypto';
import process from 'node:process';

const USAGE = `
S5 P2 hosted-S3 storage rehearsal harness — four legs:
round-trip byte parity, presigned-PUT grant (incl. rejections),
anonymous public read, GC sweep (fresh + aged).

usage (op run recommended; any env-injection mechanism that gets these
variables into the process environment is acceptable — CI secrets,
container secrets, a secret manager — never a plaintext literal in a
dot-file):
  op run --env-file=<file> -- node scripts/rehearse-storage-s3.mjs

With op run, the env file provides op:// references resolved by the
wrapper — the harness itself never reads a dot-file and never prints a
credential value. The variables it needs either way:

  BLOB_DRIVER=s3          required — the harness refuses any other driver
  S3_BUCKET               required
  S3_ACCESS_KEY_ID        required
  S3_SECRET_ACCESS_KEY    required
  S3_ENDPOINT             optional — omit for AWS S3 proper
  S3_REGION               optional — default us-east-1
  S3_FORCE_PATH_STYLE     optional — default true when S3_ENDPOINT is set
  S3_PUBLIC_BASE_URL      optional — default derived from endpoint/bucket

Exit codes: 0 all legs pass, 1 any leg fails, 2 usage/config error.
The MinIO self-verification recipe is in this file's header comment.
`.trim();

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

// --- Env gate (before importing anything from src/) ------------------------

if (process.env.BLOB_DRIVER !== 's3') {
  console.error('error: this harness only runs with BLOB_DRIVER=s3 ' +
    `(got ${process.env.BLOB_DRIVER ? `"${process.env.BLOB_DRIVER}"` : 'unset'})`);
  console.error('\n' + USAGE);
  process.exit(2);
}

const { resolveS3ConfigFromEnv, createS3Driver, keyFromUrl } = await import(
  '../src/lib/storage/s3.ts'
);
const { putPackage, listBlobs } = await import('../src/lib/storage/index.ts');
const { sweepOrphans, BLOB_PREFIX, ORPHAN_GRACE_MS } = await import(
  '../src/lib/evidence/blob-gc.ts'
);
const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');

let cfg;
try {
  cfg = resolveS3ConfigFromEnv();
} catch (err) {
  // resolveS3ConfigFromEnv names the missing VARIABLE, never a value.
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  console.error('\n' + USAGE);
  process.exit(2);
}

const RUN_ID = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

console.log('[config] BLOB_DRIVER=s3');
console.log(`[config] endpoint=${cfg.endpoint ?? '(none — AWS S3 proper)'} pathStyle=${cfg.forcePathStyle}`);
console.log(`[config] bucket=${cfg.bucket} region=${cfg.region}`);
console.log(`[config] publicBaseUrl=${cfg.publicBaseUrl}`);
console.log('[config] credentials: S3_ACCESS_KEY_ID=set S3_SECRET_ACCESS_KEY=set (values never printed)');
console.log(`[config] runId=${RUN_ID}`);

// --- Shared plumbing -------------------------------------------------------

const driver = createS3Driver(cfg);

/** Raw-read client, independent of the driver's read path (leg 1 uses it to
 *  fetch stored bytes via plain GetObject). Mirrors the driver's checksum
 *  settings so no transform is introduced on the wire. */
const rawClient = new S3Client({
  region: cfg.region,
  ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
  forcePathStyle: cfg.forcePathStyle,
  credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const objectUrl = (key) => `${cfg.publicBaseUrl}/${key}`;

/** Every object the harness creates (or a rejected PUT could conceivably
 *  have created) is registered here and deleted in teardown. */
const createdUrls = new Set();

let currentLeg = null;

function check(label, cond, detail) {
  const suffix = detail ? ` — ${detail}` : '';
  if (cond) {
    console.log(`  ok    ${label}${suffix}`);
  } else {
    currentLeg.failures.push(`${label}${suffix}`);
    console.log(`  FAIL  ${label}${suffix}`);
  }
  return cond;
}

async function checkRejects(label, fn, pattern) {
  try {
    await fn();
    check(label, false, 'resolved instead of throwing');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, pattern.test(message), `threw: ${message}`);
  }
}

/** Parse the <Code> element out of an S3 XML error body, for the transcript. */
function s3ErrorCode(bodyText) {
  return /<Code>([^<]+)<\/Code>/.exec(bodyText)?.[1] ?? '(no error code)';
}

/** List every object under a prefix through the real driver pagination. */
async function listAllUnderPrefix(prefix) {
  const items = [];
  let cursor;
  do {
    const page = await listBlobs({ prefix, cursor, limit: 1000 });
    items.push(...page.items);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return items;
}

// --- Grant-policy mirror ---------------------------------------------------
// Mirrors onBeforeGrant in src/app/api/blob/upload-token/route.ts. Next.js
// App Router route modules may only export HTTP handlers, so the policy
// constants cannot be imported; they are duplicated VERBATIM here — keep in
// sync with the route. The route's authentication step is intentionally
// absent: the harness drives the driver seam below the route, and auth is
// exercised against the deployed endpoint, not this rehearsal.

const PATHNAME_PATTERN = /^evidence-refs\/[0-9a-f]{64}(?:\.[a-z0-9]+)?$/;
const MAX_BLOB_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'text/plain',
  'text/markdown',
  'application/octet-stream',
];

async function onBeforeGrant(pathname) {
  if (!PATHNAME_PATTERN.test(pathname)) {
    throw new Error('Invalid pathname: expected evidence-refs/<sha256 hex>[.ext]');
  }
  return {
    allowedContentTypes: ALLOWED_CONTENT_TYPES,
    maximumSizeInBytes: MAX_BLOB_SIZE_BYTES,
    tokenPayload: JSON.stringify({ userId: 'rehearsal', pathname }),
  };
}

function mintGrant(payload) {
  return driver.grantClientUpload({
    request: new Request('http://rehearsal.invalid/api/blob/upload-token', { method: 'POST' }),
    body: { type: 'blob.generate-client-token', payload },
    onBeforeGrant,
  });
}

// --- Leg 1: round-trip byte parity ----------------------------------------

async function legRoundTrip(state) {
  // Non-ASCII content proves UTF-8 byte discipline through getText.
  const pkg = {
    rehearsal: 's5-p2-storage-rehearsal',
    runId: RUN_ID,
    note: 'fixture package — safe to delete; created and removed by scripts/rehearse-storage-s3.mjs',
    unicode: 'byte-parity probe: ☃ déjà vu — ¤',
    createdAt: new Date().toISOString(),
  };
  const originalBytes = Buffer.from(JSON.stringify(pkg), 'utf8');
  const originalSha = sha256(originalBytes);
  const expectedKey = `evidence-packages/${originalSha}.json`;

  const url = await putPackage(originalSha, pkg);
  createdUrls.add(url);
  state.packageUrl = url;
  state.packageKey = expectedKey;
  console.log(`  stored ${expectedKey} (${originalBytes.length} bytes, sha256=${originalSha.slice(0, 12)}…)`);

  check('content-addressed key honored', url === objectUrl(expectedKey), `url=${url}`);

  const raw = await rawClient.send(
    new GetObjectCommand({ Bucket: cfg.bucket, Key: expectedKey }),
  );
  const rawBytes = Buffer.from(await raw.Body.transformToByteArray());
  check('raw GetObject bytes sha256-identical', sha256(rawBytes) === originalSha,
    `${rawBytes.length} bytes`);
  check('stored Content-Type is application/json', raw.ContentType === 'application/json',
    `got ${raw.ContentType}`);

  const publicRes = await fetch(url);
  const publicBytes = Buffer.from(await publicRes.arrayBuffer());
  check('public-URL fetch succeeds', publicRes.ok, `status=${publicRes.status}`);
  check('public-URL bytes sha256-identical', sha256(publicBytes) === originalSha,
    `${publicBytes.length} bytes`);

  const text = await driver.getText(url);
  check('interface getText round-trip sha256-identical',
    text !== null && sha256(Buffer.from(text, 'utf8')) === originalSha);
}

// --- Leg 2: presigned-PUT grant, rejections first --------------------------

async function legGrant(state) {
  const validHash = 'a'.repeat(64);

  // Grant-time rejections (the P3 evidence matrix).
  await checkRejects('rejects wrong event type',
    () => driver.grantClientUpload({
      request: new Request('http://rehearsal.invalid/', { method: 'POST' }),
      body: { type: 'not-a-token-mint' },
      onBeforeGrant,
    }),
    /Invalid event type/);
  await checkRejects('rejects non-sha256 pathname',
    () => mintGrant({ pathname: 'evidence-refs/not-a-hash', contentType: 'text/plain', contentLength: 10 }),
    /Invalid pathname/);
  await checkRejects('rejects foreign prefix',
    () => mintGrant({ pathname: `other-prefix/${validHash}`, contentType: 'text/plain', contentLength: 10 }),
    /Invalid pathname/);
  await checkRejects('rejects oversize contentLength',
    () => mintGrant({ pathname: `evidence-refs/${validHash}`, contentType: 'text/plain', contentLength: MAX_BLOB_SIZE_BYTES + 1 }),
    /exceeds maximum size/);
  await checkRejects('rejects disallowed content type',
    () => mintGrant({ pathname: `evidence-refs/${validHash}`, contentType: 'application/x-rehearsal-evil', contentLength: 10 }),
    /Unsupported content type/);
  await checkRejects('rejects missing contentLength',
    () => mintGrant({ pathname: `evidence-refs/${validHash}`, contentType: 'text/plain' }),
    /contentLength .* required/);

  // One legitimate grant, then PUT-time signature failures against it.
  const contentBytes = Buffer.from(`rehearsal grant upload ${RUN_ID}\n`, 'utf8');
  const contentSha = sha256(contentBytes);
  const pathname = `evidence-refs/${contentSha}.md`;
  const grant = await mintGrant({
    pathname,
    contentType: 'text/markdown',
    contentLength: contentBytes.length,
  });
  createdUrls.add(objectUrl(pathname)); // teardown target even if legs below fail

  check('grant is a presigned PUT', grant.uploadMethod === 'presigned-put');
  check('grant echoes pathname + blobUrl',
    grant.pathname === pathname && grant.blobUrl === objectUrl(pathname));
  check('grant signs exact Content-Type and Content-Length',
    grant.headers['Content-Type'] === 'text/markdown' &&
    grant.headers['Content-Length'] === String(contentBytes.length));

  // PUT-time failures. Content-Length is computed by fetch from the actual
  // body (the header is not manually settable), which is exactly the point:
  // a body that differs from the granted byte count yields a mismatched
  // signed header and the storage backend must refuse it.
  const putRejected = async (label, url, headers, body) => {
    const res = await fetch(url, { method: 'PUT', headers, body });
    const bodyText = res.ok ? '' : await res.text();
    check(label, !res.ok && res.status >= 400 && res.status < 500,
      `status=${res.status} code=${res.ok ? 'n/a' : s3ErrorCode(bodyText)}`);
  };

  await putRejected('PUT with mismatched Content-Type refused',
    grant.url, { 'Content-Type': 'application/json' }, contentBytes);
  await putRejected('PUT with extra bytes (length mismatch) refused',
    grant.url, { 'Content-Type': 'text/markdown' },
    Buffer.concat([contentBytes, Buffer.from('EXTRA:7')]));

  const otherSha = sha256(Buffer.from(`re-target probe ${RUN_ID}`));
  const retargetedUrl = grant.url.replace(contentSha, otherSha);
  createdUrls.add(objectUrl(`evidence-refs/${otherSha}.md`));
  check('re-target probe rewrites the key', retargetedUrl !== grant.url);
  await putRejected('PUT to re-targeted key refused',
    retargetedUrl, { 'Content-Type': 'text/markdown' }, contentBytes);

  check('no object materialized at granted key after refused PUTs',
    (await driver.getText(objectUrl(pathname))) === null);
  check('no object materialized at re-targeted key',
    (await driver.getText(objectUrl(`evidence-refs/${otherSha}.md`))) === null);

  // The accepted upload.
  const acceptRes = await fetch(grant.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown' },
    body: contentBytes,
  });
  check('exact PUT accepted', acceptRes.ok, `status=${acceptRes.status}`);
  const readBack = await driver.getText(grant.blobUrl);
  check('accepted upload retrieves byte-identical',
    readBack !== null && sha256(Buffer.from(readBack, 'utf8')) === contentSha);

  state.grantBlobUrl = grant.blobUrl;
  state.grantKey = pathname;
  state.grantSha = contentSha;
}

// --- Leg 3: anonymous public read + URL→key mapping ------------------------

async function legPublicRead(state) {
  const targets = [
    { label: 'package', url: state.packageUrl, key: state.packageKey },
    ...(state.grantBlobUrl
      ? [{ label: 'granted upload', url: state.grantBlobUrl, key: state.grantKey }]
      : []),
  ];
  for (const t of targets) {
    if (!t.url) {
      check(`${t.label}: prerequisite object exists`, false, 'earlier leg did not store it');
      continue;
    }
    // Plain fetch: no SDK, no credentials, no signed headers — anonymous.
    const res = await fetch(t.url);
    check(`${t.label}: anonymous fetch of public URL succeeds`, res.ok, `status=${res.status}`);
    check(`${t.label}: keyFromUrl maps URL back to its key`,
      keyFromUrl(t.url, cfg.publicBaseUrl) === t.key);
  }
  check('keyFromUrl rejects a foreign URL',
    keyFromUrl('https://rehearsal.invalid/other-bucket/some-key', cfg.publicBaseUrl) === null);
}

// --- Leg 4: GC sweep, fresh then aged --------------------------------------

/**
 * One-shot clock shim: `sweepOrphans` reads `Date.now()` exactly once,
 * synchronously, before its first storage call. The shim serves the shifted
 * time to that single call and restores the real clock immediately, so SDK
 * request signing (which also consults Date.now via getSkewCorrectedDate)
 * is never skewed — a whole-run shift of +25h would fail S3's 15-minute
 * clock-skew tolerance on every signed request.
 */
function armOneShotClockShift(shiftMs) {
  const realNow = Date.now;
  let consumed = false;
  Date.now = function shiftedOnce() {
    Date.now = realNow;
    consumed = true;
    return realNow() + shiftMs;
  };
  return {
    disarm() {
      if (!consumed) Date.now = realNow;
      return consumed;
    },
  };
}

async function legGc() {
  const fixture = (name, ext, contentType) => {
    const bytes = Buffer.from(`gc-fixture ${name} ${RUN_ID}\n`, 'utf8');
    const key = `${BLOB_PREFIX}${sha256(bytes)}${ext}`;
    return { name, bytes, key, contentType };
  };
  const orphan1 = fixture('orphan-1', '', 'text/plain');
  const orphan2 = fixture('orphan-2', '.json', 'application/json');
  const referenced = fixture('referenced', '.md', 'text/markdown');

  const stored = {};
  for (const f of [orphan1, orphan2, referenced]) {
    const { url } = await driver.put(f.key, f.bytes, { contentType: f.contentType });
    createdUrls.add(url);
    stored[f.name] = url;
    console.log(`  fixture ${f.name} → ${f.key}`);
  }
  const harnessUrls = new Set(Object.values(stored));

  /**
   * Stubbed referenced-set (no production DB): the harness's referenced
   * fixture plus a shield — every object currently under the prefix that
   * the harness did not create is marked referenced, so the sweep can
   * never delete anything that is not ours. Rebuilt immediately before
   * each sweep to keep the shield window as small as possible.
   */
  const buildReferencedSet = async () => {
    const referencedSet = new Set([stored.referenced]);
    let shielded = 0;
    for (const item of await listAllUnderPrefix(BLOB_PREFIX)) {
      if (!harnessUrls.has(item.url)) {
        referencedSet.add(item.url);
        shielded++;
      }
    }
    console.log(`  shielding ${shielded} pre-existing object(s) under ${BLOB_PREFIX} (marked referenced)`);
    return { referencedSet, shielded };
  };

  // Fresh sweep: everything the harness created is younger than the grace
  // window, so nothing may be deleted.
  const fresh = await buildReferencedSet();
  const freshStats = await sweepOrphans(fresh.referencedSet);
  console.log(`  fresh sweep stats: ${JSON.stringify(freshStats)}`);
  check('fresh sweep deletes nothing', freshStats.deleted === 0,
    `deleted=${freshStats.deleted}`);
  check('fresh sweep skipped the orphans as fresh', freshStats.skippedFresh >= 2,
    `skippedFresh=${freshStats.skippedFresh}`);
  check('fresh sweep counted referenced objects', freshStats.skippedReferenced >= 1,
    `skippedReferenced=${freshStats.skippedReferenced}`);
  check('orphans still present after fresh sweep',
    (await driver.getText(stored['orphan-1'])) !== null &&
    (await driver.getText(stored['orphan-2'])) !== null);

  // Aged sweep: +25h (grace window + 1h, like the P3 evidence), via the
  // one-shot shim.
  const aged = await buildReferencedSet();
  const shiftMs = ORPHAN_GRACE_MS + 60 * 60 * 1000;
  console.log(`  aged sweep: one-shot Date.now shift of +${shiftMs / 3_600_000}h armed`);
  const shim = armOneShotClockShift(shiftMs);
  let agedStats;
  try {
    agedStats = await sweepOrphans(aged.referencedSet);
  } finally {
    const consumed = shim.disarm();
    check('age shim consumed by the sweep (blob-gc reads Date.now first)', consumed);
  }
  console.log(`  aged sweep stats: ${JSON.stringify(agedStats)}`);
  check('aged sweep deletes exactly the 2 orphans', agedStats.deleted === 2,
    `deleted=${agedStats.deleted}`);
  check('aged sweep kept referenced + shielded objects',
    agedStats.skippedReferenced === aged.shielded + 1,
    `skippedReferenced=${agedStats.skippedReferenced}, expected ${aged.shielded + 1}`);
  check('orphan-1 gone after aged sweep', (await driver.getText(stored['orphan-1'])) === null);
  check('orphan-2 gone after aged sweep', (await driver.getText(stored['orphan-2'])) === null);
  const kept = await driver.getText(stored.referenced);
  check('referenced object survived byte-identical',
    kept !== null && Buffer.from(kept, 'utf8').equals(referenced.bytes));
}

// --- Runner ---------------------------------------------------------------

const LEGS = [
  { id: '1:round-trip', title: 'round-trip byte parity', run: legRoundTrip },
  { id: '2:grant', title: 'presigned-PUT grant incl. rejections', run: legGrant },
  { id: '3:public-read', title: 'anonymous public read + URL mapping', run: legPublicRead },
  { id: '4:gc', title: 'GC sweep (fresh + aged)', run: legGc },
];

const state = {};
const results = [];

for (const leg of LEGS) {
  console.log(`\n[leg ${leg.id}] ${leg.title}`);
  currentLeg = { failures: [] };
  try {
    await leg.run(state);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    currentLeg.failures.push(`unexpected error: ${message}`);
    console.log(`  FAIL  unexpected error: ${message}`);
  }
  const pass = currentLeg.failures.length === 0;
  console.log(`[leg ${leg.id}] ${pass ? 'PASS' : `FAIL (${currentLeg.failures.length} failed check(s))`}`);
  results.push({ ...leg, pass, failures: currentLeg.failures });
}

// Teardown: best-effort delete of every object this run created (sweep-
// deleted orphans are already gone; S3 DeleteObject on a missing key is a
// no-op success). Runs even when legs failed.
console.log('\n[teardown] removing harness-created objects');
let removed = 0;
for (const url of createdUrls) {
  try {
    await driver.delete(url);
    removed++;
  } catch (err) {
    console.log(`  warn: could not delete ${url}: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`[teardown] ${removed}/${createdUrls.size} tracked object(s) deleted (missing keys delete as no-ops)`);

console.log('\n================ summary ================');
for (const r of results) {
  console.log(`  leg ${r.id.padEnd(14)} ${r.title.padEnd(40)} ${r.pass ? 'PASS' : 'FAIL'}`);
  for (const f of r.failures) console.log(`      - ${f}`);
}
const failed = results.filter((r) => !r.pass);
if (failed.length === 0) {
  console.log(`RESULT: PASS — ${results.length}/${results.length} legs (runId=${RUN_ID})`);
} else {
  console.log(`RESULT: FAIL — ${failed.length}/${results.length} leg(s) failed (runId=${RUN_ID})`);
  process.exit(1);
}
