// Tests for the env-overridable rate limits (Option B from
// docs/rate-limit-headroom.md). The core property: behavior is identical to
// the hardcoded values when the env vars are unset, and a valid override is
// honored — so a demo-window lift is a Vercel env change, not a code change.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLimit, checkRateLimit } from './rate-limit.ts';

test('resolveLimit: unset (undefined) falls back to the default', () => {
  assert.equal(resolveLimit(undefined, 10), 10);
  assert.equal(resolveLimit(undefined, 25), 25);
});

test('resolveLimit: empty string falls back to the default', () => {
  assert.equal(resolveLimit('', 10), 10);
});

test('resolveLimit: a valid numeric override is honored', () => {
  assert.equal(resolveLimit('50', 10), 50);
  assert.equal(resolveLimit('100', 25), 100);
});

test('resolveLimit: non-numeric falls back to the default (the || guard)', () => {
  assert.equal(resolveLimit('abc', 10), 10);
  assert.equal(resolveLimit('  ', 10), 10); // whitespace → Number() is NaN
});

test('resolveLimit: zero falls back to the default (|| guard treats 0 as unset)', () => {
  assert.equal(resolveLimit('0', 10), 10);
});

test('default wiring: with no env overrides, the limits are 10 (anon) and 25 (auth)', async () => {
  // The test runner has no ANONYMOUS_RATE_LIMIT / AUTHENTICATED_RATE_LIMIT set,
  // so the module constants must resolve to the hardcoded defaults. A fresh
  // identifier has count 0, so `limit` is reported verbatim.
  const anon = await checkRateLimit('rate-limit-test-fresh-anon', false);
  assert.equal(anon.limit, 10);
  assert.equal(anon.authenticated, false);

  const auth = await checkRateLimit('rate-limit-test-fresh-auth', true);
  assert.equal(auth.limit, 25);
  assert.equal(auth.authenticated, true);
});
