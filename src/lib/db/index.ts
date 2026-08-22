import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
// Extension-qualified, matching the style already used across
// `src/lib/evidence/` (`./signing.ts`, `./trust-signal.ts`, …). Required so
// this module is loadable by `node --experimental-strip-types` — the runner
// `npm test` uses, and the only one that can currently load this repo's
// signing chain — whose ESM resolver does not guess extensions.
import * as schema from './schema.ts';

let _db: NeonHttpDatabase<typeof schema> | null = null;

/**
 * Driver selection (DB_DRIVER env var):
 *   - 'neon-http' (default): Neon serverless HTTP driver — the demo
 *     deployment's behavior, unchanged when the var is unset.
 *   - 'node-postgres': TCP via `pg` — works against any Postgres.
 *
 * Both drivers expose the same Drizzle query surface over the same schema, so
 * the handle is typed once (as the default driver's type) and the 28 importers
 * are driver-agnostic.
 */
function createDb(): NeonHttpDatabase<typeof schema> {
  const driver = process.env.DB_DRIVER || 'neon-http';
  if (driver === 'node-postgres') {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Same Drizzle query-builder surface; cast keeps the exported handle's
    // type (and every importer) identical across drivers.
    return drizzleNodePostgres(pool, { schema }) as unknown as NeonHttpDatabase<typeof schema>;
  }
  if (driver !== 'neon-http') {
    throw new Error(`Unsupported DB_DRIVER "${driver}" (expected "neon-http" or "node-postgres")`);
  }
  const sql: NeonQueryFunction<false, false> = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
}

function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

/**
 * Lazily initialized Drizzle client for PostgreSQL.
 * Only connects when first accessed — safe to import at module level
 * even when DATABASE_URL is not set (e.g., during Next.js build).
 */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
