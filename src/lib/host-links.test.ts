// Tests for the cross-host link derivation (app front-door v0.1.0, P4c).
//
// Rule zero, the same one every other seam in this sprint obeys: with none of
// the three host-topology variables set, the derivation reproduces today's
// behavior exactly — relative marketing hrefs (empty prefix) and in-place
// sign-in (null href).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOST_LINKS, resolveHostLinks } from './host-links.ts';

test('unset topology: relative marketing links, sign in place', () => {
  assert.deepEqual(resolveHostLinks({}), { marketingOrigin: '', signInHref: null });
  // ...which is exactly what a consumer rendered outside the provider sees.
  assert.deepEqual(resolveHostLinks({}), DEFAULT_HOST_LINKS);
});

test('split host: marketing links carry the marketing origin, sign-in goes to the app surface', () => {
  assert.deepEqual(
    resolveHostLinks({ APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }),
    { marketingOrigin: 'https://example.org', signInHref: 'https://app.example.org/ask' },
  );
});

test('app-only: no marketing site to link to, sign-in is a relative path', () => {
  // marketingOrigin null is the instruction to HIDE the affordance, matching
  // resolvePublicSiteHref's null for the AppChrome exit link.
  assert.deepEqual(resolveHostLinks({ APP_ONLY: '1' }), {
    marketingOrigin: null,
    signInHref: '/ask',
  });
  // APP_ONLY wins over host matching, as it does in decideRoute.
  assert.deepEqual(
    resolveHostLinks({ APP_ONLY: 'true', APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }),
    { marketingOrigin: null, signInHref: '/ask' },
  );
});

test('the two halves are independent — an incremental rollout is coherent at every step', () => {
  // Stage 1: APP_HOST only. Sign-in already redirects to the app surface;
  // marketing links stay relative because no marketing origin is named yet.
  assert.deepEqual(resolveHostLinks({ APP_HOST: 'app.example.org' }), {
    marketingOrigin: '',
    signInHref: 'https://app.example.org/ask',
  });
  // Stage 2: MARKETING_HOST only. The mirror image.
  assert.deepEqual(resolveHostLinks({ MARKETING_HOST: 'example.org' }), {
    marketingOrigin: 'https://example.org',
    signInHref: null,
  });
});

test('host values accept a full origin, and a dev instance keeps its scheme and port', () => {
  assert.deepEqual(
    resolveHostLinks({ APP_HOST: 'http://app.localhost:3000/', MARKETING_HOST: 'http://localhost:3000' }),
    { marketingOrigin: 'http://localhost:3000', signInHref: 'http://app.localhost:3000/ask' },
  );
});

test('empty and whitespace values are unset, not configuration', () => {
  assert.deepEqual(resolveHostLinks({ APP_HOST: '', MARKETING_HOST: '   ', APP_ONLY: '' }), {
    marketingOrigin: '',
    signInHref: null,
  });
  assert.deepEqual(resolveHostLinks({ APP_ONLY: '0' }).marketingOrigin, '');
  assert.deepEqual(resolveHostLinks({ APP_ONLY: 'false' }).signInHref, null);
});

test('concatenation property: an empty prefix yields exactly the relative href', () => {
  // This is the byte-identity argument, expressed as an assertion: every
  // consumer builds `${marketingOrigin}${path}`.
  const { marketingOrigin } = resolveHostLinks({});
  for (const path of ['/about', '/directory', '/explore', '/learn', '/project', '/roadmap']) {
    assert.equal(`${marketingOrigin}${path}`, path);
  }
});
