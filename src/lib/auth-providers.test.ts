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
  providerAccountKey,
  OIDC_PROVIDER_ID,
} from './auth-providers.ts';

const OIDC_ENV = {
  OIDC_ISSUER: 'https://issuer.example.org',
  OIDC_CLIENT_ID: 'example-client-id',
  OIDC_CLIENT_SECRET: 'example-client-secret',
};

/** The GitHub pair, complete — the reference deployment's configuration. */
const GITHUB_ENV = {
  GITHUB_CLIENT_ID: 'example-github-id',
  GITHUB_CLIENT_SECRET: 'example-github-secret',
};

test('provider list with the GitHub pair and no OIDC env is GitHub only (demo default)', () => {
  const providers = buildProviders(GITHUB_ENV);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, 'github');
});

test('GitHub env alone does not add the OIDC provider', () => {
  const providers = buildProviders(GITHUB_ENV);
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
    const providers = buildProviders({ ...GITHUB_ENV, ...env });
    assert.equal(providers.length, 1, `expected GitHub only for ${JSON.stringify(Object.keys(env))}`);
    assert.equal(providers[0].id, 'github');
  }
});

// --- The GitHub provider gate (#193) ----------------------------------------

test('an incomplete GitHub pair produces NO GitHub provider (not a broken one)', () => {
  const partials = [
    {},
    { GITHUB_CLIENT_ID: GITHUB_ENV.GITHUB_CLIENT_ID },
    { GITHUB_CLIENT_SECRET: GITHUB_ENV.GITHUB_CLIENT_SECRET },
  ];
  for (const env of partials) {
    const providers = buildProviders(env);
    assert.equal(
      providers.length,
      0,
      `expected no providers for ${JSON.stringify(Object.keys(env))}`,
    );
  }
});

test('an OIDC-only instance advertises exactly one provider, and it is not GitHub', () => {
  const providers = buildProviders(OIDC_ENV);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, OIDC_PROVIDER_ID);
  assert.ok(!providers.some((p) => p.id === 'github'), 'no silently-broken GitHub button');
});

test('a configured GitHub provider carries the real credentials, never an empty string', () => {
  // next-auth v4 provider factories return their defaults plus the caller's
  // options under `.options`; the top-level merge happens later, in
  // parseProviders. The credentials the gate feeds in live there.
  const gh = buildProviders(GITHUB_ENV)[0] as unknown as {
    options: { clientId?: string; clientSecret?: string };
  };
  assert.equal(gh.options.clientId, GITHUB_ENV.GITHUB_CLIENT_ID);
  assert.equal(gh.options.clientSecret, GITHUB_ENV.GITHUB_CLIENT_SECRET);
  // The `|| ''` fallbacks are gone: an empty string can no longer reach a
  // rendered provider, because an incomplete pair renders no provider at all.
  assert.notEqual(gh.options.clientId, '');
  assert.notEqual(gh.options.clientSecret, '');
});

test('full OIDC trio adds the OIDC provider with issuer-driven config', () => {
  const providers = buildProviders({ ...GITHUB_ENV, ...OIDC_ENV });
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
    ...GITHUB_ENV,
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
  const providers = buildProviders({ ...GITHUB_ENV, ...OIDC_ENV });
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

// --- The single provider-account key derivation ------------------------------
//
// One implementation feeds the allowlist gate, the users-table upsert, and the
// JWT's DB lookup. These tests pin the shapes those three agree on.

test('providerAccountKey returns the GitHub numeric id for a GitHub sign-in', () => {
  assert.equal(providerAccountKey({ provider: 'github', providerAccountId: '4242' }, { id: '4242' }), '4242');
  // The GitHub path keys on user.id (what the upsert has always written),
  // not on providerAccountId.
  assert.equal(providerAccountKey({ provider: 'github', providerAccountId: '9999' }, { id: '4242' }), '4242');
});

test('providerAccountKey returns the issuer+subject composite for an OIDC sign-in', () => {
  const key = providerAccountKey(
    { provider: OIDC_PROVIDER_ID, providerAccountId: 'subject-1' },
    { id: 'ignored-when-subject-present' },
  );
  assert.equal(key, oidcAccountKey('subject-1'));
  assert.match(key as string, /^oidc:/);
});

test('providerAccountKey falls back to user.id as the OIDC subject', () => {
  const key = providerAccountKey({ provider: OIDC_PROVIDER_ID }, { id: 'subject-2' });
  assert.equal(key, oidcAccountKey('subject-2'));
});

test('providerAccountKey returns null when no key can be derived', () => {
  assert.equal(providerAccountKey({ provider: 'github' }, {}), null);
  assert.equal(providerAccountKey({ provider: OIDC_PROVIDER_ID }, {}), null);
  assert.equal(providerAccountKey(undefined, undefined), null);
  assert.equal(providerAccountKey(null, { id: '' }), null);
});

test('an absent account object takes the GitHub (pre-existing) path', () => {
  // NextAuth omits `account` on some flows; the old inline derivation treated
  // that as the GitHub branch, and this one must too.
  assert.equal(providerAccountKey(undefined, { id: '4242' }), '4242');
});
