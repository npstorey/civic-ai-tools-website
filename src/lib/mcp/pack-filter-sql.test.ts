// CKAN-1 P3, fix rounds 1 and 2 (F1, F7): the statement check of `ckan_datastore_search_sql`, held to a real server,
// not to a reading of one. Since router 0.12.0 (CKAN-2-WEB P1, W3) the tool is the hosted CKAN server's own, offered
// as `ckan__ckan_datastore_search_sql` with no pack, and the check is read through the server-tool path
// (`serverCallRefusal`). `../model-loop/ckan-server-driven.test.ts` drives the same table through the loop.
//
// THE CHECK IS A PORT of PostgreSQL's lexical rules (`src/backend/parser/scan.l`), since the datastore is PostgreSQL:
// whitespace (`space`, which in 16 holds no vertical tab); `--` comments, which end at a line feed or a carriage return
// (`newline`); block comments, which nest; `'…'` literals with `''` inside, read both ways a server may read a
// backslash in them; escape strings `E'…'`, continued across a newline; Unicode escape strings `U&'…'`; `"…"`
// identifiers; dollar quotes (`$$…$$`, `$tag$…$tag$`, the tag not starting with a digit); parameters (`$1`); and a `$`
// after an identifier, which continues it, against a `$` after a number or a parameter, which starts a dollar quote
// and which the check refuses as not sure. A statement is sent only when it is one statement that begins with SELECT
// or WITH under every reading; anything the check cannot be sure of is refused.
//
// THE TABLE (`./fixtures/statement-check-postgres16.json`, 43 rows) was driven on PostgreSQL 16.15
// (`postgres:16-alpine`, `standard_conforming_strings` on), each row sent as one simple query with its hidden statement
// written as `CREATE TABLE hit_<id>()`; each row states what the server did (`second`: it ran a second statement;
// `notSelect`: it ran a statement that does not begin with SELECT or WITH; `one`: one statement that does; `nothing`:
// it ran nothing) and what the check decides. `scripts/statement-check-postgres.mjs` drives it again (Docker; not in
// CI): run it whenever the check changes, and the table moves with it.
//
// THE DEFECT this test fails on: a row the check sends on which the server ran a hidden statement. A row the check
// refuses on which the server ran one SELECT or WITH statement is allowed, and the table marks it "refused, not sure".
// The ruled rule's named limit (D3 = A) stands: a data-modifying WITH and a SELECT INTO are one statement each, and sent.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as packFilter from './pack-filter.ts';
import { isOneSelectOrWithStatement, SqlStatementRefusedError } from './pack-filter.ts';

/** The server-tool path's refusal, read through a cast so this file type-checks before the name exists (W3's red). */
const { serverCallRefusal } = packFilter as unknown as { serverCallRefusal?: (upstream: string, args: Record<string, unknown>) => Error | null };

interface Row { id: string; label: string; sql: string; postgres: 'second' | 'notSelect' | 'one' | 'nothing'; postgresSaid: string; check: 'sent' | 'refused'; note?: string }
const TABLE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'statement-check-postgres16.json'), 'utf8')) as { server: string; rows: Row[] };
const TOOL = 'ckan_datastore_search_sql';
const PORTAL = 'https://data.boston.gov';

test('the table was driven on PostgreSQL 16.15 and covers each outcome', () => {
  assert.equal(TABLE.server, 'PostgreSQL 16.15');
  assert.ok(TABLE.rows.length >= 43, 'premise: the table holds its rows');
  for (const outcome of ['second', 'notSelect', 'one', 'nothing'] as const) {
    assert.ok(TABLE.rows.some((row) => row.postgres === outcome), `premise: a row on which PostgreSQL did "${outcome}"`);
  }
});

test('no row the check sends is one on which PostgreSQL ran a hidden statement', () => {
  const defects = TABLE.rows.filter((row) => isOneSelectOrWithStatement(row.sql) && (row.postgres === 'second' || row.postgres === 'notSelect'));
  assert.deepEqual(defects.map((row) => `${row.id}: ${row.label}`), []);
});

test('each row\'s check is the table\'s, through the server-tool path; a refusal of one statement is marked "refused, not sure"', () => {
  assert.equal(typeof serverCallRefusal, 'function', 'the server-tool path has no statement check');
  const wrong = TABLE.rows.flatMap((row) => {
    const refusal = serverCallRefusal!(TOOL, { server_url: PORTAL, sql: row.sql });
    const decided = refusal === null ? 'sent' : refusal instanceof SqlStatementRefusedError ? 'refused' : 'another refusal';
    return decided === row.check ? [] : [`${row.id}: ${row.label}: ${decided}, the table says ${row.check}`];
  });
  assert.deepEqual(wrong, []);
  const unmarked = TABLE.rows.filter((row) => row.check === 'refused' && row.postgres === 'one' && !row.note?.startsWith('refused, not sure'));
  assert.deepEqual(unmarked.map((row) => row.id), [], 'a refusal of one statement is not marked');
});
