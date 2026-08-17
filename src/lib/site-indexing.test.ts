// Tests for site indexing posture (`SITE_NOINDEX`; #258 finding E1).
//
// Env-injection idiom throughout — never via .env files — matching
// host-routing.test.ts's fixtures.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNoindexConfigured,
  resolveRobotsMetadata,
  resolveRobotsRules,
} from './site-indexing.ts';

// --- isNoindexConfigured -----------------------------------------------------

test('isNoindexConfigured: unset is false (indexable — the standard web default)', () => {
  assert.equal(isNoindexConfigured({}), false);
});

test('isNoindexConfigured: empty string is false', () => {
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: '' }), false);
});

test('isNoindexConfigured: whitespace-only is false', () => {
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: '   ' }), false);
});

test('isNoindexConfigured: "1" is true', () => {
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: '1' }), true);
});

test('isNoindexConfigured: "true" (any case, trimmed) is true', () => {
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: 'true' }), true);
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: 'TRUE' }), true);
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: '  true  ' }), true);
});

test('isNoindexConfigured: any other value is false, matching parseBooleanFlag', () => {
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: '0' }), false);
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: 'false' }), false);
  assert.equal(isNoindexConfigured({ SITE_NOINDEX: 'yes' }), false);
});

// --- resolveRobotsRules (src/app/robots.ts) ---------------------------------

test('resolveRobotsRules: unset -> Allow: / (no disallow)', () => {
  assert.deepEqual(resolveRobotsRules({}), {
    rules: { userAgent: '*', allow: '/' },
  });
});

test('resolveRobotsRules: whitespace-only -> Allow: / (absent, not a misconfiguration)', () => {
  assert.deepEqual(resolveRobotsRules({ SITE_NOINDEX: '  ' }), {
    rules: { userAgent: '*', allow: '/' },
  });
});

test('resolveRobotsRules: SITE_NOINDEX=1 -> Disallow: /', () => {
  assert.deepEqual(resolveRobotsRules({ SITE_NOINDEX: '1' }), {
    rules: { userAgent: '*', disallow: '/' },
  });
});

// --- resolveRobotsMetadata (src/app/layout.tsx <head> metadata) ------------

test('resolveRobotsMetadata: unset -> undefined (the robots entry is omitted, not defaulted)', () => {
  assert.equal(resolveRobotsMetadata({}), undefined);
});

test('resolveRobotsMetadata: whitespace-only -> undefined', () => {
  assert.equal(resolveRobotsMetadata({ SITE_NOINDEX: ' ' }), undefined);
});

test('resolveRobotsMetadata: SITE_NOINDEX=true -> index:false, follow:false', () => {
  assert.deepEqual(resolveRobotsMetadata({ SITE_NOINDEX: 'true' }), {
    index: false,
    follow: false,
  });
});

// --- robots.txt and <head> metadata never disagree --------------------------

test('the two surfaces agree for every SITE_NOINDEX value: metadata is present iff robots.txt disallows', () => {
  for (const raw of [undefined, '', '   ', '1', 'true', 'TRUE', '0', 'false', 'yes']) {
    const env = raw === undefined ? {} : { SITE_NOINDEX: raw };
    const rules = resolveRobotsRules(env);
    const metadata = resolveRobotsMetadata(env);
    const blocksInRobotsTxt = 'disallow' in rules.rules;
    assert.equal(
      blocksInRobotsTxt,
      metadata !== undefined,
      `disagreement for SITE_NOINDEX=${JSON.stringify(raw)}`,
    );
  }
});
