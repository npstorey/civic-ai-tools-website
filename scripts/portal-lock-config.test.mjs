// #436 (Wave N16 P4, criterion 5) — the one-portal switch is declared, delivered
// and documented: preflight declares SITE_PORTAL_LOCKED and promotes
// SITE_DEFAULT_PORTAL to required whenever the switch is on; the compose app
// service passes the switch at build and at run time and the Dockerfile's build
// stage declares it; `docs/deploy.md` states the switch and what it does not
// govern.
//
// WHY A NEW PROMOTION FIELD. "Required when the lock is on" is not expressible
// with the preflight's existing fields: `requiredWhen` is keyed by a driver
// seam, and `requiredWhenCustomized` promotes on ANY value other than a coded
// default, so `SITE_PORTAL_LOCKED=0` or `=false` would promote a variable the
// app does not need. `requiredWhenFlagOn` parses the switch as the app parses
// it; the parity case below holds its parser to `parseBooleanFlag`.
//
// Each promotion assertion is paired with the same env with the switch off,
// which must NOT promote — the pair is what makes the assertion able to fail.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types scripts/portal-lock-config.test.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV_SPEC, evaluateEnv, flagOn, renderReport, resolveDrivers, resolveSpec } from './preflight-env.mjs';
import { checkRepository } from './check-compose-env.mjs';

const { parseBooleanFlag } = await import('../src/lib/host-routing.ts');

const repo = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const entry = (name) => ENV_SPEC.find((s) => s.name === name);

/** An env with every variable the default profile requires, present. */
function envWithAllRequired() {
  const env = {};
  for (const s of ENV_SPEC) if (s.tier === 'required') env[s.name] = 'present';
  return env;
}

function tierOf(name, env) {
  const { drivers } = resolveDrivers(env);
  return resolveSpec(drivers, ENV_SPEC, env).applicable.find((s) => s.name === name)?.tier;
}

test('#436 C5: preflight declares the switch, read at build and at run time, off by default', () => {
  const lock = entry('SITE_PORTAL_LOCKED');
  assert.ok(lock, 'ENV_SPEC does not declare SITE_PORTAL_LOCKED');
  assert.equal(lock.readBy, 'build-and-runtime');
  assert.equal(lock.tier, 'optional');
  assert.equal(lock.hasFallback, true);
  assert.equal(entry('SITE_DEFAULT_PORTAL').requiredWhenFlagOn, 'SITE_PORTAL_LOCKED');
});

test('#436 C5: the preflight parses the switch exactly as the app does', () => {
  const values = [undefined, '', ' ', '0', '1', ' 1 ', 'true', 'TRUE', ' True ', 'false', 'yes', 'on', '2', 'truee', 't'];
  for (const value of values) {
    assert.equal(flagOn(value), parseBooleanFlag(value), `the two parsers disagree on ${JSON.stringify(value)}`);
  }
  assert.equal(flagOn('1'), true);
  assert.equal(flagOn('false'), false);
});

test('#436 C5: SITE_DEFAULT_PORTAL is required when the switch is on, and only then', () => {
  for (const on of ['1', 'true', ' TRUE ']) {
    assert.equal(tierOf('SITE_DEFAULT_PORTAL', { SITE_PORTAL_LOCKED: on }), 'required', `SITE_PORTAL_LOCKED=${JSON.stringify(on)}`);
  }
  for (const off of [undefined, '', '0', 'false', 'yes']) {
    const env = off === undefined ? {} : { SITE_PORTAL_LOCKED: off };
    assert.equal(tierOf('SITE_DEFAULT_PORTAL', env), 'recommended', `SITE_PORTAL_LOCKED=${JSON.stringify(off)}`);
  }

  const locked = { ...envWithAllRequired(), SITE_PORTAL_LOCKED: '1' };
  const failing = evaluateEnv(locked);
  assert.equal(failing.ok, false, 'a locked instance with no portal passed preflight');
  assert.deepEqual(failing.missingRequired.map((r) => r.name), ['SITE_DEFAULT_PORTAL']);
  const report = renderReport(failing);
  assert.match(report, /SITE_DEFAULT_PORTAL/);

  assert.equal(evaluateEnv({ ...locked, SITE_DEFAULT_PORTAL: 'records.city-a.example' }).ok, true);
  assert.equal(evaluateEnv({ ...envWithAllRequired(), SITE_PORTAL_LOCKED: '0' }).ok, true, 'an unlocked instance needs no portal');
});

test('#436 C5: compose delivers the switch at build and at run time, and the build stage declares it', () => {
  const result = checkRepository();
  assert.equal(result.ok, true, 'check:compose-env fails on the repository');
  const compose = repo('docker-compose.yml');
  assert.equal(compose.split(/^\s+SITE_PORTAL_LOCKED:\s*$/m).length - 1, 2, 'the app service does not pass SITE_PORTAL_LOCKED as both a build arg and an environment variable');
  assert.match(repo('Dockerfile'), /^ARG SITE_PORTAL_LOCKED$/m);
});

test('#436 C5: docs/deploy.md states the switch and the boundary it does not cross', () => {
  const doc = repo('docs/deploy.md');
  const row = doc.split('\n').find((line) => line.startsWith('| `SITE_PORTAL_LOCKED` |'));
  assert.ok(row, 'docs/deploy.md has no SITE_PORTAL_LOCKED row');
  for (const needle of ['`search`', 'bare dataset id', 'notebook', 'replay', '400', 'SITE_DEFAULT_PORTAL', '`domain`', 'rejected']) {
    assert.ok(row.includes(needle), `the SITE_PORTAL_LOCKED row does not mention ${needle}`);
  }
});
