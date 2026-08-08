// Tests for the sign-in allowlist — the app front door's gate (P2).
//
// These cover the exact expression `callbacks.signIn` evaluates:
//
//     isSignInAllowed(providerAccountKey(account, user), <SIGN_IN_ALLOWLIST>)
//
// so what is asserted here is the gate decision itself, not a paraphrase of
// it. Every function takes its env as a parameter, so no process.env mutation
// and no NextAuth or database wiring is involved.
//
// The three acceptance properties, by name:
//   (a) an off-list account is refused        → the "refuses" tests
//   (b) an on-list account is admitted        → the "admits" tests
//   (c) an unset allowlist reproduces today's behavior exactly
//                                             → the "open by default" tests
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAllowlist, isSignInAllowed, isSignInGateEnabled } from './auth-allowlist.ts';
import { providerAccountKey, oidcAccountKey, OIDC_PROVIDER_ID } from './auth-providers.ts';

/** A GitHub sign-in as NextAuth hands it to the callback. */
const githubSignIn = (id: string) => ({
  account: { provider: 'github', providerAccountId: id },
  user: { id },
});

/** An OIDC sign-in as NextAuth hands it to the callback. */
const oidcSignIn = (subject: string) => ({
  account: { provider: OIDC_PROVIDER_ID, providerAccountId: subject },
  user: { id: subject },
});

/** The gate exactly as auth.ts composes it. */
function gate(
  signIn: { account: { provider: string; providerAccountId: string }; user: { id: string } },
  allowlist: string | undefined,
): boolean {
  return isSignInAllowed(providerAccountKey(signIn.account, signIn.user), allowlist);
}

const ISSUER = 'https://idp.example.org';
const OIDC_KEY = oidcAccountKey('subject-1', ISSUER);

// --- (c) Unset ⇒ open: today's behavior, exactly -----------------------------

test('(c) an unset allowlist admits every account — both key families', () => {
  assert.equal(gate(githubSignIn('4242'), undefined), true);
  assert.equal(gate(oidcSignIn('subject-1'), undefined), true);
});

test('(c) an empty or whitespace-only allowlist is treated as unset (open)', () => {
  for (const raw of ['', '   ', '\n', '\t\n  ', ',', ' , , ', ',,\n,']) {
    assert.equal(gate(githubSignIn('4242'), raw), true, `expected open for ${JSON.stringify(raw)}`);
    assert.equal(isSignInGateEnabled(raw), false, `gate is off for ${JSON.stringify(raw)}`);
  }
});

test('(c) with the gate off, even an underivable account key is admitted', () => {
  // The pre-gate callback returned true for a keyless sign-in; that must not
  // change on an instance that never configured an allowlist.
  assert.equal(isSignInAllowed(null, undefined), true);
  assert.equal(isSignInAllowed(undefined, ''), true);
});

// --- (b) On-list accounts are admitted ---------------------------------------

test('(b) a listed GitHub numeric id is admitted', () => {
  assert.equal(gate(githubSignIn('4242'), '4242'), true);
  assert.equal(gate(githubSignIn('4242'), '1,4242,9'), true);
});

test('(b) a listed OIDC issuer+subject composite is admitted', () => {
  assert.equal(isSignInAllowed(OIDC_KEY, OIDC_KEY), true);
  assert.equal(isSignInAllowed(OIDC_KEY, `4242,${OIDC_KEY}`), true);
});

test('(b) the two key families compose in one list', () => {
  const raw = `4242, ${OIDC_KEY}`;
  assert.equal(gate(githubSignIn('4242'), raw), true);
  assert.equal(isSignInAllowed(OIDC_KEY, raw), true);
  // ...and a third party matching neither is still refused.
  assert.equal(gate(githubSignIn('7777'), raw), false);
});

// --- (a) Off-list accounts are refused ---------------------------------------

test('(a) an unlisted GitHub id is refused', () => {
  assert.equal(gate(githubSignIn('7777'), '4242'), false);
});

test('(a) an unlisted OIDC subject is refused', () => {
  assert.equal(isSignInAllowed(oidcAccountKey('intruder', ISSUER), OIDC_KEY), false);
});

test('(a) the same subject from a DIFFERENT issuer is refused', () => {
  // The composite key is what makes this true: an allowlist entry authorizes
  // an identity at one issuer, not a subject string anywhere.
  const otherIssuer = oidcAccountKey('subject-1', 'https://other-idp.example.org');
  assert.notEqual(otherIssuer, OIDC_KEY);
  assert.equal(isSignInAllowed(otherIssuer, OIDC_KEY), false);
});

test('(a) matching is exact — no prefix, substring, or case-insensitive matches', () => {
  assert.equal(isSignInAllowed('42', '4242'), false, 'no prefix match');
  assert.equal(isSignInAllowed('4242', '424'), false, 'no substring match');
  assert.equal(isSignInAllowed('42421', '4242'), false, 'no extension match');
  assert.equal(
    isSignInAllowed(oidcAccountKey('SUBJECT-1', ISSUER), OIDC_KEY),
    false,
    'OIDC subjects are case-sensitive',
  );
});

test('(a) with the gate on, an underivable account key is refused', () => {
  assert.equal(isSignInAllowed(null, '4242'), false);
  assert.equal(isSignInAllowed(undefined, '4242'), false);
  assert.equal(isSignInAllowed('', '4242'), false);
});

// --- Whitespace and separator handling ---------------------------------------

test('parseAllowlist splits on commas, whitespace, and newlines alike', () => {
  const expected = ['4242', '7777', OIDC_KEY];
  assert.deepEqual(parseAllowlist(`4242,7777,${OIDC_KEY}`), expected);
  assert.deepEqual(parseAllowlist(`4242 7777 ${OIDC_KEY}`), expected);
  assert.deepEqual(parseAllowlist(`4242\n7777\n${OIDC_KEY}`), expected);
  assert.deepEqual(parseAllowlist(`  4242 ,\n  7777,\n${OIDC_KEY}  `), expected);
});

test('parseAllowlist tolerates trailing separators and blank lines', () => {
  assert.deepEqual(parseAllowlist('4242,'), ['4242']);
  assert.deepEqual(parseAllowlist(',4242,,7777,'), ['4242', '7777']);
  assert.deepEqual(parseAllowlist('\n\n4242\n\n'), ['4242']);
});

test('parseAllowlist de-duplicates', () => {
  assert.deepEqual(parseAllowlist('4242, 4242, 7777'), ['4242', '7777']);
});

test('parseAllowlist returns an empty list for unset/empty values', () => {
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist(null), []);
  assert.deepEqual(parseAllowlist(''), []);
  assert.deepEqual(parseAllowlist('   \n  '), []);
});

test('surrounding whitespace on a listed entry does not break the match', () => {
  assert.equal(gate(githubSignIn('4242'), '  4242  '), true);
  assert.equal(gate(githubSignIn('4242'), '\n 4242 \n'), true);
  assert.equal(isSignInAllowed(OIDC_KEY, `\t${OIDC_KEY}\n`), true);
});

test('isSignInGateEnabled is true only for a populated list', () => {
  assert.equal(isSignInGateEnabled(undefined), false);
  assert.equal(isSignInGateEnabled(''), false);
  assert.equal(isSignInGateEnabled('  '), false);
  assert.equal(isSignInGateEnabled('4242'), true);
  assert.equal(isSignInGateEnabled(OIDC_KEY), true);
});
