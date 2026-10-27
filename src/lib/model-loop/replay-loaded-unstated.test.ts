// #644 W2 [B]: the replay names any source the record shows loaded but its
// stated set leaves out.
//
// After the pause, a source the reader set to Ask first and then allowed is
// loaded (its load span says `loaded`) while the record states it
// `not-consented`, true at composition (C4). A replay offers the stated set
// (#632 D8), so it runs without that source, and before this the response
// could only say so through `lacking`, whose sentence ("This site does not
// offer it") is false for a source this site does offer.
//
// `replayOfferedSet` gains one unsigned field, `loadedUnstated`: the sources
// the record's trace shows loaded that its stated set leaves out, in manifest
// order. What replay offers does not change (`sources`, `lacking`, `from`).
//
// THE FIXTURE CAN FAIL. The record loads two sources: one it states, one it
// does not; and declines a third it does not state. Only the second may be
// named.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/replay-loaded-unstated.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const name of ['NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';

const { replayOfferedSet } = await import('./replay-loop.ts');
const { readMcpEnvFromProcess } = await import('../mcp/registry.ts');

type Attr = { key: string; value: { stringValue?: string; intValue?: string } };
const loadSpan = (alias: string, outcome: string, id: string) => ({
  name: 'mcp_tool_call',
  spanId: id,
  attributes: [
    { key: 'tool.name', value: { stringValue: 'load_source' } },
    { key: 'tool.operation_type', value: { stringValue: 'load_source' } },
    { key: 'tool.arguments', value: { stringValue: JSON.stringify({ alias }) } },
    { key: 'tool.load_outcome', value: { stringValue: outcome } },
    { key: 'tool.duration_ms', value: { intValue: '12' } },
  ] as Attr[],
});

const PACKAGE = {
  trace: {
    resourceSpans: [{
      scopeSpans: [{
        spans: [
          { name: 'analysis', spanId: 'root', attributes: [] },
          loadSpan('socrata', 'loaded', 's1'),
          loadSpan('boston', 'loaded', 's2'),
          loadSpan('data_commons', 'declined', 's3'),
        ],
      }],
    }],
  },
  extensions: {
    'org.civicaitools.composition': {
      sourcesOffered: [
        { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
        { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-consented' },
        { sourceId: 'boston-opencontext', alias: 'boston', reason: 'not-consented' },
      ],
    },
  },
};

const configured = readMcpEnvFromProcess();

test('[B]: the replay names a source the record shows loaded and its stated set leaves out, and only that one', () => {
  const offered = replayOfferedSet(PACKAGE, configured) as ReturnType<typeof replayOfferedSet> & { loadedUnstated?: string[] };
  assert.deepEqual(offered.loadedUnstated, ['boston-opencontext']);
});

test('[B]: what replay offers does not change', () => {
  const offered = replayOfferedSet(PACKAGE, configured) as ReturnType<typeof replayOfferedSet> & { loadedUnstated?: string[] };
  const without = replayOfferedSet({ extensions: PACKAGE.extensions }, configured);
  assert.deepEqual(offered.sources, without.sources);
  assert.deepEqual(offered.lacking, without.lacking);
  assert.equal(offered.from, without.from);
  assert.deepEqual(offered.sources, ['socrata']);
});

test('[B]: a record with no trace, or a trace held elsewhere, names nothing; nor does one that states no set (the field is absent)', () => {
  const none = replayOfferedSet({ extensions: PACKAGE.extensions }, configured) as { loadedUnstated?: string[] };
  assert.equal(Object.hasOwn(none, 'loadedUnstated'), false);
  const BLOB = { ...PACKAGE, trace: { $blobRef: 'sha256:00' } };
  const blob = replayOfferedSet(BLOB, configured) as { loadedUnstated?: string[] };
  assert.equal(Object.hasOwn(blob, 'loadedUnstated'), false);
  const UNSTATED = { trace: PACKAGE.trace, extensions: {} };
  const unstated = replayOfferedSet(UNSTATED, configured) as { loadedUnstated?: string[] };
  assert.equal(Object.hasOwn(unstated, 'loadedUnstated'), false, 'a record that states no set replays every source, so it leaves none out');
});
