#!/usr/bin/env node
/**
 * Build the Vercel Sandbox snapshot for the executed-notebook pipeline
 * (project-plan N5; ADR-0005 Phase C). Run this once locally when:
 *   - pinned library versions in src/lib/notebook-author/prompt.ts change;
 *   - a new helper-function dependency is added;
 *   - the Vercel Sandbox runtime version bumps.
 *
 * Mechanics:
 *   1. Boot a fresh python3.13 sandbox.
 *   2. `pip install` pinned pandas/requests/numpy/matplotlib + jupyter.
 *   3. `sandbox.snapshot()` — freezes the VM state; returns a snapshotId.
 *   4. Print the snapshotId so the operator can `vercel env add` it as
 *      `SANDBOX_SNAPSHOT_ID` (preview + production scopes).
 *
 * Auth: OIDC-automatic on Vercel; local dev needs `VERCEL_OIDC_TOKEN`
 * (via `vercel link` + `vercel env pull`) OR the
 * VERCEL_TOKEN+VERCEL_TEAM_ID+VERCEL_PROJECT_ID env-var triple.
 *
 * Cost: one sandbox creation (~$0.0000006), ~30-60s active CPU during
 * pip install at 2 vCPU (~$0.005), one snapshot at the resulting size
 * (~$0.08/GB-month ongoing). Round figure: a few cents on creation,
 * pennies-per-month for storage.
 *
 * Run:   npm run sandbox:build-snapshot
 */
import { Sandbox } from '@vercel/sandbox';

// Keep this list mirrored with src/lib/notebook-author/prompt.ts:PINNED_LIBRARIES.
// Versions chosen so every pin has a prebuilt CPython 3.13 wheel — no
// compiler needed in the python3.13 sandbox image.
const PINNED_LIBRARIES: Record<string, string> = {
  pandas: '2.2.3',
  requests: '2.32.3',
  numpy: '2.1.3',
  matplotlib: '3.9.2',
};

const SNAPSHOT_BUILD_TIMEOUT_MS = 600_000; // 10 minutes — pip install + freeze
const SNAPSHOT_EXPIRATION_MS = 0;          // 0 = never expire (operator controls cadence)

async function main(): Promise<void> {
  console.log('[sandbox-snapshot] booting fresh python3.13 sandbox…');
  const sandbox = await Sandbox.create({
    runtime: 'python3.13',
    timeout: SNAPSHOT_BUILD_TIMEOUT_MS,
  });
  console.log(`[sandbox-snapshot] sandboxId=${sandbox.sandboxId}`);

  try {
    const pipArgs = [
      'install', '--no-input',
      ...Object.entries(PINNED_LIBRARIES).map(([n, v]) => `${n}==${v}`),
      'jupyter', 'ipykernel', 'nbformat', 'nbconvert',
    ];
    // The python3.13 sandbox image expects the CA bundle at the Debian
    // path `/etc/ssl/certs/ca-certificates.crt`, but Amazon Linux 2023
    // ships it at `/etc/pki/tls/certs/ca-bundle.crt`. Point pip's TLS
    // stack at the correct path so the install can reach PyPI.
    const AL2023_CA_BUNDLE = '/etc/pki/tls/certs/ca-bundle.crt';
    const tlsEnv: Record<string, string> = {
      SSL_CERT_FILE: AL2023_CA_BUNDLE,
      REQUESTS_CA_BUNDLE: AL2023_CA_BUNDLE,
      PIP_CERT: AL2023_CA_BUNDLE,
    };
    console.log('[sandbox-snapshot] installing pinned scientific stack + jupyter…');
    console.log('               pip ' + pipArgs.join(' '));
    const installResult = await sandbox.runCommand({
      cmd: 'pip',
      args: pipArgs,
      env: tlsEnv,
    });
    if (installResult.exitCode !== 0) {
      const stderr = await installResult.stderr();
      throw new Error(`pip install failed (exit ${installResult.exitCode}):\n${stderr}`);
    }
    console.log('[sandbox-snapshot] pip install ok');

    // Sanity-check imports before snapshotting; a broken environment would
    // surface as a runtime error in production otherwise.
    const verifyResult = await sandbox.runCommand('python3', [
      '-c',
      'import pandas, requests, numpy, matplotlib, nbformat, nbconvert, json, sys;'
        + ' print(json.dumps({'
        +   '"python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",'
        +   '"pandas": pandas.__version__,'
        +   '"requests": requests.__version__,'
        +   '"numpy": numpy.__version__,'
        +   '"matplotlib": matplotlib.__version__,'
        +   '"nbconvert": nbconvert.__version__,'
        + '}))',
    ]);
    if (verifyResult.exitCode !== 0) {
      const stderr = await verifyResult.stderr();
      throw new Error(`environment verification failed (exit ${verifyResult.exitCode}):\n${stderr}`);
    }
    const stdout = (await verifyResult.stdout()).trim();
    console.log('[sandbox-snapshot] environment verified:');
    console.log('               ' + stdout);

    console.log('[sandbox-snapshot] freezing snapshot (sandbox will stop)…');
    const snapshot = await sandbox.snapshot({ expiration: SNAPSHOT_EXPIRATION_MS });
    console.log('[sandbox-snapshot] snapshot ready');
    console.log('');
    console.log('================================================');
    console.log(`  snapshotId: ${snapshot.snapshotId}`);
    console.log('================================================');
    console.log('');
    console.log('Add to Vercel preview + production scopes:');
    console.log(`  vercel env add SANDBOX_SNAPSHOT_ID preview production`);
    console.log(`  # paste: ${snapshot.snapshotId}`);
  } catch (err) {
    // stop() is the cleanup; surface the real error.
    try { await sandbox.stop(); } catch { /* ignore */ }
    throw err;
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[sandbox-snapshot] FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
