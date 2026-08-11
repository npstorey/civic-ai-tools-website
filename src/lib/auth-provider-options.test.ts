// Tests for the provider → sign-in-option narrowing (app front-door v0.1.0,
// P4b). The property that matters: what `/ask` renders as sign-in buttons is
// exactly what the instance actually configured — no hardcoded provider, no
// button for a provider that cannot complete an authorization.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Provider } from 'next-auth/providers/index';
import {
  DEFAULT_SIGN_IN_OPTIONS,
  resolveSignInAffordance,
  resolveSignInProse,
  toSignInOptions,
} from './auth-provider-options.ts';
import { buildProviders } from './auth-providers.ts';
import { SIGN_IN_PANEL_HREF } from './host-links.ts';

/** A provider config with only the fields this module reads. */
function fakeProvider(id: string, name: string): Provider {
  return { id, name, type: 'oauth' } as Provider;
}

test('toSignInOptions: narrows to {id, name}, preserving order', () => {
  assert.deepEqual(
    toSignInOptions([fakeProvider('github', 'GitHub'), fakeProvider('oidc', 'Acme SSO')]),
    [
      { id: 'github', name: 'GitHub' },
      { id: 'oidc', name: 'Acme SSO' },
    ],
  );
});

test('toSignInOptions: no providers ⇒ no options (no dead button)', () => {
  assert.deepEqual(toSignInOptions([]), []);
});

test('toSignInOptions: a provider with no usable id is dropped, not rendered', () => {
  const malformed = [
    { name: 'Nameless', type: 'oauth' } as unknown as Provider,
    { id: '', name: 'Empty id', type: 'oauth' } as unknown as Provider,
    fakeProvider('github', 'GitHub'),
  ];
  assert.deepEqual(toSignInOptions(malformed), [{ id: 'github', name: 'GitHub' }]);
});

test('toSignInOptions: a missing label falls back to the id', () => {
  const unlabeled = [{ id: 'oidc', type: 'oauth' } as unknown as Provider];
  assert.deepEqual(toSignInOptions(unlabeled), [{ id: 'oidc', name: 'oidc' }]);
});

// --- Composed with the real provider construction --------------------------

test('the reference deployment shape (GitHub pair only) ⇒ one GitHub button', () => {
  const options = toSignInOptions(
    buildProviders({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' }),
  );
  assert.deepEqual(options, [{ id: 'github', name: 'GitHub' }]);
});

test('an OIDC-only instance ⇒ one button labeled with its own provider name', () => {
  const options = toSignInOptions(
    buildProviders({
      OIDC_ISSUER: 'https://sso.example.org',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_PROVIDER_NAME: 'Acme SSO',
    }),
  );
  assert.deepEqual(options, [{ id: 'oidc', name: 'Acme SSO' }]);
});

test('both configured ⇒ one button each; a half-configured pair contributes none', () => {
  const options = toSignInOptions(
    buildProviders({
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      OIDC_ISSUER: 'https://sso.example.org',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
    }),
  );
  assert.deepEqual(options, [
    { id: 'github', name: 'GitHub' },
    { id: 'oidc', name: 'SSO' },
  ]);

  // Half a pair is not a provider — the #193 property, restated at this layer.
  assert.deepEqual(toSignInOptions(buildProviders({ GITHUB_CLIENT_ID: 'id' })), []);
  assert.deepEqual(
    toSignInOptions(buildProviders({ OIDC_ISSUER: 'https://sso.example.org', OIDC_CLIENT_ID: 'id' })),
    [],
  );
});

test('an unconfigured instance ⇒ zero options', () => {
  assert.deepEqual(toSignInOptions(buildProviders({})), []);
});

// --- One-control affordances (#229 P1 / Q63) -------------------------------
//
// The header button, the rate-limit line, the sandbox-mode prompt and the two
// publish buttons each have room for exactly one control, so they cannot map
// over the options the way the /ask and /auth/device panels do.

test('resolveSignInAffordance: one provider ⇒ start it in place, named', () => {
  const affordance = resolveSignInAffordance([{ id: 'oidc', name: 'Acme SSO' }]);
  assert.deepEqual(affordance, {
    kind: 'provider',
    option: { id: 'oidc', name: 'Acme SSO' },
  });
});

test('resolveSignInAffordance: nothing configured ⇒ no control at all (#193)', () => {
  assert.deepEqual(resolveSignInAffordance([]), { kind: 'none' });
});

test('resolveSignInAffordance: more than one ⇒ defer to the panel that can list them', () => {
  assert.deepEqual(
    resolveSignInAffordance([
      { id: 'github', name: 'GitHub' },
      { id: 'oidc', name: 'Acme SSO' },
    ]),
    { kind: 'panel', href: SIGN_IN_PANEL_HREF },
  );
});

test('the seam default is today’s exact affordance: one GitHub button', () => {
  // The value a mount OUTSIDE SignInOptionsProvider falls back to. It must
  // reproduce the pre-seam rendering, not an empty list.
  assert.deepEqual(DEFAULT_SIGN_IN_OPTIONS, [{ id: 'github', name: 'GitHub' }]);
  assert.deepEqual(resolveSignInAffordance(DEFAULT_SIGN_IN_OPTIONS), {
    kind: 'provider',
    option: { id: 'github', name: 'GitHub' },
  });
});

test('the reference deployment resolves to exactly the pre-seam button', () => {
  // GitHub pair configured, nothing else: derivation → affordance → the same
  // in-place `signIn('github')` button the five surfaces hardcoded before.
  const affordance = resolveSignInAffordance(
    toSignInOptions(buildProviders({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' })),
  );
  assert.deepEqual(affordance, { kind: 'provider', option: { id: 'github', name: 'GitHub' } });
});

// --- Prose wording (#235) ---------------------------------------------------
//
// The provider-literal class's seventh instance is a SENTENCE, not a control
// ("Sign in with GitHub to add an attestation."), so it resolves to wording
// rather than an affordance.

test('resolveSignInProse: one provider ⇒ named; the seam default is today’s exact copy', () => {
  assert.equal(resolveSignInProse([{ id: 'oidc', name: 'Acme SSO' }]), 'Sign in with Acme SSO');
  assert.equal(resolveSignInProse(DEFAULT_SIGN_IN_OPTIONS), 'Sign in with GitHub');
});

test('resolveSignInProse: several providers ⇒ neutral "Sign in" (prose cannot enumerate)', () => {
  assert.equal(
    resolveSignInProse([
      { id: 'github', name: 'GitHub' },
      { id: 'oidc', name: 'Acme SSO' },
    ]),
    'Sign in',
  );
});

test('resolveSignInProse: nothing configured ⇒ null — the caller drops the sentence', () => {
  assert.equal(resolveSignInProse([]), null);
  assert.equal(resolveSignInProse(toSignInOptions(buildProviders({}))), null);
});

test('an OIDC-only instance renders its own provider, never GitHub', () => {
  const affordance = resolveSignInAffordance(
    toSignInOptions(
      buildProviders({
        OIDC_ISSUER: 'https://sso.example.org',
        OIDC_CLIENT_ID: 'id',
        OIDC_CLIENT_SECRET: 'secret',
        OIDC_PROVIDER_NAME: 'Acme SSO',
      }),
    ),
  );
  assert.deepEqual(affordance, { kind: 'provider', option: { id: 'oidc', name: 'Acme SSO' } });
  assert.equal(JSON.stringify(affordance).includes('GitHub'), false);
});
