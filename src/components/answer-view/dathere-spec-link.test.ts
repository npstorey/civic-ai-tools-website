// R10 P5 fix round 1, item 4: the status row's "Typed Standards §8.7" link
// lands on §8.7, not at the top of the specification.
//
// THE DEFECT. `DATHERE_SPEC_URL` (adapt-record.ts) targeted
// `#87-content-profile-dathere`. The specification's §8.7 heading at hub main
// is, at `docs/architecture/typed-standards-specification.md:780` (read at hub
// `af8faa7`, 2026-10-30):
//
//   ### 8.7 Profile requirements: datHere and scripted-recomputation
//
// and GitHub derives a heading's anchor by lower-casing it, removing
// punctuation other than hyphens, and turning each space into a hyphen. No
// heading yields the old fragment, so the link has opened the top of the
// specification (since at least hub `c59029e`, 2026-10-18).
//
// THE INSTRUMENT. The expected fragment is hard-coded from that heading, and
// the slug rule below is checked against it, so neither half can drift alone.
// No network: the heading is cited, not fetched. A rename of §8.7 upstream is
// invisible here, which is this file's blind spot.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATHERE_SPEC_URL } from './adapt-record.ts';

/** typed-standards-specification.md:780 at hub af8faa7. */
const HEADING = '8.7 Profile requirements: datHere and scripted-recomputation';
const EXPECTED_FRAGMENT = '87-profile-requirements-dathere-and-scripted-recomputation';
const SPEC_PATH = 'https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md';

/** GitHub's heading anchor: lower-case, punctuation other than `-` removed, spaces to hyphens. */
function githubSlug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}

test('4: premise: the slug rule derives the hard-coded fragment from the cited heading', () => {
  assert.equal(githubSlug(HEADING), EXPECTED_FRAGMENT);
});

test('4: the §8.7 link targets the specification\'s §8.7 heading', () => {
  const url = new URL(DATHERE_SPEC_URL);
  assert.equal(`${url.origin}${url.pathname}`, SPEC_PATH, 'the link no longer targets the specification');
  assert.equal(url.hash.slice(1), EXPECTED_FRAGMENT, 'the link\'s fragment is not the anchor GitHub derives for §8.7, so it opens the top of the specification');
});
