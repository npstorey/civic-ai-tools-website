// S3-B W1 (npstorey/civic-ai-tools#318; B8, B9, B13; the owner's W0 rulings D7 = B and D9 = A): the record's words for
// a run whose sources the reader picked.
//
// THE WORDS:
//   - `reader-picked` version 1, bundle revision 5 `composition.considered` (:106), verbatim, pinned to the digest the
//     installed verify-core names for this site's producer profile, as `chooser-search-revision-5.test.ts` pins the
//     search's: "The person who asked this question picked those sources. A picked source was left out if it was
//     turned off, or not set up on the site that ran this question."
//   - S11, "Where this question went" for `not-selected`: "Not picked for this question."
//   - D7 = B, `not-configured` there: "Not set up on the site that ran this question."
//   - S10, the refusal of a question none of whose picks could be used.
//
// RED at 15a52942: the chooser names `reader-picked` as a rule it has no words for, `not-selected` has no words in
// "Where this question went", `notSetUp` reads "Not set up on this site.", and no stream kind carries S10.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCER_PROFILE_SUBTYPES } from '@typedstandards/verify-core';
import * as copy from './copy.ts';
import * as streaming from '../streaming.ts';
import { chooserFromPackage, chooserLines } from '../flows/source-chooser.ts';
import { whereItWentFromCalls } from '../flows/where-it-went.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = copy as unknown as Loose;

/** Bundle revision 5's digest (hub `docs/profiles/ai-assisted-analysis/civicaitools-v1/bundle.json` at `15de084`). */
const BUNDLE_SHA256_OF_THESE_WORDS = '9946c58f2a4e800388b10f31a43a099c5a1d97b4f5084dbbff8351480d9223d5';
const READER_PICKED_1 = 'The person who asked this question picked those sources. A picked source was left out if it was turned off, or not set up on the site that ran this question.';

test('S3-B W1: the installed producer-profile bundle is the one the reader-picked words were read from', () => {
  const row = (PRODUCER_PROFILE_SUBTYPES as Record<string, { bundle?: { url: string; sha256: string } }>)['ai-assisted-analysis/civicaitools-v1']?.bundle;
  assert.ok(row, 'premise: the installed verify-core names a bundle for ai-assisted-analysis/civicaitools-v1');
  assert.equal(row!.sha256, BUNDLE_SHA256_OF_THESE_WORDS, `the installed bundle moved (${row!.url}): read its sentences again`);
});

test('S3-B W1 (B9): reader-picked version 1 is revision 5\'s sentence, verbatim', () => {
  assert.equal(C.SOURCE_CHOOSER_CONSIDERED.rules['reader-picked']?.['1'], READER_PICKED_1);
  // directory-set's words are unchanged.
  assert.equal(C.SOURCE_CHOOSER_CONSIDERED.rules['directory-set']['1'], 'Those were the sources set up on the site that ran this question, less any turned off for it.');
});

test('S3-B W1 (B9): a picked record\'s chooser names the reader\'s choice; a version this site has no words for is named as recorded', () => {
  const pkg = (version: string) => ({
    extensions: {
      'org.civicaitools.composition': {
        routing: { method: 'in-loop', version: '0.10.0' },
        sourcesOffered: [
          { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
          { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-selected' },
        ],
        considered: { inventory: { id: 'civic', version: 'v', hash: 'a'.repeat(64) }, total: 7, listed: 1, rule: 'reader-picked', ruleVersion: version },
      },
    },
    trace: { resourceSpans: [] },
  });
  const one = chooserLines(chooserFromPackage(pkg('1'))).map((line) => line.text).join('\n');
  assert.ok(one.includes(`The model was shown 1 of the 7 sources in the source inventory civic (version v). ${READER_PICKED_1}`), one);
  assert.ok(!one.includes('Data Commons'), `the chooser names the unpicked source: ${one}`);
  const two = chooserLines(chooserFromPackage(pkg('2'))).map((line) => line.text).join('\n');
  assert.ok(two.includes('They were chosen by a rule recorded as reader-picked, version 2, which this site has no words for.'), two);
});

test('S3-B W1 (B8, S11; D7 = B): "Where this question went" words not-selected and not-configured', () => {
  assert.equal(C.WHERE_IT_WENT_REASONS.notPicked, 'Not picked for this question.');
  assert.equal(C.WHERE_IT_WENT_REASONS.notSetUp, 'Not set up on the site that ran this question.');
  const model = whereItWentFromCalls({
    toolCalls: [],
    resolveSource: () => undefined,
    sourcesOffered: [
      { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-selected' },
      { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
      { sourceId: 'nyc-checkbook', alias: 'nyc_checkbook', reason: 'reader-off' },
      { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'not-consented' },
    ],
    statement: null,
    model: 'fixture',
    service: 'fixture',
  } as never) as { notReached: Array<{ sourceId: string; whyNotSent: string }> };
  assert.deepEqual(Object.fromEntries(model.notReached.map((row) => [row.sourceId, row.whyNotSent])), {
    'data-commons': 'Not picked for this question.',
    'boston-opencontext': 'Not set up on the site that ran this question.',
    // Moved by S4 W2b (C3-O = B): S125[5] and S125[6].
    'nyc-checkbook': 'Disabled.',
    'nyc-record': 'Not enabled: not asked for this question.',
  });
});

test('S3-B W1 (S10): a question none of whose picks could be used is refused in its own words, a stream kind of its own', () => {
  const kinds = (streaming as unknown as Loose).STREAM_ERROR_KINDS as readonly string[];
  assert.ok(kinds.includes('no_picks_usable'), 'no_picks_usable is not a stream error kind');
  assert.equal(streaming.friendlyStreamError({ code: 'no_picks_usable' }), 'None of the data sources you picked could be used, so nothing was sent. Pick again, or choose Auto.');
});
