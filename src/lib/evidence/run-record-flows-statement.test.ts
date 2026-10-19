// R6 W2 (#632, D2 = A): the sixth run attribute, `analysis.flows_statement`.
//
// Harness 0.9.0's extractor reads it from the root span as JSON text of one
// object whose fields are exactly `url`, `hash` and `date`, and refuses an
// extra key, a missing key or `null`; the derivation states it as the
// composition block's last key. So the app writes `JSON.stringify({ url, hash,
// date })` with exactly those keys, in that order, and writes NOTHING when a
// run has no statement — never `null`, which the extractor refuses (R6-HUB
// record 6253541140 §4).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRunAttributes } from '@typedstandards/civic-typed-harness';
import { RUN_RECORD_ATTRIBUTE, runRecordAttributes, TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';

const BASE_RUN = {
  assertedDate: '2026-10-19',
  mcpServers: [{ url: 'https://socrata.fixture.example', name: 'socrata' }],
  toolDefinitions: [],
  sourcesOffered: [{ sourceId: 'socrata', alias: 'socrata', reason: 'selected' }],
  components: [{ id: '@typedstandards/civic-typed-router', version: '0.4.0' }],
};
const REFERENCE = { url: 'https://site.fixture.example/api/flows', hash: 'a'.repeat(64), date: '2026-10-19' };

/** `runRecordAttributes` with a field the base's input type does not name. */
const encode = runRecordAttributes as unknown as (run: Record<string, unknown>) => Record<string, string>;

test('the sixth attribute is analysis.flows_statement, by the harness\'s name', () => {
  assert.equal((RUN_RECORD_ATTRIBUTE as Record<string, string>).flowsStatement, 'analysis.flows_statement');
});

test('a run with a statement writes exactly { url, hash, date }, in that order', () => {
  const attributes = encode({ ...BASE_RUN, flowsStatement: { date: REFERENCE.date, hash: REFERENCE.hash, url: REFERENCE.url, extra: 'dropped' } });
  assert.equal(attributes['analysis.flows_statement'], JSON.stringify(REFERENCE));
});

test('a run without one writes no such attribute, never null, and its other five bytes are unchanged', () => {
  const without = encode(BASE_RUN);
  assert.equal(Object.hasOwn(without, 'analysis.flows_statement'), false);
  const withIt = encode({ ...BASE_RUN, flowsStatement: REFERENCE });
  const { ['analysis.flows_statement']: written, ...rest } = withIt;
  assert.ok(written, 'premise: the statement was written');
  assert.deepEqual(rest, without);
});

test('the harness reads it back from the root span as the same three strings', () => {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  builder.endRoot(encode({ ...BASE_RUN, flowsStatement: REFERENCE }));
  const extracted = extractRunAttributes(builder.finalize() as unknown as Record<string, unknown>);
  assert.deepEqual(extracted.flowsStatement, REFERENCE);
});
