// Unit tests for the notebook-executor driver seam (S3b P4):
//   1. Anti-drift: docker/executor/Dockerfile mirrors the single-sourced
//      pinned-library table (src/lib/notebook-author/prompt.ts) and the
//      notebook-tooling table (src/lib/sandbox/driver.ts) — the container
//      image cannot silently diverge from what the sandbox snapshot and the
//      notebook's own pip-install cell pin. Since #450 the tooling table
//      carries versions too, and `./executor-pins.test.ts` is where the
//      version equality, the non-root user and the image tag are asserted.
//   2. Pure helpers of the container driver (image resolution, docker exec
//      by-name env flags, shell quoting).
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
import { EXECUTOR_LAMBDA_RUNTIME_PACKAGES, EXECUTOR_TOOLING_PACKAGES } from './driver.ts';
import {
  DEFAULT_CONTAINER_IMAGE,
  dockerEnvNameFlags,
  resolveContainerImage,
  shellSingleQuote,
} from './container.ts';
import { resolveExecutorDriverName } from './execute.ts';

const DOCKERFILE_PATH = fileURLToPath(
  new URL('../../../docker/executor/Dockerfile', import.meta.url),
);
const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');

test('Dockerfile pins exactly the three single-sourced tables and nothing else', () => {
  const pinPattern = /([a-zA-Z0-9_-]+)==([0-9][0-9a-zA-Z.]*)/g;
  const dockerfilePins: Record<string, string> = {};
  for (const match of dockerfile.matchAll(pinPattern)) {
    dockerfilePins[match[1]] = match[2];
  }
  // Exact equality both directions: no missing pins, no extra pins, no
  // version drift. PINNED_LIBRARIES (scientific stack) and
  // EXECUTOR_TOOLING_PACKAGES (notebook tooling, pinned since #450) are the
  // single sources, with EXECUTOR_LAMBDA_RUNTIME_PACKAGES for the lambda
  // target (#530); the Dockerfile is a test-enforced mirror of their union
  // (Dockerfiles cannot import TypeScript). Which stage installs which is
  // `./executor-pins.test.ts`'s to assert.
  assert.deepEqual(dockerfilePins, {
    ...PINNED_LIBRARIES,
    ...EXECUTOR_TOOLING_PACKAGES,
    ...EXECUTOR_LAMBDA_RUNTIME_PACKAGES,
  });
});

test('Dockerfile FROM line matches PYTHON_RUNTIME_VERSION', () => {
  // Every stage but the first builds on an earlier one (#530: `executor`, then
  // `lambda` and the default `container`), so exactly one FROM names an image.
  const fromLines = dockerfile
    .split('\n')
    .filter((line) => line.startsWith('FROM '));
  const stageNames = fromLines.map((line) => /\sAS\s+(\S+)/i.exec(line)?.[1]).filter(Boolean);
  const fromImage = fromLines.filter((line) => !stageNames.includes(line.split(/\s+/)[1]));
  assert.equal(fromImage.length, 1, `expected one FROM that names an image, found: ${fromImage.join(' | ')}`);
  assert.match(
    fromImage[0],
    new RegExp(`^FROM python:${PYTHON_RUNTIME_VERSION.replace('.', '\\.')}-`),
    `executor image python version must match PYTHON_RUNTIME_VERSION (${PYTHON_RUNTIME_VERSION})`,
  );
});

test('Dockerfile installs every notebook-tooling package, with a version', () => {
  // Since #450 the boundary is `==`, not whitespace: this exact assertion
  // passed against four unversioned names, which is the state #450 was filed
  // about. `./executor-pins.test.ts` asserts the versions AGREE with the
  // table; this one asserts each name is present and pinned at all.
  for (const pkg of Object.keys(EXECUTOR_TOOLING_PACKAGES)) {
    assert.match(
      dockerfile,
      new RegExp(`(^|[\\s\\\\])${pkg}==\\d`, 'm'),
      `Dockerfile must install "${pkg}" with a version (EXECUTOR_TOOLING_PACKAGES)`,
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

test('dockerEnvNameFlags produces -e NAME pairs in order, and never a value (#521)', () => {
  assert.deepEqual(dockerEnvNameFlags([]), []);
  assert.deepEqual(dockerEnvNameFlags(['ALPHA', 'BETA']), ['-e', 'ALPHA', '-e', 'BETA']);
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
