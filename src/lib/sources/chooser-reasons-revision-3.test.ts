// S2-B W9 (npstorey/civic-ai-tools#309): the chooser line's load reasons are bundle revision 3's words, verbatim.
//
// The bundle the installed verify-core names for this site's producer profile
// (`PRODUCER_PROFILE_SUBTYPES['ai-assisted-analysis/civicaitools-v1'].bundle`) states, at its `:142`
// (`trace.loadSpan.loadOutcome`'s sentence), the reason the chooser sentence gives for a source requested and
// not loaded: one sentence each for declined, no-answer and unavailable. `CHOOSER_REASONS` are those three.
//
// THE PIN. The bundle is not installed, only its address and digest are. This test holds the words to the digest
// they were read from (`BUNDLE_SHA256_OF_THESE_WORDS`, copied from the installed package by script, not typed):
// when an upgrade moves the installed digest, this test fails, and the words are read again from the new bundle.
// `WHERE_IT_WENT_REASONS` stays as it is (the owner-approved eight; pinned by
// `src/components/answer-view/where-it-went-chooser.test.ts`, "fix round 1 (6)").
//
// RED at tree 3 (c90e924): `declined` reads "Ask first, so it was not used for this question."
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCER_PROFILE_SUBTYPES } from '@typedstandards/verify-core';
import { CHOOSER_REASONS } from './copy.ts';

/** The digest of the bundle these words were read from: verify-core 0.15.2's row, revision 3. */
const BUNDLE_SHA256_OF_THESE_WORDS = 'db8175703601a5de9d785a2cda93db194eb05cdeeb222dcfd509ea8ab249f016';

test('S2-B W9: the installed producer-profile bundle is the one the chooser reasons were read from', () => {
  const row = (PRODUCER_PROFILE_SUBTYPES as Record<string, { bundle?: { url: string; sha256: string } }>)['ai-assisted-analysis/civicaitools-v1']?.bundle;
  assert.ok(row, 'premise: the installed verify-core names a bundle for ai-assisted-analysis/civicaitools-v1');
  assert.equal(row!.sha256, BUNDLE_SHA256_OF_THESE_WORDS, `the installed bundle moved (${row!.url}): read its chooser reasons again`);
});

test('S2-B W9: CHOOSER_REASONS are revision 3\'s three sentences, verbatim', () => {
  assert.deepEqual({ ...CHOOSER_REASONS }, {
    declined: 'Not allowed, so it was not used for this question.',
    noAnswer: 'Not used, because the site that ran this question could not ask, or no answer arrived in time.',
    unavailable: 'Unavailable. The site that ran this question could not load it.',
  });
});
