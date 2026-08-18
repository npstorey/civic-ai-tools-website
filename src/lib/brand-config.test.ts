import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  UNNAMED_WORDMARK,
  getBrandName,
  getBrandRepoUrl,
  getBrandTagline,
  getBrandAttribution,
  getBrandAccent,
  pageTitle,
  parseBrandAccent,
} from './brand-config.ts';

const BRAND_VARS = [
  'SITE_BRAND_NAME',
  'SITE_BRAND_ACCENT',
  'SITE_BRAND_TAGLINE',
  'SITE_BRAND_ATTRIBUTION',
  'SITE_BRAND_REPO_URL',
];

afterEach(() => {
  for (const v of BRAND_VARS) delete process.env[v];
});

describe('brand-config getters (call-time env; unset names nobody)', () => {
  // #259 P4 (A3) replaced the old byte-parity bar. These getters used to
  // answer with the reference deployment's own strings when unset, which was
  // defensible while the marketing face and the app were one deployment and
  // stopped being defensible the moment an unconfigured instance served the
  // APP surface. Every nameable value is now null-when-unset, and the
  // consumers omit rather than substitute.
  test('unset environment names nobody at all', () => {
    assert.equal(getBrandName(), null);
    assert.equal(getBrandTagline(), null);
    assert.equal(getBrandAttribution(), null);
    assert.equal(getBrandRepoUrl(), null);
    assert.equal(getBrandAccent(), null);
  });

  test('no getter can return the reference deployment\'s chrome from an empty env', () => {
    for (const getter of [getBrandName, getBrandTagline, getBrandAttribution, getBrandRepoUrl]) {
      const value = getter();
      assert.equal(value, null, `${getter.name} answered ${JSON.stringify(value)} with nothing set`);
    }
  });

  test('set variables override at call time, not module load', () => {
    process.env.SITE_BRAND_NAME = 'Alt City Data';
    process.env.SITE_BRAND_TAGLINE = 'Open data for Alt City';
    process.env.SITE_BRAND_ATTRIBUTION = 'Run by the Alt City data office.';
    process.env.SITE_BRAND_REPO_URL = 'https://example.org/alt-city/data-site';
    assert.equal(getBrandName(), 'Alt City Data');
    assert.equal(getBrandTagline(), 'Open data for Alt City');
    assert.equal(getBrandAttribution(), 'Run by the Alt City data office.');
    assert.equal(getBrandRepoUrl(), 'https://example.org/alt-city/data-site');
  });

  test('empty strings read as unset, matching site-config.ts', () => {
    process.env.SITE_BRAND_NAME = '';
    process.env.SITE_BRAND_TAGLINE = '';
    process.env.SITE_BRAND_ATTRIBUTION = '';
    process.env.SITE_BRAND_REPO_URL = '';
    assert.equal(getBrandName(), null);
    assert.equal(getBrandTagline(), null);
    assert.equal(getBrandAttribution(), null);
    assert.equal(getBrandRepoUrl(), null);
  });
});

describe('pageTitle (the one place the unnamed case is spelled)', () => {
  test('named instance: the exact strings the pages produced before', () => {
    process.env.SITE_BRAND_NAME = 'Civic AI Tools';
    assert.equal(pageTitle('Ask'), 'Ask - Civic AI Tools');
    assert.equal(pageTitle('Data Flow', '|'), 'Data Flow | Civic AI Tools');
  });

  test('unnamed instance: the page name alone, never the word "null"', () => {
    assert.equal(pageTitle('Ask'), 'Ask');
    assert.equal(pageTitle('Data Flow', '|'), 'Data Flow');
    assert.ok(!pageTitle('Dashboard').includes('null'));
  });

  test('the wordmark fallback is a navigation label, not a name', () => {
    // The header wordmark is the one consumer with no honest empty
    // rendering — a link needs a label. It must not be anyone's brand.
    assert.equal(UNNAMED_WORDMARK, 'Home');
  });
});

describe('parseBrandAccent', () => {
  test('six-digit hex: normalizes and derives the family', () => {
    const a = parseBrandAccent('#0A7A3D');
    assert.ok(a);
    assert.equal(a.accent, '#0a7a3d');
    assert.equal(a.accentRgb, '10, 122, 61');
    // Derivations: hover = channel × 0.6; light = channel × 0.25 + 255 × 0.75.
    assert.equal(a.accentHover, '#064925'); // 6, 73, 37
    assert.equal(a.accentLight, '#c2decf'); // 194, 222, 207
  });

  test('three-digit hex expands', () => {
    const a = parseBrandAccent('#f80');
    assert.ok(a);
    assert.equal(a.accent, '#ff8800');
    assert.equal(a.accentRgb, '255, 136, 0');
  });

  test('whitespace is tolerated; case is normalized', () => {
    const a = parseBrandAccent('  #103FEF  ');
    assert.ok(a);
    assert.equal(a.accent, '#103fef');
    assert.equal(a.accentRgb, '16, 63, 239');
  });

  test('invalid values return null — degrade to stylesheet defaults, never emit garbage', () => {
    for (const bad of [
      undefined,
      '',
      'blue',
      '103FEF',
      '#103FE',
      '#103FEF0',
      '#gggggg',
      'rgb(16, 63, 239)',
      'url(javascript:alert(1))',
    ]) {
      assert.equal(parseBrandAccent(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  test('getBrandAccent reads SITE_BRAND_ACCENT and rejects invalid values', () => {
    process.env.SITE_BRAND_ACCENT = '#0a7a3d';
    assert.deepEqual(getBrandAccent(), parseBrandAccent('#0a7a3d'));
    process.env.SITE_BRAND_ACCENT = 'not-a-color';
    assert.equal(getBrandAccent(), null);
  });
});
