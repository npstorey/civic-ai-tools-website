// Tests for the provider → sign-in-option narrowing (app front-door v0.1.0,
// P4b). The property that matters: what `/ask` renders as sign-in buttons is
// exactly what the instance actually configured — no hardcoded provider, no
// button for a provider that cannot complete an authorization.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Provider } from 'next-auth/providers/index';
import { toSignInOptions } from './auth-provider-options.ts';
import { buildProviders } from './auth-providers.ts';

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
