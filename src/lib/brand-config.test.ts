import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  DEMO_BRAND_NAME,
  DEMO_BRAND_TAGLINE,
  getBrandName,
  getBrandTagline,
  getBrandAttribution,
  getBrandAccent,
  parseBrandAccent,
} from './brand-config.ts';

const BRAND_VARS = [
  'SITE_BRAND_NAME',
  'SITE_BRAND_ACCENT',
  'SITE_BRAND_TAGLINE',
  'SITE_BRAND_ATTRIBUTION',
];

afterEach(() => {
  for (const v of BRAND_VARS) delete process.env[v];
});

describe('brand-config getters (call-time env, demo defaults)', () => {
  test('unset environment yields the demo chrome values (byte-parity bar)', () => {
    assert.equal(getBrandName(), DEMO_BRAND_NAME);
    assert.equal(getBrandName(), 'Civic AI Tools');
    assert.equal(getBrandTagline(), DEMO_BRAND_TAGLINE);
    assert.equal(getBrandAttribution(), null);
    assert.equal(getBrandAccent(), null);
  });

  test('set variables override at call time, not module load', () => {
    process.env.SITE_BRAND_NAME = 'Alt City Data';
    process.env.SITE_BRAND_TAGLINE = 'Open data for Alt City';
    process.env.SITE_BRAND_ATTRIBUTION = 'Run by the Alt City data office.';
    assert.equal(getBrandName(), 'Alt City Data');
    assert.equal(getBrandTagline(), 'Open data for Alt City');
    assert.equal(getBrandAttribution(), 'Run by the Alt City data office.');
  });

  test('empty strings fall back to the defaults, matching site-config.ts', () => {
    process.env.SITE_BRAND_NAME = '';
    process.env.SITE_BRAND_ATTRIBUTION = '';
    assert.equal(getBrandName(), DEMO_BRAND_NAME);
    assert.equal(getBrandAttribution(), null);
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
