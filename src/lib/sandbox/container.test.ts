// Unit tests for the notebook-executor driver seam (S3b P4):
//   1. Anti-drift: docker/executor/Dockerfile mirrors the single-sourced
//      pinned-library table (src/lib/notebook-author/prompt.ts) and the
//      notebook-tooling package set (src/lib/sandbox/driver.ts) — the
//      container image cannot silently diverge from what the sandbox
//      snapshot and the notebook's own pip-install cell pin.
//   2. Pure helpers of the container driver (image resolution, docker exec
//      env flags, shell quoting).
//   3. Driver selection (EXECUTOR_DRIVER), matching the DB_DRIVER /
//      BLOB_DRIVER register: default, explicit values, loud unknown-value
//      failure.
//
// Driver behavior against a live container runtime is exercised separately
// via scripts/executor-parity.mjs; these tests stay docker-free.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PINNED_LIBRARIES, PYTHON_RUNTIME_VERSION } from '../notebook-author/prompt.ts';
import { EXECUTOR_TOOLING_PACKAGES } from './driver.ts';
import {
  DEFAULT_CONTAINER_IMAGE,
  buildDockerEnvFlags,
  resolveContainerImage,
  shellSingleQuote,
} from './container.ts';
import { resolveExecutorDriverName } from './execute.ts';

const DOCKERFILE_PATH = fileURLToPath(
  new URL('../../../docker/executor/Dockerfile', import.meta.url),
);
const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');

test('Dockerfile pins exactly the single-sourced PINNED_LIBRARIES table', () => {
  const pinPattern = /([a-zA-Z0-9_-]+)==([0-9][0-9a-zA-Z.]*)/g;
  const dockerfilePins: Record<string, string> = {};
  for (const match of dockerfile.matchAll(pinPattern)) {
    dockerfilePins[match[1]] = match[2];
  }
  // Exact equality both directions: no missing pins, no extra pins, no
  // version drift. PINNED_LIBRARIES is the single source; the Dockerfile is
  // a test-enforced mirror (Dockerfiles cannot import TypeScript).
  assert.deepEqual(dockerfilePins, { ...PINNED_LIBRARIES });
});

test('Dockerfile FROM line matches PYTHON_RUNTIME_VERSION', () => {
  const fromLines = dockerfile
    .split('\n')
    .filter((line) => line.startsWith('FROM '));
  assert.equal(fromLines.length, 1);
  assert.match(
    fromLines[0],
    new RegExp(`^FROM python:${PYTHON_RUNTIME_VERSION.replace('.', '\\.')}-`),
    `executor image python version must match PYTHON_RUNTIME_VERSION (${PYTHON_RUNTIME_VERSION})`,
  );
});

test('Dockerfile installs every notebook-tooling package', () => {
  for (const pkg of EXECUTOR_TOOLING_PACKAGES) {
    assert.match(
      dockerfile,
      new RegExp(`(^|[\\s\\\\])${pkg}([\\s\\\\]|$)`, 'm'),
      `Dockerfile must install "${pkg}" (EXECUTOR_TOOLING_PACKAGES)`,
    );
  }
});

test('resolveContainerImage: default, override, and blank-value fallback', () => {
  assert.equal(resolveContainerImage({}), DEFAULT_CONTAINER_IMAGE);
  assert.equal(
    resolveContainerImage({ EXECUTOR_CONTAINER_IMAGE: 'registry.example.org/executor:2' }),
    'registry.example.org/executor:2',
  );
  assert.equal(resolveContainerImage({ EXECUTOR_CONTAINER_IMAGE: '   ' }), DEFAULT_CONTAINER_IMAGE);
});

test('buildDockerEnvFlags produces -e KEY=VALUE pairs in insertion order', () => {
  assert.deepEqual(buildDockerEnvFlags({}), []);
  assert.deepEqual(
    buildDockerEnvFlags({ ALPHA: 'one', BETA: 'two=with=equals' }),
    ['-e', 'ALPHA=one', '-e', 'BETA=two=with=equals'],
  );
});

test('shellSingleQuote wraps and escapes embedded single quotes', () => {
  assert.equal(shellSingleQuote('/tmp/notebook.ipynb'), `'/tmp/notebook.ipynb'`);
  assert.equal(shellSingleQuote(`a'b`), `'a'\\''b'`);
});

test('resolveExecutorDriverName: default and explicit values', () => {
  assert.equal(resolveExecutorDriverName({}), 'vercel-sandbox');
  assert.equal(resolveExecutorDriverName({ EXECUTOR_DRIVER: '' }), 'vercel-sandbox');
  assert.equal(
    resolveExecutorDriverName({ EXECUTOR_DRIVER: 'vercel-sandbox' }),
    'vercel-sandbox',
  );
  assert.equal(resolveExecutorDriverName({ EXECUTOR_DRIVER: 'container' }), 'container');
});

test('resolveExecutorDriverName: unknown value fails loudly with the value named', () => {
  assert.throws(
    () => resolveExecutorDriverName({ EXECUTOR_DRIVER: 'kubernetes' }),
    /Unsupported EXECUTOR_DRIVER "kubernetes"/,
  );
});
