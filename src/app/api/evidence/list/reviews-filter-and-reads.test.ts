// UX-2 P5 criteria 3 and 10, driven through the real list route
// (`./route.ts`, which `/api/records/list` re-exports).
//
// CRITERION 3 (R18b C, §11 item 9): the registry's filter is a reviews filter
// over the attestation rows. `?reviews=expert` answers the records that hold
// an `expert_attestation` row and no others; `?reviews=none` the records that
// hold no row; `evaluation` and `consistency` likewise. A record with only an
// expert review is in `expert` and not in `none`. The count the page reports
// (`total`) is the filtered count. Each row carries `reviews` (the shape
// `@/lib/evidence/review-summary` declares): its expert reviews' rating words,
// oldest first, and its evaluation and consistency-test counts.
//
// CRITERION 10 (F4 = A; relay 13 rulings 1-3): what a listing reads from
// storage, counted. The registry row carries no "Sources used" in P5, so a
// listing reads NO stored package. It reads each expert review's stored
// payload for its rating word: exactly one read per expert review on the page.
// An evaluation or a consistency test costs no read: its kind and count are
// database facts. Measured on a page of 20 with 0, 1 and 3 expert reviews per
// row (3 is above any density measured in production: nine attestation rows
// across seven records, `record-list.ts:17-19`).
//
// WHAT IS REAL. The route handler; `@/lib/storage` with `BLOB_DRIVER=s3`, the
// real S3 driver and SDK; `buildExpertAttestationPayload`; the three real
// record packages under `src/lib/flows/fixtures/` as the stored base packages;
// drizzle's own SQL rendering of every condition the route builds.
//
// THE DATABASE DOUBLE (`@/lib/db`, defined here). Each query's WHERE is
// rendered by drizzle's `PgDialect` and evaluated over in-memory rows. It
// reads: column comparisons with `=`, `>=`, `ilike`, `in (…)`, `not in (…)`,
// `is null`, `is not null`, a `::text` cast, `and`, `or`, parentheses, and
// drizzle's `true` / `false` for an empty list. It throws on anything else
// (a join, a subquery, `exists`), so a condition it cannot read fails the
// test instead of matching every row; a fix that needs another shape extends
// the double, and says so. It honours `orderBy(asc|desc(column))`, `groupBy`
// with `count(*)`, `limit`, `offset` and `selectDistinct`.
//
// THE COUNTER is a loopback S3 store defined here. It counts every GET by key,
// classed S (a base package), R (an expert review's payload), N (another
// review's payload). No tracked module is faked.
//
// DECOYS. Each count's check is shown able to fail in the last tests: an extra
// base-package read, a counter that drops one expert read, and a read of a
// non-expert payload each make `readMismatches` report the class they break.
//
// BLIND SPOTS. The double is not Postgres; it evaluates only the shapes above.
// Latency is not measured here (leg A measured the loopback floor; the staging
// and production reads are owed at the gate).
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
import { getTableColumns, getTableName, SQL, type Table } from 'drizzle-orm';

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
const SRC = path.resolve(HERE, '..', '..', '..', '..');

// --- Module hooks -------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-ux2-p5-list-stub/';
const STUB_SOURCE: Record<string, string> = {
  '@/lib/db': `export const db = {
    select: (...a) => globalThis.__ux2P5Db.select(false, ...a),
    selectDistinct: (...a) => globalThis.__ux2P5Db.select(true, ...a),
  };`,
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
      throw new Error(`UX-2 P5 list test hook: cannot resolve ${specifier}`);
    }
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

// --- The database double: drizzle renders each condition, this evaluates it ----

type DbRow = Record<string, unknown>;
const tables = new Map<string, DbRow[]>();
const dialect = new PgDialect();

type Node =
  | { op: 'and' | 'or'; parts: Node[] }
  | { op: 'const'; value: boolean }
  | { op: 'cmp'; table: string; column: string; kind: '=' | '>=' | 'ilike'; param: number }
  | { op: 'in'; table: string; column: string; negate: boolean; params: number[] }
  | { op: 'null'; table: string; column: string; negate: boolean };

function parseCondition(text: string): Node {
  const tokens = text.match(/"[a-z_]+"\."[a-z_]+"|\$\d+|::text|>=|=|\(|\)|,|[A-Za-z]+/g) ?? [];
  if (tokens.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) throw new Error(`UX-2 P5 db double: cannot read ${JSON.stringify(text)}`);
  let i = 0;
  const peek = () => tokens[i]?.toLowerCase();
  const take = (want?: string) => {
    const t = tokens[i++];
    if (want !== undefined && t?.toLowerCase() !== want) throw new Error(`UX-2 P5 db double: expected ${want} in ${JSON.stringify(text)}`);
    return t;
  };
  const params = (): number[] => {
    take('(');
    const out: number[] = [];
    while (peek() !== ')') { out.push(Number(take().slice(1))); if (peek() === ',') take(','); }
    take(')');
    return out;
  };
  const atom = (): Node => {
    if (peek() === '(') { take('('); const n = expr(); take(')'); return n; }
    if (peek() === 'true' || peek() === 'false') return { op: 'const', value: take() === 'true' };
    const ref = take();
    const m = ref?.match(/^"([a-z_]+)"\."([a-z_]+)"$/);
    if (!m) throw new Error(`UX-2 P5 db double: cannot read ${JSON.stringify(text)} at ${ref}`);
    const [, table, column] = m;
    if (peek() === '::text') take();
    const t = peek();
    if (t === '=' || t === '>=' || t === 'ilike') { take(); return { op: 'cmp', table, column, kind: t, param: Number(take().slice(1)) }; }
    if (t === 'in') { take(); return { op: 'in', table, column, negate: false, params: params() }; }
    if (t === 'not') { take(); take('in'); return { op: 'in', table, column, negate: true, params: params() }; }
    if (t === 'is') {
      take();
      const negate = peek() === 'not';
      if (negate) take();
      take('null');
      return { op: 'null', table, column, negate };
    }
    throw new Error(`UX-2 P5 db double: cannot read ${JSON.stringify(text)} at ${t}`);
  };
  const conj = (): Node => {
    const parts = [atom()];
    while (peek() === 'and') { take(); parts.push(atom()); }
    return parts.length === 1 ? parts[0] : { op: 'and', parts };
  };
  const expr = (): Node => {
    const parts = [conj()];
    while (peek() === 'or') { take(); parts.push(conj()); }
    return parts.length === 1 ? parts[0] : { op: 'or', parts };
  };
  const node = expr();
  if (i !== tokens.length) throw new Error(`UX-2 P5 db double: cannot read ${JSON.stringify(text)}`);
  return node;
}

const comparable = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v);

function evaluate(node: Node, row: DbRow, table: string, values: unknown[]): boolean {
  switch (node.op) {
    case 'and': return node.parts.every((p) => evaluate(p, row, table, values));
    case 'or': return node.parts.some((p) => evaluate(p, row, table, values));
    case 'const': return node.value;
    default: break;
  }
  if (node.table !== table) throw new Error(`UX-2 P5 db double: a condition on ${node.table} in a query over ${table}`);
  const cell = row[node.column];
  if (node.op === 'null') return (cell === null || cell === undefined) !== node.negate;
  if (node.op === 'in') return node.params.map((p) => values[p - 1]).includes(cell) !== node.negate;
  const value = values[node.param - 1];
  if (node.kind === '=') return cell === value;
  if (node.kind === '>=') return (comparable(cell) as number) >= (comparable(value) as number);
  const re = new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
  return re.test(String(cell ?? ''));
}

const dbQueries: string[] = [];

globals.__ux2P5Db = {
  select(distinct: boolean, selection?: Record<string, unknown>) {
    let table: Table;
    let cond: SQL | undefined;
    let order: Array<{ column: string; desc: boolean }> = [];
    let group: string | null = null;
    let limit = Infinity;
    let offset = 0;
    const run = (): DbRow[] => {
      const name = getTableName(table);
      dbQueries.push(name);
      const columns = getTableColumns(table) as Record<string, { name: string }>;
      let rows = tables.get(name) ?? [];
      if (cond) {
        const { sql: text, params } = dialect.sqlToQuery(cond);
        const node = parseCondition(text);
        rows = rows.filter((row) => evaluate(node, row, name, params));
      }
      for (const { column, desc } of [...order].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = comparable(a[column]) as number, y = comparable(b[column]) as number;
          return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
        });
      }
      const sel = selection ?? Object.fromEntries(Object.entries(columns));
      const isCount = (v: unknown) => v instanceof SQL && dialect.sqlToQuery(v).sql.toLowerCase().includes('count(');
      const project = (row: DbRow) => Object.fromEntries(Object.entries(sel).map(([alias, v]) => {
        if (v instanceof SQL) throw new Error(`UX-2 P5 db double: cannot project ${alias}`);
        return [alias, row[(v as { name: string }).name]];
      }));
      if (group !== null) {
        const counts = new Map<unknown, DbRow[]>();
        for (const row of rows) counts.set(row[group], [...(counts.get(row[group]) ?? []), row]);
        return [...counts.values()].map((rs) => Object.fromEntries(Object.entries(sel).map(([alias, v]) =>
          [alias, isCount(v) ? rs.length : rs[0][(v as { name: string }).name]])));
      }
      if (Object.values(sel).some(isCount)) return [{ count: rows.length }];
      let out = rows.slice(offset, offset + limit).map(project);
      if (distinct) out = [...new Map(out.map((r) => [JSON.stringify(r), r])).values()];
      return out;
    };
    const unsupported = (what: string) => () => { throw new Error(`UX-2 P5 db double: ${what} is not supported; extend the double`); };
    const chain = {
      from(t: Table) { table = t; return chain; },
      where(c: SQL) { cond = c; return chain; },
      orderBy(...items: Array<SQL | { name: string }>) {
        order = items.map((item) => {
          if (!(item instanceof SQL)) return { column: item.name, desc: false };
          const m = dialect.sqlToQuery(item).sql.match(/^"[a-z_]+"\."([a-z_]+)"(?: (asc|desc))?$/);
          if (!m) throw new Error('UX-2 P5 db double: cannot read an orderBy');
          return { column: m[1], desc: m[2] === 'desc' };
        });
        return chain;
      },
      groupBy(column: { name: string }) { group = column.name; return chain; },
      limit(n: number) { limit = n; return chain; },
      offset(n: number) { offset = n; return chain; },
      innerJoin: unsupported('innerJoin'),
      leftJoin: unsupported('leftJoin'),
      then(resolve: (rows: DbRow[]) => unknown, reject: (err: unknown) => unknown) {
        try { return Promise.resolve(run()).then(resolve, reject); } catch (err) { return Promise.reject(err).then(resolve, reject); }
      },
    };
    return chain;
  },
};

// --- The counter: a loopback S3 store that counts every GET, by key -----------

const BUCKET = 'ux2-p5-list';
const objects = new Map<string, Buffer>();
const keyClass = new Map<string, 'S' | 'R' | 'N'>();
type Reads = Record<'S' | 'R' | 'N' | 'other', number>;
const reads: Reads = { S: 0, R: 0, N: 0, other: 0 };
let dropNextExpertRead = false;
const resetReads = () => { reads.S = 0; reads.R = 0; reads.N = 0; reads.other = 0; };

const s3 = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const key = decodeURIComponent(new URL(req.url ?? '/', 'http://loopback').pathname).slice(`/${BUCKET}/`.length);
  if (req.method === 'PUT') {
    objects.set(key, Buffer.concat(chunks));
    res.writeHead(200, { ETag: '"ux2-p5"' }).end();
    return;
  }
  if (req.method === 'GET') {
    const cls = keyClass.get(key) ?? 'other';
    if (cls === 'R' && dropNextExpertRead) dropNextExpertRead = false; // the decoy: a read the counter misses
    else reads[cls] += 1;
    const body = objects.get(key);
    if (!body) { res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) }).end(body);
    return;
  }
  res.writeHead(405).end();
});
await new Promise<void>((resolve) => s3.listen(0, '127.0.0.1', resolve));
after(() => new Promise<void>((resolve) => s3.close(() => resolve())));
const ENDPOINT = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;

for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[name];
Object.assign(process.env, {
  BLOB_DRIVER: 's3',
  S3_ENDPOINT: ENDPOINT,
  S3_BUCKET: BUCKET,
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'fixture',
  S3_SECRET_ACCESS_KEY: 'fixture',
});

const { putPackage, getPackage } = await import('../../../../lib/storage/index.ts');
const { buildExpertAttestationPayload } = await import('../../../../lib/evidence/expert-attestation.ts');
const route = await import('./route.ts');
const { NextRequest } = await import('next/server.js');

// --- Fixtures --------------------------------------------------------------------

const keyOfUrl = (url: string) => url.slice(`${ENDPOINT}/${BUCKET}/`.length);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PACKAGES = ['record-2f32d9', 'record-397939', 'record-d887c1'].map((name) =>
  JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'flows', 'fixtures', `${name}.package.json`), 'utf8')) as Record<string, unknown>);
const CREATOR = randomUUID();
tables.set('users', [{ id: CREATOR, display_name: 'Fixture author', github_profile_url: 'https://example.invalid/fixture' }]);

type Kind = 'expert_attestation' | 'evaluation' | 'consistency';
type ReviewSpec = { kind: 'expert_attestation'; rating: 'endorse' | 'concerns' | 'dispute' | 'neutral' | 'unreadable' } | { kind: 'evaluation' | 'consistency' };

let clock = Date.UTC(2026, 9, 1);
const tick = () => new Date((clock += 60_000));

async function recordRow(slug: string, visibility: 'public' | 'sealed', index: number): Promise<DbRow> {
  const hash = sha(`ux2-p5-${slug}`);
  const url = await putPackage(hash, PACKAGES[index % PACKAGES.length]);
  keyClass.set(keyOfUrl(url), 'S');
  return {
    id: randomUUID(), slug, title: `Fixture ${slug}`, summary: 'A fixture summary.', model: 'anthropic/claude-sonnet-5.5',
    verification_status: 'unverified', is_public: true, visibility, withdrawn_at: null, reinstated_at: null,
    created_at: tick(), creator_id: CREATOR, base_package_hash: hash, base_package_storage_key: url,
  };
}

async function reviewRow(record: DbRow, spec: ReviewSpec): Promise<DbRow> {
  let url: string;
  if (spec.kind === 'expert_attestation') {
    if (spec.rating === 'unreadable') {
      url = `${ENDPOINT}/${BUCKET}/evidence-packages/attestation-${sha(`absent-${record.slug}`)}.json`;
    } else {
      const payload = buildExpertAttestationPayload(
        { body: `Fixture review of ${record.slug}.`, expertise: 'Fixture expertise', rating: spec.rating },
        { dbUserId: CREATOR, githubId: 'fixture', displayName: 'Fixture reviewer', githubProfileUrl: 'https://example.invalid/fixture' },
        record.base_package_hash as string, tick().toISOString());
      url = await putPackage(`attestation-${sha(JSON.stringify(payload) + randomUUID())}`, payload);
    }
    keyClass.set(keyOfUrl(url), 'R');
  } else {
    const payload = { schemaVersion: '0.1.0', type: spec.kind, evidenceBaseHash: record.base_package_hash, createdAt: tick().toISOString(), fixture: randomUUID() };
    url = await putPackage(`attestation-${sha(JSON.stringify(payload))}`, payload);
    keyClass.set(keyOfUrl(url), 'N');
  }
  return {
    id: randomUUID(), evidence_record_id: record.id, type: spec.kind as Kind, creator_id: CREATOR,
    package_hash: sha(url), storage_key: url, references_base_hash: record.base_package_hash, created_at: tick(),
  };
}

interface ListItem { slug: string; reviews?: { expertRatings: Array<string | null>; evaluations: number; consistencyTests: number } }
interface ListBody { records: ListItem[]; total: number }

async function list(query = ''): Promise<ListBody> {
  const res = await route.GET(new NextRequest(`http://localhost/api/records/list${query}`) as never);
  assert.equal(res.status, 200, `the list answered ${res.status}`);
  return (await res.json()) as ListBody;
}

// The registry's five shapes, plus a sealed record (never listed) holding an expert review.
const SHAPES: Record<string, ReviewSpec[]> = {
  'none': [],
  'expert-only': [{ kind: 'expert_attestation', rating: 'concerns' }],
  'machine-only': [{ kind: 'evaluation' }, { kind: 'consistency' }],
  'expert-and-evaluation': [{ kind: 'expert_attestation', rating: 'endorse' }, { kind: 'evaluation' }],
  'two-experts': [{ kind: 'expert_attestation', rating: 'dispute' }, { kind: 'expert_attestation', rating: 'neutral' }],
  'unreadable-expert': [{ kind: 'expert_attestation', rating: 'unreadable' }],
};
const filterRecords: DbRow[] = [];
const filterReviews: DbRow[] = [];
for (const [i, [slug, specs]] of Object.entries(SHAPES).entries()) {
  const record = await recordRow(slug, 'public', i);
  filterRecords.push(record);
  for (const spec of specs) filterReviews.push(await reviewRow(record, spec));
}
{
  const sealed = await recordRow('sealed-with-expert', 'sealed', 0);
  filterRecords.push(sealed);
  filterReviews.push(await reviewRow(sealed, { kind: 'expert_attestation', rating: 'endorse' }));
}
const useFilterFixture = () => { tables.set('evidence_records', filterRecords); tables.set('attestation_packages', filterReviews); };

const slugs = (body: ListBody) => body.records.map((r) => r.slug).sort();

// The criterion-10 page: every fixture is stored before the first test runs
// (node:test starts a test while the module is still loading).
const PAGE = 20;
const K = 3;
const pageRecords: DbRow[] = [];
for (let i = 0; i < PAGE; i += 1) pageRecords.push(await recordRow(`page-${String(i).padStart(2, '0')}`, 'public', i));
const RATINGS = ['endorse', 'concerns', 'dispute', 'neutral'] as const;
const pageReviews = new Map<number, DbRow[]>();
for (const experts of [0, 1, K]) {
  const rows: DbRow[] = [];
  for (const [i, record] of pageRecords.entries()) {
    for (let j = 0; j < experts; j += 1) rows.push(await reviewRow(record, { kind: 'expert_attestation', rating: RATINGS[(i + j) % 4] }));
    rows.push(await reviewRow(record, { kind: 'evaluation' }));
    rows.push(await reviewRow(record, { kind: 'consistency' }));
  }
  pageReviews.set(experts, rows);
}

// --- Criterion 3: the reviews filter ------------------------------------------------

test('UX-2 P5 C3: ?reviews=expert answers the records holding an expert review, and no others; the count is the filtered count', async () => {
  useFilterFixture();
  const all = await list();
  assert.deepEqual(slugs(all), ['expert-and-evaluation', 'expert-only', 'machine-only', 'none', 'two-experts', 'unreadable-expert'], 'premise: six public records list, the sealed one does not');
  const expert = await list('?reviews=expert');
  assert.deepEqual(slugs(expert), ['expert-and-evaluation', 'expert-only', 'two-experts', 'unreadable-expert']);
  assert.equal(expert.total, 4, 'the page count is the filtered count');
});

test('UX-2 P5 C3: ?reviews=none answers the records holding no review; a record with only an expert review is not among them', async () => {
  useFilterFixture();
  const none = await list('?reviews=none');
  assert.deepEqual(slugs(none), ['none']);
  assert.equal(none.total, 1);
  assert.ok(!slugs(none).includes('expert-only'));
});

test('UX-2 P5 C3: ?reviews=evaluation and ?reviews=consistency answer their kinds', async () => {
  useFilterFixture();
  assert.deepEqual(slugs(await list('?reviews=evaluation')), ['expert-and-evaluation', 'machine-only']);
  assert.deepEqual(slugs(await list('?reviews=consistency')), ['machine-only']);
});

test('UX-2 P5 C3 / G0-13 a: each row reports its reviews: the rating words oldest first, a payload that could not be read as null, and the two machine counts', async () => {
  useFilterFixture();
  const bySlug = new Map((await list()).records.map((r) => [r.slug, r.reviews]));
  assert.deepEqual(Object.fromEntries(bySlug), {
    'none': { expertRatings: [], evaluations: 0, consistencyTests: 0 },
    'expert-only': { expertRatings: ['concerns'], evaluations: 0, consistencyTests: 0 },
    'machine-only': { expertRatings: [], evaluations: 1, consistencyTests: 1 },
    'expert-and-evaluation': { expertRatings: ['endorse'], evaluations: 1, consistencyTests: 0 },
    'two-experts': { expertRatings: ['dispute', 'neutral'], evaluations: 0, consistencyTests: 0 },
    'unreadable-expert': { expertRatings: [null], evaluations: 0, consistencyTests: 0 },
  });
});

// --- Criterion 10: storage reads per listing ------------------------------------------

/** Every way the observed reads differ from what a page with `experts` expert reviews per row may read. */
function readMismatches(observed: Reads, experts: number): string[] {
  const out: string[] = [];
  if (observed.S !== 0) out.push(`class S: the listing read ${observed.S} stored package(s); it reads none (relay 13, ruling 1)`);
  if (observed.R !== PAGE * experts) out.push(`class R: ${observed.R} expert-review read(s) for ${PAGE * experts} expert review(s) on the page; exactly one each`);
  if (observed.N !== 0) out.push(`class N: ${observed.N} read(s) of an evaluation or consistency payload; their kind and count are database facts`);
  if (observed.other !== 0) out.push(`other: ${observed.other} read(s) of an object this fixture did not store`);
  return out;
}

async function drivePage(experts: number, decoy?: 'base-read' | 'drop-one' | 'read-other'): Promise<{ body: ListBody; observed: Reads }> {
  tables.set('evidence_records', pageRecords);
  tables.set('attestation_packages', pageReviews.get(experts)!);
  await getPackage(pageRecords[0].base_package_storage_key as string); // warm the driver, outside the count
  resetReads();
  if (decoy === 'drop-one') dropNextExpertRead = true;
  const body = await list();
  if (decoy === 'base-read') await getPackage(pageRecords[1].base_package_storage_key as string);
  if (decoy === 'read-other') await getPackage(pageReviews.get(experts)!.find((r) => r.type === 'evaluation')!.storage_key as string);
  dropNextExpertRead = false;
  return { body, observed: { ...reads } };
}

for (const experts of [0, 1, K]) {
  test(`UX-2 P5 C10: a page of ${PAGE} with ${experts} expert review(s) per row (and 1 evaluation and 1 consistency test each) reads no stored package and ${PAGE * experts} expert payload(s)`, async () => {
    const { body, observed } = await drivePage(experts);
    console.log(`# UX2-P5-C10 experts/row=${experts} reads=${JSON.stringify(observed)}`);
    assert.equal(body.records.length, PAGE, 'premise: a full page');
    assert.deepEqual(readMismatches(observed, experts), [], `the listing read ${JSON.stringify(observed)}`);
    for (const r of body.records) {
      assert.equal(r.reviews?.expertRatings.length, experts, `${r.slug}: one rating word per expert review`);
      assert.ok(r.reviews!.expertRatings.every((w) => (RATINGS as readonly string[]).includes(w as string)), `${r.slug}: ${JSON.stringify(r.reviews)}`);
    }
  });
}

test('UX-2 P5 C10 decoys: each read class\'s check reports a page that broke it', async () => {
  const cases: Array<[Parameters<typeof drivePage>[1], number, RegExp]> = [
    ['base-read', 1, /^class S/],
    ['drop-one', 1, /^class R/],
    ['read-other', 1, /^class N/],
  ];
  for (const [decoy, experts, cls] of cases) {
    const { observed } = await drivePage(experts, decoy);
    const found = readMismatches(observed, experts);
    console.log(`# UX2-P5-C10 decoy=${decoy} reads=${JSON.stringify(observed)} -> ${JSON.stringify(found)}`);
    assert.ok(found.some((m) => cls.test(m)), `decoy ${decoy}: the check did not report ${cls}; it reported ${JSON.stringify(found)}`);
  }
});
