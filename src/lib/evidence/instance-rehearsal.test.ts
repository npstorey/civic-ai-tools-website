// ADR-0020 config-rehearsal harness test (S3a P3, #166; S3a acceptance §3).
//
// Spawns scripts/rehearse-instance-identity.ts as a CHILD PROCESS — exactly
// the command an operator runs — so the rehearsal proves itself repeatable
// under `npm test` while its environment mutations (ephemeral signing key,
// alternate identity vars) stay confined to the child. The child:
//
//   - generates an ephemeral Ed25519 keypair (never the real key),
//   - builds a local trust registry from the docs/instance-setup.md template,
//   - runs the produce path under fully alternate identity config,
//   - verifies the emitted package offline (§9.2) against that registry,
//   - asserts the alternate identity appears throughout the emitted output.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/rehearse-instance-identity.ts',
);

test('config rehearsal: alternate identity + local registry, zero code edits (child process)', () => {
  // Strip every EVIDENCE_* variable from the inherited environment so the
  // rehearsal's config is exactly what the script sets — the run must not
  // borrow identity (or, worse, a key) from the invoking shell.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('EVIDENCE_')) delete env[name];
  }

  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', SCRIPT],
    { env, encoding: 'utf-8', timeout: 120_000 },
  );

  assert.equal(
    result.status,
    0,
    `rehearsal exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  // The §9.2 offline pass against the local registry, and the closing verdict.
  assert.match(result.stdout, /§9\.2 offline checks PASS against the local registry/);
  assert.match(result.stdout, /alternate identity present throughout/);
  assert.match(result.stdout, /REHEARSAL PASS/);
});
