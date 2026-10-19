// R6 W5 (#632), criterion 5: the usage table (D9), as the migration, its
// journal entry, its snapshot and the schema state it.
//
// `0018_usage_counts.sql` creates `usage_counts`: one row per day and per
// combination of the eight key columns, holding how many runs ended with that
// combination. Every column is NOT NULL, and the primary key over the eight
// is written inside the CREATE TABLE, under an explicit name:
// `usage_counts_pkey`. Drizzle's default name for a key over these eight
// columns is longer than Postgres's 63-byte identifier limit; Postgres would
// truncate it with a NOTICE, and the snapshot's name would then differ from
// the catalog's. `CREATE TABLE IF NOT EXISTS` is written by hand, as `0017`'s
// header says why: the owner applies it through `psql` ahead of the deploy,
// and a fork applies the same file through `drizzle-kit migrate`, so both
// paths must be safe on a database that already has it.
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no `0018` file, no journal
// entry at idx 18, no snapshot and no `usageCounts` in the schema.
//
// The scratch database read-back (the migration applied, the catalog listed)
// is the phase report's, not this file's: no test here opens a database.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE = path.resolve(HERE, '..', '..', '..', 'drizzle');
const SQL_FILE = path.join(DRIZZLE, '0018_usage_counts.sql');
const SNAPSHOT_FILE = path.join(DRIZZLE, 'meta', '0018_snapshot.json');
const PREV_ID = '62bfeb10-0f9d-4903-839b-8288ee1a204d';
const KEY_NAME = 'usage_counts_pkey';

/** D9's columns as the contract states them: name and SQL type, in order. */
const COLUMNS: Array<[string, string]> = [
  ['day', 'date'],
  ['environment', 'text'],
  ['surface', 'text'],
  ['signed_in', 'boolean'],
  ['model', 'text'],
  ['outcome', 'text'],
  ['sources_offered', 'text'],
  ['sources_used', 'text'],
  ['count', 'integer'],
];
/** The eight key columns, in order: every column but `count`. */
const KEY_COLUMNS = COLUMNS.map(([name]) => name).filter((name) => name !== 'count');

function readSql(): string {
  assert.ok(fs.existsSync(SQL_FILE), `no migration at ${path.relative(path.dirname(DRIZZLE), SQL_FILE)}`);
  return fs.readFileSync(SQL_FILE, 'utf8');
}

/** The column lines of the CREATE TABLE, keyed by column name. */
function sqlColumnLines(sql: string): Map<string, string> {
  const lines = new Map<string, string>();
  for (const line of sql.split('\n')) {
    const match = /^\s*"([a-z_]+)"\s+/.exec(line);
    if (match) lines.set(match[1], line);
  }
  return lines;
}

function usageCountsTable(): PgTable {
  const table = (schema as Record<string, unknown>).usageCounts;
  assert.ok(table, 'schema.ts exports no usageCounts');
  return table as PgTable;
}

test('criterion 5: 0018 creates usage_counts by hand with IF NOT EXISTS, every column NOT NULL with its type', () => {
  const sql = readSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "usage_counts"/);
  const lines = sqlColumnLines(sql);
  assert.deepEqual([...lines.keys()], COLUMNS.map(([name]) => name), 'the CREATE TABLE does not list D9\'s columns, in order');
  for (const [name, type] of COLUMNS) {
    const line = lines.get(name)!;
    assert.ok(new RegExp(`^\\s*"${name}"\\s+${type}\\b`).test(line), `"${name}" is not ${type}: ${line}`);
    assert.match(line, /NOT NULL/i, `"${name}" is nullable: ${line}`);
    assert.doesNotMatch(line, /PRIMARY KEY/i, `"${name}" carries a key of its own: ${line}`);
  }
  assert.match(sql, /drizzle-kit generate[^]*IF NOT EXISTS/i, 'the header does not say why IF NOT EXISTS is written by hand');
});

test('criterion 5: the key is written inline, named usage_counts_pkey (at most 63 bytes), over the eight key columns in order', () => {
  const sql = readSql();
  // The statements, not the header: the header says why there is no ALTER TABLE.
  const statements = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /ALTER TABLE/i, 'a constraint is added by ALTER TABLE, which has no IF NOT EXISTS form');
  const keys = [...sql.matchAll(/CONSTRAINT "([^"]+)" PRIMARY KEY\s*\(([^)]*)\)/g)];
  assert.equal(keys.length, 1, `the file does not hold exactly one named primary key:\n${sql}`);
  const [, name, list] = keys[0];
  assert.equal(name, KEY_NAME);
  assert.ok(Buffer.byteLength(name, 'utf8') <= 63, `the key's name is ${Buffer.byteLength(name, 'utf8')} bytes; Postgres truncates past 63`);
  assert.deepEqual(list.split(',').map((c) => c.trim().replace(/^"|"$/g, '')), KEY_COLUMNS);
  const create = /CREATE TABLE IF NOT EXISTS "usage_counts" \(([^]*)\);/.exec(sql);
  assert.ok(create && create[1].includes(`CONSTRAINT "${KEY_NAME}"`), 'the key is not inside the CREATE TABLE');
});

test('criterion 5: the header states what the table holds, who runs it, the order, the read-back and the reversal', () => {
  const sql = readSql();
  const header = sql.split('\n').filter((l) => l.startsWith('--')).join('\n');
  assert.match(header, /WHAT IT HOLDS/);
  assert.match(header, /OWNER-RUN/);
  assert.match(header, /ORDERING IS SAFE IN BOTH DIRECTIONS/);
  assert.match(header, /\\d usage_counts/, 'the header gives no read-back');
  assert.match(header, /DROP TABLE IF EXISTS usage_counts/, 'the header does not say how to reverse it');
});

test('criterion 5: the journal holds 0018 at idx 18, and its snapshot chains from 0017\'s and states the key', () => {
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
  const entry = journal.entries.find((e) => e.tag === '0018_usage_counts');
  assert.ok(entry, 'the journal has no 0018_usage_counts entry');
  assert.equal(entry.idx, 18);
  assert.ok(fs.existsSync(SNAPSHOT_FILE), 'no 0018 snapshot');
  const prev = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta', '0017_snapshot.json'), 'utf8')) as { id: string };
  assert.equal(prev.id, PREV_ID, 'premise: 0017\'s snapshot id');
  const next = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) as {
    id: string;
    prevId: string;
    tables: Record<string, { columns: Record<string, { notNull: boolean; type: string; primaryKey: boolean }>; compositePrimaryKeys: Record<string, { name: string; columns: string[] }> }>;
  };
  assert.equal(next.prevId, PREV_ID, 'the 0018 snapshot does not chain from 0017\'s');
  const table = next.tables['public.usage_counts'];
  assert.ok(table, 'the snapshot has no usage_counts table');
  assert.deepEqual(Object.entries(table.columns).map(([name, c]) => [name, c.type]), COLUMNS);
  for (const [name, column] of Object.entries(table.columns)) {
    assert.equal(column.notNull, true, `${name} is nullable in the snapshot`);
    assert.equal(column.primaryKey, false, `${name} is a key of its own in the snapshot`);
  }
  assert.deepEqual(Object.values(table.compositePrimaryKeys), [{ name: KEY_NAME, columns: KEY_COLUMNS }]);
});

test('criterion 5: the schema states the table with the file\'s columns and types, none nullable, and the same named key', () => {
  const table = usageCountsTable();
  const columns = Object.values(getTableColumns(table));
  assert.deepEqual(columns.map((c) => [c.name, c.getSQLType()]), COLUMNS);
  for (const column of columns) assert.equal(column.notNull, true, `${column.name} is nullable in the schema`);
  const lines = sqlColumnLines(readSql());
  assert.deepEqual(columns.map((c) => c.name), [...lines.keys()], 'the schema\'s columns differ from the file\'s');
  const config = getTableConfig(table);
  assert.equal(config.name, 'usage_counts');
  assert.equal(config.primaryKeys.length, 1, 'the schema states no composite key');
  const key = config.primaryKeys[0];
  assert.equal(key.getName(), KEY_NAME, 'the schema\'s key carries drizzle\'s default name, which Postgres truncates');
  assert.ok(Buffer.byteLength(key.getName(), 'utf8') <= 63);
  assert.deepEqual(key.columns.map((c) => c.name), KEY_COLUMNS);
});
