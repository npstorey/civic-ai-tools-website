// R8 W3 criterion 3 (c): the preflight's rows for the three new hosted
// sources and State legislation's key.
//
// - NYS_LEGISLATION_API_KEY is required while NYS_LEGISLATION_HOSTING is
//   `sandbox`, and read for presence only: a sentinel value never reaches the
//   report, and the refusal names the variable.
// - SOURCE_BRIDGE_SECRET is required while ANY of the four switches is
//   `sandbox`, each switch alone.
// - The four new rows (three switches, the key) are scoped to the
//   vercel-sandbox executor, as NYC Charter's two are.
//
// Red before the key's row and the bridge secret's wider condition: the key is
// undeclared, and a new switch alone leaves the secret optional.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV_SPEC, evaluateEnv, renderReport } from './preflight-env.mjs';

const GUIDE = readFileSync(new URL('../docs/deploy.md', import.meta.url), 'utf8');

const REQUIRED = ENV_SPEC.filter((s) => s.tier === 'required').map((s) => s.name);
const envWithAllRequired = () => Object.fromEntries(REQUIRED.map((name) => [name, 'present']));
const rowOf = (name) => ENV_SPEC.find((s) => s.name === name);

const SWITCHES = ['NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING'];
const KEY = 'NYS_LEGISLATION_API_KEY';
const SENTINEL = 'KEY-SENTINEL-DO-NOT-LEAK';

test('R8 W3 criterion 3 (c): the key is declared, optional, closed to its switch, and scoped to the sandbox executor', () => {
  const row = rowOf(KEY);
  assert.ok(row, `${KEY} is not declared in ENV_SPEC`);
  assert.equal(row.tier, 'optional');
  assert.deepEqual(row.requiredWhenValue, { NYS_LEGISLATION_HOSTING: 'sandbox' });
  assert.deepEqual(row.onlyWhen, { executor: 'vercel-sandbox' });
  for (const name of ['NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING']) {
    assert.deepEqual(rowOf(name)?.onlyWhen, { executor: 'vercel-sandbox' }, `${name} is not scoped as Charter's row is`);
    assert.deepEqual(rowOf(name)?.allowedValues, ['sandbox'], `${name} is not a closed set`);
  }
});

test('R8 W3 criterion 3 (c): NYS_LEGISLATION_HOSTING=sandbox without the key is refused, naming the key and never a value', () => {
  const without = evaluateEnv({ ...envWithAllRequired(), NYS_LEGISLATION_HOSTING: 'sandbox', SOURCE_BRIDGE_SECRET: 'present' });
  assert.equal(without.ok, false, 'the switch on without its key passed');
  assert.deepEqual(without.missingRequired.map((r) => r.name), [KEY]);
  assert.ok(renderReport(without).includes(KEY), 'the refusal does not name the key');
  const withKey = evaluateEnv({ ...envWithAllRequired(), NYS_LEGISLATION_HOSTING: 'sandbox', SOURCE_BRIDGE_SECRET: 'present', [KEY]: SENTINEL });
  assert.equal(withKey.ok, true);
  assert.ok(!renderReport(withKey).includes(SENTINEL), 'the key reached the report');
  // The key alone, its switch unset, is not a refusal.
  assert.equal(evaluateEnv({ ...envWithAllRequired(), [KEY]: SENTINEL }).ok, true);
});

test('R8 W3 criterion 3 (c): SOURCE_BRIDGE_SECRET is required while any one of the four switches is sandbox', () => {
  for (const name of SWITCHES) {
    const env = { ...envWithAllRequired(), [name]: 'sandbox', ...(name === 'NYS_LEGISLATION_HOSTING' ? { [KEY]: SENTINEL } : {}) };
    const without = evaluateEnv(env);
    assert.equal(without.ok, false, `${name}=sandbox passed without the bridge secret`);
    assert.deepEqual(without.missingRequired.map((r) => r.name), ['SOURCE_BRIDGE_SECRET'], `${name}=sandbox`);
    assert.equal(evaluateEnv({ ...env, SOURCE_BRIDGE_SECRET: 'present' }).ok, true, `${name}=sandbox with the secret`);
  }
  assert.equal(evaluateEnv(envWithAllRequired()).ok, true, 'every switch unset needs no secret');
});

test('R8 W3 criterion 3 (c): the new rows are not applicable where the sandbox auth is not', () => {
  const result = evaluateEnv({ ...envWithAllRequired(), EXECUTOR_DRIVER: 'container', NYS_LEGISLATION_HOSTING: 'on' });
  for (const name of ['NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING', KEY]) {
    assert.ok(result.notApplicable.includes(name), `${name} is applicable under the container driver`);
  }
  assert.deepEqual(result.valueErrors, [], 'a not-applicable variable was validated');
});

// R8 W3 criterion 5: the guide's environment reference has a row for each new
// switch and for the key, beside Charter's, and the hosted-sources section a
// table of the sources.
test('R8 W3 criterion 5: the guide has a row per new switch and one for the key, and a table of the hosted sources', () => {
  const rowAt = (name) => GUIDE.split('\n').findIndex((line) => line.startsWith(`| \`${name}\` | `) && line.length > 200);
  const charter = rowAt('NYC_CHARTER_HOSTING');
  assert.ok(charter > 0, 'premise: Charter\'s row is in the environment reference');
  for (const name of ['NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING', KEY]) {
    const at = rowAt(name);
    assert.ok(at > 0, `the environment reference has no row for ${name}`);
    assert.ok(Math.abs(at - charter) <= 6, `${name}'s row is not next to Charter's`);
  }
  const section = GUIDE.slice(GUIDE.indexOf('### Hosted sources'), GUIDE.indexOf('**What runs where.**'));
  for (const host of ['www.checkbooknyc.com', 'data.cityofnewyork.us', 'legislation.nysenate.gov']) {
    assert.ok(section.includes(host), `the hosted-sources table does not name ${host}`);
  }
});
