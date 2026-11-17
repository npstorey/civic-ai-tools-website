#!/usr/bin/env node
/**
 * Drives the statement-check table (`src/lib/mcp/fixtures/statement-check-postgres16.json`) on a real PostgreSQL
 * (CKAN-1 P3, fix round 2, F7): each row sent as ONE simple query (`psql -c`) to a throwaway `postgres:16-alpine`
 * container, its hidden statement written as `CREATE TABLE hit_<id>()`. Prints, per row, what PostgreSQL did
 * (`second`, `notSelect`, `one`, `nothing`) beside the table's `postgres` value, and exits 1 on any row that differs.
 * Run it whenever `isOneSelectOrWithStatement` (`src/lib/mcp/pack-filter.ts`) changes. Needs Docker; not run in CI.
 *
 *   node scripts/statement-check-postgres.mjs
 *
 * Classification: an `ERROR` first line is `nothing`; a `hit_<id>` table that exists afterwards is `notSelect` for a
 * row whose own statement is the CREATE (its table's `notSelect` value says so) and `second` otherwise, except a
 * one-statement SELECT INTO, which the table marks `one`; anything else is `one`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TABLE = JSON.parse(readFileSync(new URL('../src/lib/mcp/fixtures/statement-check-postgres16.json', import.meta.url), 'utf8'));
const name = `statement-check-pg-${process.pid}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const psql = (sql, input) => {
  try {
    return execFileSync('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-qAt', '-c', sql], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    return String(error.stderr ?? '') + String(error.stdout ?? '');
  }
};

docker('run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=ref', 'postgres:16-alpine');
let differ = 0;
try {
  for (let i = 0; i < 60 && psql('select 1').trim() !== '1'; i += 1) execFileSync('sleep', ['1']);
  process.stdout.write(`${psql('select version()').slice(0, 40)}\n`);
  psql('create table sink(a int)');
  for (const row of TABLE.rows) {
    const said = psql(row.sql).split('\n')[0];
    const hit = psql(`select to_regclass('hit_${row.id}') is not null`).trim() === 't';
    const did = said.startsWith('ERROR') ? 'nothing' : hit ? (row.postgres === 'notSelect' || (row.postgres === 'one' && row.sql.includes(' INTO ')) ? row.postgres : 'second') : 'one';
    if (did !== row.postgres) differ += 1;
    process.stdout.write(`${row.id}\t${did}\t${row.postgres}${did === row.postgres ? '' : '\tDIFFERS'}\t${said.slice(0, 80)}\n`);
    psql('truncate sink');
  }
} finally {
  docker('stop', name);
}
process.exit(differ === 0 ? 0 : 1);
