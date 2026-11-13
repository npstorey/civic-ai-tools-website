// S2-B F9 and D3 (npstorey/civic-ai-tools#309): the chooser line's sentences for what an in-loop run considered,
// and its clause for a loaded pack, are bundle revision 3's words, verbatim.
//
// The bundle the installed verify-core names for this site's producer profile states, at its `:88`
// (`composition.considered`'s sentence), the two sentences that follow the chooser's in-loop sentence: the count
// and the inventory, then the rule's words (`directory-set` version 1), or, for a rule this site has no words for,
// the sentence that names it as recorded. At its `:331` (`civic:packId`'s sentence) it states the fallback a host
// uses for a pack whose inventory it does not resolve: "a pack recorded as {packId}, using {the host's name for
// the base}", with no author. `SOURCE_CHOOSER_CONSIDERED` and `SOURCE_CHOOSER_PACK`'s clause are those words.
// `SOURCE_CHOOSER_PACK.definition` is R5's sentence, the owner's D4 = A, not the bundle's, and is pinned here
// beside them.
//
// THE PIN, as `chooser-reasons-revision-3.test.ts` pins `:142`: the bundle is not installed, only its address
// and digest are, so these words are held to the digest they were read from. When an upgrade moves the
// installed digest, this test fails, and the words are read again from the new bundle.
//
// RED at tree 5b (d99f2532): `copy.ts` has neither constant.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCER_PROFILE_SUBTYPES } from '@typedstandards/verify-core';
import * as copy from './copy.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = copy as unknown as Loose;

/** The digest of the bundle these words were read from: verify-core 0.15.2's row, revision 3. */
const BUNDLE_SHA256_OF_THESE_WORDS = 'db8175703601a5de9d785a2cda93db194eb05cdeeb222dcfd509ea8ab249f016';

test('S2-B F9: the installed producer-profile bundle is the one the considered sentences and the pack clause were read from', () => {
  const row = (PRODUCER_PROFILE_SUBTYPES as Record<string, { bundle?: { url: string; sha256: string } }>)['ai-assisted-analysis/civicaitools-v1']?.bundle;
  assert.ok(row, 'premise: the installed verify-core names a bundle for ai-assisted-analysis/civicaitools-v1');
  assert.equal(row!.sha256, BUNDLE_SHA256_OF_THESE_WORDS, `the installed bundle moved (${row!.url}): read its sentences again`);
});

test('S2-B F9: the considered sentences are revision 3\'s :88, verbatim', () => {
  const W = C.SOURCE_CHOOSER_CONSIDERED as Loose | undefined;
  assert.ok(W, 'copy.ts has no SOURCE_CHOOSER_CONSIDERED');
  assert.equal(W!.shown(4, 7, 'civic', '2026-11-09.1+ed7302810ed4'), 'The model was shown 4 of the 7 sources in the source inventory civic (version 2026-11-09.1+ed7302810ed4).');
  assert.deepEqual(W!.rules, { 'directory-set': { '1': 'Those were the sources set up on the site that ran this question, less any turned off for it.' } });
  assert.equal(W!.unknownRule('R', 'V'), 'They were chosen by a rule recorded as R, version V, which this site has no words for.');
});

test('S2-B D3: the pack clause is revision 3\'s :331 fallback, and the definition is R5\'s sentence', () => {
  const P = C.SOURCE_CHOOSER_PACK as Loose | undefined;
  assert.ok(P, 'copy.ts has no SOURCE_CHOOSER_PACK');
  assert.equal(`${P!.open}{packId}${P!.using}{base}${P!.close}`, ' (a pack recorded as {packId}, using {base})');
  assert.equal(P!.definition, 'A pack is a source with no server of its own. Its requests go through the server of the source named after “using”, limited to what the pack fixes in advance, such as one dataset.');
});
