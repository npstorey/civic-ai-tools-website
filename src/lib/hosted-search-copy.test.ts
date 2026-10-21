// #617 P4 criterion 4, b2 — a search of NYC Charter, Laws and Rules is
// narrated as what it finds: sections of law, not datasets, and not a catalog.
//
// The step copy for kind `search` was written when every search found
// datasets (Socrata's `search`, CKAN's) or statistical indicators (Data
// Commons' `search_indicators`). Charter's `search` derives the same kind
// (`search` is Socrata's row, read by upstream name), so without b2 a Charter
// search reads "Searching the catalog for datasets about …". The `reason`
// line is written into both notebooks, which a record package carries, so the
// false copy would be signed.
//
// b2: the copy resolves the call's SOURCE through the dispatch map (the
// exposed name `nyc_charter__search` names it), not the upstream name the two
// sources share. A bare `search` is Socrata's, as it was before Charter
// existed: every record that carries one predates Charter.
//
// WHAT IS ASSERTED, for one Charter search with a query, and for each line
// that takes the call's name (progress, result, reason, narrative, breadcrumb,
// and `searchSubject` itself): no line says "catalog" or "dataset", and each
// that names a subject names sections of law. And the same lines for Socrata,
// Data Commons and Boston are pinned byte for byte to what they were at
// 0fd882a, so b2 moves no existing reader's copy.
//
// THE TWO LINES KEYED BY THE OPERATION TYPE ALONE. The badge tooltip
// (`tool-badges.ts`) and the educational annotation (`getEducationalAnnotation`)
// are looked up by kind, and their callers pass no tool name, so they cannot
// resolve a source. They are rewritten in words true of every source's search
// (Socrata's catalog, Data Commons' indicators, Boston's datasets, the
// Charter's sections of law, whose hits carry text), and pinned below. The
// breadcrumb's no-query line names the source when the record carries a name,
// and says only "Search" when it does not.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/hosted-search-copy.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OP_BADGE_TOOLTIPS } from '../components/tool-badges.ts';
import {
  buildBreadcrumbLabel,
  getEducationalAnnotation,
  buildNarrativeSummary,
  formatToolProgress,
  formatToolResult,
  generateToolReason,
  searchSubject,
} from './streaming.ts';

const QUERY = 'rent stabilization';
const ARGS = { query: QUERY };
const FALSE_SUBJECT = /catalog|dataset/i;

function charterLines(name: string): Array<[string, string]> {
  return [
    ['formatToolProgress', formatToolProgress(name, ARGS)],
    ['formatToolResult (3 rows)', formatToolResult(ARGS, { rows: 3, columns: 1 }, name) ?? ''],
    ['formatToolResult (1 row)', formatToolResult(ARGS, { rows: 1, columns: 1 }, name) ?? ''],
    ['generateToolReason', generateToolReason(ARGS, name)],
    ['generateToolReason (no query)', generateToolReason({}, name)],
    ['buildNarrativeSummary', buildNarrativeSummary([{ name, args: ARGS }])],
    ['buildBreadcrumbLabel (no query)', buildBreadcrumbLabel({ name, args: {} })],
    ['searchSubject', JSON.stringify(searchSubject(name))],
  ];
}

test('b2: a Charter search\'s lines say neither "catalog" nor "dataset"', () => {
  for (const [fn, line] of charterLines('nyc_charter__search')) {
    assert.doesNotMatch(line, FALSE_SUBJECT, `${fn}: ${line}`);
  }
});

test('b2: a Charter search\'s lines name sections of law', () => {
  assert.deepEqual(
    { singular: searchSubject('nyc_charter__search').singular, plural: searchSubject('nyc_charter__search').plural },
    { singular: 'section of law', plural: 'sections of law' },
  );
  for (const [fn, line] of charterLines('nyc_charter__search')) {
    if (fn.startsWith('searchSubject')) continue;
    assert.match(line, /section/, `${fn} names no section: ${line}`);
  }
  assert.match(formatToolProgress('nyc_charter__search', ARGS), new RegExp(`"${QUERY}"`), 'the progress line lost the query');
});

test('b2: the same lines for the three pre-existing sources are byte-identical to 0fd882a', () => {
  // Pinned from website 0fd882a, the base of #617 P4.
  const PINNED: Record<string, string[]> = {
    socrata__search: [
      'Searching the catalog for datasets about "rent stabilization"',
      'Found 3 datasets matching the search',
      'Found 1 dataset matching the search',
      'to find datasets about "rent stabilization"',
      'to search for relevant datasets',
      'The AI searched for datasets about "rent stabilization".',
      'Search catalog',
      '{"singular":"dataset","plural":"datasets"}',
    ],
    search: [
      'Searching the catalog for datasets about "rent stabilization"',
      'Found 3 datasets matching the search',
      'Found 1 dataset matching the search',
      'to find datasets about "rent stabilization"',
      'to search for relevant datasets',
      'The AI searched for datasets about "rent stabilization".',
      'Search catalog',
      '{"singular":"dataset","plural":"datasets"}',
    ],
    data_commons__search_indicators: [
      'Searching the catalog for statistical indicators about "rent stabilization"',
      'Found 3 statistical indicators matching the search',
      'Found 1 statistical indicator matching the search',
      'to find statistical indicators about "rent stabilization"',
      'to search for relevant statistical indicators',
      'The AI searched for statistical indicators about "rent stabilization".',
      'Search catalog',
      '{"singular":"statistical indicator","plural":"statistical indicators"}',
    ],
    boston__ckan__search_datasets: [
      'Searching the catalog for datasets about "rent stabilization"',
      'Found 3 datasets matching the search',
      'Found 1 dataset matching the search',
      'to find datasets about "rent stabilization"',
      'to search for relevant datasets',
      'The AI searched for datasets about "rent stabilization".',
      'Search catalog',
      '{"singular":"dataset","plural":"datasets"}',
    ],
  };
  for (const [name, expected] of Object.entries(PINNED)) {
    const lines = charterLines(name).map(([, line]) => line);
    const subject = searchSubject(name);
    lines[lines.length - 1] = JSON.stringify({ singular: subject.singular, plural: subject.plural });
    assert.deepEqual(lines, expected, name);
  }
});

test('b2: the tooltip and the annotation for kind search are true of every source\'s search, pinned', () => {
  const tooltip = OP_BADGE_TOOLTIPS.search;
  const annotation = getEducationalAnnotation('tool_start', 'search') ?? '';
  assert.equal(tooltip, 'Searching a source for what it holds on this topic');
  assert.equal(annotation, 'The AI is searching a source for what it holds on this topic, to decide what to look at next.');
  for (const line of [tooltip, annotation]) {
    assert.doesNotMatch(line, FALSE_SUBJECT, line);
    assert.doesNotMatch(line, /before (any of it is read|reading)/, `${line}: a Charter hit carries text`);
  }
});

test('b2: a search breadcrumb with no query names the source when the name is given, and nothing otherwise', () => {
  assert.equal(buildBreadcrumbLabel({ name: 'nyc_charter__search', args: {} }), 'Search sections of law');
  assert.equal(buildBreadcrumbLabel({ name: 'socrata__search', args: {} }), 'Search catalog');
  assert.equal(buildBreadcrumbLabel({ args: {}, operationType: 'search' }), 'Search');
});

// R8 W3 criterion 4 (c): NYS Open Legislation's `search` derives `search`
// too (by upstream name), so without its own subject a bill search reads
// "Searching the catalog for datasets…". Its query argument is `term`, not
// `query`, so the "about …" clause does not render; the lines are asserted
// with the arguments the server takes.
const NYS_SEARCH = 'nys_legislation__search';
const NYS_ARGS = { type: 'bills', term: QUERY };

function nysLines(): Array<[string, string]> {
  return [
    ['formatToolProgress', formatToolProgress(NYS_SEARCH, NYS_ARGS)],
    ['formatToolResult (3 rows)', formatToolResult(NYS_ARGS, { rows: 3, columns: 1 }, NYS_SEARCH) ?? ''],
    ['formatToolResult (1 row)', formatToolResult(NYS_ARGS, { rows: 1, columns: 1 }, NYS_SEARCH) ?? ''],
    ['generateToolReason', generateToolReason(NYS_ARGS, NYS_SEARCH)],
    ['generateToolReason (no query)', generateToolReason({}, NYS_SEARCH)],
    ['buildNarrativeSummary', buildNarrativeSummary([{ name: NYS_SEARCH, args: NYS_ARGS }])],
    ['buildBreadcrumbLabel (no query)', buildBreadcrumbLabel({ name: NYS_SEARCH, args: {} })],
    ['searchSubject', JSON.stringify(searchSubject(NYS_SEARCH))],
  ];
}

test('R8 W3 criterion 4 (c): a State legislation search\'s lines say neither "catalog" nor "dataset"', () => {
  for (const [fn, line] of nysLines()) {
    assert.doesNotMatch(line, FALSE_SUBJECT, `${fn}: ${line}`);
  }
});

test('R8 W3 criterion 4 (c): every line that resolves a search subject names State legislation\'s', () => {
  assert.deepEqual(
    { singular: searchSubject(NYS_SEARCH).singular, plural: searchSubject(NYS_SEARCH).plural },
    { singular: 'bill, law or other legislative record', plural: 'bills, laws and other legislative records' },
  );
  for (const [fn, line] of nysLines()) {
    if (fn.startsWith('searchSubject')) continue;
    assert.match(line, /legislative record/, `${fn} names no legislative record: ${line}`);
  }
  // A bare `search` is still Socrata's: State legislation's needs the exposed name.
  assert.equal(searchSubject('search').singular, 'dataset');
});
