// S2-B P3R (npstorey/civic-ai-tools#309; the seat's ruling 12): the driven fixtures' Socrata tool entries are the
// deployed server's, and each entry City Record's pin names hashes to that pin.
//
// `fixtures/socrata-tools-at-gr.json` is copied by script, byte for byte per tool entry, from the owner's GR read of
// the deployed Socrata server (its `initialize` and its one `tools/list` page, 2026-11-12; npstorey/civic-ai-tools
// issue 317, section 5). Two driven tests serve it (`src/app/api/in-loop-routing-driven.test.ts`,
// `src/app/api/replay-a-retired-city-record-step-driven.test.ts`), so the base check they pass is a match on the
// real server's tools, not on a fixture shaped to match.
//
// THE PROPERTY. Each tool router 0.9.0's `basePins[0]` names is in the fixture once, and its `mcpToolSchemaSha256`
// is the pinned hash; the fixture's `serverInfo` is the pin's name and version. THE DECOY: one argument's type
// changed in a copy moves that tool's hash, so the comparison can fail.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CIVIC_MANIFEST, mcpToolSchemaSha256, type McpListedTool } from '@typedstandards/civic-typed-router';

const FIXTURE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socrata-tools-at-gr.json'), 'utf8')) as {
  _meta: { sha256: string };
  serverInfo: { name: string; version: string };
  tools: McpListedTool[];
};
const PACK = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'nyc-record');
const PIN = PACK?.pack?.basePins[0];

test('premise: the installed City Record pack states one base pin, naming get_data and fetch', () => {
  assert.ok(PIN, 'the installed router states no base pin for nyc-record');
  assert.equal(PACK!.pack!.basePins.length, 1);
  assert.deepEqual(Object.keys(PIN!.tools).sort(), ['fetch', 'get_data']);
  assert.equal(FIXTURE._meta.sha256, '3e9f5ae14e984385c07cfc1b7aaa72b7ab39e7164c9f2b6e1f1e5f3c603dc52e', 'the fixture names another read');
});

test('the fixture reports the pinned name and version, and each pinned tool, listed once, hashes to its pin', () => {
  assert.deepEqual(FIXTURE.serverInfo, { name: PIN!.serverName, version: PIN!.serverVersion });
  for (const [name, pinned] of Object.entries(PIN!.tools)) {
    const listed = FIXTURE.tools.filter((tool) => tool.name === name);
    assert.equal(listed.length, 1, `${name} is listed ${listed.length} times`);
    assert.equal(mcpToolSchemaSha256(listed[0]), pinned, `${name} does not hash to its pin`);
  }
});

test('decoy: a copy whose get_data dataset_id is an integer no longer hashes to the pin', () => {
  const copy = JSON.parse(JSON.stringify(FIXTURE.tools.find((tool) => tool.name === 'get_data'))) as McpListedTool & { inputSchema: { properties: Record<string, { type?: string }> } };
  assert.equal(copy.inputSchema.properties.dataset_id.type, 'string', 'premise: dataset_id is a string');
  copy.inputSchema.properties.dataset_id.type = 'integer';
  assert.notEqual(mcpToolSchemaSha256(copy), PIN!.tools.get_data);
});
