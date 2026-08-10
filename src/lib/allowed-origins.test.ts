// Tests for the topology-aware allowed-origin predicate (s6 P3, #229).
//
// Security-sensitive module: the cases below are the origin-matching
// contract — exact equality after normalization, scheme- and
// port-sensitive, www-insensitive, no suffix matching anywhere. The evil
// lookalikes (`evil-app.example.test`, `app.example.test.evil.com`,
// registrable-domain suffixes) are the regression net.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isConfiguredMarketingOrigin,
  isTrustedRequestOrigin,
  normalizeOriginForComparison,
  resolveMarketingCorsOrigin,
  resolveSessionAffordance,
  resolveTrustedOrigins,
} from './allowed-origins.ts';

// A split-host fixture used throughout: NEXTAUTH_URL stays on the
// marketing host — the exact #213 configuration in which device-approve
// POSTs from the app host used to 403.
const SPLIT = {
  NEXTAUTH_URL: 'https://example.test',
  APP_HOST: 'app.example.test',
  MARKETING_HOST: 'example.test',
};

test('normalization: canonical form, www- and trailing-dot-insensitive, default ports elided', () => {
  assert.equal(normalizeOriginForComparison('https://example.test'), 'https://example.test');
  assert.equal(normalizeOriginForComparison('https://WWW.Example.Test'), 'https://example.test');
  assert.equal(normalizeOriginForComparison('https://example.test.'), 'https://example.test');
  assert.equal(normalizeOriginForComparison('https://example.test:443'), 'https://example.test');
  assert.equal(normalizeOriginForComparison('http://example.test:80'), 'http://example.test');
  assert.equal(normalizeOriginForComparison('http://localhost:3000'), 'http://localhost:3000');
  // A full URL normalizes to its origin — NEXTAUTH_URL may carry a path.
  assert.equal(
    normalizeOriginForComparison('https://example.test/api/auth'),
    'https://example.test',
  );
});

test('normalization: garbage, opaque, and non-web origins are null, never a match', () => {
  assert.equal(normalizeOriginForComparison(null), null);
  assert.equal(normalizeOriginForComparison(undefined), null);
  assert.equal(normalizeOriginForComparison(''), null);
  assert.equal(normalizeOriginForComparison('   '), null);
  // `Origin: null` — sandboxed iframes, some redirects. Must never match.
  assert.equal(normalizeOriginForComparison('null'), null);
  assert.equal(normalizeOriginForComparison('example.test'), null); // no scheme
  assert.equal(normalizeOriginForComparison('file:///etc/hosts'), null);
  assert.equal(normalizeOriginForComparison('chrome-extension://abcdef'), null);
});

test('rule zero: nothing configured — empty trusted set, no marketing CORS origin, no affordance', () => {
  assert.deepEqual(resolveTrustedOrigins({}), []);
  assert.equal(resolveMarketingCorsOrigin({}), null);
  assert.equal(resolveSessionAffordance({}), null);
  assert.equal(isConfiguredMarketingOrigin('https://example.test', {}), false);
});

test('unset topology: the trusted set is exactly NEXTAUTH_URL — pre-#213 behavior, unchanged', () => {
  const env = { NEXTAUTH_URL: 'https://example.test' };
  assert.deepEqual(resolveTrustedOrigins(env), ['https://example.test']);
  assert.equal(isTrustedRequestOrigin('https://example.test', null, env), true);
  // www-insensitive in both directions (the production apex→www redirect).
  assert.equal(isTrustedRequestOrigin('https://www.example.test', null, env), true);
  assert.equal(
    isTrustedRequestOrigin('https://example.test', null, { NEXTAUTH_URL: 'https://www.example.test' }),
    true,
  );
  // What used to 403 still 403s: a different subdomain is a different origin.
  assert.equal(isTrustedRequestOrigin('https://app.example.test', null, env), false);
});

test('split host (#213): app-host and marketing-host origins are the instance\'s own', () => {
  // The fix itself: a device-approve POST from the app host passes.
  assert.equal(isTrustedRequestOrigin('https://app.example.test', null, SPLIT), true);
  // The marketing origin and NEXTAUTH_URL keep passing.
  assert.equal(isTrustedRequestOrigin('https://example.test', null, SPLIT), true);
  assert.equal(isTrustedRequestOrigin('https://www.example.test', null, SPLIT), true);
  assert.equal(isTrustedRequestOrigin('https://www.app.example.test', null, SPLIT), true);
});

test('split host: evil-origin lookalikes never match', () => {
  for (const evil of [
    'https://evil-app.example.test',
    'https://app.example.test.evil.com',
    'https://evilexample.test', // registrable-domain suffix lookalike
    'https://example.test.evil.com',
    'https://app-example.test',
    'https://wwwapp.example.test', // `www.`-stripping requires the dot
    'https://evil.test',
  ]) {
    assert.equal(isTrustedRequestOrigin(evil, null, SPLIT), false, evil);
  }
});

test('split host: scheme and port are part of the origin', () => {
  assert.equal(isTrustedRequestOrigin('http://app.example.test', null, SPLIT), false);
  assert.equal(isTrustedRequestOrigin('https://app.example.test:8443', null, SPLIT), false);
  assert.equal(isTrustedRequestOrigin('https://example.test:8443', null, SPLIT), false);
  // ...but the scheme-default port is the same origin.
  assert.equal(isTrustedRequestOrigin('https://app.example.test:443', null, SPLIT), true);
});

test('split host, dev shape: a full-origin host value keeps its scheme and port', () => {
  const env = {
    NEXTAUTH_URL: 'http://localhost:3000',
    APP_HOST: 'http://app.localhost:3000',
    MARKETING_HOST: 'http://localhost:3000',
  };
  assert.deepEqual(resolveTrustedOrigins(env), [
    'http://localhost:3000',
    'http://app.localhost:3000',
  ]);
  assert.equal(isTrustedRequestOrigin('http://app.localhost:3000', null, env), true);
  assert.equal(isTrustedRequestOrigin('http://app.localhost:3001', null, env), false);
  assert.equal(isTrustedRequestOrigin('https://app.localhost:3000', null, env), false);
});

test('app-only: the two host variables are declared ignored, so only NEXTAUTH_URL is trusted', () => {
  const env = { ...SPLIT, APP_ONLY: '1' };
  assert.deepEqual(resolveTrustedOrigins(env), ['https://example.test']);
  assert.equal(isTrustedRequestOrigin('https://app.example.test', null, env), false);
});

test('trusted set is deduplicated and skips unset values', () => {
  assert.deepEqual(
    resolveTrustedOrigins({
      NEXTAUTH_URL: 'https://www.example.test',
      MARKETING_HOST: 'example.test',
    }),
    ['https://example.test'],
  );
  assert.deepEqual(resolveTrustedOrigins({ APP_HOST: 'app.example.test' }), [
    'https://app.example.test',
  ]);
  assert.deepEqual(resolveTrustedOrigins({ APP_HOST: '', MARKETING_HOST: '   ' }), []);
});

test('no Origin header is never trusted, whatever the configuration', () => {
  assert.equal(isTrustedRequestOrigin(null, 'example.test', SPLIT), false);
  assert.equal(isTrustedRequestOrigin(undefined, 'example.test', {}), false);
  assert.equal(isTrustedRequestOrigin('', 'example.test', {}), false);
  assert.equal(isTrustedRequestOrigin('null', 'example.test', {}), false);
});

test('dev fallback (nothing configured): the request\'s own host, by exact equality', () => {
  assert.equal(isTrustedRequestOrigin('http://localhost:3000', 'localhost:3000', {}), true);
  assert.equal(isTrustedRequestOrigin('https://example.test', 'example.test', {}), true);
  // www-insensitive, matching the configured-origin path.
  assert.equal(isTrustedRequestOrigin('https://www.example.test', 'example.test', {}), true);
  assert.equal(isTrustedRequestOrigin('https://example.test', 'www.example.test', {}), true);
  // No Host header → nothing to trust.
  assert.equal(isTrustedRequestOrigin('http://localhost:3000', null, {}), false);
  // Port must match.
  assert.equal(isTrustedRequestOrigin('http://localhost:3001', 'localhost:3000', {}), false);
});

test('dev fallback: suffix lookalikes no longer pass (the pre-#213 endsWith hole)', () => {
  // `https://evil-example.org`.endsWith('example.org') was true; exact
  // host equality is not.
  assert.equal(isTrustedRequestOrigin('https://evil-example.test', 'example.test', {}), false);
  assert.equal(isTrustedRequestOrigin('https://aexample.test', 'example.test', {}), false);
  assert.equal(isTrustedRequestOrigin('https://example.test.evil.com', 'example.test', {}), false);
});

test('dev fallback is unreachable once any origin is configured — configuration narrows trust', () => {
  const env = { NEXTAUTH_URL: 'https://example.test' };
  // Same-host request whose origin is not the configured one: refused,
  // even though the fallback would have accepted it.
  assert.equal(isTrustedRequestOrigin('https://other.test', 'other.test', env), false);
});

test('marketing CORS origin: named only by a split topology, normalized like everything else', () => {
  assert.equal(resolveMarketingCorsOrigin(SPLIT), 'https://example.test');
  assert.equal(
    resolveMarketingCorsOrigin({ MARKETING_HOST: 'www.example.test' }),
    'https://example.test',
  );
  assert.equal(
    resolveMarketingCorsOrigin({ MARKETING_HOST: 'http://localhost:3000' }),
    'http://localhost:3000',
  );
  // Rule zero, each shape: unset topology, app-only, APP_HOST alone.
  assert.equal(resolveMarketingCorsOrigin({}), null);
  assert.equal(resolveMarketingCorsOrigin({ ...SPLIT, APP_ONLY: 'true' }), null);
  assert.equal(resolveMarketingCorsOrigin({ APP_HOST: 'app.example.test' }), null);
});

test('marketing CORS predicate: only the marketing origin, www-insensitive, nothing else', () => {
  assert.equal(isConfiguredMarketingOrigin('https://example.test', SPLIT), true);
  assert.equal(isConfiguredMarketingOrigin('https://www.example.test', SPLIT), true);
  // The instance's OWN app origin is not a marketing origin — the app host
  // has the session cookie already and needs no CORS grant.
  assert.equal(isConfiguredMarketingOrigin('https://app.example.test', SPLIT), false);
  for (const evil of [
    'https://evil.test',
    'https://evilexample.test',
    'https://example.test.evil.com',
    'http://example.test', // scheme mismatch
    'https://example.test:8443', // port mismatch
    'null',
  ]) {
    assert.equal(isConfiguredMarketingOrigin(evil, SPLIT), false, evil);
  }
});

test('session affordance: full split topology only', () => {
  assert.deepEqual(resolveSessionAffordance(SPLIT), {
    statusUrl: 'https://app.example.test/api/session-status',
    openAppHref: 'https://app.example.test/ask',
  });
  // Dev shape keeps scheme and port.
  assert.deepEqual(
    resolveSessionAffordance({
      APP_HOST: 'http://app.localhost:3000',
      MARKETING_HOST: 'http://localhost:3000',
    }),
    {
      statusUrl: 'http://app.localhost:3000/api/session-status',
      openAppHref: 'http://app.localhost:3000/ask',
    },
  );
});

test('session affordance rule zero: null topology, app-only, and partial rollouts are null', () => {
  assert.equal(resolveSessionAffordance({}), null);
  assert.equal(resolveSessionAffordance({ APP_ONLY: '1' }), null);
  assert.equal(resolveSessionAffordance({ ...SPLIT, APP_ONLY: 'true' }), null);
  // APP_HOST alone: the endpoint would refuse the probe (no marketing
  // origin to allow), so no probe may fire.
  assert.equal(resolveSessionAffordance({ APP_HOST: 'app.example.test' }), null);
  // MARKETING_HOST alone: nowhere to probe or point.
  assert.equal(resolveSessionAffordance({ MARKETING_HOST: 'example.test' }), null);
  // NEXTAUTH_URL alone never conjures an affordance.
  assert.equal(resolveSessionAffordance({ NEXTAUTH_URL: 'https://example.test' }), null);
});
