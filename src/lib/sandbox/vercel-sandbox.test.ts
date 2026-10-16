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
import { Sandbox } from '@vercel/sandbox';
import { createVercelSandboxDriver, resolveSandboxAuthParams } from './vercel-sandbox.ts';

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

// --- the creation parameters the driver hands the SDK (#491, sprint #617 P1) --
//
// Driven through the real driver with `Sandbox.create` replaced by a recorder
// that answers with a stand-in sandbox, so no request is made. Every executor
// creation is one-use: `@vercel/sandbox` 3.x makes a sandbox persistent unless
// told otherwise, and a persistent sandbox is snapshotted when it stops — a
// visitor's notebook files would be kept, and the snapshot storage would grow
// with every run. The four shapes are every branch `createSandbox` takes:
// snapshot or no snapshot, auth triple or none.

const STAND_IN = { name: 'fixture-sandbox-name', sandboxId: 'sbx_fixture_prior_id' };
const AUTH_KEYS = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'] as const;

async function recordCreate(
  snapshotId: string | undefined,
  withAuth: boolean,
): Promise<{ params: Record<string, unknown>; sessionId: string }> {
  const recorded: Record<string, unknown>[] = [];
  const realCreate = Sandbox.create;
  const saved = Object.fromEntries(AUTH_KEYS.map((k) => [k, process.env[k]]));
  for (const k of AUTH_KEYS) delete process.env[k];
  if (withAuth) Object.assign(process.env, FIXTURE_ENV);
  Sandbox.create = (async (params: Record<string, unknown>) => {
    recorded.push(params);
    return STAND_IN;
  }) as unknown as typeof Sandbox.create;
  try {
    const session = await createVercelSandboxDriver().createSession({
      timeoutMs: 60_000,
      env: {},
      ...(snapshotId ? { snapshotId } : {}),
    });
    assert.equal(recorded.length, 1, 'one session makes exactly one Sandbox.create call');
    return { params: recorded[0]!, sessionId: session.id };
  } finally {
    Sandbox.create = realCreate;
    for (const k of AUTH_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

for (const snapshotId of ['snap_fixture', undefined]) {
  for (const withAuth of [false, true]) {
    const shape = `${snapshotId ? 'from a snapshot' : 'with no snapshot'}, ${withAuth ? 'with' : 'without'} the auth triple`;
    test(`every executor sandbox is created one-use (persistent: false) — ${shape}`, async () => {
      const { params } = await recordCreate(snapshotId, withAuth);
      // The branch really was the one named: the control that makes this a
      // drive of four shapes rather than one shape four times.
      assert.equal('source' in params, Boolean(snapshotId));
      assert.equal('token' in params, withAuth);
      assert.equal(
        params.persistent,
        false,
        `Sandbox.create received persistent=${String(params.persistent)}; 3.x keeps a sandbox's ` +
          'filesystem across sessions unless persistent is false',
      );
    });
  }
}

test("the session id is the sandbox's name, the 3.x instance identifier", async () => {
  const { sessionId } = await recordCreate('snap_fixture', false);
  assert.equal(
    sessionId,
    STAND_IN.name,
    `the session id is ${sessionId}; 3.x has no sandboxId, so the id a record carries is the name`,
  );
});
