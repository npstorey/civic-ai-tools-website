/**
 * One-time backfill (civic-ai-tools-website#294 P2): sign the
 * `attestation_packages` rows that predate migration 0016.
 *
 * P1 made the write path sign NEW reviews. Every review submitted before it
 * merged is still content-addressed, hash-bound to its base package, and
 * unsigned, with `unsigned_reason` NULL because nothing was writing that
 * column yet. This pass signs them.
 *
 * REFUSES TO RUN WITHOUT A SIGNING KEY, and that is the point rather than a
 * safety afterthought. A keyless run would label every historical row
 * `no_signing_key` — taking the operator's current environment and asserting
 * it retroactively across rows written under a configuration it cannot
 * observe, destroying the only record that their state was unknown. It stops
 * instead, before reading a single row. Same for a key with no configured kid
 * or no declared instance identity: signing under an identity this instance
 * never declared would write misattributed envelopes into historical rows.
 *
 * `signed_at` IS THE RUN TIME, never `created_at` (decision D2). A signature
 * that did not exist in April must not claim it did, and the gap between the
 * review and its signature is exactly what makes this a disclosable correction
 * rather than a quiet rewrite. The record detail page shows both dates.
 *
 * Rows it cannot sign are labeled `backfill_signing_failed` and the run
 * CONTINUES — never left NULL, which would make them indistinguishable from
 * rows the pass never reached.
 *
 * IDEMPOTENT. A re-run skips rows that already carry a signature and retries
 * ones a previous run failed on. Running it twice is safe and writes nothing
 * the second time (beyond retried failures).
 *
 * DRY RUN BY DEFAULT (writes nothing, prints the report the real run will
 * print). Pass `--apply` to write. Migration 0016 must already be applied.
 *
 * The decision logic, and every test over it, lives in
 * `src/lib/evidence/attestation-backfill.ts` — this file is the database
 * wiring and the exit code, nothing more.
 *
 * `op run` is recommended so DATABASE_URL and the signing key reach the
 * process environment this way; any env-injection mechanism is acceptable (CI
 * secrets, container secrets, a secret manager) — never a plaintext literal
 * in a dot-file:
 *
 *   Dry run:  op run --env-file=.env.local -- node --experimental-strip-types scripts/backfill-attestation-signatures.mts
 *   Apply:    op run --env-file=.env.local -- node --experimental-strip-types scripts/backfill-attestation-signatures.mts --apply
 *
 * NOTE THE RUNNER: `node --experimental-strip-types`, the same one `npm test`
 * uses — NOT `npx tsx`, which the sibling backfill script uses. tsx cannot
 * load this repo's signing chain at all in its current dependency state
 * (measured 2026-08-22): it compiles the repo's `.ts` files as CommonJS, and
 * `canonicalize@3.0.0` declares only `import`/`types` export conditions, so the
 * require fails with ERR_PACKAGE_PATH_NOT_EXPORTED before any line runs.
 * `scripts/backfill-rekor-entry-body.ts` fails the same way and for the same
 * reason; that is a pre-existing tooling gap, filed separately, not something
 * this script introduced.
 *
 * EXIT CODES. Non-zero means DO NOT PROCEED:
 *   1 — no signing key (or a key with no kid / no instance identity);
 *       the database was never read.
 *   1 — the database could not be reached.
 *   1 — the row listing came back empty while the count said otherwise.
 * Individual row failures and timestamp-authority failures are counted and
 * reported, and exit 0 — they are outcomes, not reasons to stop.
 */

// `.mts`, and explicit file paths, NOT the extensionless `.ts` style of
// `backfill-rekor-entry-body.ts`. This is a workaround for a REAL and
// PRE-EXISTING breakage, not a style preference: run as plain `.ts`, tsx treats
// the file as CommonJS, resolves `canonicalize@3.0.0` (which declares only
// `import`/`types` export conditions) through the CJS loader, and the process
// dies with ERR_PACKAGE_PATH_NOT_EXPORTED before a single line executes. That
// kills ANY script importing this repo's signing chain under tsx — the sibling
// backfill script included, measured 2026-08-22. The `.mts` extension puts tsx
// in ESM mode, where the same import resolves correctly.
import { count, eq } from 'drizzle-orm';
import {
  runAttestationSignatureBackfill,
  formatBackfillReport,
  type BackfillWriteColumns,
} from '../src/lib/evidence/attestation-backfill.ts';

// The DATABASE module alone is imported lazily, and that is deliberate rather
// than incidental: because the ports are only ever called after preflight
// passes, a keyless or misconfigured run does not so much as LOAD the database
// module, let alone open a connection. The refusal's claim that no row was
// read holds at the strongest level available — the code that could read one
// was never evaluated.
type DbModule = {
  db: typeof import('../src/lib/db/index.ts')['db'];
  attestationPackages: typeof import('../src/lib/db/schema.ts')['attestationPackages'];
};
let _dbModule: DbModule | null = null;
async function database(): Promise<DbModule> {
  if (!_dbModule) {
    const [dbMod, schemaMod] = await Promise.all([
      import('../src/lib/db/index.ts'),
      import('../src/lib/db/schema.ts'),
    ]);
    _dbModule = { db: dbMod.db, attestationPackages: schemaMod.attestationPackages };
  }
  return _dbModule;
}

// Dry run unless --apply, matching `backfill-rekor-entry-body.ts`. `--dry-run`
// is accepted explicitly and WINS over `--apply` if both are passed: between
// two contradictory instructions, the one that writes nothing is the one to
// honor.
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--apply');

async function main(): Promise<void> {
  const result = await runAttestationSignatureBackfill({
    dryRun: DRY_RUN,
    log: (line) => console.warn(line),

    countRows: async () => {
      const { db, attestationPackages } = await database();
      const [row] = await db.select({ n: count() }).from(attestationPackages);
      return row?.n ?? 0;
    },

    loadRows: async () => {
      const { db, attestationPackages } = await database();
      return db
        .select({
          id: attestationPackages.id,
          packageHash: attestationPackages.packageHash,
          signature: attestationPackages.signature,
          unsignedReason: attestationPackages.unsignedReason,
          createdAt: attestationPackages.createdAt,
        })
        .from(attestationPackages);
    },

    updateRow: async (id: string, columns: BackfillWriteColumns) => {
      const { db, attestationPackages } = await database();
      await db
        .update(attestationPackages)
        .set({
          signature: columns.signature,
          signingKeyId: columns.signingKeyId,
          rfc3161Timestamp: columns.rfc3161Timestamp,
          signedAt: columns.signedAt,
          unsignedReason: columns.unsignedReason,
        })
        .where(eq(attestationPackages.id, id));
    },
  });

  if (!result.ok) {
    // The refusal message is the whole diagnosis; it names what is missing and
    // what was deliberately NOT done. Nothing was written.
    console.error(`[backfill] REFUSED (${result.refusal.body.code}):`);
    console.error(result.refusal.body.error);
    process.exit(1);
  }

  console.log(formatBackfillReport(result.report));

  if (result.report.failedWithReason > 0) {
    console.warn(
      `[backfill] ${result.report.failedWithReason} row(s) could not be signed and ` +
        'are labeled as attempted-and-failed rather than left blank. They stay ' +
        'unsigned; investigate before re-running.',
    );
  }
  if (DRY_RUN) {
    console.log('[backfill] dry run — nothing was written. Re-run with --apply.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Reaching here means a port threw: an unreachable database, or a write
    // that failed mid-pass. Either way the run is incomplete and the operator
    // must not read it as done.
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
