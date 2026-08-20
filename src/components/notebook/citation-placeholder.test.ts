// #227 / #258 — citation placeholder-URL tests. Run with: npm test
//
// Same shape as the instance-config tests: overrides are exercised
// per-process through the real site-config getter and cleaned up after each
// test. The reference-deployment direction injects the reference origin
// EXPLICITLY; the unset environment yields a SITE-RELATIVE placeholder —
// honest absence, never another deployment's origin.
//
// The PATH segment is `/records/` as of the 2026-08-19 vocabulary settlement
// (civic-ai-tools#160 P5, spec Appendix J). This is a deliberate change to the
// string, not a regression: the placeholder previews where a record WILL live
// once published, and new publishes are addressed at `/records/<slug>`. The
// prior-era `/evidence/<slug>` address stays served permanently, so citations
// already copied out of this preview keep resolving — but a preview showing an
// address the publish response no longer returns would be misleading.
//
// The environment variable read below is deliberately the PRIOR-ERA spelling
// (`EVIDENCE_SITE_ORIGIN`). P3 landed new-then-old resolution for all 14
// variables and that fallback has no drop date yet; exercising it here is what
// keeps the prior-era leg covered. The canonical `PUBLISHER_*` leg is driven by
// the config rehearsal, which unsets every prior-era twin before it runs.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildCitationPlaceholderUrl } from './citation-placeholder.ts';
import { getEvidenceSiteOrigin } from '../../lib/site-config.ts';
import { REFERENCE_SITE_ORIGIN } from '../../lib/evidence/reference-identity-fixture.ts';

afterEach(() => {
  delete process.env.EVIDENCE_SITE_ORIGIN;
});

describe('buildCitationPlaceholderUrl', () => {
  test('reference origin, explicitly injected, resolves against the declared origin', () => {
    process.env.EVIDENCE_SITE_ORIGIN = REFERENCE_SITE_ORIGIN;
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      'https://civicaitools.org/records/(URL assigned at publish)',
    );
  });

  test('unset environment yields a SITE-RELATIVE placeholder (honest absence, #258)', () => {
    assert.equal(getEvidenceSiteOrigin(), null);
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      '/records/(URL assigned at publish)',
    );
  });

  test('EVIDENCE_SITE_ORIGIN re-points the placeholder to the instance origin', () => {
    process.env.EVIDENCE_SITE_ORIGIN = 'https://evidence.example.org';
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      'https://evidence.example.org/records/(URL assigned at publish)',
    );
  });

  test('trailing slash on the configured origin never doubles the separator', () => {
    process.env.EVIDENCE_SITE_ORIGIN = 'https://evidence.example.org/';
    assert.equal(
      buildCitationPlaceholderUrl(getEvidenceSiteOrigin()),
      'https://evidence.example.org/records/(URL assigned at publish)',
    );
  });
});
