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
// NOT ASSERTED HERE: the badge tooltip (`tool-badges.ts`) and the educational
// annotation (`getEducationalAnnotation`) are keyed by the operation type
// alone, and their callers pass no tool name; see the phase record.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/hosted-search-copy.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBreadcrumbLabel,
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
