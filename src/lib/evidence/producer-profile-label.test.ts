// The record page's "Civic AI Tools profile, v1" link names the bundle's
// revision 3 (sprint S2-B, npstorey/civic-ai-tools#309, hub ADR-0038's
// amendment of 2026-11-07; revision 2 was R11 P4's, civic-ai-tools#293).
//
// `producerProfileLink` reads the bundle url from verify-core's subtype table
// row and writes none of its own, so the link follows the installed package.
// `record-page-producer-profile.test.ts` asserts that the page links to the
// row's url, whatever it is; this file asserts WHICH row is installed: the one
// verify-core 0.15.2 pins, revision 3's url and its sha256.
//
// WHAT MAKES IT ABLE TO FAIL. At verify-core 0.15.1 the row names revision 2
// (the v0.1.14-typed-standards-spec url, sha256 45bf3ab4…eb9b), and at 0.15.0
// revision 1 (v0.1.13-typed-standards-spec, 724e399e…a281); either way both
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

/** Revision 3 of the subtype's guidance bundle, as verify-core 0.15.2 pins it. */
const REVISION_3_URL =
  'https://raw.githubusercontent.com/npstorey/civic-ai-tools/v0.1.15-typed-standards-spec/docs/profiles/ai-assisted-analysis/civicaitools-v1/bundle.json';
const REVISION_3_SHA256 = 'db8175703601a5de9d785a2cda93db194eb05cdeeb222dcfd509ea8ab249f016';

const row = (PRODUCER_PROFILE_SUBTYPES as Record<string, { bundle?: { url: string; sha256: string } }>)[SUBTYPE];

test('the "Civic AI Tools profile, v1" link names revision 3 of the bundle', () => {
  const link = producerProfileLink(SUBTYPE);
  assert.ok(link, 'premise: the subtype has a linked label');
  assert.equal(link.href, REVISION_3_URL, 'the link does not name revision 3 of the bundle');
});

test("the installed subtype row pins revision 3's sha256", () => {
  assert.ok(row?.bundle, 'premise: the subtype row names a bundle');
  assert.deepEqual(
    { url: row.bundle.url, sha256: row.bundle.sha256 },
    { url: REVISION_3_URL, sha256: REVISION_3_SHA256 },
    "the row's url and sha256 are not revision 3's",
  );
});
