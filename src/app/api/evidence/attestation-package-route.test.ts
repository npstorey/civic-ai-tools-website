// #559 criteria 1 and 2 — `GET /api/records/:slug/attestations/:id/package`,
// driven through the real handler: it serves one attestation's stored package,
// only for an attestation of that record, behind the record's read gate, and the
// body is the stored object's bytes unchanged.
//
// THE HARNESS IS #553's (`./package-route.test.ts`), copied rather than shared so
// that file stays as it was merged: `module.registerHooks()` in-file, a loopback
// S3 store that keeps each PUT's exact bytes, and SHA-256 comparison.
//
// WHAT IS REAL. The route handler (`./[slug]/attestations/[id]/package/route.ts`,
// which `/api/records/[slug]/attestations/[id]/package` re-exports),
// `@/lib/storage` with `BLOB_DRIVER=s3` and the real S3 driver and SDK, the
// record gate `@/lib/evidence/sealed-access` with its visibility vocabulary, the
// schema, and drizzle's own SQL rendering of every condition the route builds.
//
// STUBS, and why each is a stub:
//   - `@/lib/db`: no database. In its place, a small in-memory table store that
//     renders each `where` with drizzle's `PgDialect` and evaluates it. It
//     accepts only `"table"."column" = $n` terms joined by `and`, and throws on
//     anything else, so a condition it cannot read fails the test instead of
//     matching everything. Like Postgres, it refuses a value that is not a UUID
//     against a `uuid` column, which is what makes the malformed-id case able
//     to fail: a route that sent `not-a-uuid` to the database would throw.
//   - `@/lib/api-auth`: no sign-in provider outside Next; `resolveRequestUser`
//     answers with the requester the test set (null for an anonymous one);
//   - `next-auth`, `@/lib/auth`: imported by the gate's module for its other
//     export, never called on this path.
//
// WHAT MAKES THE ASSERTIONS ABLE TO FAIL (CLAUDE.md, the fixture rule).
//   - Ownership: the foreign-id cases ask for an attestation that EXISTS, whose
//     object is in the store, and whose own record is readable by the requester
//     (a public record), or is a sealed record's asked for under a public slug.
//     A route that looked the id up without the record would serve both.
//   - Byte parity: an attestation written through `putPackage` is
//     `JSON.stringify` output, which a parse and re-serialize returns byte for
//     byte, so a round-tripping route passes on it. The parity test also runs
//     on a stored text that a round trip WOULD alter (indentation, `1.0`, a `\u`
//     escape), and asserts that premise before hashing.
//
// BLIND SPOTS, stated. The in-memory store implements only the query shapes
// this route uses (`select…from…where…limit`); it is not Postgres. The driver
// decodes the object as UTF-8 and the route re-encodes it, so an object that is
// not valid UTF-8 would not come back byte for byte; every attestation package
// is written as the UTF-8 of a JS string, so none is. No Turbopack artifact:
// this is unbundled TypeScript under `node --test`. The source assertions at the
// end cannot tell that the block they find is the one that runs; the drives
// above them are what show it does.
//
// Run with: npm test

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableColumns, getTableName, type SQL, type Table } from 'drizzle-orm';

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

const STUB_PREFIX = 'file:///civic-p559-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `export async function resolveRequestUser() { return globalThis.__p559User ?? null; }`,
  '@/lib/db': `export const db = { select: (...args) => globalThis.__p559Db.select(...args) };`,
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
      throw new Error(`#559 test hook: cannot resolve ${specifier}`);
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

// --- In-memory tables: drizzle renders each condition, this store evaluates it ---

type DbRow = Record<string, unknown>;
const tables = new Map<string, DbRow[]>();
const dialect = new PgDialect();
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const queries: Array<{ table: string; sql: string; params: unknown[] }> = [];

function matcher(table: Table, cond: SQL): (row: DbRow) => boolean {
  const name = getTableName(table);
  const { sql, params, typings } = dialect.sqlToQuery(cond);
  queries.push({ table: name, sql, params });
  const body = sql.startsWith('(') && sql.endsWith(')') ? sql.slice(1, -1) : sql;
  const terms = body.split(' and ').map((term) => {
    const m = term.match(/^"([a-z_]+)"\."([a-z_]+)" = \$(\d+)$/);
    if (!m || m[1] !== name) throw new Error(`#559 fake db: cannot evaluate ${JSON.stringify(sql)}`);
    const index = Number(m[3]) - 1;
    const value = params[index];
    if (typings?.[index] === 'uuid' && (typeof value !== 'string' || !UUID_SHAPE.test(value))) {
      // What Postgres answers (22P02) for a non-UUID compared with a uuid column.
      throw new Error(`invalid input syntax for type uuid: "${String(value)}"`);
    }
    return { column: m[2], value };
  });
  return (row) => terms.every(({ column, value }) => row[column] === value);
}

globals.__p559Db = {
  select(selection: Record<string, { name: string }>) {
    let table: Table;
    let where: (row: DbRow) => boolean = () => true;
    const chain = {
      from(t: Table) { table = t; return chain; },
      where(cond: SQL) { where = matcher(table, cond); return chain; },
      async limit(n: number) {
        const rows = (tables.get(getTableName(table)) ?? []).filter(where).slice(0, n);
        return rows.map((row) =>
          Object.fromEntries(Object.entries(selection).map(([alias, column]) => [alias, row[column.name]])));
      },
    };
    return chain;
  },
};

// --- Loopback S3: keeps each PUT's exact bytes ----------------------------------

const BUCKET = 'p559-attestations';
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
    res.writeHead(200, { ETag: '"p559"' }).end();
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
  S3_ACCESS_KEY_ID: 'p559-loopback-id',
  S3_SECRET_ACCESS_KEY: 'p559-loopback-secret',
});

const { putPackage } = await import('../../../lib/storage/index.ts');
const schema = await import('../../../lib/db/schema.ts');
const route = await import('./[slug]/attestations/[id]/package/route.ts');
const recordsRoute = await import('../records/[slug]/attestations/[id]/package/route.ts');
const { loadAttestationPackage } = await import('../../../lib/evidence/attestation-content.ts');

// --- Fixtures ------------------------------------------------------------------

const CREATOR = randomUUID();
const OTHER = randomUUID();
const sha256 = (bytes: Uint8Array | ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(bytes as ArrayBuffer)).digest('hex');
const keyOf = (url: string) => url.slice(`${ENDPOINT}/${BUCKET}/`.length);
const urlOf = (key: string) => `${ENDPOINT}/${BUCKET}/${key}`;

// Every attestation package the POST writes is `JSON.stringify` output stored
// under its hash (`attestations/route.ts`, through `signAndStoreAttestationPackage`).
const REVIEW = {
  schemaVersion: '0.1.0',
  type: 'expert_attestation',
  evidenceBaseHash: 'a'.repeat(64),
  createdAt: '2026-10-07T12:00:00.000Z',
  body: 'Reviewed the café-hours query ☕ — Ñ, 漢字, and a ratio of 0.1.',
  rating: 'concerns',
  metrics: { ratio: 0.1, big: 12345678901234567890, nested: [1, 2.5, -0.001, null, true] },
  '2': 'an integer-like key, which an object orders first',
};

// A stored text that a parse and re-serialize WOULD alter.
const ALTERED = [
  '{',
  '  "schemaVersion": "0.1.0",',
  '  "type": "consistency",',
  '  "ratio": 1.0,',
  '  "count": 1E2,',
  '  "title": "caf\\u00e9"',
  '}',
  '',
].join('\n');

const COLS = {
  record: getTableColumns(schema.evidenceRecords),
  attestation: getTableColumns(schema.attestationPackages),
};
function recordRow(slug: string, visibility: string): DbRow {
  return {
    [COLS.record.id.name]: randomUUID(),
    [COLS.record.slug.name]: slug,
    [COLS.record.visibility.name]: visibility,
    [COLS.record.creatorId.name]: CREATOR,
  };
}
function attestationRow(record: DbRow, storageKey: string): DbRow {
  return {
    [COLS.attestation.id.name]: randomUUID(),
    [COLS.attestation.evidenceRecordId.name]: record[COLS.record.id.name],
    [COLS.attestation.storageKey.name]: storageKey,
  };
}
const idOf = (row: DbRow) => row[COLS.attestation.id.name] as string;

const putUrl = await putPackage('b'.repeat(64), REVIEW);
const alteredKey = 'evidence-packages/p559-altered.json';
objects.set(alteredKey, Buffer.from(ALTERED, 'utf8'));

const records = {
  public: recordRow('public-one', 'public'),
  published: recordRow('published-one', 'published'),
  sealed: recordRow('sealed-one', 'sealed'),
  committed: recordRow('committed-one', 'committed'),
  otherPublic: recordRow('other-public', 'public'),
};
const attestations = {
  public: attestationRow(records.public, putUrl),
  publicAltered: attestationRow(records.public, urlOf(alteredKey)),
  publicMissing: attestationRow(records.public, urlOf('evidence-packages/absent.json')),
  published: attestationRow(records.published, putUrl),
  sealed: attestationRow(records.sealed, putUrl),
  committed: attestationRow(records.committed, putUrl),
  otherPublic: attestationRow(records.otherPublic, putUrl),
};
tables.set(getTableName(schema.evidenceRecords), Object.values(records));
tables.set(getTableName(schema.attestationPackages), Object.values(attestations));

async function get(slug: string, id: string, requester: string | null) {
  globals.__p559User = requester ? { userId: requester, scopes: [], via: 'session' } : null;
  return route.GET(
    new Request(`http://localhost/api/records/${slug}/attestations/${id}/package`) as never,
    { params: Promise.resolve({ slug, id }) },
  );
}
const slugOf = (record: DbRow) => record[COLS.record.slug.name] as string;
const requesterName = (r: string | null) => (r === null ? 'anonymous' : r === CREATOR ? 'creator' : 'non-creator');

// --- Criterion 1: one attestation, of that record, behind the record's gate ------

test('#559 C1: a public record\'s attestation is served to anyone, under both labels', async () => {
  for (const [record, attestation] of [[records.public, attestations.public], [records.published, attestations.published]]) {
    for (const requester of [null, OTHER, CREATOR]) {
      const res = await get(slugOf(record), idOf(attestation), requester);
      assert.equal(res.status, 200, `${slugOf(record)}, ${requesterName(requester)}`);
      assert.equal(sha256(await res.arrayBuffer()), sha256(objects.get(keyOf(putUrl))!));
    }
  }
});

test('#559 C1: a sealed record\'s attestation is a 404 to an anonymous reader and to a non-creator, under both labels', async () => {
  for (const [record, attestation] of [[records.sealed, attestations.sealed], [records.committed, attestations.committed]]) {
    for (const requester of [null, OTHER]) {
      const res = await get(slugOf(record), idOf(attestation), requester);
      assert.equal(res.status, 404, `${slugOf(record)}, ${requesterName(requester)}`);
      assert.deepEqual(await res.json(), { error: 'Not found' });
    }
  }
});

test('#559 C1: a sealed record\'s attestation is served to its creator, under both labels', async () => {
  for (const [record, attestation] of [[records.sealed, attestations.sealed], [records.committed, attestations.committed]]) {
    const res = await get(slugOf(record), idOf(attestation), CREATOR);
    assert.equal(res.status, 200, slugOf(record));
    assert.equal(sha256(await res.arrayBuffer()), sha256(objects.get(keyOf(putUrl))!));
  }
});

test('#559 C1: an attestation of another record is a 404, even when that record is readable', async () => {
  // Both ids exist and their objects are in the store; only the record differs.
  for (const requester of [null, OTHER, CREATOR]) {
    const foreign = await get(slugOf(records.public), idOf(attestations.otherPublic), requester);
    assert.equal(foreign.status, 404, `another public record's attestation, ${requesterName(requester)}`);
    assert.deepEqual(await foreign.json(), { error: 'Not found' });
    const sealedUnderPublic = await get(slugOf(records.public), idOf(attestations.sealed), requester);
    assert.equal(sealedUnderPublic.status, 404, `a sealed record's attestation under a public slug, ${requesterName(requester)}`);
    assert.deepEqual(await sealedUnderPublic.json(), { error: 'Not found' });
  }
});

test('#559 C1: an unknown id, a malformed id and an unknown slug are 404s', async () => {
  for (const [slug, id] of [
    [slugOf(records.public), randomUUID()],
    [slugOf(records.public), 'not-a-uuid'],
    [slugOf(records.public), '../../package'],
    ['no-such-record', idOf(attestations.public)],
  ]) {
    const res = await get(slug, id, CREATOR);
    assert.equal(res.status, 404, `${slug} / ${id}`);
    assert.deepEqual(await res.json(), { error: 'Not found' });
  }
});

test('#559 C1: /api/records/:slug/attestations/:id/package is the same handler', () => {
  assert.equal(recordsRoute.GET, route.GET);
});

// --- Criterion 2: the stored bytes, unchanged -------------------------------------

test('#559 C2 (b): a stored text a round trip would alter is served unchanged', async () => {
  assert.notEqual(JSON.stringify(JSON.parse(ALTERED)), ALTERED, 'premise: a parse and re-serialize alters this text');
  const res = await get(slugOf(records.public), idOf(attestations.publicAltered), null);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.equal(sha256(await res.arrayBuffer()), sha256(objects.get(alteredKey)!), 'the response body is the stored object, byte for byte');
});

test('#559 C2 (a): an attestation written through putPackage is served as the stored bytes', async () => {
  const stored = objects.get(keyOf(putUrl));
  assert.ok(stored, `the loopback store holds ${putUrl}`);
  assert.equal(stored.toString('utf8'), JSON.stringify(REVIEW), 'premise: the store holds what putPackage wrote');
  const res = await get(slugOf(records.public), idOf(attestations.public), null);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.equal(sha256(await res.arrayBuffer()), sha256(stored), 'the response body is the stored object, byte for byte');
});

test('#559 C2: an attestation whose object is missing from storage is a 502', async () => {
  const res = await get(slugOf(records.public), idOf(attestations.publicMissing), null);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'Package retrieval failed' });
});

// --- Criterion 3, end to end: the page's read against the real route -------------

test('#559 C3: the page\'s read, against the real route, returns the content or null, never an error body', async () => {
  const drive = (record: DbRow, attestation: DbRow, requester: string | null) => {
    globals.__p559User = requester ? { userId: requester, scopes: [], via: 'session' } : null;
    return loadAttestationPackage(slugOf(record), idOf(attestation), {
      fetch: async (input) => {
        const m = input.match(/^\/api\/records\/([^/]+)\/attestations\/([^/]+)\/package$/);
        assert.ok(m, `the read asked the attestation package route, not ${input}`);
        const [, slug, id] = m.map(decodeURIComponent);
        return recordsRoute.GET(new Request(`http://localhost${input}`) as never, { params: Promise.resolve({ slug, id }) });
      },
    });
  };
  assert.equal(await drive(records.sealed, attestations.sealed, null), null, 'the gate\'s 404 is not content');
  assert.equal(await drive(records.public, attestations.otherPublic, CREATOR), null, 'a foreign id\'s 404 is not content');
  assert.equal(await drive(records.public, attestations.publicMissing, null), null, 'the 502 is not content');
  assert.deepEqual(await drive(records.sealed, attestations.sealed, CREATOR), JSON.parse(JSON.stringify(REVIEW)));
  assert.deepEqual(await drive(records.public, attestations.publicAltered, OTHER), JSON.parse(ALTERED));
});

// --- Source positions: the gate, the scoped lookup, the text read, the helper -------

const ROUTE_SRC = fs.readFileSync(path.join(HERE, '[slug]', 'attestations', '[id]', 'package', 'route.ts'), 'utf8');
const count = (source: string, needle: string) => source.split(needle).length - 1;
function at(source: string, needle: string): number {
  const index = source.indexOf(needle);
  assert.ok(index > 0, `the attestation package route should contain ${needle}`);
  return index;
}

test('#559 C1: the gate is consulted once, before the attestation lookup and any storage read', () => {
  assert.equal(count(ROUTE_SRC, 'canReadRecord('), 1, 'one gate');
  const gate = at(ROUTE_SRC, 'if (!(await canReadRecord(request, records[0]))) {');
  const refusal = ROUTE_SRC.slice(gate, ROUTE_SRC.indexOf('\n  }', gate));
  assert.match(refusal, /return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\);/);
  assert.ok(gate < at(ROUTE_SRC, '.from(attestationPackages)'), 'the gate comes before the attestation lookup');
  assert.ok(gate < at(ROUTE_SRC, 'getPackageText('), 'the gate comes before the storage read');
});

test('#559 C2: the route reads the stored text once and answers with P2\'s helper, never a re-serialization', () => {
  assert.equal(count(ROUTE_SRC, 'getPackageText('), 1, 'one text read');
  assert.equal(count(ROUTE_SRC, 'getPackage('), 0, 'no parsing read');
  assert.equal(count(ROUTE_SRC, 'return storedPackageResponse(text);'), 1, 'the success answer is the helper');
  const read = at(ROUTE_SRC, 'getPackageText(');
  const failed = at(ROUTE_SRC, "{ error: 'Package retrieval failed' }");
  const served = at(ROUTE_SRC, 'return storedPackageResponse(text);');
  assert.ok(read < failed && failed < served, 'read, then the 502 on a failed read, then the helper');
  assert.ok(at(ROUTE_SRC, "from '@/lib/evidence/package-response'") < read, 'the helper is imported');
});

test('#559 C1: every query the route sent was one this store could evaluate', () => {
  // The fake store throws on a condition it cannot read; this records that the
  // drives above did reach it with the attestation lookup scoped to the record.
  const lookups = queries.filter((q) => q.table === getTableName(schema.attestationPackages));
  assert.ok(lookups.length > 0, 'the route looked attestations up');
  for (const q of lookups) {
    assert.match(q.sql, /"attestation_packages"\."id" = \$\d/);
    assert.match(q.sql, /"attestation_packages"\."evidence_record_id" = \$\d/);
  }
});
