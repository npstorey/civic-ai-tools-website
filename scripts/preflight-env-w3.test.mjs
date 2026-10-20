// R6 W3 (#632), criteria 5 and 14: the preflight's two W3 rows.
//
// CRITERION 5 (D10 = A). `SITE_DEPLOYMENT_GUIDE_URL` is the deployment guide's
// public address: declared in `ENV_SPEC` at tier `optional` (an operator-run
// report; it refuses no deploy), delivered by the compose file, and named in
// the deployment guide's environment reference. Unset, the report names it
// absent at its tier and still passes.
//
// CRITERION 14 (carried from W5, gate record 6279499371). `VERCEL_ENV` has two
// readers: a hosted source's sandbox name, and the usage table's `environment`
// column, which every instance with a database writes. Its row's purpose names
// both, and `onlyWhen` is dropped, so an instance that runs no sandbox source
// still sees the row. It stays `optional`, with its fallback (`local`).
//
// WHAT MAKES IT ABLE TO FAIL. At the base the guide's variable is declared
// nowhere, and `VERCEL_ENV` is scoped to the vercel-sandbox executor: under
// `EXECUTOR_DRIVER=container` the report omits it.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV_SPEC, evaluateEnv, renderReport } from './preflight-env.mjs';
import { checkComposeEnvCoverage } from './check-compose-env.mjs';

const REQUIRED = ENV_SPEC.filter((s) => s.tier === 'required').map((s) => s.name);
const envWithAllRequired = () => Object.fromEntries(REQUIRED.map((name) => [name, 'present']));
const rowOf = (name) => ENV_SPEC.find((s) => s.name === name);

const COMPOSE = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const GUIDE_DOC = readFileSync(new URL('../docs/deploy.md', import.meta.url), 'utf8');

// --- Criterion 5: the guide's address ---------------------------------------------

test('criterion 5: SITE_DEPLOYMENT_GUIDE_URL is declared at tier optional, with a purpose', () => {
  const row = rowOf('SITE_DEPLOYMENT_GUIDE_URL');
  assert.ok(row, 'SITE_DEPLOYMENT_GUIDE_URL is not declared in ENV_SPEC');
  assert.equal(row.tier, 'optional');
  assert.equal(row.onlyWhen, undefined, 'the guide\'s address is scoped to a profile');
  assert.match(row.purpose, /guide/i);
});

test('criterion 5: unset, the report names SITE_DEPLOYMENT_GUIDE_URL absent at its tier, and refuses nothing', () => {
  const result = evaluateEnv(envWithAllRequired());
  const report = renderReport(result);
  assert.equal(result.ok, true);
  const optional = report.slice(report.indexOf('OPTIONAL'));
  assert.ok(report.includes('OPTIONAL') && /\[absent \] SITE_DEPLOYMENT_GUIDE_URL\b/.test(optional), `the report does not name the guide's address absent under OPTIONAL:\n${report}`);
  assert.match(report, /RESULT: PASS/);
});

test('criterion 5: the compose file delivers SITE_DEPLOYMENT_GUIDE_URL, and the coverage check passes', () => {
  assert.match(COMPOSE, /^\s+SITE_DEPLOYMENT_GUIDE_URL:/m, 'docker-compose.yml has no SITE_DEPLOYMENT_GUIDE_URL row');
  const result = checkComposeEnvCoverage(COMPOSE);
  assert.equal(result.ok, true, `the compose coverage check fails: ${JSON.stringify(result).slice(0, 400)}`);
});

test('criterion 5: the deployment guide\'s environment reference has the row', () => {
  const start = GUIDE_DOC.indexOf('## Environment reference, tier by tier');
  const end = GUIDE_DOC.indexOf('\n## ', start + 1);
  assert.ok(start >= 0, 'premise: the guide has its environment reference');
  assert.match(GUIDE_DOC.slice(start, end), /^\| `SITE_DEPLOYMENT_GUIDE_URL` \|/m, 'the environment reference has no SITE_DEPLOYMENT_GUIDE_URL row');
});

// --- Criterion 14: VERCEL_ENV and its two readers --------------------------------------

test('criterion 14: VERCEL_ENV\'s purpose names both readers, and the row is not scoped to a profile', () => {
  const row = rowOf('VERCEL_ENV');
  assert.ok(row, 'premise: VERCEL_ENV is declared');
  assert.equal(row.tier, 'optional');
  assert.equal(row.hasFallback, true, 'VERCEL_ENV lost its fallback');
  assert.equal(row.onlyWhen, undefined, `VERCEL_ENV is still scoped to ${JSON.stringify(row.onlyWhen)}`);
  assert.match(row.purpose, /sandbox/i, 'the purpose does not name the sandbox\'s name');
  assert.match(row.purpose, /usage/i, 'the purpose does not name the usage table');
  assert.match(row.purpose, /environment/i, 'the purpose does not name the environment column');
});

test('criterion 14: an instance with no sandbox source sees the VERCEL_ENV row, as a fallback, and still passes', () => {
  const result = evaluateEnv({ ...envWithAllRequired(), EXECUTOR_DRIVER: 'container' });
  const report = renderReport(result);
  assert.ok(!result.notApplicable.includes('VERCEL_ENV'), 'VERCEL_ENV is not applicable to an instance with no sandbox source');
  assert.match(report, /\[fallbk \] VERCEL_ENV\b/, `the report does not list VERCEL_ENV for an instance with no sandbox source:\n${report}`);
  assert.equal(result.ok, true);
  if (process.env.R6_W3_PREFLIGHT_PRINT === '1') process.stderr.write(`${report}\n`);
});
