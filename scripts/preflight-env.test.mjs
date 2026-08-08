// Unit tests for the demo-day env preflight.
//
// Run with:  node --test scripts/preflight-env.test.mjs
//
// (The repo's `npm test` globs src/**/*.test.ts; this scripts/ test is run
// explicitly — and would be wired into the cross-repo CI bundle, brief #5.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateEnv,
  renderReport,
  resolveDrivers,
  resolveSpec,
  ENV_SPEC,
  DRIVER_SEAMS,
  OIDC_PROVIDER_SET,
} from './preflight-env.mjs';

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

// --- Driver-aware resolution (instance profiles) ---------------------------

/** Env selecting the plain-Postgres + S3 + container profile. */
function selfHostedDrivers() {
  return { DB_DRIVER: 'node-postgres', BLOB_DRIVER: 's3', EXECUTOR_DRIVER: 'container' };
}

/** Names the S3 driver hard-throws on (src/lib/storage/s3.ts:67-69). */
const S3_CREDENTIALS = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
/** Variables only the vercel-sandbox executor driver reads. */
const SANDBOX_ONLY = ['SANDBOX_SNAPSHOT_ID', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'];

function tierOf(rows, name) {
  return rows.find((r) => r.name === name)?.tier;
}

test('every conditional field names a known seam and a known driver value', () => {
  for (const s of ENV_SPEC) {
    for (const field of ['onlyWhen', 'requiredWhen']) {
      if (!s[field]) continue;
      for (const [seam, driver] of Object.entries(s[field])) {
        assert.ok(DRIVER_SEAMS[seam], `${s.name}.${field} names a known seam (${seam})`);
        assert.ok(
          DRIVER_SEAMS[seam].values.includes(driver),
          `${s.name}.${field}.${seam} names a known driver (${driver})`,
        );
      }
    }
  }
});

test('unset selectors resolve to the coded defaults and report as the default profile', () => {
  const { drivers, errors, isDefault } = resolveDrivers({});
  assert.equal(isDefault, true);
  assert.deepEqual(errors, []);
  for (const [seam, def] of Object.entries(DRIVER_SEAMS)) {
    assert.equal(drivers[seam], def.default, `${seam} defaults to ${def.default}`);
  }
});

test('REGRESSION: the default profile resolves the spec unchanged (identity transform)', () => {
  const { drivers } = resolveDrivers({});
  const { applicable, notApplicable } = resolveSpec(drivers);
  assert.deepEqual(applicable, ENV_SPEC, 'no entry is dropped, retiered, or reordered');
  assert.deepEqual(notApplicable, [], 'nothing is suppressed under the default profile');
});

test('REGRESSION: selectors set explicitly to their defaults match unset, byte for byte', () => {
  const base = envWithAllRequired();
  const explicit = { ...base };
  for (const def of Object.values(DRIVER_SEAMS)) explicit[def.env] = def.default;

  const unsetResult = evaluateEnv(base);
  const explicitResult = evaluateEnv(explicit);
  assert.equal(explicitResult.profile.isDefault, true);
  assert.deepEqual(
    explicitResult.rows.map((r) => [r.name, r.tier]),
    unsetResult.rows.map((r) => [r.name, r.tier]),
  );
  // The profile banner must not appear for a default profile — that is what
  // keeps the report identical to the pre-driver-awareness output.
  assert.ok(!renderReport(unsetResult).includes('PROFILE:'));
  assert.ok(!renderReport(explicitResult).includes('PROFILE:'));
});

test('BLOB_DRIVER=s3 promotes the S3 credentials to required', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 's3' };
  const result = evaluateEnv(env);
  for (const name of S3_CREDENTIALS) {
    assert.equal(tierOf(result.rows, name), 'required', `${name} is required under the s3 driver`);
  }
  // Absent (envWithAllRequired only fills base-tier required vars) ⇒ hard miss.
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name).sort(), [...S3_CREDENTIALS].sort());
});

test('BLOB_DRIVER=s3 passes once the S3 credentials are present', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 's3' };
  for (const name of S3_CREDENTIALS) env[name] = 'present';
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
});

test('the tier flip reverses: under the default blob driver the S3 credentials stay optional', () => {
  const result = evaluateEnv(envWithAllRequired()); // BLOB_DRIVER unset
  for (const name of S3_CREDENTIALS) {
    assert.equal(tierOf(result.rows, name), 'optional', `${name} is optional off the s3 driver`);
  }
  assert.equal(result.ok, true, 'absent S3 credentials do not fail the default profile');
});

test('BLOB_DRIVER=s3 suppresses the Vercel Blob token entirely (not merely demotes it)', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 's3' };
  delete env.BLOB_READ_WRITE_TOKEN;
  for (const name of S3_CREDENTIALS) env[name] = 'present';
  const result = evaluateEnv(env);

  assert.equal(result.ok, true, 'an instance off Vercel Blob is not failed for its token');
  assert.equal(tierOf(result.rows, 'BLOB_READ_WRITE_TOKEN'), undefined, 'no row at all');
  assert.ok(result.notApplicable.includes('BLOB_READ_WRITE_TOKEN'));
  // "Reports nothing irrelevant": the name must not reach the rendered output.
  assert.ok(
    !renderReport(result).includes('BLOB_READ_WRITE_TOKEN'),
    'a not-applicable variable is never named in the report',
  );
});

test('EXECUTOR_DRIVER=container suppresses the sandbox-only variables', () => {
  const env = { ...envWithAllRequired(), EXECUTOR_DRIVER: 'container' };
  const result = evaluateEnv(env);
  const report = renderReport(result);
  for (const name of SANDBOX_ONLY) {
    assert.equal(tierOf(result.rows, name), undefined, `${name} has no row`);
    assert.ok(result.notApplicable.includes(name), `${name} is marked not applicable`);
    assert.ok(!report.includes(name), `${name} is not named in the report`);
  }
  // Fallback-backed under both drivers, so it stays listed either way.
  assert.equal(tierOf(result.rows, 'EXECUTOR_CONTAINER_IMAGE'), 'optional');
  // A suppressed recommended var must not be counted as a degraded feature.
  assert.ok(!result.missingRecommended.some((r) => r.name === 'SANDBOX_SNAPSHOT_ID'));
});

test('the default executor driver keeps the sandbox-only variables listed', () => {
  const result = evaluateEnv(envWithAllRequired()); // EXECUTOR_DRIVER unset
  for (const name of SANDBOX_ONLY) {
    assert.notEqual(tierOf(result.rows, name), undefined, `${name} is listed under the sandbox driver`);
  }
  assert.deepEqual(result.notApplicable, []);
});

test('the self-hosted profile passes with no platform-specific variables set', () => {
  const env = { ...envWithAllRequired(), ...selfHostedDrivers() };
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.KV_REST_API_URL;
  delete env.KV_REST_API_TOKEN;
  for (const name of S3_CREDENTIALS) env[name] = 'present';

  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  assert.equal(result.profile.isDefault, false);

  const report = renderReport(result);
  assert.match(report, /PROFILE: db=node-postgres {2}blob=s3 {2}executor=container/);
  assert.match(report, /5 variable\(s\) not applicable to this profile/);
  for (const name of ['BLOB_READ_WRITE_TOKEN', ...SANDBOX_ONLY]) {
    assert.ok(!report.includes(name), `${name} is never mentioned to a self-hosted instance`);
  }
});

test('the self-hosted profile fails, naming S3_BUCKET, when the bucket is absent', () => {
  const env = { ...envWithAllRequired(), ...selfHostedDrivers() };
  delete env.BLOB_READ_WRITE_TOKEN;
  env.S3_ACCESS_KEY_ID = 'present';
  env.S3_SECRET_ACCESS_KEY = 'present'; // S3_BUCKET deliberately absent

  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name), ['S3_BUCKET']);
  assert.match(renderReport(result), /RESULT: FAIL — 1 required variable\(s\) missing:/);
  assert.match(renderReport(result), /- S3_BUCKET/);
});

test('an unrecognized selector value fails the run and is never echoed', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 'gopher-SENTINEL-DO-NOT-LEAK' };
  const result = evaluateEnv(env);

  assert.equal(result.ok, false, 'the app throws on this value, so preflight must not pass');
  assert.deepEqual(result.driverErrors, ['BLOB_DRIVER']);
  // Resolution falls back to the seam default so the rest of the table renders.
  assert.equal(result.profile.drivers.blob, DRIVER_SEAMS.blob.default);

  const report = renderReport(result);
  assert.ok(!report.includes('SENTINEL'), 'the offending value is never echoed');
  assert.match(report, /BLOB_DRIVER \(expected one of: vercel-blob, s3\)/);
});

// --- Alternative sets (sign-in providers; #193) -----------------------------

/** The pair that gates the GitHub provider in src/lib/auth-providers.ts. */
const GITHUB_PAIR = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'];

/** Env with a complete generic-OIDC provider triple. */
function withOidcProvider(env) {
  const out = { ...env };
  for (const name of OIDC_PROVIDER_SET) out[name] = 'present';
  return out;
}

test('every requiredUnlessAllPresent names variables the spec itself declares', () => {
  const declared = new Set(ENV_SPEC.map((s) => s.name));
  for (const s of ENV_SPEC) {
    if (!s.requiredUnlessAllPresent) continue;
    assert.ok(Array.isArray(s.requiredUnlessAllPresent), `${s.name}.requiredUnlessAllPresent is a list`);
    assert.ok(s.requiredUnlessAllPresent.length > 0, `${s.name}.requiredUnlessAllPresent is non-empty`);
    // Demotion only makes sense from 'required' — anything else is a no-op
    // that would silently mislead a reader of the spec.
    assert.equal(s.tier, 'required', `${s.name} declares 'required' so the demotion is meaningful`);
    for (const name of s.requiredUnlessAllPresent) {
      assert.ok(declared.has(name), `${s.name} names a declared variable (${name})`);
    }
  }
});

test('the GitHub pair carries the OIDC alternative condition', () => {
  for (const name of GITHUB_PAIR) {
    const entry = ENV_SPEC.find((s) => s.name === name);
    assert.deepEqual(entry.requiredUnlessAllPresent, OIDC_PROVIDER_SET);
  }
});

test('REGRESSION: an incomplete OIDC triple leaves the GitHub pair required', () => {
  // Every strict subset of the triple, plus none of it at all.
  const partials = [
    {},
    { OIDC_ISSUER: 'present' },
    { OIDC_ISSUER: 'present', OIDC_CLIENT_ID: 'present' },
    { OIDC_CLIENT_ID: 'present', OIDC_CLIENT_SECRET: 'present' },
  ];
  for (const partial of partials) {
    const env = { ...envWithAllRequired(), ...partial };
    for (const name of GITHUB_PAIR) delete env[name];
    const result = evaluateEnv(env);
    const which = JSON.stringify(Object.keys(partial));
    for (const name of GITHUB_PAIR) {
      assert.equal(tierOf(result.rows, name), 'required', `${name} stays required for ${which}`);
    }
    assert.equal(result.ok, false, `an instance with no working provider fails for ${which}`);
    assert.deepEqual(result.missingRequired.map((r) => r.name).sort(), [...GITHUB_PAIR].sort());
  }
});

test('a complete OIDC triple demotes the GitHub pair to optional and passes without it', () => {
  const env = withOidcProvider(envWithAllRequired());
  for (const name of GITHUB_PAIR) delete env[name];

  const result = evaluateEnv(env);
  assert.equal(result.ok, true, 'an OIDC-only instance has a working provider and must pass');
  for (const name of GITHUB_PAIR) {
    assert.equal(tierOf(result.rows, name), 'optional', `${name} is optional for an OIDC-only instance`);
  }
  // Demoted to 'optional', NOT 'recommended': an absent GitHub pair on an
  // OIDC-only instance is a configuration choice, not a degraded feature, so
  // it must not appear in the "feature(s) will degrade" note.
  assert.ok(!result.missingRecommended.some((r) => GITHUB_PAIR.includes(r.name)));
  const report = renderReport(result);
  // The degrade note exists (other recommended vars are absent in this env);
  // what matters is that neither GitHub variable is named inside it.
  const degradeNote = report.slice(report.indexOf('will degrade'));
  for (const name of GITHUB_PAIR) {
    assert.ok(!degradeNote.includes(name), `${name} is not nagged about as a degraded feature`);
  }
  // Still listed in the table, so the operator can see GitHub remains
  // available to add alongside OIDC.
  assert.match(report, /GITHUB_CLIENT_ID/);
});

test('the demotion is presence-driven, not order-driven: whitespace-only OIDC vars do not count', () => {
  const env = { ...envWithAllRequired(), ...withOidcProvider({}) };
  env.OIDC_CLIENT_SECRET = '   '; // present-but-blank is absent everywhere else too
  for (const name of GITHUB_PAIR) delete env[name];

  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  for (const name of GITHUB_PAIR) {
    assert.equal(tierOf(result.rows, name), 'required');
  }
});

test('REGRESSION: resolveSpec without an env argument never demotes (identity preserved)', () => {
  const { drivers } = resolveDrivers({});
  const { applicable } = resolveSpec(drivers); // no env passed
  assert.deepEqual(applicable, ENV_SPEC);
});

// --- The app front door's two new knobs -------------------------------------

test('the sign-in gate and app-tier knobs are optional with coded fallbacks', () => {
  // Both reproduce today's behavior when unset — SIGN_IN_ALLOWLIST leaves
  // sign-in open, APP_TIER_RATE_LIMIT falls back to the authenticated limit —
  // so neither may ever fail or nag a run.
  for (const name of ['SIGN_IN_ALLOWLIST', 'APP_TIER_RATE_LIMIT']) {
    const entry = ENV_SPEC.find((s) => s.name === name);
    assert.ok(entry, `${name} is enumerated`);
    assert.equal(entry.tier, 'optional', `${name} is optional`);
    assert.equal(entry.hasFallback, true, `${name} has a coded fallback`);
  }
  const result = evaluateEnv(envWithAllRequired()); // both absent
  assert.equal(result.ok, true);
  assert.ok(!result.missingRecommended.some((r) => r.name === 'SIGN_IN_ALLOWLIST'));
  assert.ok(!result.missingRecommended.some((r) => r.name === 'APP_TIER_RATE_LIMIT'));
});

test('a configured allowlist is never echoed — only the variable name', () => {
  const env = { ...envWithAllRequired(), SIGN_IN_ALLOWLIST: '4242,oidc:https://idp.example.org:SENTINEL' };
  const report = renderReport(evaluateEnv(env));
  assert.ok(!report.includes('SENTINEL'), 'allowlist entries are identities — never printed');
  assert.ok(!report.includes('4242'));
  assert.ok(report.includes('SIGN_IN_ALLOWLIST'));
});

test('the durable rate-limit counter is soft: absent, the run still passes', () => {
  // rate-limit.ts:53-63 takes an in-process memory store when either is absent.
  const env = envWithAllRequired();
  delete env.KV_REST_API_URL;
  delete env.KV_REST_API_TOKEN;
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.requiredOnFallback.map((r) => r.name).filter((n) => n.startsWith('KV_')),
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  );
});
