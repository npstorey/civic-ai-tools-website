// R6 W3 (#632), criterion 11 and G7's T13: a source's name as the reader
// surfaces show it (the panel, the card, the Sources tab, the notices and
// the privacy page). Every manifest `displayName` ends "MCP Server" (router
// 0.4.0), which is implementation language to a reader (design principles,
// P9). `readerSourceName` takes the source: it keys on `sourceId` with one
// override (`data-commons` reads "Data Commons", ruled at G7), and every
// other source's name is its `displayName` (or registry `label`) with a
// trailing " MCP Server" removed; a name without the suffix is shown whole,
// and the suffix is removed only at the end.
//
// THE RECORD NAME. The record page names a source through
// `displayNameForSource` (`src/lib/evidence/data-sources.ts`). The reader
// function does not import it (that would bring the registry and the harness
// into the client bundle through the panel and the card), so this test pins
// the two equal for every manifest entry: the reader name and the record
// name cannot drift. `displayNameForSource` is imported here, in the test
// only.
//
// WHAT MAKES IT ABLE TO FAIL. Before G7 the function stripped the suffix
// alone, which reads "Google Data Commons" where the record reads "Data
// Commons" (measured at 90ba21a).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { readerSourceName } from './source-name.ts';
import { displayNameForSource } from '../evidence/data-sources.ts';

test('T13: every manifest entry reads the record page\'s name, from its displayName and from a registry label alike', () => {
  assert.ok(CIVIC_MANIFEST.length >= 4, 'premise: the manifest has its four entries');
  for (const entry of CIVIC_MANIFEST) {
    assert.ok(entry.displayName.endsWith(' MCP Server'), `premise: ${entry.sourceId}'s name ends " MCP Server" (${entry.displayName})`);
    const record = displayNameForSource(entry.sourceId);
    assert.equal(readerSourceName({ sourceId: entry.sourceId, displayName: entry.displayName }), record, `${entry.sourceId}: the reader name and the record name differ`);
    assert.equal(readerSourceName({ sourceId: entry.sourceId, label: entry.displayName }), record, `${entry.sourceId}: a label reads differently from a displayName`);
    assert.ok(!record.includes('MCP Server'), `premise: the record name of ${entry.sourceId} carries no "MCP Server"`);
  }
  assert.equal(readerSourceName({ sourceId: 'data-commons', displayName: 'Google Data Commons MCP Server' }), 'Data Commons');
});

test('criterion 11: a name without the suffix is shown whole, and the suffix is removed only at the end', () => {
  for (const whole of ['Boston Open Data', 'An MCP Server Directory', 'MCP Server', 'Fixture MCP Servers']) {
    assert.equal(readerSourceName({ sourceId: 'fixture-source', displayName: whole }), whole, `"${whole}" was changed`);
  }
  assert.equal(readerSourceName({ sourceId: 'fixture-source', displayName: 'Fixture MCP Server' }), 'Fixture');
});
