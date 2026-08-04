// Provider-list tests (S3b P2 seam 3: generic-OIDC auth provider).
//
// buildProviders(env) is a pure function of the env it is handed, so these
// tests pass explicit env objects — no process.env mutation needed.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviders,
  normalizeIssuer,
  oidcAccountKey,
  OIDC_PROVIDER_ID,
} from './auth-providers.ts';

const OIDC_ENV = {
  OIDC_ISSUER: 'https://issuer.example.org',
  OIDC_CLIENT_ID: 'example-client-id',
  OIDC_CLIENT_SECRET: 'example-client-secret',
};

test('provider list without OIDC env is GitHub only (demo default)', () => {
  const providers = buildProviders({});
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, 'github');
});

test('GitHub env alone does not add the OIDC provider', () => {
  const providers = buildProviders({
    GITHUB_CLIENT_ID: 'example-github-id',
    GITHUB_CLIENT_SECRET: 'example-github-secret',
  });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, 'github');
});

test('partial OIDC env (any of the three missing) stays GitHub only', () => {
  const partials = [
    { OIDC_ISSUER: OIDC_ENV.OIDC_ISSUER },
    { OIDC_ISSUER: OIDC_ENV.OIDC_ISSUER, OIDC_CLIENT_ID: OIDC_ENV.OIDC_CLIENT_ID },
    { OIDC_CLIENT_ID: OIDC_ENV.OIDC_CLIENT_ID, OIDC_CLIENT_SECRET: OIDC_ENV.OIDC_CLIENT_SECRET },
  ];
  for (const env of partials) {
    const providers = buildProviders(env);
    assert.equal(providers.length, 1, `expected GitHub only for ${JSON.stringify(Object.keys(env))}`);
    assert.equal(providers[0].id, 'github');
  }
});

test('full OIDC trio adds the OIDC provider with issuer-driven config', () => {
  const providers = buildProviders(OIDC_ENV);
  assert.equal(providers.length, 2);
  assert.equal(providers[0].id, 'github');

  const oidc = providers[1] as unknown as Record<string, unknown>;
  assert.equal(oidc.id, OIDC_PROVIDER_ID);
  assert.equal(oidc.type, 'oauth');
  assert.equal(oidc.issuer, 'https://issuer.example.org');
  assert.equal(oidc.wellKnown, 'https://issuer.example.org/.well-known/openid-configuration');
  assert.equal(oidc.clientId, 'example-client-id');
  assert.equal(oidc.clientSecret, 'example-client-secret');
  // Discovery-based config: no hardcoded endpoint URLs.
  assert.equal(oidc.name, 'SSO');
});

test('OIDC_PROVIDER_NAME sets the button label; trailing issuer slash is normalized', () => {
  const providers = buildProviders({
    ...OIDC_ENV,
    OIDC_ISSUER: 'https://issuer.example.org/',
    OIDC_PROVIDER_NAME: 'Example SSO',
  });
  const oidc = providers[1] as unknown as Record<string, unknown>;
  assert.equal(oidc.name, 'Example SSO');
  assert.equal(oidc.issuer, 'https://issuer.example.org');
  assert.equal(oidc.wellKnown, 'https://issuer.example.org/.well-known/openid-configuration');
});

test('OIDC profile mapper follows standard claims with fallbacks', () => {
  const providers = buildProviders(OIDC_ENV);
  const oidc = providers[1] as unknown as {
    profile: (p: Record<string, unknown>) => { id: string; name: unknown; email: unknown; image: unknown };
  };

  const full = oidc.profile({
    sub: 'subject-1',
    name: 'Full Name',
    preferred_username: 'preferred',
    email: 'user@example.org',
    picture: 'https://issuer.example.org/avatar.png',
  });
  assert.deepEqual(full, {
    id: 'subject-1',
    name: 'Full Name',
    email: 'user@example.org',
    image: 'https://issuer.example.org/avatar.png',
  });

  const minimal = oidc.profile({ sub: 'subject-2' });
  assert.deepEqual(minimal, { id: 'subject-2', name: 'subject-2', email: null, image: null });
});

test('oidcAccountKey is an issuer+subject composite that cannot collide with numeric ids', () => {
  const key = oidcAccountKey('subject-1', 'https://issuer.example.org/');
  assert.equal(key, 'oidc:https://issuer.example.org:subject-1');
  assert.ok(!/^\d+$/.test(key));
});

test('normalizeIssuer strips only trailing slashes', () => {
  assert.equal(normalizeIssuer('https://issuer.example.org//'), 'https://issuer.example.org');
  assert.equal(normalizeIssuer('https://issuer.example.org/realms/a'), 'https://issuer.example.org/realms/a');
});
