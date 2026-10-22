// The comparison's servers row in the reader's words (UX pass, row 12). The
// run's configured servers, as its trace records them (`analysis.mcp_servers`),
// are labelled "Data sources this site could use", and an entry a manifest
// source names reads as that source's reader name with its host. An entry no
// source names reads as stored, its host, as before.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the row is "MCP servers" and every
// entry is its bare host.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptComparison } from './adapt-comparison.ts';

const trace = (servers: Array<{ url: string; name?: string }>) => ({
  resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'analysis', attributes: [{ key: 'analysis.mcp_servers', value: { stringValue: JSON.stringify(servers) } }] }] }] }],
});

const model = (servers: Array<{ url: string; name?: string }>) => adaptComparison({
  content: 'An answer.',
  isComplete: true,
  isActive: false,
  toolsCalled: [],
  progressGroups: [],
  progressLog: [],
  evidenceTrace: trace(servers),
  instance: null,
});

test('UX pass row 12: the comparison names each configured server a source names, under the reader\'s label', () => {
  const environment = model([
    { url: 'https://socrata-mcp.civicaitools.org', name: 'socrata' },
    { url: 'https://api.datacommons.org/mcp', name: 'data-commons' },
    { url: 'https://mcp.unknown.example/mcp' },
  ]).disclosure.environment ?? [];
  assert.ok(!environment.some((i) => i.label === 'MCP servers'), 'the row is still labelled "MCP servers"');
  const row = environment.find((i) => i.label === 'Data sources this site could use');
  assert.equal(row?.value, 'Socrata (socrata-mcp.civicaitools.org), Data Commons (api.datacommons.org), mcp.unknown.example');
});
