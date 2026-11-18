// CKAN-2-WEB P1b (OA-1043, M1 = A and M2 = A): the CKAN source's description line is the owner's ruled words.
// CKAN-2-WEB P2 (OA-1043, M1 = A and M3 = A): the whole ruled line, M1's third sentence and M3's sentence after P1b's
// two. The surfaces' renders are pinned in `src/components/sources/ckan-words-rendered.test.ts`.
//
// `SOURCE_DESCRIPTIONS['ckan-server'].what` is the line the source picker prints under CKAN when a search finds it
// and this site has not set it up ("Not set up on this site"), and, where CKAN is set up, on its row, in Settings, on
// the privacy page and on the pause card. It is stored lower-case first (`SourceDescription.what`): the panel
// upper-cases its first letter, and the privacy page prints it as stored.
//
// The ruled line is the four sentences below. The two P1b replaced said the source holds no data of its own and that
// each CKAN portal is a separate source with its own setting; neither is part of the ruled words.
//
// WHAT MAKES IT ABLE TO FAIL. At `cc16f525` the line began with P1b's two sentences and went on with the two
// replaced ones; at `c451a735` (P2's base) it is P1b's two alone. The equality fails at both. A line that kept either
// replaced sentence fails an absence assertion even if the equality were loosened.
//
// BLIND SPOTS, stated. This test reads the stored line, not a rendered surface: the upper-casing and where the line
// prints are the surfaces' own tests' to pin. It does not read the served bundle on any deployment.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_DESCRIPTIONS } from './copy.ts';

const RULED = 'an open-source platform for open-data portals. Many governments publish their data on CKAN portals. Universities and other groups run CKAN portals too. The AI model chooses the portal for each request, and the record names each portal.';

test('the CKAN source\'s description line is the ruled four sentences, byte for byte (OA-1043, M1 = A and M3 = A)', () => {
  const what = SOURCE_DESCRIPTIONS['ckan-server']?.what;
  assert.equal(what, RULED);
  assert.ok(!what.includes('no data of its own'), `the CKAN line still says the source has no data of its own: ${what}`);
  assert.ok(!what.includes('separate source'), `the CKAN line still says each portal is a separate source: ${what}`);
});
