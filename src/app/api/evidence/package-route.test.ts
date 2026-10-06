// #553 criteria 3 and 4 — `GET /api/records/:slug/package`, driven through the
// real handler: it serves the stored object's bytes unchanged, and its access
// decision is the one it had.
//
// WHAT IS REAL. The route handler (`./[slug]/package/route.ts`, which
// `/api/records/[slug]/package` re-exports), `@/lib/storage` with
// `BLOB_DRIVER=s3` and the real S3 driver and SDK, the record gate
// `@/lib/evidence/sealed-access` with its visibility vocabulary, and the
// schema. The object store is a loopback S3 endpoint in this file: it keeps the
// exact bytes each PUT carried and answers GET with them, or with `NoSuchKey`.
//
// STUBS, and why each is a stub. `module.registerHooks()` in-file, as in
// `src/lib/errors-out-of-logs-driven.test.ts` (no CLI flag in package.json):
//   - `@/lib/db`: no database; `select…limit` answers with the row the test set;
//   - `@/lib/api-auth`: no sign-in provider outside Next; `resolveRequestUser`
//     answers with the requester the test set (null for an anonymous one);
//   - `next-auth`, `@/lib/auth`: imported by the gate's module for its other
//     export, never called on this path.
//
// WHAT MAKES THE PARITY ASSERTION ABLE TO FAIL (CLAUDE.md, the fixture rule).
// A package written through `putPackage` is `JSON.stringify` output, which a
// parse and re-serialize returns byte for byte: a route that round-trips passes
// on it. So the parity test also runs on a stored text that a round trip WOULD
// alter (indentation, `1.0`, a `\u` escape), and asserts that premise before
// hashing. That case is red against the route as it stood at `111fb99`
// (`NextResponse.json(await getPackage(key))`), shown at #553's red commit.
//
// BLIND SPOTS, stated. The driver decodes the object as UTF-8 and the route
// re-encodes it, so an object that is not valid UTF-8 would not come back byte
// for byte; every package is written as the UTF-8 of a JS string, so none is.
// No Turbopack artifact: this is unbundled TypeScript under `node --test`.
// The source assertions at the end cannot tell that the block they find is the
// one that runs; the drives above them are what show it does.
//
// Run with: npm test

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', '..');

// --- Module hooks -------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-p553-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `export async function resolveRequestUser() { return globalThis.__p553User ?? null; }`,
  '@/lib/db': `
    const chain = {
      from() { return chain; },
      where() { return chain; },
      async limit() { return globalThis.__p553Rows ?? []; },
    };
    export const db = { select() { return chain; } };`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`#553 test hook: cannot resolve ${specifier}`);
    }
    // Next's bundler resolves an extensionless relative import; Node's does not.
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const globals = globalThis as unknown as Record<string, unknown>;

// --- Loopback S3: keeps each PUT's exact bytes ----------------------------------

const BUCKET = 'p553-records';
const objects = new Map<string, Buffer>();
const s3 = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://loopback').pathname);
  const prefix = `/${BUCKET}/`;
  if (!pathname.startsWith(prefix)) {
    res.writeHead(400).end();
    return;
  }
  const key = pathname.slice(prefix.length);
  if (req.method === 'PUT') {
    objects.set(key, Buffer.concat(chunks));
    res.writeHead(200, { ETag: '"p553"' }).end();
    return;
  }
  if (req.method === 'GET') {
    const body = objects.get(key);
    if (!body) {
      res.writeHead(404, { 'Content-Type': 'application/xml' })
        .end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>none</Message><Key>${key}</Key></Error>`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) }).end(body);
    return;
  }
  res.writeHead(405).end();
});
await new Promise<void>((resolve) => s3.listen(0, '127.0.0.1', resolve));
after(() => new Promise<void>((resolve) => s3.close(() => resolve())));
const ENDPOINT = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;

// The driver reads its configuration once, at first use. The proxy variables
// are cleared so the loopback store is reached directly whatever the host sets.
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[name];
}
Object.assign(process.env, {
  BLOB_DRIVER: 's3',
  S3_ENDPOINT: ENDPOINT,
  S3_BUCKET: BUCKET,
  S3_REGION: 'us-east-1',
  // Guard-safe fixture values: the loopback store checks no signature.
  S3_ACCESS_KEY_ID: 'p553-loopback-id',
  S3_SECRET_ACCESS_KEY: 'p553-loopback-secret',
});

const { putPackage, putCommittedPackage } = await import('../../../lib/storage/index.ts');
const route = await import('./[slug]/package/route.ts');
const recordsRoute = await import('../records/[slug]/package/route.ts');
const { downloadRecordPackage } = await import('../../../lib/evidence/package-download.ts');

// --- Drive ---------------------------------------------------------------------

interface Row { basePackageStorageKey: string | null; visibility: string; creatorId: string }

const CREATOR = 'creator-p553';
const sha256 = (bytes: Uint8Array | ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(bytes as ArrayBuffer)).digest('hex');
const keyOf = (url: string) => url.slice(`${ENDPOINT}/${BUCKET}/`.length);

async function get(row: Row | null, requester: string | null, slug = 'record-under-test') {
  globals.__p553Rows = row ? [row] : [];
  globals.__p553User = requester ? { userId: requester, scopes: [], via: 'session' } : null;
  const res = await route.GET(
    new Request(`http://localhost/api/records/${slug}/package`) as never,
    { params: Promise.resolve({ slug }) },
  );
  return res;
}

const PACKAGE = {
  packageVersion: '0.1',
  title: 'Bodega licences — café hours ☕, Ñ and 漢字',
  query: { text: 'How many?', portal: 'data.example.org' },
  metrics: { ratio: 0.1, count: 12, big: 12345678901234567890, nested: [1, 2.5, -0.001, null, true] },
  '2': 'an integer-like key, which an object orders first',
};

// A stored text that a parse and re-serialize WOULD alter.
const ALTERED = [
  '{',
  '  "packageVersion": "0.1",',
  '  "ratio": 1.0,',
  '  "count": 1E2,',
  '  "title": "caf\\u00e9"',
  '}',
  '',
].join('\n');

test('#553 C3 (a): a package written through putPackage is served as the stored bytes', async () => {
  const url = await putPackage('p553-a', PACKAGE);
  const stored = objects.get(keyOf(url));
  assert.ok(stored, `the loopback store holds ${url}`);
  assert.equal(stored.toString('utf8'), JSON.stringify(PACKAGE), 'premise: the store holds what putPackage wrote');

  const res = await get({ basePackageStorageKey: url, visibility: 'public', creatorId: CREATOR }, null);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.equal(sha256(await res.arrayBuffer()), sha256(stored), 'the response body is the stored object, byte for byte');
});

test('#553 C3 (b): a stored text a round trip would alter is served unchanged', async () => {
  assert.notEqual(JSON.stringify(JSON.parse(ALTERED)), ALTERED, 'premise: a parse and re-serialize alters this text');
  const key = 'evidence-packages/p553-b.json';
  objects.set(key, Buffer.from(ALTERED, 'utf8'));

  const res = await get({ basePackageStorageKey: `${ENDPOINT}/${BUCKET}/${key}`, visibility: 'public', creatorId: CREATOR }, null);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json\b/);
  const body = await res.arrayBuffer();
  assert.equal(sha256(body), sha256(objects.get(key)!), 'the response body is the stored object, byte for byte');
});

test('#553 C3: a record whose object is missing from storage is a 502, as before', async () => {
  const res = await get({ basePackageStorageKey: `${ENDPOINT}/${BUCKET}/evidence-packages/absent.json`, visibility: 'public', creatorId: CREATOR }, null);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'Package retrieval failed' });
});

test('#553 C3: /api/records/:slug/package is the same handler', () => {
  assert.equal(recordsRoute.GET, route.GET);
});

// --- Criterion 4: the access decision, driven ------------------------------------

test('#553 C4: a sealed record is a 404 to an anonymous reader and to a non-creator, under both labels', async () => {
  const url = await putCommittedPackage(PACKAGE);
  for (const visibility of ['sealed', 'committed']) {
    const row = { basePackageStorageKey: url, visibility, creatorId: CREATOR };
    for (const requester of [null, 'someone-else']) {
      const res = await get(row, requester);
      assert.equal(res.status, 404, `${visibility}, requester ${requester ?? 'anonymous'}`);
      assert.deepEqual(await res.json(), { error: 'Not found' });
    }
  }
});

test('#553 C4: a sealed record is served to its creator, as the stored bytes', async () => {
  const url = await putCommittedPackage(PACKAGE);
  for (const visibility of ['sealed', 'committed']) {
    const res = await get({ basePackageStorageKey: url, visibility, creatorId: CREATOR }, CREATOR);
    assert.equal(res.status, 200, visibility);
    assert.equal(sha256(await res.arrayBuffer()), sha256(objects.get(keyOf(url))!));
  }
});

test('#553 C4: a public record is served to anyone, under both labels', async () => {
  const url = await putPackage('p553-c4', PACKAGE);
  for (const visibility of ['public', 'published']) {
    for (const requester of [null, 'someone-else', CREATOR]) {
      const res = await get({ basePackageStorageKey: url, visibility, creatorId: CREATOR }, requester);
      assert.equal(res.status, 200, `${visibility}, requester ${requester ?? 'anonymous'}`);
    }
  }
});

test('#553 C4: an unknown slug and a record with no package are 404s, as before', async () => {
  const none = await get(null, null);
  assert.equal(none.status, 404);
  assert.deepEqual(await none.json(), { error: 'Not found' });
  const empty = await get({ basePackageStorageKey: null, visibility: 'public', creatorId: CREATOR }, null);
  assert.equal(empty.status, 404);
  assert.deepEqual(await empty.json(), { error: 'Package not available' });
});

// --- Criterion 2, end to end: the page's Download against the real route ----------

test('#553 C2: Download against the real route saves the stored bytes, and saves nothing on its 404 or 502', async () => {
  const url = await putCommittedPackage(PACKAGE);
  const saved: Array<{ blob: Blob; fileName: string }> = [];
  const drive = async (row: Row, requester: string | null) => {
    globals.__p553Rows = [row];
    globals.__p553User = requester ? { userId: requester, scopes: [], via: 'session' } : null;
    return downloadRecordPackage('sealed-one', {
      fetch: async (input) => {
        const slug = input.match(/^\/api\/records\/([^/]+)\/package$/)?.[1];
        assert.ok(slug, `the Download asked the package route, not ${input}`);
        return recordsRoute.GET(new Request(`http://localhost${input}`) as never, { params: Promise.resolve({ slug }) });
      },
      save: (blob, fileName) => saved.push({ blob, fileName }),
    });
  };

  assert.deepEqual(await drive({ basePackageStorageKey: url, visibility: 'sealed', creatorId: CREATOR }, null), { ok: false, status: 404 });
  assert.deepEqual(
    await drive({ basePackageStorageKey: `${ENDPOINT}/${BUCKET}/evidence-packages/absent.json`, visibility: 'public', creatorId: CREATOR }, null),
    { ok: false, status: 502 },
  );
  assert.equal(saved.length, 0, 'neither refusal was saved');

  assert.deepEqual(await drive({ basePackageStorageKey: url, visibility: 'sealed', creatorId: CREATOR }, CREATOR), { ok: true });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].fileName, 'record-sealed-one.json');
  assert.equal(sha256(await saved[0].blob.arrayBuffer()), sha256(objects.get(keyOf(url))!));
});

// --- Source positions: the route's use of the text read and the helper ------------

const ROUTE_SRC = fs.readFileSync(path.join(HERE, '[slug]', 'package', 'route.ts'), 'utf8');

function at(source: string, needle: string): number {
  const index = source.indexOf(needle);
  assert.ok(index > 0, `the package route should contain ${needle}`);
  return index;
}
const count = (source: string, needle: string) => source.split(needle).length - 1;

test('#553 C3: the route reads the stored text once and answers with the helper, never a re-serialization', () => {
  assert.equal(count(ROUTE_SRC, 'getPackageText(storageKey)'), 1, 'one text read');
  assert.equal(count(ROUTE_SRC, 'getPackage('), 0, 'the parsing read is gone from the route');
  assert.equal(count(ROUTE_SRC, 'NextResponse.json(pkg)'), 0, 'the re-serializing answer is gone');
  assert.equal(count(ROUTE_SRC, 'return storedPackageResponse(text);'), 1, 'the success answer is the helper');
  const read = at(ROUTE_SRC, 'getPackageText(storageKey)');
  const failed = at(ROUTE_SRC, "{ error: 'Package retrieval failed' }");
  const served = at(ROUTE_SRC, 'return storedPackageResponse(text);');
  assert.ok(read < failed && failed < served, 'read, then the 502 on a failed read, then the helper');
  assert.ok(at(ROUTE_SRC, "from '@/lib/evidence/package-response'") < read, 'the helper is imported');
});

test('#553 C4: the gate is consulted once, before the read, and refuses with a 404', () => {
  assert.equal(count(ROUTE_SRC, 'canReadRecord('), 1, 'one gate');
  const gate = at(ROUTE_SRC, 'if (!(await canReadRecord(request, records[0]))) {');
  const refusal = ROUTE_SRC.slice(gate, ROUTE_SRC.indexOf('\n  }', gate));
  assert.match(refusal, /return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\);/);
  const firstRead = ROUTE_SRC.search(/getPackage(?:Text)?\(/);
  assert.ok(firstRead > 0, 'the route reads storage');
  assert.ok(gate < firstRead, 'the gate is consulted before any storage read');
});
