// UX-2 P6 + P10 (#729), criterion 12 (contract p6p10.md v5.2; P10-11, item 14): the sources sentence reads N and the
// names from the instance's statement, never typed.
//
// THE RULE. "This site answers from <N> data sources: <names>." with the names in the statement's order, each its reader
// name (`readerSourceName`), joined "A, B and C"; at N = 1, "This site answers from 1 data source: <name>." There is no
// N = 0 form (D-15): the statement always lists one source or more.
//
// WHAT IS DRIVEN. `sourcesSentence` over the statement `buildFlowsStatement()` builds under this file's environment
// (production's six sources switched on), and over that statement's first two sources and its first one.
//
// WHAT MAKES IT ABLE TO FAIL. A typed "six" reads red on the two-source fixture; a fixed name list reads red on either
// fixture; the singular form is driven at N = 1.
//
// BLIND SPOTS, stated. When a static page reads the statement (build time, for `/project` and `/learn`) is the gate
// record's, not this test's.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowsStatement } from './statement.ts';
import { readerSourceName } from '../sources/source-name.ts';
import { sourcesSentence } from './sources-sentence.ts';

for (const name of ['DATA_COMMONS_MCP_URL', 'BOSTON_OPENCONTEXT_MCP_URL']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.NYC_CHECKBOOK_HOSTING = 'sandbox';
process.env.NYS_LEGISLATION_HOSTING = 'sandbox';
// The legislation source is configured only with its key; a fixture value, never a key.
process.env.NYS_LEGISLATION_API_KEY = 'fixture';

const statement = await buildFlowsStatement();
const names = (sources: typeof statement.sources) => sources.map((s) => readerSourceName(s));

test('premise: production\'s six sources, in production\'s order', () => {
  assert.deepEqual(statement.sources.map((s) => s.sourceId), ['socrata', 'data-commons', 'nyc-charter', 'nyc-checkbook', 'nyc-record', 'nys-legislation']);
});

test('criterion 12: with production\'s six, the sentence reads "6" and the six names in the statement\'s order', () => {
  const n = names(statement.sources);
  assert.equal(sourcesSentence(statement.sources), `This site answers from 6 data sources: ${n.slice(0, -1).join(', ')} and ${n[5]}.`);
});

test('criterion 12: with a two-source fixture, the sentence reads "2" and the two names', () => {
  const two = statement.sources.slice(0, 2);
  const n = names(two);
  assert.equal(sourcesSentence(two), `This site answers from 2 data sources: ${n[0]} and ${n[1]}.`);
});

test('criterion 12: with one source, the singular form', () => {
  const one = statement.sources.slice(0, 1);
  assert.equal(sourcesSentence(one), `This site answers from 1 data source: ${names(one)[0]}.`);
});
