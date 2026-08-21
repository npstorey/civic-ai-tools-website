// Tests for scripts/publish-with-blob-ref.mjs (civic-ai-tools#155 P1 E4).
//
// The script used to default --base-url to https://www.civicaitools.org
// when omitted, silently routing an unconfigured run against the reference
// production host. It now refuses with a named error instead. Spawned as a
// CHILD PROCESS, the same idiom used elsewhere in this repo's script tests
// (see generate-signing-key.test.mjs), so the refusal is exercised exactly
// as an operator would trigger it — no network call is ever reached in
// either case below.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './publish-with-blob-ref.mjs',
);

test('refuses with a named error when --base-url is omitted', () => {
  const env = { ...process.env };
  delete env.CIVICAITOOLS_SESSION_TOKEN;

  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf-8',
    timeout: 15_000,
    env,
  });

  assert.equal(result.status, 2, `expected exit 2\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /--base-url/);
  // The old default must not appear anywhere in the refusal — this is a
  // named-flag refusal, not a silent fallback to the reference host.
  assert.doesNotMatch(result.stdout + result.stderr, /www\.civicaitools\.org/);
});

test('with --base-url present, proceeds to the next check (missing session token)', () => {
  const env = { ...process.env };
  delete env.CIVICAITOOLS_SESSION_TOKEN;

  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--base-url', 'https://example.invalid'],
    { encoding: 'utf-8', timeout: 15_000, env },
  );

  assert.equal(result.status, 2, `expected exit 2\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /CIVICAITOOLS_SESSION_TOKEN/);
});
