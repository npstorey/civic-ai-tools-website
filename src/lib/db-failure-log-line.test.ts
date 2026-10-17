// #516 P4 — a database failure's log line carries its SQLSTATE code, and
// nothing else the database or the reader wrote.
//
// WHAT IS DRIVEN. Each supported driver (`src/lib/db/index.ts`) produces its
// OWN error class, and the ORM's real wrapper (`drizzle-orm`'s
// `queryWithCache`, which throws `DrizzleQueryError`) wraps it, by running a
// real insert through the real driver and the real `drizzle` handle:
//
//   - node-postgres (`pg`): a loopback socket that speaks just enough of the
//     Postgres wire protocol to accept a session and answer the insert with an
//     ErrorResponse. `pg-protocol`'s own parser builds the `DatabaseError`;
//   - the Neon HTTP driver (`@neondatabase/serverless`): `neonConfig`'s
//     `fetchFunction` answers the insert the way the Neon SQL endpoint answers
//     a failed statement (HTTP 400, the error's fields as JSON). The driver's
//     own code builds the `NeonDbError`.
//
// No database is reached; CI has none. The error each driver builds is the
// driver's, not a look-alike, and the wrapper around it is the ORM's.
//
// WHY THE FIXTURE CAN FAIL. The canary is a bound parameter of the insert, so
// the wrapper's `message` carries it (`Failed query: …\nparams: …`) — asserted
// below before the line is read — and the driver's `detail` carries it too, as
// a unique violation's detail does in Postgres (`Key (prompt)=(…) already
// exists.`). A line that logged the message, the detail or the whole error
// would carry it.
//
// WHAT THE LINE IS. Every server-side site logs a failure as
// `console.<level>('<prefix>', errorLogFacts(err))`
// (`src/lib/errors-out-of-logs.test.ts` holds that over the tree). The line
// below is that call, captured from `console` and formatted once per call
// with `util.format`, which is what `console` itself does.
//
// The red: at the base (`41f4e40`) `errorLogFacts` returns `{ errorClass:
// 'Error' }` for every database failure, so the unique-violation assertions
// fail there. The non-SQLSTATE assertions pass at the base (it logs no `code`
// at all); their red is the head with the shape check switched off.
//
// Run with: node --test --experimental-strip-types src/lib/db-failure-log-line.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import util from 'node:util';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

import { errorLogFacts } from './streaming.ts';

const require = createRequire(import.meta.url);

/** Planted as a bound parameter of every insert below; found in no log line. */
const CANARY = 'Vb6nQz3k-bound-param-canary';

/** The line a site writes for `err`, captured from `console` and formatted as `console` formats it. */
function loggedLine(err: unknown): string {
  const lines: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { lines.push(util.format(...args)); };
  try {
    console.error('[db-site]', errorLogFacts(err));
  } finally {
    console.error = real;
  }
  assert.equal(lines.length, 1, 'one call, one line');
  return lines[0];
}

/** The `code` the bound reports, read off the record, not the line. */
function reportedCode(err: unknown): unknown {
  return (errorLogFacts(err) as unknown as Record<string, unknown>).code;
}

// --- the ORM's table, shaped like the app's -----------------------------------

function recordsTable() {
  const { pgTable, text } = require('drizzle-orm/pg-core') as typeof import('drizzle-orm/pg-core');
  return pgTable('evidence_records', { title: text('title'), prompt: text('prompt') });
}

const ROW = { title: 'Noise complaints', prompt: `the reader asked ${CANARY}` };
const DUPLICATE_DETAIL = `Key (prompt)=(the reader asked ${CANARY}) already exists.`;

// --- node-postgres: a loopback Postgres that answers one way ------------------

type PgAnswer =
  | { kind: 'error'; fields: Record<string, string>; thenClose: boolean }
  | { kind: 'hang-up' };

/** One Postgres backend message: a type byte, an int32 length, the payload. */
function backendMessage(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.write(type, 0, 'latin1');
  head.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([head, payload]);
}

function errorResponse(fields: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(k, 'latin1'), Buffer.from(v, 'utf8'), Buffer.from([0]));
  parts.push(Buffer.from([0]));
  return backendMessage('E', Buffer.concat(parts));
}

const AUTH_OK = backendMessage('R', Buffer.from([0, 0, 0, 0]));
const READY = backendMessage('Z', Buffer.from('I', 'latin1'));

/**
 * A server that accepts a session without a password, then answers the first
 * query it is sent: with an ErrorResponse (and ReadyForQuery, or a close), or
 * by hanging up — a connection dropped mid-query.
 */
async function loopbackPostgres(answer: PgAnswer): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let startedUp = false;
    let answered = false;
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!startedUp) {
          if (buf.length < 4) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          buf = buf.subarray(len);
          startedUp = true;
          socket.write(Buffer.concat([AUTH_OK, READY]));
          continue;
        }
        if (buf.length < 5) return;
        const type = String.fromCharCode(buf[0]);
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) return;
        buf = buf.subarray(1 + len);
        if (type === 'X') { socket.end(); return; }
        if (answered) continue;
        if (answer.kind === 'hang-up') { answered = true; socket.destroy(); return; }
        // The extended protocol ends a statement with Sync ('S'); answer there.
        if (type !== 'S' && type !== 'Q') continue;
        answered = true;
        if (answer.thenClose) { socket.end(errorResponse(answer.fields)); return; }
        socket.write(Buffer.concat([errorResponse(answer.fields), READY]));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => server.close() };
}

/** Run the insert through the real `pg` Pool and the real `drizzle` node-postgres handle. */
async function pgInsertFailure(answer: PgAnswer): Promise<Error> {
  const { Pool } = require('pg') as typeof import('pg');
  const { drizzle } = require('drizzle-orm/node-postgres') as typeof import('drizzle-orm/node-postgres');
  const backend = await loopbackPostgres(answer);
  const pool = new Pool({ connectionString: `postgresql://fixture@127.0.0.1:${backend.port}/fixture` });
  pool.on('error', () => {});
  try {
    await drizzle(pool).insert(recordsTable()).values(ROW);
  } catch (err) {
    return err as Error;
  } finally {
    await pool.end().catch(() => {});
    backend.close();
  }
  throw new Error('the loopback insert succeeded — the fixture backend answers every query with a failure, so it is broken');
}

const UNIQUE_VIOLATION_FIELDS = {
  S: 'ERROR',
  V: 'ERROR',
  C: '23505',
  M: 'duplicate key value violates unique constraint "evidence_records_prompt_key"',
  D: DUPLICATE_DETAIL,
  s: 'public',
  t: 'evidence_records',
  n: 'evidence_records_prompt_key',
};

// --- Neon HTTP: the SQL endpoint, answered through `fetchFunction` -------------

/** Run the insert through the real `neon()` query function and the real `drizzle` neon-http handle. */
async function neonInsertFailure(answer: () => Promise<Response>): Promise<Error> {
  const { neon, neonConfig } = require('@neondatabase/serverless') as typeof import('@neondatabase/serverless');
  const { drizzle } = require('drizzle-orm/neon-http') as typeof import('drizzle-orm/neon-http');
  const prior = neonConfig.fetchFunction;
  neonConfig.fetchFunction = answer;
  try {
    await drizzle(neon('postgresql://fixture@fixture.invalid/fixture')).insert(recordsTable()).values(ROW);
  } catch (err) {
    return err as Error;
  } finally {
    neonConfig.fetchFunction = prior;
  }
  throw new Error('the Neon insert succeeded — the fixture endpoint answers every query with a failure, so it is broken');
}

const neonUniqueViolation = async () => new Response(JSON.stringify({
  message: 'duplicate key value violates unique constraint "evidence_records_prompt_key"',
  severity: 'ERROR',
  code: '23505',
  detail: DUPLICATE_DETAIL,
  schema: 'public',
  table: 'evidence_records',
  constraint: 'evidence_records_prompt_key',
}), { status: 400, headers: { 'Content-Type': 'application/json' } });

/** What the platform `fetch` throws when the peer closes the socket mid-request. */
const neonDroppedConnection = async (): Promise<Response> => {
  throw new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
};

// --- the fixture is shaped so it can fail --------------------------------------

/** The wrapper is the ORM's, the cause is the driver's, and the canary is in the wrapper's message. */
function assertCarrierShape(err: Error, driverClass: new (...args: never[]) => Error): void {
  const { DrizzleQueryError } = require('drizzle-orm') as typeof import('drizzle-orm');
  assert.ok(err instanceof DrizzleQueryError, `the ORM's own wrapper, got ${err?.constructor?.name}`);
  assert.ok(err.cause instanceof driverClass, `the driver's own error class as the cause, got ${(err.cause as Error)?.constructor?.name}`);
  assert.ok(err.message.includes(CANARY), "the canary is in the wrapper's message (the fixture can fail)");
}

// --- acceptance 1: each supported driver, driven -------------------------------

test('node-postgres: a unique violation logs 23505, and no bound parameter', async () => {
  const { DatabaseError } = require('pg') as typeof import('pg');
  const err = await pgInsertFailure({ kind: 'error', fields: UNIQUE_VIOLATION_FIELDS, thenClose: false });
  assertCarrierShape(err, DatabaseError);
  assert.ok(((err.cause as { detail?: string }).detail ?? '').includes(CANARY), "the driver's detail carries the row too");
  const line = loggedLine(err);
  assert.equal(reportedCode(err), '23505', `the record names the SQLSTATE: ${line}`);
  assert.ok(line.includes("code: '23505'"), `the line names the SQLSTATE: ${line}`);
  assert.ok(!line.includes(CANARY), `no bound parameter on the line: ${line}`);
});

test('node-postgres: a connection dropped mid-query logs a different code, or none, and no bound parameter', async () => {
  const err = await pgInsertFailure({ kind: 'hang-up' });
  const { DrizzleQueryError } = require('drizzle-orm') as typeof import('drizzle-orm');
  assert.ok(err instanceof DrizzleQueryError, `the ORM's own wrapper, got ${err?.constructor?.name}`);
  assert.ok(err.message.includes(CANARY), "the canary is in the wrapper's message (the fixture can fail)");
  assert.notEqual(reportedCode(err), '23505');
  const line = loggedLine(err);
  assert.ok(!line.includes('23505'), line);
  assert.ok(!line.includes(CANARY), `no bound parameter on the line: ${line}`);
});

test('node-postgres: a server that terminates the session logs its own code (57P01), not 23505', async () => {
  const { DatabaseError } = require('pg') as typeof import('pg');
  const err = await pgInsertFailure({
    kind: 'error',
    thenClose: true,
    fields: { S: 'FATAL', V: 'FATAL', C: '57P01', M: 'terminating connection due to administrator command' },
  });
  assertCarrierShape(err, DatabaseError);
  const line = loggedLine(err);
  assert.equal(reportedCode(err), '57P01', `the record names the SQLSTATE: ${line}`);
  assert.ok(line.includes("code: '57P01'"), line);
  assert.ok(!line.includes(CANARY), `no bound parameter on the line: ${line}`);
});

test('Neon HTTP: a unique violation logs 23505, and no bound parameter', async () => {
  const { NeonDbError } = require('@neondatabase/serverless') as typeof import('@neondatabase/serverless');
  const err = await neonInsertFailure(neonUniqueViolation);
  assertCarrierShape(err, NeonDbError);
  assert.ok(((err.cause as { detail?: string }).detail ?? '').includes(CANARY), "the driver's detail carries the row too");
  const line = loggedLine(err);
  assert.equal(reportedCode(err), '23505', `the record names the SQLSTATE: ${line}`);
  assert.ok(line.includes("code: '23505'"), `the line names the SQLSTATE: ${line}`);
  assert.ok(!line.includes(CANARY), `no bound parameter on the line: ${line}`);
});

test('Neon HTTP: a dropped connection logs a different code, or none, and no bound parameter', async () => {
  const { NeonDbError } = require('@neondatabase/serverless') as typeof import('@neondatabase/serverless');
  const err = await neonInsertFailure(neonDroppedConnection);
  assertCarrierShape(err, NeonDbError);
  assert.notEqual(reportedCode(err), '23505');
  const line = loggedLine(err);
  assert.ok(!line.includes('23505'), line);
  assert.ok(!line.includes(CANARY), `no bound parameter on the line: ${line}`);
  assert.ok(!line.includes('UND_ERR_SOCKET'), `a code below the driver's error is not read: ${line}`);
});

// --- acceptance 2: a `code` that is not a SQLSTATE does not reach the line -----

/** A real `ENOENT`, from the runtime's own file read. */
function realEnoent(): Error {
  try {
    fs.readFileSync(`/nonexistent-${process.pid}/fixture`);
  } catch (err) {
    return err as Error;
  }
  throw new Error('the read of a nonexistent path succeeded');
}

test('a code that is not SQLSTATE-shaped does not reach the line, on the error or on its cause', async () => {
  const { DrizzleQueryError } = require('drizzle-orm') as typeof import('drizzle-orm');
  const enoent = realEnoent();
  assert.equal((enoent as { code?: unknown }).code, 'ENOENT', 'the runtime set the code (the fixture can fail)');
  const carriers: Record<string, unknown> = {
    'ENOENT on the error': enoent,
    'ENOENT on the cause': new DrizzleQueryError('insert into "evidence_records" …', [ROW.prompt], enoent),
    'a canary as the code': Object.assign(new Error('fixture'), { code: CANARY }),
    'a SQLSTATE followed by a canary': Object.assign(new Error('fixture'), { code: `23505 ${CANARY}` }),
    'a canary on the cause': new DrizzleQueryError('insert …', [], Object.assign(new Error('fixture'), { code: `${CANARY}` })),
    'lower case': Object.assign(new Error('fixture'), { code: '2350a' }),
    'six characters': Object.assign(new Error('fixture'), { code: '235050' }),
    'a number': Object.assign(new Error('fixture'), { code: 23505 }),
    'a non-Error object': { code: `ENOENT ${CANARY}` },
  };
  for (const [name, carrier] of Object.entries(carriers)) {
    assert.equal(reportedCode(carrier), undefined, `${name}: no code reported`);
    const line = loggedLine(carrier);
    assert.ok(!/\bcode\b/.test(line), `${name}: no code on the line: ${line}`);
    assert.ok(!line.includes(CANARY), `${name}: no canary on the line: ${line}`);
  }
});
