// #227 / #258 — citation placeholder-URL tests. Run with: npm test
//
// Same shape as the instance-config tests: overrides are exercised
// per-process through the real site-config getter and cleaned up after each
// test. The reference-deployment direction injects the reference origin
// EXPLICITLY (the byte-parity proof); the unset environment now yields a
// SITE-RELATIVE placeholder — honest absence, never another deployment's
// origin.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildCitationPlaceholderUrl } from './citation-placeholder.ts';
import { getEvidenceSiteOrigin } from '../../lib/site-config.ts';
import { REFERENCE_SITE_ORIGIN } from '../../lib/evidence/reference-identity-fixture.ts';

afterEach(() => {
  delete process.env.EVIDENCE_SITE_ORIGIN;
});

describe('buildCitationPlaceholderUrl', () => {
  test('reference origin, explicitly injected, reproduces the historical string (byte-parity bar)', () => {
    process.env.EVIDENCE_SITE_ORIGIN = REFERENCE_SITE_ORIGIN;
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      'https://civicaitools.org/evidence/(URL assigned at publish)',
    );
  });

  test('unset environment yields a SITE-RELATIVE placeholder (honest absence, #258)', () => {
    assert.equal(getEvidenceSiteOrigin(), null);
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      '/evidence/(URL assigned at publish)',
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
