// Tests for the sign-in intent handoff gate (app front-door v0.1.0, P4d).
//
// The property worth pinning: auto-invoking an off-site redirect happens only
// when all three conditions hold, and every other combination degrades to
// rendering the ordinary panel — never to a wrong provider, never to a
// redirect the visitor did not ask for.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGN_IN_INTENT_PARAM,
  readSignInIntent,
  shouldAutoSignIn,
} from './sign-in-intent.ts';

test('the parameter name is the one the hrefs carry', () => {
  assert.equal(SIGN_IN_INTENT_PARAM, 'signin');
});

test('readSignInIntent: only the literal 1 counts', () => {
  assert.equal(readSignInIntent('1'), true);
  for (const value of [undefined, '', '0', 'true', 'yes', 'signin', ' 1']) {
    assert.equal(readSignInIntent(value), false, JSON.stringify(value));
  }
});

test('readSignInIntent: a repeated parameter arrives as an array', () => {
  assert.equal(readSignInIntent(['1']), true);
  assert.equal(readSignInIntent(['0', '1']), true);
  assert.equal(readSignInIntent(['0']), false);
  assert.equal(readSignInIntent([]), false);
});

// --- The gate -----------------------------------------------------------

const ONE_PROVIDER = { hasIntent: true, signedOut: true, optionCount: 1 };

test('all three conditions ⇒ auto-invoke', () => {
  assert.equal(shouldAutoSignIn(ONE_PROVIDER), true);
});

test('no intent ⇒ never: a direct visit to /ask renders the panel', () => {
  assert.equal(shouldAutoSignIn({ ...ONE_PROVIDER, hasIntent: false }), false);
});

test('signed in ⇒ never', () => {
  assert.equal(shouldAutoSignIn({ ...ONE_PROVIDER, signedOut: false }), false);
});

test('the intent is IGNORED when the provider is ambiguous or absent', () => {
  // Two providers: "sign in" does not name one, so the visitor chooses.
  assert.equal(shouldAutoSignIn({ ...ONE_PROVIDER, optionCount: 2 }), false);
  assert.equal(shouldAutoSignIn({ ...ONE_PROVIDER, optionCount: 5 }), false);
  // None configured: there is nothing to invoke, and the panel says so.
  assert.equal(shouldAutoSignIn({ ...ONE_PROVIDER, optionCount: 0 }), false);
});

test('every combination that is not exactly-one-and-intended falls back to the panel', () => {
  for (const hasIntent of [true, false]) {
    for (const signedOut of [true, false]) {
      for (const optionCount of [0, 1, 2, 3]) {
        const expected = hasIntent && signedOut && optionCount === 1;
        assert.equal(
          shouldAutoSignIn({ hasIntent, signedOut, optionCount }),
          expected,
          `intent=${hasIntent} signedOut=${signedOut} options=${optionCount}`,
        );
      }
    }
  }
});
