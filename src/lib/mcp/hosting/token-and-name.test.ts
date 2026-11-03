// #617 P3 criteria 1 and 4, the parts that are pure: the bridge token and the
// sandbox name.
//
//   - The token is HMAC-SHA256 of the sandbox name under SOURCE_BRIDGE_SECRET,
//     hex, checked against a vector computed independently here (`node:crypto`
//     directly), so a token computed some other way — a plain hash, the secret
//     alone, another encoding — fails. Two names give two tokens, and two
//     secrets give two tokens: a rotated secret cannot open an old sandbox.
//   - The secret is read by name, trimmed, and blank is absent.
//   - The name carries the prefix, the environment, the alias and the pinned
//     version encoded to the platform's rules (`^[a-zA-Z0-9_-]+$`, 1-128,
//     measured on 3.5.1 in #617 P1); a pin move makes a new name, an
//     environment makes a new name, and a version that cannot be encoded
//     one-to-one is refused rather than folded into another pin's name.
//
// The 401s on the sandbox's public URL are measured live (the phase record);
// `hosted-call-driven.test.ts` drives the client's side of a refused token.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/hosting/token-and-name.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { bridgeToken, readBridgeSecret, SOURCE_BRIDGE_SECRET_VARIABLE } from './token.ts';
import { hostedSandboxName, hostingEnvironment, HOSTED_SANDBOX_NAME_PREFIX } from './lifecycle.ts';
import { NYC_CHARTER_ENTRY } from '@typedstandards/civic-typed-router';

const SECRET = 'r7-p3-vector-secret';
const NAME = 'civic-src-production-nyc_charter__0_3_1';

test('criterion 4: the token is HMAC-SHA256 of the sandbox name under the secret, lowercase hex', () => {
  const expected = createHmac('sha256', SECRET).update(NAME, 'utf8').digest('hex');
  assert.equal(bridgeToken(SECRET, NAME), expected);
  assert.match(bridgeToken(SECRET, NAME), /^[0-9a-f]{64}$/);
  assert.notEqual(bridgeToken(SECRET, NAME), bridgeToken(SECRET, `${NAME}x`), 'two sandboxes share a token');
  assert.notEqual(bridgeToken(SECRET, NAME), bridgeToken(`${SECRET}x`, NAME), 'a rotated secret opens the old sandbox');
  assert.throws(() => bridgeToken('', NAME), /empty/);
});

test('criterion 4: the secret is read by name, trimmed, and blank is absent', () => {
  assert.equal(SOURCE_BRIDGE_SECRET_VARIABLE, 'SOURCE_BRIDGE_SECRET');
  const saved = process.env.SOURCE_BRIDGE_SECRET;
  try {
    process.env.SOURCE_BRIDGE_SECRET = `  ${SECRET}\n`;
    assert.equal(readBridgeSecret(), SECRET);
    process.env.SOURCE_BRIDGE_SECRET = '   ';
    assert.equal(readBridgeSecret(), undefined);
    delete process.env.SOURCE_BRIDGE_SECRET;
    assert.equal(readBridgeSecret(), undefined);
  } finally {
    if (saved === undefined) delete process.env.SOURCE_BRIDGE_SECRET;
    else process.env.SOURCE_BRIDGE_SECRET = saved;
  }
});

test('criterion 1: the name is the prefix, the environment, the alias and the pinned version, within the platform rules', () => {
  // Router 0.4.0 (#632 D11): the pin is the entry's npm-package hosting variant.
  const { alias, hostings } = NYC_CHARTER_ENTRY;
  const hosting = hostings.find((variant) => variant.kind === 'npm-package');
  assert.ok(hosting, 'premise: the manifest entry carries an npm-package hosting variant');
  const name = hostedSandboxName(alias, hosting!.version, 'production');
  assert.equal(name, NAME);
  assert.ok(name.startsWith(HOSTED_SANDBOX_NAME_PREFIX));
  assert.ok(!name.startsWith('nbexec-') && !name.startsWith('nbsnap-'), 'the name shares a prefix with the executor');
  assert.match(name, /^[a-zA-Z0-9_-]{1,128}$/);
  assert.notEqual(hostedSandboxName(alias, '0.3.2', 'production'), name, 'a pin move keeps the old name');
  assert.notEqual(hostedSandboxName(alias, hosting!.version, 'preview'), name, 'preview and production share a sandbox');
  assert.notEqual(hostedSandboxName(alias, '0.3.1', 'production'), hostedSandboxName(alias, '0.31', 'production'), 'two versions encode to one name');
  assert.throws(() => hostedSandboxName(alias, '0.3.1+b784cb7', 'production'), /does not encode/, 'build metadata was folded into a name');
});

/** Runs `body` with the two platform variables as given (undefined: unset), then restores them. */
function underPlatform(env: { VERCEL_TARGET_ENV?: string; VERCEL_ENV?: string }, body: () => void): void {
  const names = ['VERCEL_TARGET_ENV', 'VERCEL_ENV'] as const;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const n of names) {
      if (env[n] === undefined) delete process.env[n];
      else process.env[n] = env[n];
    }
    body();
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

test('criterion 1: with no VERCEL_TARGET_ENV, the environment is the platform\'s VERCEL_ENV, or local off it', () => {
  for (const [value, expected] of [['preview', 'preview'], ['Production ', 'production'], ['not a name!', 'local'], [undefined, 'local']] as const) {
    underPlatform({ VERCEL_ENV: value }, () => assert.equal(hostingEnvironment(), expected, `VERCEL_ENV=${JSON.stringify(value)}`));
  }
});

// #717. On a custom environment the platform sets VERCEL_ENV to `preview` and
// the environment's own name in VERCEL_TARGET_ENV, so staging was counted, and
// would have named its sandboxes, as a preview.
test('#717: a custom environment reads its own name from VERCEL_TARGET_ENV, not VERCEL_ENV\'s preview', () => {
  underPlatform({ VERCEL_TARGET_ENV: 'staging', VERCEL_ENV: 'preview' }, () => {
    assert.equal(hostingEnvironment(), 'staging');
    assert.equal(hostedSandboxName('nyc_charter', '0.3.1'), 'civic-src-staging-nyc_charter__0_3_1');
  });
  underPlatform({ VERCEL_TARGET_ENV: ' Staging\n', VERCEL_ENV: 'preview' }, () => assert.equal(hostingEnvironment(), 'staging'));
});

test('#717: production and previews read as before, the platform setting both variables to the same value', () => {
  for (const value of ['production', 'preview', 'development']) {
    underPlatform({ VERCEL_TARGET_ENV: value, VERCEL_ENV: value }, () => assert.equal(hostingEnvironment(), value));
  }
});

test('#717: a VERCEL_TARGET_ENV the guard refuses falls back to VERCEL_ENV, as before', () => {
  for (const refused of ['qa-2', 'staging2', 'a'.repeat(17), '', '   ']) {
    underPlatform({ VERCEL_TARGET_ENV: refused, VERCEL_ENV: 'preview' }, () =>
      assert.equal(hostingEnvironment(), 'preview', `VERCEL_TARGET_ENV=${JSON.stringify(refused)}`),
    );
    underPlatform({ VERCEL_TARGET_ENV: refused }, () => assert.equal(hostingEnvironment(), 'local', `VERCEL_TARGET_ENV=${JSON.stringify(refused)}, no VERCEL_ENV`));
  }
});
