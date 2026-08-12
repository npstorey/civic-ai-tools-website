// Unit tests for the compose environment-coverage guard.
//
// Run with:  node --test scripts/check-compose-env.test.mjs
// (`npm test` globs scripts/**/*.test.mjs, so this runs there and in CI.)
//
// The last test in this file is the gate: it runs the check against the real
// docker-compose.yml. Everything above it pins the behavior that makes that
// gate meaningful.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  APP_SERVICE,
  checkComposeEnvCoverage,
  parseComposeService,
  renderComposeReport,
} from './check-compose-env.mjs';
import { ENV_SPEC } from './preflight-env.mjs';

/** A compose file in the shape this repo uses, small enough to reason about. */
function fixture({ env = [], args = null, envFile = null } = {}) {
  const lines = ['services:', '  postgres:', '    image: postgres:17-bookworm', '  app:', '    build:', '      context: .', '      target: runner'];
  if (args) {
    lines.push('      args:');
    for (const a of args) lines.push(`        ${a}`);
  }
  if (envFile) {
    lines.push('    env_file:');
    lines.push(`      - ${envFile}`);
  }
  lines.push('    environment:');
  lines.push('      # a comment inside the block');
  for (const e of env) lines.push(`      ${e}`);
  return lines.join('\n') + '\n';
}

/** A tiny spec, so a test is not hostage to the real inventory's contents. */
const SPEC = [
  { name: 'RUNTIME_ONE', tier: 'required', purpose: 'runtime' },
  { name: 'RUNTIME_TWO', tier: 'optional', purpose: 'runtime' },
  { name: 'BOTH_ONE', readBy: 'build-and-runtime', tier: 'optional', purpose: 'both' },
  { name: 'BUILD_ONE', readBy: 'build', tier: 'optional', purpose: 'build' },
  { name: 'TOOL_ONE', readBy: 'external-tool', tier: 'optional', purpose: 'a script reads it' },
];

const COMPLETE = fixture({
  env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:'],
  args: ['BOTH_ONE:', 'BUILD_ONE:'],
});

// --- parsing ---------------------------------------------------------------

test('bare NAME parses as null (pass-through) and NAME: value as its value', () => {
  const { environment } = parseComposeService(
    fixture({ env: ['BARE:', 'LITERAL: container', 'INTERP: ${X:-y}'] }),
  );
  assert.equal(environment.get('BARE'), null);
  assert.equal(environment.get('LITERAL'), 'container');
  assert.equal(environment.get('INTERP'), '${X:-y}');
});

test('build.args and env_file are read; comments and other services are ignored', () => {
  const parsed = parseComposeService(fixture({ env: ['A:'], args: ['B:'], envFile: 'ops.env' }));
  assert.deepEqual([...parsed.environment.keys()], ['A']);
  assert.deepEqual([...parsed.buildArgs.keys()], ['B']);
  assert.deepEqual(parsed.envFiles, ['ops.env']);
});

test('sequence-form environment throws rather than silently reading nothing', () => {
  const text = 'services:\n  app:\n    environment:\n      - FOO=bar\n';
  assert.throws(() => parseComposeService(text), /sequence-form/);
});

test('a missing app service throws rather than passing vacuously', () => {
  assert.throws(() => parseComposeService('services:\n  postgres:\n    image: postgres\n'), /no `app` service/);
});

// --- coverage --------------------------------------------------------------

test('a complete compose file passes', () => {
  const r = checkComposeEnvCoverage(COMPLETE, SPEC);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missingRuntime, []);
  assert.deepEqual(r.missingBuildArg, []);
});

test('THE DEFECT: a variable the app reads but compose omits fails, by name', () => {
  const r = checkComposeEnvCoverage(fixture({ env: ['RUNTIME_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }), SPEC);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingRuntime.map((e) => e.name), ['RUNTIME_TWO', 'BOTH_ONE']);
  assert.match(renderComposeReport(r), /RUNTIME_TWO/);
});

test('a build-time variable missing from build.args fails even when the environment lists it', () => {
  const r = checkComposeEnvCoverage(fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:'], args: ['BUILD_ONE:'] }), SPEC);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingBuildArg.map((e) => e.name), ['BOTH_ONE']);
});

test('a build-only variable listed under environment is flagged as inert there', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:', 'BUILD_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.runtimeInert.map((e) => e.name), ['BUILD_ONE']);
});

test('an external-tool variable is never demanded of the container', () => {
  const r = checkComposeEnvCoverage(COMPLETE, SPEC);
  assert.equal(r.missingRuntime.some((e) => e.name === 'TOOL_ONE'), false);
  assert.equal(r.missingBuildArg.some((e) => e.name === 'TOOL_ONE'), false);
});

test('a variable compose passes that the spec does not declare is reported as drift', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:', 'GHOST:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.undeclared, ['GHOST']);
});

// --- the empty-string-vs-unset rule ---------------------------------------

test('EMPTY VS UNSET: ${NAME:-} is rejected — it sets "" where unset was meant', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO: ${RUNTIME_TWO:-}', 'BOTH_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.emptyDefaultForm, ['RUNTIME_TWO']);
  assert.match(renderComposeReport(r), /Empty is not absent/);
});

test('bare ${NAME} is rejected too (compose blanks it when unset)', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE: ${RUNTIME_ONE}', 'RUNTIME_TWO:', 'BOTH_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.deepEqual(r.emptyDefaultForm, ['RUNTIME_ONE']);
});

test('a real default ${NAME:-value} is fine — it is a choice, not an accident', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE: ${RUNTIME_ONE:-hello}', 'RUNTIME_TWO:', 'BOTH_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, true);
});

// --- profile awareness -----------------------------------------------------

test('the compose file pins the profile; variables it will never read are not demanded', () => {
  // BLOB_READ_WRITE_TOKEN is onlyWhen blob=vercel-blob, so a file that pins
  // BLOB_DRIVER: s3 must not be told to pass it.
  const text = fixture({ env: ['BLOB_DRIVER: s3', 'EXECUTOR_DRIVER: container'] });
  const r = checkComposeEnvCoverage(text, ENV_SPEC);
  assert.equal(r.drivers.blob, 's3');
  assert.equal(r.drivers.executor, 'container');
  const demanded = r.missingRuntime.map((e) => e.name);
  assert.equal(demanded.includes('BLOB_READ_WRITE_TOKEN'), false);
  assert.equal(demanded.includes('SANDBOX_SNAPSHOT_ID'), false);
  // …and it IS told about the ones that profile reads.
  assert.equal(demanded.includes('S3_BUCKET'), true);
});

test('env_file makes run-time coverage unprovable, and the report says so', () => {
  const r = checkComposeEnvCoverage(fixture({ env: ['RUNTIME_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'], envFile: 'ops.env' }), SPEC);
  assert.equal(r.coverageProvable, false);
  assert.deepEqual(r.missingRuntime, []);
  assert.match(renderComposeReport(r), /coverage cannot be proven statically/);
});

// --- the gate --------------------------------------------------------------

test("GATE: the repo's docker-compose.yml can deliver every variable the app reads", () => {
  const path = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));
  const result = checkComposeEnvCoverage(readFileSync(path, 'utf8'));
  assert.equal(result.ok, true, renderComposeReport(result, APP_SERVICE));
});
