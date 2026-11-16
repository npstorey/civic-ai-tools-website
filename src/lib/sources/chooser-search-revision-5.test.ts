// S3-B W2 (npstorey/civic-ai-tools#318; W2-7, O9): the site's words for a search, and its corrected system-prompt
// sentence, are bundle revision 5's, verbatim, pinned to the digest the installed verify-core names for this site's
// producer profile, as `chooser-considered-revision-4.test.ts` pins revision 4's.
//
// THE WORDS, by the bundle's line (hub `docs/profiles/ai-assisted-analysis/civicaitools-v1/bundle.json` at the tag
// `v0.1.17-typed-standards-spec`, sha256 9946c58f…23d5):
//   - `skillMetadata.skillText` (:448): "The model was given {count} system prompts during this question. This section
//     describes the last one." It replaces revision 4's "as it loaded data sources" (U2): a search whose hits add a
//     source recomposes the prompt with no load.
//   - `composition.considered` (:106): "was first shown" in place of "was shown" on a record whose trace holds a search
//     that returned a source.
//   - `trace.searchSpan.searchQuery` (:205), `.searchHits` (:214), `.operationType` (:187), `.searchOutcome` (:196): a
//     search's words, one call at a time, after the considered sentences (`composition.routing`, :88).
// The site sets the query off with “ ” and closes the query's sentence with a period, which the bundle's "set off as a
// quotation" leaves to the host.
//
// RED at 2d649c4: the installed bundle is revision 4's, `manyPrompts` says "as it loaded data sources", and the chooser
// has no words for a search.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCER_PROFILE_SUBTYPES } from '@typedstandards/verify-core';
import * as copy from './copy.ts';
import { chooserFromPackage, chooserLines } from '../flows/source-chooser.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = copy as unknown as Loose;

/** The digest of the bundle these words were read from: verify-core 0.15.4's row, revision 5. */
const BUNDLE_SHA256_OF_THESE_WORDS = '9946c58f2a4e800388b10f31a43a099c5a1d97b4f5084dbbff8351480d9223d5';

test('S3-B W2: the installed producer-profile bundle is the one the search words were read from', () => {
  const row = (PRODUCER_PROFILE_SUBTYPES as Record<string, { bundle?: { url: string; sha256: string } }>)['ai-assisted-analysis/civicaitools-v1']?.bundle;
  assert.ok(row, 'premise: the installed verify-core names a bundle for ai-assisted-analysis/civicaitools-v1');
  assert.equal(row!.sha256, BUNDLE_SHA256_OF_THESE_WORDS, `the installed bundle moved (${row!.url}): read its sentences again`);
});

test('S3-B W2 (U2): the system-prompt count sentence is revision 5\'s skillText sentence, verbatim', () => {
  assert.equal(copy.SYSTEM_PROMPT_TEXT.manyPrompts(3), 'The model was given 3 system prompts during this question. This section describes the last one.');
});

test('S3-B W2: the search words are revision 5\'s, verbatim', () => {
  const S = C.SOURCE_CHOOSER_SEARCH as Loose | undefined;
  assert.ok(S, 'copy.ts has no SOURCE_CHOOSER_SEARCH');
  assert.equal(S!.searched('q'), 'The model searched for sources, using the words: “q”');
  assert.equal(S!.searchedEmpty, 'The model searched for sources with no search words.');
  assert.equal(S!.hits(['A', 'B']), 'The search returned 2 sources. They are listed in the search\'s order, its best match first: A; B.');
  assert.equal(S!.hits(['A']), 'The search returned one source: A.');
  assert.equal(S!.hits([]), 'The search returned no sources.');
  assert.equal(S!.bySite, 'The site that ran this question did the search itself. It did not send the search to any source.');
  assert.equal(S!.limited('q'), 'The model asked for another search, using the words: “q”');
  assert.equal(S!.limitedEmpty, 'The model asked for another search, with no search words.');
  assert.equal(S!.limitReached, 'The site that ran this question did not run this search. It had already run two searches for this question, which was its limit.');
  assert.equal(C.SOURCE_CHOOSER_CONSIDERED.firstShown(2, 7, 'civic', 'v'), 'The model was first shown 2 of the 7 sources in the source inventory civic (version v).');
});

// --- The chooser line over a record with a search ----------------------------------------------------------------------

const span = (name: string, attributes: Record<string, string>, parentSpanId?: string) => ({
  name, ...(parentSpanId ? { parentSpanId } : {}),
  attributes: Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: value } })),
});

function record(searchHits: string): unknown {
  return {
    extensions: {
      'org.civicaitools.composition': {
        routing: { method: 'in-loop', version: '0.10.0' },
        sourcesOffered: [
          { sourceId: 'socrata', alias: 'socrata', reason: 'configured' },
          { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'configured' },
        ],
        considered: { inventory: { id: 'civic', version: 'v', hash: 'h' }, total: 7, listed: 1, rule: 'test-listed-subset', ruleVersion: '1' },
      },
    },
    trace: { resourceSpans: [{ scopeSpans: [{ spans: [
      span('analysis', {}),
      span('mcp_tool_call', { 'tool.name': 'find_source', 'tool.operation_type': 'find_source', 'tool.arguments': '{"query":"notices"}', 'tool.search_query': 'notices', 'tool.search_outcome': 'searched', 'tool.search_hits': searchHits }, 'root'),
      span('mcp_tool_call', { 'tool.name': 'find_source', 'tool.operation_type': 'find_source', 'tool.arguments': '{}', 'tool.search_query': '', 'tool.search_outcome': 'limit-reached' }, 'root'),
      span('mcp_tool_call', { 'tool.name': 'load_source', 'tool.operation_type': 'load_source', 'tool.arguments': '{"alias":"nyc_record"}', 'tool.load_outcome': 'loaded' }, 'root'),
    ] }] }] },
  };
}

test('S3-B W2-7: the chooser line states each search after the considered sentences, and "was first shown" when a search returned a source', () => {
  const text = chooserLines(chooserFromPackage(record('["nyc-record"]'))).map((line) => line.text).join('\n');
  assert.ok(text.includes('The model was first shown 1 of the 7 sources in the source inventory civic (version v).'), text);
  assert.ok(text.includes('They were chosen by a rule recorded as test-listed-subset, version 1, which this site has no words for.'), text);
  assert.ok(!text.includes('Those were the sources set up on the site'), 'the test rule is read as directory-set');
  assert.ok(text.includes('The model searched for sources, using the words: “notices”. The search returned one source: NYC City Record. The site that ran this question did the search itself. It did not send the search to any source.'), text);
  assert.ok(text.includes('The model asked for another search, with no search words. The site that ran this question did not run this search. It had already run two searches for this question, which was its limit.'), text);
  assert.ok(text.indexOf('first shown') < text.indexOf('The model searched'), 'the search words do not follow the considered sentences');
  assert.ok(text.indexOf('The model searched') < text.indexOf('Loaded:'), 'the search words do not come before the groups');
});

test('S3-B W2-7: a search that returned no source keeps "was shown"', () => {
  const text = chooserLines(chooserFromPackage(record('[]'))).map((line) => line.text).join('\n');
  assert.ok(text.includes('The model was shown 1 of the 7'), text);
  assert.ok(text.includes('The search returned no sources.'), text);
});
