// Tests for scripts/eval-models.mjs (civic-ai-tools#155 P1 E4).
//
// SOCRATA_MCP_URL used to default to https://socrata-mcp.civicaitools.org
// when unset, silently routing an unconfigured run's queries through
// infrastructure the caller does not operate. It now refuses with a named
// error instead. Spawned as a CHILD PROCESS so the refusal is exercised the
// same way an operator would trigger it, before any model/MCP call is made.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './eval-models.mjs',
);

test('refuses with a named error when OPENROUTER_API_KEY is unset', () => {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.SOCRATA_MCP_URL;

  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8', timeout: 15_000, env });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /OPENROUTER_API_KEY/);
});

test('refuses with a named error when SOCRATA_MCP_URL is unset (no reference-host default)', () => {
  const env = { ...process.env, OPENROUTER_API_KEY: 'not-a-real-key' };
  delete env.SOCRATA_MCP_URL;

  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8', timeout: 15_000, env });

  assert.equal(result.status, 1, `expected exit 1\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /SOCRATA_MCP_URL/);
  // The old default must not appear anywhere in the refusal.
  assert.doesNotMatch(result.stdout + result.stderr, /socrata-mcp\.civicaitools\.org/);
});
