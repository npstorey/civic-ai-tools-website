// Unit tests for the demo-day env preflight.
//
// Run with:  node --test scripts/preflight-env.test.mjs
//
// (The repo's `npm test` globs src/**/*.test.ts; this scripts/ test is run
// explicitly — and would be wired into the cross-repo CI bundle, brief #5.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEnv, renderReport, ENV_SPEC } from './preflight-env.mjs';

const REQUIRED = ENV_SPEC.filter((s) => s.tier === 'required').map((s) => s.name);
const RECOMMENDED = ENV_SPEC.filter((s) => s.tier === 'recommended').map((s) => s.name);

/** Build an env object with every required var present (non-empty). */
function envWithAllRequired() {
  const env = {};
  for (const name of REQUIRED) env[name] = 'present';
  return env;
}

test('ok=true when every required variable is present', () => {
  const result = evaluateEnv(envWithAllRequired());
  assert.equal(result.ok, true);
  assert.equal(result.missingRequired.length, 0);
});

test('ok=false and the missing required var is reported when one is absent', () => {
  const env = envWithAllRequired();
  delete env.DATABASE_URL;
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name), ['DATABASE_URL']);
});

test('empty string and whitespace-only count as absent (not present)', () => {
  const env = envWithAllRequired();
  // Two required vars with NO coded fallback, so they count as hard misses.
  env.EVIDENCE_SIGNING_KEY = '';
  env.NEXTAUTH_SECRET = '   ';
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  const names = result.missingRequired.map((r) => r.name).sort();
  assert.deepEqual(names, ['EVIDENCE_SIGNING_KEY', 'NEXTAUTH_SECRET']);
});

test('a required var with a coded fallback is soft when absent (fallbk, run still passes)', () => {
  const env = envWithAllRequired();
  delete env.EVIDENCE_KEY_ID; // required, but hasFallback (signing.ts → DEFAULT_KEY_ID)
  const result = evaluateEnv(env);
  assert.equal(result.ok, true, 'a fallback-backed required var does not fail the run');
  assert.equal(result.missingRequired.length, 0);
  assert.deepEqual(result.requiredOnFallback.map((r) => r.name), ['EVIDENCE_KEY_ID']);
  const report = renderReport(result);
  assert.match(report, /fallbk/);
  assert.match(report, /built-in fallback/);
});

test('missing recommended variables do not fail the run', () => {
  const env = envWithAllRequired(); // recommended vars all absent
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  assert.equal(result.missingRecommended.length, RECOMMENDED.length);
});

test('renderReport never emits a variable value — only names and statuses', () => {
  const env = envWithAllRequired();
  // Use a recognizable sentinel value; it must never appear in the report.
  env.OPENROUTER_API_KEY = 'sk-or-SECRET-SENTINEL-DO-NOT-LEAK';
  const report = renderReport(evaluateEnv(env));
  assert.ok(!report.includes('SECRET-SENTINEL'), 'report must not contain any env value');
  assert.ok(report.includes('OPENROUTER_API_KEY'), 'report should list the variable name');
  assert.ok(report.includes('PASS'), 'report should show an overall PASS');
});

test('every spec entry has a known tier and a purpose', () => {
  for (const s of ENV_SPEC) {
    assert.ok(['required', 'recommended', 'optional'].includes(s.tier), `${s.name} has a valid tier`);
    assert.ok(typeof s.purpose === 'string' && s.purpose.length > 0, `${s.name} has a purpose`);
  }
});
