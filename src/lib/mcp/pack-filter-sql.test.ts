// CKAN-1 P3 fix round 1 (F1): the statement check of a CKAN pack's `ckan_datastore_search_sql` reads PostgreSQL's
// lexical forms, since the datastore is PostgreSQL: escape strings (`E'…'`, where a backslash escapes a quote), plain
// literals under either reading of a backslash (a server with backslash escapes on reads `'\''` as one quote), dollar
// quotes (`$$…$$`, `$tag$…$tag$`) and nested block comments. A statement is sent only when it is one statement under
// every reading the server could take, and refused where the check cannot be sure.
//
// THE TABLE holds the four shapes driven at stage G's head (`…/temp/ckan/p3/v/sql-probe.out`), each a second statement
// after a semicolon outside a quoted literal as PostgreSQL reads it; A15's seven controls; and shapes that are one
// statement and must still be sent (a dollar quote holding a semicolon, a nested comment holding one).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packCallRefusal, packFilterOf, SqlStatementRefusedError } from './pack-filter.ts';

const TOOL = 'ckan_datastore_search_sql';
const FILTER = packFilterOf(`boston__${TOOL}`);

const TABLE: Array<[label: string, sql: string, sent: boolean]> = [
  ['escape string, backslash-escaped quote, then a second statement', "SELECT E'\\''; DROP TABLE x; --'", false],
  ['plain literal read with backslash escapes on, then a second statement', "SELECT '\\''; DROP TABLE x; --'", false],
  ['dollar-quoted literal holding a quote, then a second statement', "SELECT $$ ' $$; DROP TABLE x; --'", false],
  ['tagged dollar quote holding a quote, then a second statement', "SELECT $a$ ' $a$; DROP TABLE x; --'", false],
  ['A15: a DELETE', 'DELETE FROM "x"', false],
  ['A15: a comment, then DROP', '/* c */ drop table x', false],
  ['A15: a plain second statement', 'SELECT 1; DROP TABLE x', false],
  ['an unterminated literal: the check cannot be sure', "SELECT 'a; DROP TABLE x", false],
  ['an unterminated dollar quote: the check cannot be sure', 'SELECT $$ a; DROP TABLE x', false],
  ['A15: a count', 'SELECT count(*) FROM "x"', true],
  ['A15: a WITH', 'WITH t AS (SELECT 1) SELECT * FROM t', true],
  ['A15: a semicolon inside a quoted literal', 'SELECT * FROM "x" WHERE name = \'a;b\'', true],
  ['A15: a comment, then SELECT', '/* c */ SELECT 1', true],
  ['a dollar-quoted literal holding a semicolon, and no second statement', 'SELECT $$a;b$$ AS v FROM "x"', true],
  ['a tagged dollar quote holding a semicolon and a quote', "SELECT $t$ it's; fine $t$", true],
  ['a nested block comment holding a semicolon, read as PostgreSQL nests it', 'SELECT 1 /* a /* b */ ; DROP TABLE x */', true],
  ['a doubled quote inside a literal', "SELECT 'it''s' AS v", true],
  ['a backslash not before a quote, one statement under both readings', "SELECT 'a\\b' AS v", true],
  ['a trailing semicolon and a comment', 'SELECT 1; -- done', true],
  // Fix round 2 (F7), driven on PostgreSQL 16.15 by the ORCH: a carriage return ends a `--` comment, and a `$` after a
  // number or a parameter starts a dollar quote rather than continuing a word.
  ['a carriage return ends a trailing line comment, then a second statement', 'SELECT 1 -- x\r; CREATE TABLE hit_r01()', false],
  ['a carriage return ends a leading line comment, then a statement that is not SELECT', '-- c\rCREATE TABLE hit_r02 AS (\nSELECT 1)', false],
  ['a dollar quote directly after a number', "SELECT 1$$ ' $$; CREATE TABLE hit_n01(); --'", false],
  ['a tagged dollar quote directly after a number', "SELECT 1$a$ ' $a$; CREATE TABLE hit_n02(); --'", false],
  ['a dollar quote directly after a decimal', "SELECT 1.5$$ ' $$; CREATE TABLE hit_n03(); --'", false],
  ['a dollar quote directly after a parameter', "SELECT $1$$ ' $$; CREATE TABLE hit_n04(); --'", false],
];

test('fix round 1 (F1): the statement check reads PostgreSQL\'s quoting forms and sends only one statement under every reading', () => {
  assert.ok(FILTER, 'premise: the Boston pack has a filter');
  const wrong = TABLE.flatMap(([label, sql, sent]) => {
    const refusal = packCallRefusal(TOOL, { server_url: FILTER!.portal, sql }, FILTER!);
    const refused = refusal instanceof SqlStatementRefusedError;
    return refused === !sent && (refusal === null || refused) ? [] : [`${label}: ${JSON.stringify(sql)} ${sent ? 'refused' : 'sent'}`];
  });
  assert.deepEqual(wrong, []);
});
