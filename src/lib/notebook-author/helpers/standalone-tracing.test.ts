// Standalone-tracing guard for the runtime-read Python helpers (S3b P5).
//
// The helpers in this directory are read with node:fs at request time, so
// they reach a standalone build only through the `outputFileTracingIncludes`
// declaration in next.config.ts. If that declaration ever stops covering
// them, `next build` still succeeds and the failure surfaces as a 500 on the
// executed-notebook route — a silent trapdoor.
//
// scripts/check-standalone-assets.mjs is the build-time gate. These tests
// pin its contract without needing a real build:
//
//   - the asset list covers every .py file actually in this directory
//     (adding a helper without registering it fails here);
//   - next.config.ts still declares the tracing include that populates them;
//   - the check PASSES on a complete synthetic output, and FAILS on a
//     missing or byte-changed asset — including end-to-end through the CLI,
//     which is what a build pipeline calls.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ASSETS, checkStandaloneAssets } from '../../../../scripts/check-standalone-assets.mjs';

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HELPERS_DIR, '../../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-standalone-assets.mjs');

/** Copy the declared assets into a synthetic standalone root. */
function buildSyntheticStandalone(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-assets-'));
  for (const { file } of ASSETS) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), target);
  }
  return dir;
}

test('asset list covers every runtime-read helper source in this directory', () => {
  const onDisk = fs
    .readdirSync(HELPERS_DIR)
    .filter((f) => f.endsWith('.py'))
    .sort();
  const declared = ASSETS.map(({ file }: { file: string }) => path.basename(file)).sort();
  assert.deepEqual(
    declared,
    onDisk,
    'scripts/check-standalone-assets.mjs ASSETS is out of step with the helper sources on disk',
  );
});

test('next.config.ts still declares the tracing include that ships them', () => {
  const config = fs.readFileSync(path.join(REPO_ROOT, 'next.config.ts'), 'utf8');
  assert.match(config, /outputFileTracingIncludes/);
  assert.match(
    config,
    /\.\/src\/lib\/notebook-author\/helpers\/\*\.py/,
    'the helpers glob vanished from outputFileTracingIncludes — standalone builds would ship without it',
  );
});

test('check passes on a complete standalone output', () => {
  const dir = buildSyntheticStandalone();
  try {
    const { ok, results } = checkStandaloneAssets({ standaloneDir: dir });
    assert.equal(ok, true, JSON.stringify(results, null, 2));
    assert.equal(results.length, ASSETS.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check fails loudly when a traced asset is missing', () => {
  const dir = buildSyntheticStandalone();
  try {
    const victim = path.join(dir, ASSETS[0].file);
    fs.rmSync(victim);
    const { ok, results } = checkStandaloneAssets({ standaloneDir: dir });
    assert.equal(ok, false);
    assert.equal(results[0].status, 'missing');

    // And through the CLI, which is what a build pipeline invokes.
    const run = spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf-8' });
    assert.equal(run.status, 1, `expected exit 1, got ${run.status}\n${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /missing runtime-read files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check fails when a shipped asset drifts from its source bytes', () => {
  const dir = buildSyntheticStandalone();
  try {
    const victim = path.join(dir, ASSETS[1].file);
    fs.writeFileSync(victim, '# truncated by a bad copy\n');
    const { ok, results } = checkStandaloneAssets({ standaloneDir: dir });
    assert.equal(ok, false);
    assert.equal(results[1].status, 'mismatch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
