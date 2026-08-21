// Tests for scripts/sync-fallback.mjs (civic-ai-tools#155 P1 E4, premise-
// checked).
//
// This script is DEAD/FROZEN by its own docstring: the verbatim-paste model
// it implements is unsound post-#258/post-posture-split, and it refuses to
// run at all unless the discouraged --force-clobber flag is passed. That
// refusal is the primary, load-bearing behavior this suite pins down.
// SOCRATA_MCP_URL used to default to https://socrata-mcp.civicaitools.org
// on the --force-clobber path; stripping that default is COSMETIC here (the
// script is inert on every normal invocation regardless — see the module
// comment above MCP_URL in the script) but is still exercised below for
// consistency with the rest of this repo's reference-host-default removal.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './sync-fallback.mjs',
);

test('refuses to run at all without --force-clobber (primary, load-bearing behavior)', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8', timeout: 15_000 });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /REFUSING to run/);
  assert.match(result.stderr, /unsound/);
});

test('with --force-clobber, refuses with a named error when SOCRATA_MCP_URL is unset (no reference-host default)', () => {
  const env = { ...process.env };
  delete env.SOCRATA_MCP_URL;

  const result = spawnSync(process.execPath, [SCRIPT, '--force-clobber'], {
    encoding: 'utf-8',
    timeout: 15_000,
    env,
  });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /SOCRATA_MCP_URL/);
  assert.doesNotMatch(result.stdout + result.stderr, /socrata-mcp\.civicaitools\.org/);
});
