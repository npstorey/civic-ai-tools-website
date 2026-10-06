// #552 (anchor #555, P1, criterion 4) — the seal-only setting is declared,
// delivered and documented: preflight declares SITE_SEAL_ONLY as read by the
// running server; the compose app service passes it at run time; the
// environment reference in `docs/deploy.md` states what it refuses and what it
// leaves alone; the publish API's contract states the refusal on both routes.
//
// READ AT RUN TIME ONLY. Every reader is request-time: the two publish routes,
// the signing-status route (a GET handler with no static export, so not
// prerendered — the build's route table marks it dynamic), and the dashboard
// page (`dynamic = 'force-dynamic'`). No page that is prerendered reads it, so
// it is not a build arg, unlike SITE_PORTAL_LOCKED, which the root layout
// resolves. The assertion below that compose does NOT pass it at build is what
// makes that a claim rather than an omission.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types scripts/seal-only-config.test.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV_SPEC, evaluateEnv } from './preflight-env.mjs';
import { checkRepository } from './check-compose-env.mjs';

const repo = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const entry = (name) => ENV_SPEC.find((s) => s.name === name);

function envWithAllRequired() {
  const env = {};
  for (const s of ENV_SPEC) if (s.tier === 'required') env[s.name] = 'present';
  return env;
}

test('#552 C4: preflight declares SITE_SEAL_ONLY, read by the running server, optional and off by default', () => {
  const spec = entry('SITE_SEAL_ONLY');
  assert.ok(spec, 'ENV_SPEC does not declare SITE_SEAL_ONLY');
  assert.equal(spec.readBy, undefined, 'SITE_SEAL_ONLY is read at run time only');
  assert.equal(spec.tier, 'optional');
  assert.equal(spec.hasFallback, true);
  assert.match(spec.purpose, /public/);
  assert.match(spec.purpose, /already public stay public/);
  // Setting it changes no other variable's tier.
  assert.equal(evaluateEnv({ ...envWithAllRequired(), SITE_SEAL_ONLY: '1' }).ok, true);
});

test('#552 C4: compose delivers SITE_SEAL_ONLY to the app at run time, and not as a build arg', () => {
  const result = checkRepository();
  assert.equal(result.ok, true, 'check:compose-env fails on the repository');
  const compose = repo('docker-compose.yml');
  assert.equal(compose.split(/^\s+SITE_SEAL_ONLY:\s*$/m).length - 1, 1, 'the app service does not pass SITE_SEAL_ONLY exactly once');
  const appEnvironment = compose.slice(compose.indexOf('\n  app:'));
  const buildArgs = appEnvironment.slice(appEnvironment.indexOf('args:'), appEnvironment.indexOf('restart:'));
  assert.ok(!buildArgs.includes('SITE_SEAL_ONLY'), 'SITE_SEAL_ONLY is passed as a build arg; nothing prerendered reads it');
  assert.ok(appEnvironment.includes('SITE_SEAL_ONLY'), 'the app service does not carry SITE_SEAL_ONLY');
  assert.doesNotMatch(repo('Dockerfile'), /SITE_SEAL_ONLY/, 'the build stage declares a variable no build step reads');
});

test('#552 C4: docs/deploy.md has a SITE_SEAL_ONLY row stating what it refuses and what stays public', () => {
  const doc = repo('docs/deploy.md');
  const row = doc.split('\n').find((line) => line.startsWith('| `SITE_SEAL_ONLY` |'));
  assert.ok(row, 'docs/deploy.md has no SITE_SEAL_ONLY row');
  for (const needle of [
    '`1`/`true`',
    'nothing changes',
    '`POST /api/records`',
    '`POST /api/records/:slug/publish`',
    'omits `visibility`',
    '`"sealed"`',
    '`seal_only`',
    '403',
    'stay public',
    '§8.10.3',
    'dashboard',
    'dialog',
  ]) {
    assert.ok(row.includes(needle), `the SITE_SEAL_ONLY row does not mention ${needle}`);
  }
});

test('#552 C4: the bring-up example in docs/deploy.md shows what signing-status answers now', () => {
  const doc = repo('docs/deploy.md');
  assert.ok(doc.includes('# → {"signingConfigured":false,"sealOnly":false}'), 'the bring-up example does not show the sealOnly key');
  assert.ok(!doc.includes('# → {"signingConfigured":false}\n'), 'the bring-up example still shows the one-key answer');
});

test('#552 C4: docs/api/records-publish.md states the refusal on both routes and the absent-visibility rule', () => {
  const doc = repo('docs/api/records-publish.md');
  const errorRow = doc.split('\n').find((line) => line.startsWith('| `403`') && line.includes('"seal_only"'));
  assert.ok(errorRow, 'the error table has no seal_only row');
  for (const needle of ['SITE_SEAL_ONLY', '`POST /api/records/:slug/publish`', 'omits `visibility`', '`"sealed"`', 'already public']) {
    assert.ok(errorRow.includes(needle), `the seal_only error row does not mention ${needle}`);
  }
  const visibilityRow = doc.split('\n').find((line) => line.startsWith('| `visibility`'));
  assert.ok(visibilityRow.includes('SITE_SEAL_ONLY'), 'the visibility field row does not name the setting');
  assert.ok(doc.includes('#### On an instance that seals records only'), 'the sealed-mode section has no seal-only subsection');
});
