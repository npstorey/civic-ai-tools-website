// UX-2 P4b, criterion 2: the Settings overlay's search narrows the rows (item
// 17), over each source's reader name and its "what" line, and its count line
// reads item 24's words.
//
// THE FIXTURE. Thirteen sources, more than any instance configures today, so a
// search that leaves three cannot be the configured set by coincidence. The
// query "transit" matches two names and one "what" line only, so a search over
// names alone leaves two, and one over "what" alone leaves one; the match is
// case-insensitive, so "TRANSIT" reads the same; a source whose "what" line is
// null is searched by its name.
//
// WHAT MAKES IT ABLE TO FAIL. At the base `matchingSources` is a stub that
// returns every source, and `sourcesShownLine` does not exist.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingSources, type SearchableSource } from './source-search.ts';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const copy = (await import('./copy.ts')) as Mod;

const SOURCES: SearchableSource[] = [
  { sourceId: 's01', name: 'Transit Ridership', what: 'daily counts of riders' },
  { sourceId: 's02', name: 'Parks', what: 'public parks and their hours' },
  { sourceId: 's03', name: 'Housing Court', what: 'eviction filings' },
  { sourceId: 's04', name: 'Street Trees', what: 'a census of street trees' },
  { sourceId: 's05', name: 'Bus Lanes', what: 'where the city runs transit priority lanes' },
  { sourceId: 's06', name: 'Libraries', what: null },
  { sourceId: 's07', name: 'School Meals', what: 'meals served by school' },
  { sourceId: 's08', name: 'Transit Fares', what: 'fare changes by year' },
  { sourceId: 's09', name: 'Permits', what: 'building permits issued' },
  { sourceId: 's10', name: 'Noise', what: 'noise complaints' },
  { sourceId: 's11', name: 'Budget', what: 'the adopted budget' },
  { sourceId: 's12', name: 'Elections', what: 'results by district' },
  { sourceId: 's13', name: 'Water', what: 'reservoir levels' },
];

test('premise: the fixture holds thirteen sources', () => {
  assert.equal(SOURCES.length, 13);
});

test('UX-2 P4b criterion 2: a query that leaves three sources, by name and by "what" line', () => {
  assert.deepEqual(matchingSources(SOURCES, 'transit').map((s) => s.sourceId), ['s01', 's05', 's08']);
});

test('UX-2 P4b criterion 2: the match is case-insensitive and ignores surrounding spaces', () => {
  assert.deepEqual(matchingSources(SOURCES, '  TRANSIT ').map((s) => s.sourceId), ['s01', 's05', 's08']);
});

test('UX-2 P4b criterion 2: a source with no "what" line is searched by its name', () => {
  assert.deepEqual(matchingSources(SOURCES, 'librar').map((s) => s.sourceId), ['s06']);
});

test('UX-2 P4b criterion 2: an empty query leaves every source, and a query matching nothing leaves none', () => {
  assert.equal(matchingSources(SOURCES, '').length, 13);
  assert.deepEqual(matchingSources(SOURCES, 'no-source-is-called-this'), []);
});

test('UX-2 P4b criterion 2: the count line reads item 24\'s words, "N of M sources shown"', () => {
  assert.equal(typeof copy.sourcesShownLine, 'function', 'copy.ts exports no sourcesShownLine');
  const shown = matchingSources(SOURCES, 'transit').length;
  assert.equal(copy.sourcesShownLine(shown, SOURCES.length), '3 of 13 sources shown');
});
