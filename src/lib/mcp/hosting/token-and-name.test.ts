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
  const { alias, hosting } = NYC_CHARTER_ENTRY;
  assert.ok(hosting, 'premise: the manifest entry carries a hosting field');
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

test('criterion 1: the environment is the platform\'s VERCEL_ENV, or local off it', () => {
  const saved = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = 'preview';
    assert.equal(hostingEnvironment(), 'preview');
    process.env.VERCEL_ENV = 'Production ';
    assert.equal(hostingEnvironment(), 'production');
    process.env.VERCEL_ENV = 'not a name!';
    assert.equal(hostingEnvironment(), 'local');
    delete process.env.VERCEL_ENV;
    assert.equal(hostingEnvironment(), 'local');
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  }
});
