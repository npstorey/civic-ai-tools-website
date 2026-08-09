// #227 — citation placeholder-URL tests. Run with: npm test
//
// Same shape as the brand-config / instance-config tests: the unset
// environment is the byte-compat oracle (the demo default must reproduce the
// historical hardcoded string exactly), overrides are exercised per-process
// through the real site-config getter and cleaned up after each test.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildCitationPlaceholderUrl } from './citation-placeholder.ts';
import { DEMO_SITE_ORIGIN, getEvidenceSiteOrigin } from '../../lib/site-config.ts';

afterEach(() => {
  delete process.env.EVIDENCE_SITE_ORIGIN;
});

describe('buildCitationPlaceholderUrl', () => {
  test('demo origin reproduces the historical hardcoded string (byte-parity bar)', () => {
    assert.equal(
      buildCitationPlaceholderUrl(DEMO_SITE_ORIGIN),
      'https://civicaitools.org/evidence/(URL assigned at publish)',
    );
  });

  test('unset environment resolves to the same bytes through the getter', () => {
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      'https://civicaitools.org/evidence/(URL assigned at publish)',
    );
  });

  test('EVIDENCE_SITE_ORIGIN re-points the placeholder to the instance origin', () => {
    process.env.EVIDENCE_SITE_ORIGIN = 'https://evidence.example.org';
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      'https://evidence.example.org/evidence/(URL assigned at publish)',
    );
  });

  test('trailing slash on the configured origin never doubles the separator', () => {
    process.env.EVIDENCE_SITE_ORIGIN = 'https://evidence.example.org/';
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      'https://evidence.example.org/evidence/(URL assigned at publish)',
    );
  });
});
