// Tests for the cross-host link derivation (app front-door v0.1.0, P4c;
// marketing gate re-keyed in #259 P3).
//
// THE TWO FIELDS ANSWER DIFFERENT QUESTIONS, and #259 P3 moved exactly one:
//
//   - `marketingOrigin` asks "does a marketing surface exist, and where?"
//     Its unset-topology answer CHANGED from `''` (relative) to `null`
//     (hide), because the portable default no longer serves the marketing
//     routes anywhere — relative hrefs to `/learn`, `/about` and `/roadmap`
//     would have rendered into a 404.
//   - `signInHref` asks "where do sessions live?", which only `APP_HOST`
//     answers. Unchanged: null still means sign in in place.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOST_LINKS, resolveHostLinks } from './host-links.ts';
import { SIGN_IN_INTENT_PARAM } from './sign-in-intent.ts';

test('portable default: no marketing surface, so the links are hidden (#259 P3)', () => {
  assert.deepEqual(resolveHostLinks({}), { marketingOrigin: null, signInHref: null });
});

test('SERVE_MARKETING: relative marketing links, sign in place — the pre-#259 answer', () => {
  assert.deepEqual(resolveHostLinks({ SERVE_MARKETING: '1' }), {
    marketingOrigin: '',
    signInHref: null,
  });
  // ...which is exactly what a consumer rendered outside the provider sees.
  // DEFAULT_HOST_LINKS is the CONTEXT default (a consumer with no provider
  // above it), not the unset-env answer — the two stopped coinciding at the
  // flip, and the safe context default is the permissive one: a component
  // mounted outside the provider keeps rendering what it always did.
  assert.deepEqual(resolveHostLinks({ SERVE_MARKETING: '1' }), DEFAULT_HOST_LINKS);
});

test('split host: marketing links carry the marketing origin, sign-in goes to the app surface', () => {
  assert.deepEqual(
    resolveHostLinks({ APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }),
    { marketingOrigin: 'https://example.org', signInHref: 'https://app.example.org/ask?signin=1' },
  );
});

test('app-only: no marketing site to link to, sign-in is a relative path', () => {
  // marketingOrigin null is the instruction to HIDE the affordance, matching
  // resolvePublicSiteHref's null for the AppChrome exit link.
  assert.deepEqual(resolveHostLinks({ APP_ONLY: '1' }), {
    marketingOrigin: null,
    signInHref: '/ask?signin=1',
  });
  // APP_ONLY wins over host matching, as it does in decideRoute.
  assert.deepEqual(
    resolveHostLinks({ APP_ONLY: 'true', APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }),
    { marketingOrigin: null, signInHref: '/ask?signin=1' },
  );
});

test('the two halves are independent — an incremental rollout is coherent at every step', () => {
  // Stage 0 (new in #259 P3): SERVE_MARKETING, before any host is named.
  // Every host passes through, so both halves read as a single-host instance.
  assert.deepEqual(resolveHostLinks({ SERVE_MARKETING: '1' }), {
    marketingOrigin: '',
    signInHref: null,
  });
  // Stage 1: APP_HOST added. Sign-in redirects to the app surface; marketing
  // links stay relative because the unnamed apex is still passing through.
  assert.deepEqual(
    resolveHostLinks({ APP_HOST: 'app.example.org', SERVE_MARKETING: '1' }),
    { marketingOrigin: '', signInHref: 'https://app.example.org/ask?signin=1' },
  );
  // Stage 2: MARKETING_HOST added — the origin is now named, and the knob
  // stops mattering for the marketing half.
  assert.deepEqual(
    resolveHostLinks({ APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }),
    { marketingOrigin: 'https://example.org', signInHref: 'https://app.example.org/ask?signin=1' },
  );
  // MARKETING_HOST alone is still the mirror image of stage 1.
  assert.deepEqual(resolveHostLinks({ MARKETING_HOST: 'example.org' }), {
    marketingOrigin: 'https://example.org',
    signInHref: null,
  });
});

test('APP_HOST alone WITHOUT the knob hides the marketing links, and must', () => {
  // The stage that changed at the flip. With only APP_HOST named and no
  // knob, NO host serves the marketing routes — the app host withholds them
  // and every unnamed host now takes the app role too — so a relative
  // prefix would have pointed the footer and nav at guaranteed 404s.
  // signInHref is untouched: it answers a different question.
  assert.deepEqual(resolveHostLinks({ APP_HOST: 'app.example.org' }), {
    marketingOrigin: null,
    signInHref: 'https://app.example.org/ask?signin=1',
  });
});

test('host values accept a full origin, and a dev instance keeps its scheme and port', () => {
  assert.deepEqual(
    resolveHostLinks({ APP_HOST: 'http://app.localhost:3000/', MARKETING_HOST: 'http://localhost:3000' }),
    { marketingOrigin: 'http://localhost:3000', signInHref: 'http://app.localhost:3000/ask?signin=1' },
  );
});

test('empty and whitespace values are unset, not configuration', () => {
  assert.deepEqual(
    resolveHostLinks({ APP_HOST: '', MARKETING_HOST: '   ', APP_ONLY: '', SERVE_MARKETING: '' }),
    { marketingOrigin: null, signInHref: null },
  );
  // An empty MARKETING_HOST does not count as "a marketing host is named",
  // so the knob still decides — the same reading normalizeHost gives it.
  assert.deepEqual(
    resolveHostLinks({ MARKETING_HOST: '   ', SERVE_MARKETING: '1' }).marketingOrigin,
    '',
  );
  assert.deepEqual(resolveHostLinks({ APP_ONLY: '0' }).marketingOrigin, null);
  assert.deepEqual(resolveHostLinks({ APP_ONLY: '0', SERVE_MARKETING: 'true' }).marketingOrigin, '');
  assert.deepEqual(resolveHostLinks({ APP_ONLY: 'false' }).signInHref, null);
});

test('every non-null sign-in href carries the intent parameter, relative one included', () => {
  // The parameter encodes intent, not topology — an app-only visitor who
  // clicks "sign in" wants what a split-host visitor who clicks it wants.
  const configured = [
    resolveHostLinks({ APP_HOST: 'app.example.org' }).signInHref,
    resolveHostLinks({ APP_HOST: 'app.example.org', MARKETING_HOST: 'example.org' }).signInHref,
    resolveHostLinks({ APP_ONLY: '1' }).signInHref,
  ];
  for (const href of configured) {
    assert.ok(href !== null);
    assert.ok(href.includes(`${SIGN_IN_INTENT_PARAM}=1`), href);
    assert.ok(href.split('?')[0].endsWith('/ask'), href);
  }
  // ...and an unset instance still has no href at all, so no parameter
  // reaches anything: the affordances stay in-place buttons.
  assert.equal(resolveHostLinks({}).signInHref, null);
});

test('concatenation property: an empty prefix yields exactly the relative href', () => {
  // This is the byte-identity argument, expressed as an assertion: every
  // consumer builds `${marketingOrigin}${path}`.
  const { marketingOrigin } = resolveHostLinks({ SERVE_MARKETING: '1' });
  for (const path of ['/about', '/directory', '/explore', '/learn', '/project', '/roadmap']) {
    assert.equal(`${marketingOrigin}${path}`, path);
  }
});

test('null is never concatenated: every consumer must guard, and the value says so', () => {
  // The counterpart to the property above, and the reason the "hide" signal
  // is `null` rather than some sentinel string: `${null}${path}` produces
  // the visibly broken `null/about`, so a consumer that forgets to guard
  // fails loudly in the markup instead of silently linking somewhere wrong.
  // The four live consumers all guard on `!== null` (root layout footer,
  // Header.showMarketingNav, and two McpResponseDisplay /learn links).
  const { marketingOrigin } = resolveHostLinks({});
  assert.equal(marketingOrigin, null);
  assert.equal(`${marketingOrigin}/about`, 'null/about');
});
