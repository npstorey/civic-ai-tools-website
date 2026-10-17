// #516 P1 (criteria 5 and 6) — RATE_LIMIT_SECRET is declared along the whole
// chain: preflight declares it required under every profile with no fallback,
// and its report names it when it is missing; the compose app service passes
// it through bare, with its line in the "unset ⇒" block; `docs/deploy.md`
// carries it in the minimal environment file, in the operator-supplied count,
// and in the core query path table, with the trade the ruling accepts.
//
// What this file cannot see: whether the code reads the variable. That half is
// `scripts/env-reads-declared.test.mjs` (a read with no ENV_SPEC row fails
// there) and `src/lib/rate-limit-key.test.ts` (the refusal without it).
//
// Run with: npm test
//   (or: node --test scripts/rate-limit-secret-config.test.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV_SPEC, DRIVER_SEAMS, evaluateEnv, renderReport } from './preflight-env.mjs';

const repo = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const NAME = 'RATE_LIMIT_SECRET';

function envWithAllRequired() {
  const env = {};
  for (const s of ENV_SPEC) if (s.tier === 'required') env[s.name] = 'present';
  return env;
}

test('#516 P1 (5): preflight declares RATE_LIMIT_SECRET required, read by the running server, with no fallback or condition', () => {
  const spec = ENV_SPEC.find((s) => s.name === NAME);
  assert.ok(spec, `ENV_SPEC does not declare ${NAME}`);
  assert.equal(spec.tier, 'required');
  assert.equal(spec.readBy, undefined, 'read at run time by the server');
  for (const field of [
    'hasFallback', 'priorEraName', 'onlyWhen', 'notWhen', 'requiredWhen', 'requiredWhenCustomized',
    'requiredUnlessAllPresent', 'requiredWhenFlagOn', 'requiredWhenValue', 'requiredWhenPartnerPresent',
  ]) {
    assert.equal(spec[field], undefined, `${NAME} carries ${field}: the ruling is required under every profile, no fallback`);
  }
});

test('#516 P1 (5): absent, empty or blank, the preflight fails naming it — under every driver of every seam', () => {
  const profiles = [{}];
  for (const seam of Object.values(DRIVER_SEAMS)) {
    for (const value of seam.values) profiles.push({ [seam.env]: value });
  }
  for (const profile of profiles) {
    for (const value of [undefined, '', '   ']) {
      const env = { ...envWithAllRequired(), ...profile };
      if (value === undefined) delete env[NAME];
      else env[NAME] = value;
      const result = evaluateEnv(env);
      const where = `profile ${JSON.stringify(profile)}, value ${JSON.stringify(value)}`;
      assert.equal(result.ok, false, where);
      assert.ok(result.missingRequired.some((r) => r.name === NAME), `${where}: not named among the missing`);
      assert.ok(!result.requiredOnFallback.some((r) => r.name === NAME), `${where}: reported as running on a fallback`);
    }
  }
  const report = renderReport(evaluateEnv((() => { const env = envWithAllRequired(); delete env[NAME]; return env; })()));
  assert.match(report, new RegExp(`\\[MISSING\\] ${NAME}\\b`));
  assert.match(report, new RegExp(`required variable\\(s\\) missing:[\\s\\S]*- ${NAME}\\b`));
});

test('#516 P1 (5): the compose app service passes RATE_LIMIT_SECRET bare, with its line in the "unset ⇒" block', () => {
  const compose = repo('docker-compose.yml');
  const app = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  gc-cron:'));
  assert.ok(app.length > 0, 'the app service was not found');
  const lines = app.split('\n');
  assert.equal(lines.filter((l) => l.trim() === `${NAME}:`).length, 1, `the app service carries no bare \`${NAME}:\``);
  assert.ok(!app.includes(`\${${NAME}`), `${NAME} is interpolated; only the bare form leaves an unset variable unset`);
  assert.ok(
    lines.some((l) => /^\s*#\s+RATE_LIMIT_SECRET\s+unset ⇒ /.test(l)),
    'the "unset ⇒" comment block has no line for it',
  );
});

test('#516 P1 (6): docs/deploy.md carries the variable, the count, the core-path row and the trade', () => {
  const doc = repo('docs/deploy.md');
  assert.match(doc, /^RATE_LIMIT_SECRET=<generated: openssl rand -base64 32>$/m, 'the minimal environment file has no line for it');
  assert.match(doc, /naming exactly the fourteen operator-supplied\nvariables — [^\n]*`RATE_LIMIT_SECRET`/);
  const row = doc.split('\n').find((line) => line.startsWith(`| \`${NAME}\` |`));
  assert.ok(row, 'docs/deploy.md has no RATE_LIMIT_SECRET row');
  const coreTable = doc.slice(doc.indexOf('**The core query path fails without:**'), doc.indexOf('**Absence disables a specific feature**'));
  assert.ok(coreTable.includes(row), 'the row is not in the core query path table');
  for (const needle of [
    'rate_limit_not_configured',
    'before anything is counted',
    '501 first',
    'No fallback',
    'HMAC-SHA256',
    // The trade, as the ruling states it.
    're-derive which stored key belongs to a given address',
    'rotating it mid-day restarts that day',
    'expire within 48 hours',
    'through a pipe',
    'Preflight checks presence only',
  ]) {
    assert.ok(row.includes(needle), `the row does not say: ${needle}`);
  }
});
