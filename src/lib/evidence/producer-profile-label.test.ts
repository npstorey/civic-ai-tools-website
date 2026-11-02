// The record page's "Civic AI Tools profile, v1" link names the bundle's
// revision 2 (R11 P4, civic-ai-tools#293, hub ADR-0038's amendment of
// 2026-11-02).
//
// `producerProfileLink` reads the bundle url from verify-core's subtype table
// row and writes none of its own, so the link follows the installed package.
// `record-page-producer-profile.test.ts` asserts that the page links to the
// row's url, whatever it is; this file asserts WHICH row is installed: the one
// verify-core 0.15.1 pins, revision 2's url and its sha256.
//
// WHAT MAKES IT ABLE TO FAIL. At verify-core 0.15.0 the row names revision 1
// (the v0.1.13-typed-standards-spec url, sha256 724e399e…a281), and both
// assertions below fail. The two literals are the values compared and appear
// nowhere else in this repository's source.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { producerProfileLink } from './producer-profile-label.ts';
import { PRODUCER_PROFILE_SUBTYPES } from './profiles.ts';

/** The subtype, spelled out: the assertions must not lean on the constant they test. */
const SUBTYPE = 'ai-assisted-analysis/civicaitools-v1';

/** Revision 2 of the subtype's guidance bundle, as verify-core 0.15.1 pins it. */
const REVISION_2_URL =
  'https://raw.githubusercontent.com/npstorey/civic-ai-tools/v0.1.14-typed-standards-spec/docs/profiles/ai-assisted-analysis/civicaitools-v1/bundle.json';
const REVISION_2_SHA256 = '45bf3ab479325a791829ed9987f5f291fea44238b54bfb598f32f306f574eb9b';

const row = (PRODUCER_PROFILE_SUBTYPES as Record<string, { bundle?: { url: string; sha256: string } }>)[SUBTYPE];

test('the "Civic AI Tools profile, v1" link names revision 2 of the bundle', () => {
  const link = producerProfileLink(SUBTYPE);
  assert.ok(link, 'premise: the subtype has a linked label');
  assert.equal(link.href, REVISION_2_URL, 'the link does not name revision 2 of the bundle');
});

test("the installed subtype row pins revision 2's sha256", () => {
  assert.ok(row?.bundle, 'premise: the subtype row names a bundle');
  assert.deepEqual(
    { url: row.bundle.url, sha256: row.bundle.sha256 },
    { url: REVISION_2_URL, sha256: REVISION_2_SHA256 },
    "the row's url and sha256 are not revision 2's",
  );
});
