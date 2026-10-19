// R6 W2 (#632), criterion 2: the consent table (D4 = A), as the migration, its
// journal entry, its snapshot and the schema state it.
//
// `0017_source_consents.sql` creates `source_consents`: one row per signed-in
// reader, keyed on `users.id`, with the per-source states, the flows hash and
// the statement snapshot it refers to, and the two times. Nullable nothing.
// `CREATE TABLE IF NOT EXISTS` is written by hand, as `0016`'s header says
// why: the owner applies it through `psql` ahead of the deploy, and a fork
// applies the same file through `drizzle-kit migrate`, so both paths must be
// safe on a database that already has it.
//
// The scratch database read-back (the migration applied, the columns listed)
// is the phase report's, not this file's: no test here opens a database.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import * as schema from './schema.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE = path.resolve(HERE, '..', '..', '..', 'drizzle');
const SQL_FILE = path.join(DRIZZLE, '0017_source_consents.sql');

/** D4's columns: name, SQL type, and the extra clause each must carry. */
const COLUMNS: Array<[string, string, RegExp]> = [
  ['user_id', 'uuid', /PRIMARY KEY/i],
  ['states', 'jsonb', /NOT NULL/i],
  ['flows_hash', 'text', /NOT NULL/i],
  ['flows_statement', 'jsonb', /NOT NULL/i],
  ['consented_at', 'timestamp with time zone', /NOT NULL/i],
  ['updated_at', 'timestamp with time zone', /NOT NULL/i],
];

test('criterion 2: 0017 creates source_consents by hand with IF NOT EXISTS, every column NOT NULL, and says why', () => {
  assert.ok(fs.existsSync(SQL_FILE), `no migration at ${path.relative(path.dirname(DRIZZLE), SQL_FILE)}`);
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "source_consents"/);
  for (const [name, type, clause] of COLUMNS) {
    const line = sql.split('\n').find((l) => l.trim().startsWith(`"${name}"`));
    assert.ok(line, `source_consents has no "${name}" column`);
    assert.ok(line!.includes(type), `"${name}" is not ${type}: ${line}`);
    assert.match(line!, /NOT NULL/i, `"${name}" is nullable: ${line}`);
    assert.match(line!, clause, `"${name}": ${line}`);
  }
  assert.match(sql, /REFERENCES "public"\."users"\("id"\) ON DELETE cascade/i, 'the row is not keyed on users.id with a cascading delete');
  assert.match(sql, /drizzle-kit generate[^]*IF NOT EXISTS/i, 'the header does not say why IF NOT EXISTS is written by hand');
});

test('criterion 2: the journal holds 0017 at idx 17, and its snapshot chains from 0016\'s', () => {
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
  // Found by its tag, not as the journal's last entry: `0018_usage_counts`
  // (R6 W5) follows it, and later migrations will follow that.
  const entry = journal.entries.find((e) => e.tag === '0017_source_consents');
  assert.deepEqual(entry && { idx: entry.idx, tag: entry.tag }, { idx: 17, tag: '0017_source_consents' });
  const snapshotFile = path.join(DRIZZLE, 'meta', '0017_snapshot.json');
  assert.ok(fs.existsSync(snapshotFile), 'no 0017 snapshot');
  const prev = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta', '0016_snapshot.json'), 'utf8')) as { id: string };
  const next = JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) as { id: string; prevId: string; tables: Record<string, { columns: Record<string, { notNull: boolean; type: string }> }> };
  assert.equal(next.prevId, prev.id, 'the 0017 snapshot does not chain from 0016\'s');
  const table = next.tables['public.source_consents'];
  assert.ok(table, 'the snapshot has no source_consents table');
  assert.deepEqual(Object.keys(table.columns), COLUMNS.map(([name]) => name));
  for (const [name, column] of Object.entries(table.columns)) assert.equal(column.notNull, true, `${name} is nullable in the snapshot`);
});

test('criterion 2: the schema states the table with the same columns, none nullable', () => {
  const table = (schema as Record<string, unknown>).sourceConsents;
  assert.ok(table, 'schema.ts exports no sourceConsents');
  const columns = getTableColumns(table as Parameters<typeof getTableColumns>[0]);
  assert.deepEqual(Object.values(columns).map((c) => c.name), COLUMNS.map(([name]) => name));
  for (const column of Object.values(columns)) assert.equal(column.notNull, true, `${column.name} is nullable in the schema`);
});
