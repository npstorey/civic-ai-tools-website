// Unit tests for the vercel-sandbox driver's pure auth-params helper
// (S3b P4 fix-on-top).
//
// Why this exists: `@vercel/sandbox` / `@vercel/oidc` read exactly ONE auth
// variable from the environment — VERCEL_OIDC_TOKEN. The
// VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID triple is accepted only as
// explicit Sandbox.create({ token, teamId, projectId }) parameters, and the
// SDK's resolver THROWS on a partial triple (returning to the OIDC path only
// when all three are absent). So the resolution rule is all-three-or-none,
// and that rule is what these tests pin.
//
// No network, no SDK calls: the helper is pure and takes its env as an
// argument. Fixture values below are obviously-fake placeholders — no
// real-looking credentials.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSandboxAuthParams } from './vercel-sandbox.ts';

// Guard-safe fixture values: obviously fake, structurally unlike real
// credentials, and never logged by the code under test.
const FIXTURE_ENV = {
  VERCEL_TOKEN: 'fixture-token-value-not-real',
  VERCEL_TEAM_ID: 'fixture-team-id',
  VERCEL_PROJECT_ID: 'fixture-project-id',
};

test('all three present → params returned verbatim (passed to Sandbox.create)', () => {
  const params = resolveSandboxAuthParams(FIXTURE_ENV);
  assert.deepEqual(params, {
    token: 'fixture-token-value-not-real',
    teamId: 'fixture-team-id',
    projectId: 'fixture-project-id',
  });
});

test('none present → null, so the on-platform OIDC path is untouched', () => {
  // This is the demo/production case: no auth keys are passed to the SDK.
  assert.equal(resolveSandboxAuthParams({}), null);
});

test('any one missing → null (never a partial triple, which the SDK rejects)', () => {
  for (const omitted of ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']) {
    const env: Record<string, string | undefined> = { ...FIXTURE_ENV };
    delete env[omitted];
    assert.equal(
      resolveSandboxAuthParams(env),
      null,
      `omitting ${omitted} must yield null, not a partial triple`,
    );
  }
});

test('empty and whitespace-only values count as absent', () => {
  assert.equal(resolveSandboxAuthParams({ ...FIXTURE_ENV, VERCEL_TOKEN: '' }), null);
  assert.equal(resolveSandboxAuthParams({ ...FIXTURE_ENV, VERCEL_TEAM_ID: '   ' }), null);
});

test('surrounding whitespace is trimmed off the resolved values', () => {
  const params = resolveSandboxAuthParams({
    VERCEL_TOKEN: '  fixture-token-value-not-real  ',
    VERCEL_TEAM_ID: '\tfixture-team-id\n',
    VERCEL_PROJECT_ID: ' fixture-project-id ',
  });
  assert.deepEqual(params, {
    token: 'fixture-token-value-not-real',
    teamId: 'fixture-team-id',
    projectId: 'fixture-project-id',
  });
});

test('the returned object has exactly the SDK credential keys (no extras, no undefineds)', () => {
  const params = resolveSandboxAuthParams(FIXTURE_ENV);
  assert.notEqual(params, null);
  assert.deepEqual(Object.keys(params!).sort(), ['projectId', 'teamId', 'token']);
  for (const value of Object.values(params!)) {
    assert.equal(typeof value, 'string');
  }
});
