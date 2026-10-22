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

// The owner's fix (pre-merge): a hosted source is recorded by the purl of the
// package it ran, whose URL has no host. The row used to drop it while its
// label claimed every source this site could use; it is now named as the
// record page names it, by reader name and pinned version, and an entry no
// source names reads as stored. Production's six configured servers are the
// fixture: two addressed, four hosted.
test('owner fix: the comparison names a hosted source by name and pinned version instead of dropping it', () => {
  const environment = model([
    { url: 'https://socrata-mcp.civicaitools.org', name: 'socrata' },
    { url: 'https://api.datacommons.org/mcp', name: 'data-commons' },
    { url: 'pkg:npm/%40betanyc/nyc-charter-laws-rules@0.3.1', name: 'nyc-charter' },
    { url: 'pkg:npm/%40betanyc/nyc-checkbook-mcp@1.6.3', name: 'nyc-checkbook' },
    { url: 'pkg:npm/%40betanyc/nyc-record-mcp@1.1.0', name: 'nyc-record' },
    { url: 'pkg:npm/%40betanyc/nys-openlegislation-mcp@2.4.0', name: 'nys-legislation' },
    { url: 'pkg:npm/%40example/unknown-source@0.1.0' },
  ]).disclosure.environment ?? [];
  const row = environment.find((i) => i.label === 'Data sources this site could use');
  assert.equal(
    row?.value,
    'Socrata (socrata-mcp.civicaitools.org), Data Commons (api.datacommons.org), NYC Charter, Laws and Rules (0.3.1), NYC Checkbook (1.6.3), NYC City Record (1.1.0), NYS Open Legislation (2.4.0), pkg:npm/%40example/unknown-source@0.1.0',
  );
});
