// #599 W4 — the five root-span attributes a run writes are the five the
// harness reads (hub ADR-0033 §D, §E).
//
// `runRecordAttributes` (`./trace.ts`) encodes what a query route states about
// its run; the harness's `extractRunAttributes` reads it back at publish. The
// names live in two packages, so a rename on either side would leave a record
// silently stating nothing. This file round-trips every field through both,
// and states the names a third time, literally, so a change to either list is
// seen here.
//
// RED before W4: `./trace.ts` exports no `runRecordAttributes`. The module is
// read through its namespace so this file type-checks against a tree that
// lacks it and is red at the assertion that names it.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRunAttributes } from '@typedstandards/civic-typed-harness';
import * as traceModule from './trace.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';

type RunRecordAttributes = (run: {
  assertedDate: string;
  mcpServers: Array<{ url: string; name?: string }>;
  toolDefinitions: unknown[];
  sourcesOffered: Array<{ sourceId: string; alias: string; reason: string }>;
  components: Array<{ id: string; version?: string; guidanceHash?: string; guidanceOrigin?: string }>;
}) => Record<string, string>;

const encode = (traceModule as unknown as Record<string, unknown>).runRecordAttributes as RunRecordAttributes | undefined;
const NAMES = (traceModule as unknown as Record<string, unknown>).RUN_RECORD_ATTRIBUTE as Record<string, string> | undefined;

const RUN = {
  assertedDate: '2026-10-15',
  mcpServers: [{ url: 'https://socrata.example/mcp', name: 'socrata' }, { url: 'https://dc.example/mcp', name: 'data-commons' }],
  toolDefinitions: [{ type: 'function', function: { name: 'socrata__get_data', parameters: { type: 'object', properties: {} } } }],
  sourcesOffered: [
    { sourceId: 'socrata', alias: 'socrata', reason: 'configured' },
    { sourceId: 'data-commons', alias: 'data_commons', reason: 'configured' },
    { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-configured' },
  ],
  components: [
    { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: 'a'.repeat(64), guidanceOrigin: 'endpoint' },
    { id: 'datacommons-mcp@https://github.com/datacommonsorg/agent-toolkit' },
    { id: '@typedstandards/civic-typed-router', version: '0.2.0' },
  ],
};

// R6 W2 (#632, D2 = A) adds the sixth, `analysis.flows_statement`, written only
// when a run had a flows statement in force; its own round trip is in
// `run-record-flows-statement.test.ts`.
test('trace.ts exports the encoder and the six names', () => {
  assert.equal(typeof encode, 'function', 'trace.ts exports no runRecordAttributes');
  assert.deepEqual(NAMES, {
    assertedDate: 'analysis.asserted_date',
    mcpServers: 'analysis.mcp_servers',
    toolDefinitions: 'analysis.tool_definitions',
    sourcesOffered: 'analysis.sources_offered',
    components: 'analysis.components',
    flowsStatement: 'analysis.flows_statement',
  });
});

test('every field a run writes is the field the harness reads back, unchanged', () => {
  assert.equal(typeof encode, 'function', 'trace.ts exports no runRecordAttributes');
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  builder.endRoot(encode!(RUN));
  const read = extractRunAttributes(builder.finalize() as unknown as Record<string, unknown>);
  assert.deepEqual(read, {
    assertedDate: RUN.assertedDate,
    runMcpServers: RUN.mcpServers,
    toolDefinitions: RUN.toolDefinitions,
    sourcesOffered: RUN.sourcesOffered,
    components: RUN.components,
  });
});

test('the instrument can fail: a root span written under another name reads back as absent', () => {
  assert.equal(typeof encode, 'function', 'trace.ts exports no runRecordAttributes');
  const renamed = Object.fromEntries(Object.entries(encode!(RUN)).map(([k, v]) => [k.replace('analysis.', 'analysis.x_'), v]));
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  builder.endRoot(renamed);
  assert.deepEqual(extractRunAttributes(builder.finalize() as unknown as Record<string, unknown>), {});
});
