// UX-2 P4a criteria 1, 2 (the reads), 4 and 5, driven through the real
// dashboard page (`src/app/(app)/dashboard/page.tsx`): what it hands
// `DashboardTabs`, and what it reads from storage to do so.
//
//   1. The analyses tab's count is the total over pages (`analysesTotal`),
//      not the page's length.
//   2. Each analysis on the page carries its `reviews` (the shape
//      `review-summary.ts` declares), and the page reads storage once per
//      expert review on the page and for nothing else: no stored package, no
//      evaluation's or consistency test's payload (the charter's L7 number;
//      as `api/evidence/list/reviews-filter-and-reads.test.ts` counts the
//      registry's).
//   4. 60 analyses render as pages of 25, 25 and 10, newest first; the page
//      is `?page=`; `?tab=` opens a tab as today. Out of range (the brief's
//      measurement 2, a proposal for the seat): a page past the last renders
//      the last; anything but digits (zero, a negative, `abc`, `2.5x`) renders
//      the first.
//   5. The evaluations handed to the tab carry no `storageKey` (#565 item 1).
//
// WHAT IS REAL. The page module and every module it imports except the
// database: `@/lib/storage` with `BLOB_DRIVER=s3` and the real S3 driver;
// `findDbUserByAccountKey`; drizzle's own SQL for every condition the page
// builds; `buildExpertAttestationPayload`. The page is called as Next calls a
// server component, and the element it returns is read for the
// `DashboardTabs` element's props; nothing is rendered.
//
// THE DATABASE DOUBLE (`@/lib/db`, defined here). Each query's conditions
// (WHERE and each inner join's ON) are rendered by drizzle's `PgDialect` and
// evaluated over in-memory rows: `=`, `<>`, `>=`, `in (…)`, `not in (…)`,
// `is null`, `is not null`, `and`, `or`, parentheses. It throws on any other
// shape, so a condition it cannot read fails the test rather than matching
// every row. It honours `innerJoin`, `orderBy(asc|desc(column))` over several
// columns, `groupBy` with `count(*)`, a bare `count(*)`, `limit` and `offset`.
//
// THE COUNTER is a loopback S3 store defined here: every GET by key, classed
// S (an analysis's stored package), R (an expert review's payload), N (an
// evaluation's or consistency test's payload). Decoys show each class's check
// able to fail.
//
// BLIND SPOTS. The double is not Postgres. Latency is not measured. The tab's
// rendering of these props is `dashboard-tabs.test.ts`.
//
// Run with: npm test

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import type { ReactElement } from 'react';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName, SQL, type Table } from 'drizzle-orm';
import { CONSENT_SURFACE_STUBS, SRC, registerSurfaceHooks, sessions } from '../sources/surface-test-harness.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  '@/lib/db': `export const db = { select: (...a) => globalThis.__ux2P4aDb.select(...a) };`,
});

const globals = globalThis as unknown as Record<string, unknown>;

// --- The database double -----------------------------------------------------------------

type DbRow = Record<string, unknown>;
/** Rows by table name, keyed by column name. */
const tables = new Map<string, DbRow[]>();
const dialect = new PgDialect();

type Operand = { ref: string } | { param: number };
type Node =
  | { op: 'and' | 'or'; parts: Node[] }
  | { op: 'const'; value: boolean }
  | { op: 'cmp'; left: string; kind: '=' | '<>' | '>='; right: Operand }
  | { op: 'in'; left: string; negate: boolean; params: number[] }
  | { op: 'null'; left: string; negate: boolean };

function parseCondition(text: string): Node {
  const tokens = text.match(/"[a-z_]+"\."[a-z_]+"|\$\d+|::text|<>|>=|=|\(|\)|,|[A-Za-z]+/g) ?? [];
  if (tokens.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) throw new Error(`UX-2 P4a db double: cannot read ${JSON.stringify(text)}`);
  let i = 0;
  const peek = () => tokens[i]?.toLowerCase();
  const take = (want?: string) => {
    const t = tokens[i++];
    if (want !== undefined && t?.toLowerCase() !== want) throw new Error(`UX-2 P4a db double: expected ${want} in ${JSON.stringify(text)}`);
    return t;
  };
  const ref = (t: string | undefined): string => {
    const m = t?.match(/^"([a-z_]+)"\."([a-z_]+)"$/);
    if (!m) throw new Error(`UX-2 P4a db double: cannot read ${JSON.stringify(text)} at ${t}`);
    return `${m[1]}.${m[2]}`;
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
    const left = ref(take());
    if (peek() === '::text') take();
    const t = peek();
    if (t === '=' || t === '<>' || t === '>=') {
      take();
      const next = take();
      return { op: 'cmp', left, kind: t, right: next.startsWith('$') ? { param: Number(next.slice(1)) } : { ref: ref(next) } };
    }
    if (t === 'in') { take(); return { op: 'in', left, negate: false, params: params() }; }
    if (t === 'not') { take(); take('in'); return { op: 'in', left, negate: true, params: params() }; }
    if (t === 'is') {
      take();
      const negate = peek() === 'not';
      if (negate) take();
      take('null');
      return { op: 'null', left, negate };
    }
    throw new Error(`UX-2 P4a db double: cannot read ${JSON.stringify(text)} at ${t}`);
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
  if (i !== tokens.length) throw new Error(`UX-2 P4a db double: cannot read ${JSON.stringify(text)}`);
  return node;
}

const comparable = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v);

function evaluate(node: Node, row: DbRow, values: unknown[]): boolean {
  const cell = (key: string) => {
    if (!(key in row)) throw new Error(`UX-2 P4a db double: ${key} is not in this query's tables`);
    return row[key];
  };
  switch (node.op) {
    case 'and': return node.parts.every((p) => evaluate(p, row, values));
    case 'or': return node.parts.some((p) => evaluate(p, row, values));
    case 'const': return node.value;
    case 'null': { const v = cell(node.left); return (v === null || v === undefined) !== node.negate; }
    case 'in': return node.params.map((p) => values[p - 1]).includes(cell(node.left)) !== node.negate;
    case 'cmp': {
      const a = comparable(cell(node.left));
      const b = comparable('ref' in node.right ? cell(node.right.ref) : values[node.right.param - 1]);
      if (node.kind === '=') return a === b;
      if (node.kind === '<>') return a !== b;
      return (a as number) >= (b as number);
    }
  }
}

/** A table's rows, each keyed `table.column`. */
const qualified = (table: Table): DbRow[] => {
  const name = getTableName(table);
  return (tables.get(name) ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [`${name}.${k}`, v])));
};

type Column = { name: string; table: Table };
const keyOf = (column: Column) => `${getTableName(column.table)}.${column.name}`;
const isCount = (v: unknown) => v instanceof SQL && dialect.sqlToQuery(v).sql.toLowerCase().includes('count(');

const dbQueries: string[] = [];

globals.__ux2P4aDb = {
  select(selection: Record<string, unknown>) {
    let base: Table;
    const joins: Array<{ table: Table; on: SQL }> = [];
    let cond: SQL | undefined;
    let order: Array<{ key: string; desc: boolean }> = [];
    let group: string | null = null;
    let limit = Infinity;
    let offset = 0;
    const run = (): DbRow[] => {
      dbQueries.push([getTableName(base), ...joins.map((j) => getTableName(j.table))].join('+'));
      let rows = qualified(base);
      for (const join of joins) {
        const { sql: text, params } = dialect.sqlToQuery(join.on);
        const node = parseCondition(text);
        const right = qualified(join.table);
        rows = rows.flatMap((left) => right.map((r) => ({ ...left, ...r })).filter((joined) => evaluate(node, joined, params)));
      }
      if (cond) {
        const { sql: text, params } = dialect.sqlToQuery(cond);
        const node = parseCondition(text);
        rows = rows.filter((row) => evaluate(node, row, params));
      }
      for (const { key, desc } of [...order].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = comparable(a[key]) as number, y = comparable(b[key]) as number;
          return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
        });
      }
      const project = (row: DbRow) => Object.fromEntries(Object.entries(selection).map(([alias, v]) => {
        if (v instanceof SQL) throw new Error(`UX-2 P4a db double: cannot project ${alias}`);
        return [alias, row[keyOf(v as Column)]];
      }));
      if (group !== null) {
        const groups = new Map<unknown, DbRow[]>();
        for (const row of rows) groups.set(row[group], [...(groups.get(row[group]) ?? []), row]);
        return [...groups.values()].map((rs) => Object.fromEntries(Object.entries(selection).map(([alias, v]) =>
          [alias, isCount(v) ? rs.length : rs[0][keyOf(v as Column)]])));
      }
      if (Object.values(selection).some(isCount)) return [{ count: rows.length }];
      return rows.slice(offset, offset + limit).map(project);
    };
    const chain = {
      from(t: Table) { base = t; return chain; },
      innerJoin(t: Table, on: SQL) { joins.push({ table: t, on }); return chain; },
      leftJoin() { throw new Error('UX-2 P4a db double: leftJoin is not supported; extend the double'); },
      where(c: SQL) { cond = c; return chain; },
      orderBy(...items: SQL[]) {
        order = items.map((item) => {
          const m = dialect.sqlToQuery(item).sql.match(/^"([a-z_]+)"\."([a-z_]+)"(?: (asc|desc))?$/);
          if (!m) throw new Error('UX-2 P4a db double: cannot read an orderBy');
          return { key: `${m[1]}.${m[2]}`, desc: m[3] === 'desc' };
        });
        return chain;
      },
      groupBy(column: Column) { group = keyOf(column); return chain; },
      limit(n: number) { limit = n; return chain; },
      offset(n: number) { offset = n; return chain; },
      then(resolve: (rows: DbRow[]) => unknown, reject: (err: unknown) => unknown) {
        try { return Promise.resolve(run()).then(resolve, reject); } catch (err) { return Promise.reject(err).then(resolve, reject); }
      },
    };
    return chain;
  },
};

// --- The counter: a loopback S3 store that counts every GET, by key ------------------------

const BUCKET = 'ux2-p4a-dashboard';
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
    res.writeHead(200, { ETag: '"ux2-p4a"' }).end();
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

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const { putPackage, getPackage } = await load('lib/storage/index.ts');
const { buildExpertAttestationPayload } = await load('lib/evidence/expert-attestation.ts');
const DashboardPage = (await load('app/(app)/dashboard/page.tsx')).default as (props: { searchParams?: Promise<Record<string, string>> }) => Promise<ReactElement>;
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as unknown;

// --- Fixtures ------------------------------------------------------------------------------

const keyOfUrl = (url: string) => url.slice(`${ENDPOINT}/${BUCKET}/`.length);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'flows', 'fixtures', 'record-2f32d9.package.json'), 'utf8')) as Record<string, unknown>;

const ACCOUNT = 'gh-fixture-account';
const ME = randomUUID();
const OTHER = randomUUID();
tables.set('users', [
  { id: ME, github_id: ACCOUNT, display_name: 'Fixture author', github_profile_url: 'https://example.invalid/me' },
  { id: OTHER, github_id: 'gh-fixture-other', display_name: 'Fixture reviewer', github_profile_url: 'https://example.invalid/other' },
]);
tables.set('api_tokens', []);

let clock = Date.UTC(2026, 8, 1);
const tick = () => new Date((clock += 60_000));

const N = 60;
const RATINGS = ['endorse', 'concerns', 'dispute', 'neutral'] as const;
const records: DbRow[] = [];
const reviews: DbRow[] = [];
/** Each of my analyses' expected reviews, by slug. */
const expected = new Map<string, { expertRatings: string[]; evaluations: number; consistencyTests: number }>();

async function recordRow(slug: string, creator: string): Promise<DbRow> {
  const hash = sha(`ux2-p4a-${slug}`);
  const url = await putPackage(hash, PACKAGE);
  keyClass.set(keyOfUrl(url), 'S');
  return {
    id: randomUUID(), slug, title: `Fixture ${slug}`, summary: `The ${slug} summary.`, model: 'anthropic/claude-sonnet-5.5',
    verification_status: 'unverified', consistency_classification: null, is_public: true, visibility: 'public',
    withdrawn_at: null, reinstated_at: null, created_at: tick(), creator_id: creator,
    base_package_hash: hash, base_package_storage_key: url,
  };
}

async function reviewRow(record: DbRow, creator: string, kind: 'expert_attestation' | 'evaluation' | 'consistency', rating?: (typeof RATINGS)[number]): Promise<DbRow> {
  let url: string;
  if (kind === 'expert_attestation') {
    const payload = buildExpertAttestationPayload(
      { body: `Fixture review of ${record.slug}.`, expertise: 'Fixture expertise', rating: rating! },
      { dbUserId: creator, githubId: 'fixture', displayName: 'Fixture reviewer', githubProfileUrl: 'https://example.invalid/fixture' },
      record.base_package_hash as string, tick().toISOString());
    url = await putPackage(`attestation-${sha(JSON.stringify(payload) + randomUUID())}`, payload);
    keyClass.set(keyOfUrl(url), 'R');
  } else {
    const payload = { schemaVersion: '0.1.0', type: kind, evidenceBaseHash: record.base_package_hash, createdAt: tick().toISOString(), fixture: randomUUID() };
    url = await putPackage(`attestation-${sha(JSON.stringify(payload))}`, payload);
    keyClass.set(keyOfUrl(url), 'N');
  }
  return {
    id: randomUUID(), evidence_record_id: record.id, type: kind, creator_id: creator,
    package_hash: sha(url), storage_key: url, references_base_hash: record.base_package_hash, created_at: tick(),
  };
}

// My 60 analyses, oldest first (`mine-00` … `mine-59`), each with one expert
// review and one evaluation by another account; every third also a
// consistency test. Another account's three analyses, with one evaluation of
// each written by me (my "reviews and checks").
for (let i = 0; i < N; i += 1) {
  const slug = `mine-${String(i).padStart(2, '0')}`;
  const record = await recordRow(slug, ME);
  records.push(record);
  const rating = RATINGS[i % RATINGS.length];
  reviews.push(await reviewRow(record, OTHER, 'expert_attestation', rating));
  reviews.push(await reviewRow(record, OTHER, 'evaluation'));
  const consistency = i % 3 === 0;
  if (consistency) reviews.push(await reviewRow(record, OTHER, 'consistency'));
  expected.set(slug, { expertRatings: [rating], evaluations: 1, consistencyTests: consistency ? 1 : 0 });
}
for (let i = 0; i < 3; i += 1) {
  const record = await recordRow(`theirs-${i}`, OTHER);
  records.push(record);
  reviews.push(await reviewRow(record, ME, 'evaluation'));
}
tables.set('evidence_records', records);
tables.set('attestation_packages', reviews);

const mine = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, k) => `mine-${String(from - k).padStart(2, '0')}`);

// --- Driving the page ------------------------------------------------------------------------

/** The `DashboardTabs` element in a tree, or null. */
function tabsElement(node: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) { const found = tabsElement(child); if (found) return found; }
    return null;
  }
  if (node === null || typeof node !== 'object' || !('props' in (node as object))) return null;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === DashboardTabs) return el;
  return tabsElement((el.props as { children?: unknown }).children);
}

async function drive(params: Record<string, string> = {}): Promise<{ props: Record<string, unknown>; observed: Reads }> {
  sessions.server = { user: { id: ACCOUNT } };
  await getPackage(records[0].base_package_storage_key as string); // warm the driver, outside the count
  resetReads();
  const tree = await DashboardPage({ searchParams: Promise.resolve(params) });
  const el = tabsElement(tree);
  assert.ok(el, 'premise: the page renders DashboardTabs');
  return { props: el.props, observed: { ...reads } };
}

const slugsOf = (props: Record<string, unknown>) => (props.myEvidence as Array<{ slug: string }>).map((r) => r.slug);

/** Every way the observed reads differ from what a page of `rows` analyses, one expert review each, may read. */
function readMismatches(observed: Reads, experts: number): string[] {
  const out: string[] = [];
  if (observed.S !== 0) out.push(`class S: the page read ${observed.S} stored package(s); it reads none`);
  if (observed.R !== experts) out.push(`class R: ${observed.R} expert-review read(s) for ${experts} expert review(s) on the page; exactly one each`);
  if (observed.N !== 0) out.push(`class N: ${observed.N} read(s) of an evaluation or consistency payload; their kind and count are database facts`);
  if (observed.other !== 0) out.push(`other: ${observed.other} read(s) of an object this fixture did not store`);
  return out;
}

// --- Criterion 4 (and 1): pages of 25, newest first ------------------------------------------------

test('UX-2 P4a C4: 60 analyses render as pages of 25, 25 and 10, newest first, through ?page=', async () => {
  const pages = [];
  for (const [params, want] of [
    [{}, mine(59, 35)],
    [{ page: '2' }, mine(34, 10)],
    [{ page: '3' }, mine(9, 0)],
  ] as Array<[Record<string, string>, string[]]>) {
    const { props } = await drive(params);
    assert.deepEqual(slugsOf(props), want, `?page=${params.page ?? '(none)'}: the page's analyses`);
    pages.push(props);
  }
  assert.deepEqual(pages.map((p) => [p.page, p.pageCount]), [[1, 3], [2, 3], [3, 3]], 'each page\'s number and the page count');
  assert.equal(new Set(pages.flatMap(slugsOf)).size, N, 'the three pages together hold every analysis once');
});

test('UX-2 P4a C1: the analyses count handed to the tab is the total over pages, on every page', async () => {
  for (const page of ['1', '2', '3']) {
    const { props } = await drive({ page });
    assert.equal(props.analysesTotal, N, `?page=${page}: the analyses total`);
  }
});

test('UX-2 P4a C4 (measurement 2, proposed): a page past the last renders the last; anything but digits renders the first', async () => {
  assert.deepEqual(slugsOf((await drive({ page: '9' })).props), mine(9, 0), '?page=9');
  for (const page of ['0', '-2', 'abc', '2.5x']) {
    const { props } = await drive({ page });
    assert.equal(props.page, 1, `?page=${page}: the page number`);
  }
});

test('UX-2 P4a C4: ?tab= works as today, beside ?page=', async () => {
  assert.equal((await drive({ tab: 'sources' })).props.initialTab, 'sources', '?tab=sources');
  assert.equal((await drive({})).props.initialTab, 'evidence', 'no ?tab=');
  const both = (await drive({ tab: 'sources', page: '2' })).props;
  assert.equal(both.initialTab, 'sources', '?tab=sources&page=2: the tab');
  assert.deepEqual(slugsOf(both), mine(34, 10), '?tab=sources&page=2: the page');
});

// --- Criterion 5: no storageKey reaches the client ------------------------------------------------

test('UX-2 P4a C5: the evaluations handed to the tab carry no storageKey (#565 item 1)', async () => {
  const { props } = await drive({});
  const evaluations = props.myEvaluations as Array<Record<string, unknown>>;
  assert.equal(evaluations.length, 3, 'premise: my three evaluations');
  assert.deepEqual(evaluations.filter((e) => 'storageKey' in e).map((e) => e.id), [], 'an evaluation carries its storage key to the client');
});

// --- Criterion 2: the reviews, and what they cost ---------------------------------------------------

test('UX-2 P4a C2: each analysis on the page carries its reviews, rating words read from the expert reviews\' payloads', async () => {
  for (const page of ['1', '3']) {
    const { props } = await drive({ page });
    const rows = props.myEvidence as Array<{ slug: string; reviews?: unknown }>;
    assert.deepEqual(
      Object.fromEntries(rows.map((r) => [r.slug, r.reviews])),
      Object.fromEntries(rows.map((r) => [r.slug, expected.get(r.slug)])),
      `?page=${page}: the rows' reviews`,
    );
  }
});

for (const [page, rows] of [['1', 25], ['2', 25], ['3', 10]] as Array<[string, number]>) {
  test(`UX-2 P4a C2 / L7: page ${page} (${rows} analyses, one expert review each) reads ${rows} expert payloads and nothing else`, async () => {
    const { props, observed } = await drive({ page });
    console.log(`# UX2-P4A-L7 page=${page} rows=${(props.myEvidence as unknown[]).length} reads=${JSON.stringify(observed)}`);
    assert.deepEqual(readMismatches(observed, rows), [], `the page read ${JSON.stringify(observed)}`);
    assert.equal((props.myEvidence as unknown[]).length, rows, 'the page\'s analyses');
  });
}

test('UX-2 P4a L7 decoys: each read class\'s check reports a page that broke it', async () => {
  const cases: Array<[string, RegExp, () => Promise<void>]> = [
    ['base-read', /^class S/, async () => { await getPackage(records[1].base_package_storage_key as string); }],
    ['drop-one', /^class R/, async () => { dropNextExpertRead = true; }],
    ['read-other', /^class N/, async () => { await getPackage(reviews.find((r) => r.type === 'evaluation')!.storage_key as string); }],
  ];
  for (const [decoy, cls, act] of cases) {
    sessions.server = { user: { id: ACCOUNT } };
    await getPackage(records[0].base_package_storage_key as string);
    resetReads();
    if (decoy === 'drop-one') await act();
    const tree = await DashboardPage({ searchParams: Promise.resolve({ page: '1' }) });
    if (decoy !== 'drop-one') await act();
    dropNextExpertRead = false;
    assert.ok(tabsElement(tree), 'premise: the page renders DashboardTabs');
    const found = readMismatches({ ...reads }, 25);
    console.log(`# UX2-P4A-L7 decoy=${decoy} reads=${JSON.stringify(reads)} -> ${JSON.stringify(found)}`);
    assert.ok(found.some((m) => cls.test(m)), `decoy ${decoy}: the check did not report ${cls}; it reported ${JSON.stringify(found)}`);
  }
});

// The queries a page makes, for the gate record (not asserted: the reads are the cost the charter names).
test('UX-2 P4a L7: the queries one dashboard page makes (reported, not asserted)', async () => {
  dbQueries.length = 0;
  await drive({ page: '1' });
  console.log(`# UX2-P4A-L7 queries=${JSON.stringify(dbQueries)}`);
  assert.ok(dbQueries.length > 0, 'premise: the page queried the double');
});
