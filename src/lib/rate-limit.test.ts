// Tests for the env-overridable rate limits (Option B from
// docs/rate-limit-headroom.md). The core property: behavior is identical to
// the hardcoded values when the env vars are unset, and a valid override is
// honored — so a demo-window lift is a Vercel env change, not a code change.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLimit, selectLimit, checkRateLimit } from './rate-limit.ts';

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

// --- Tier selection, including the app tier (app front door P2) -------------

/** The default numbers, named so the intent of each case is readable. */
const TIERS = { anonymous: 10, authenticated: 25, appTier: 40 };

test('selectLimit: anonymous requests take the anonymous limit, gated or not', () => {
  assert.equal(selectLimit({ ...TIERS, isAuthenticated: false, gated: false }), 10);
  assert.equal(selectLimit({ ...TIERS, isAuthenticated: false, gated: true }), 10);
});

test('selectLimit: on an UNGATED instance, a signed-in user takes the authenticated limit', () => {
  // The reference deployment today. This is the byte-identical-behavior case:
  // no allowlist configured means the app tier is never consulted, whatever
  // APP_TIER_RATE_LIMIT happens to say.
  assert.equal(selectLimit({ ...TIERS, isAuthenticated: true, gated: false }), 25);
  assert.equal(
    selectLimit({ ...TIERS, appTier: 999, isAuthenticated: true, gated: false }),
    25,
    'an app-tier value set on an ungated instance is inert',
  );
});

test('selectLimit: on a GATED instance, a signed-in user takes the app tier', () => {
  // On a gated instance every authenticated identity is an allowlisted one —
  // the gate is at sign-in — so "authenticated + gated" is the app tier.
  assert.equal(selectLimit({ ...TIERS, isAuthenticated: true, gated: true }), 40);
});

test('selectLimit: an unset app tier resolves to the authenticated limit (identity, not a default)', () => {
  // resolveLimit(undefined, AUTHENTICATED_LIMIT) is how the module wires it,
  // so an instance that sets an allowlist but no app-tier number sees exactly
  // its authenticated numbers.
  const appTier = resolveLimit(undefined, 25);
  assert.equal(appTier, 25);
  assert.equal(selectLimit({ ...TIERS, appTier, isAuthenticated: true, gated: true }), 25);
});

test('selectLimit: the app tier inherits a lifted authenticated limit when unset', () => {
  // AUTHENTICATED_RATE_LIMIT=100 with APP_TIER_RATE_LIMIT unset ⇒ app tier 100.
  const authenticated = resolveLimit('100', 25);
  const appTier = resolveLimit(undefined, authenticated);
  assert.equal(appTier, 100);
  assert.equal(selectLimit({ ...TIERS, authenticated, appTier, isAuthenticated: true, gated: true }), 100);
});

test('selectLimit: an app tier may be set below the authenticated limit', () => {
  // Nothing forces the gated tier upward — an instance may deliberately run a
  // tighter per-user budget on its gated surface.
  assert.equal(selectLimit({ ...TIERS, appTier: 5, isAuthenticated: true, gated: true }), 5);
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
