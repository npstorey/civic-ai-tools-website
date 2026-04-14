// Unit tests for the multi-MCP routing registry.
//
// Run with: node --test --experimental-strip-types src/lib/mcp/registry.test.ts
//
// These tests assert the M9.1 routing contract: Socrata tool names route to
// the Socrata endpoint; Data Commons tool names route to the Data Commons
// endpoint with the X-API-Key header attached; unknown tools do not
// accidentally resolve to either server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMcpRegistry,
  resolveServerForTool,
  readMcpEnvFromProcess,
} from './registry.ts';

const TEST_ENV = {
  socrataUrl: 'https://socrata-mcp.example.org',
  dataCommonsUrl: 'https://api.datacommons.org/mcp',
  dataCommonsApiKey: 'test-key-abc',
};

test('Socrata tool names route to the Socrata endpoint', () => {
  const registry = buildMcpRegistry(TEST_ENV);
  for (const toolName of ['get_data', 'search', 'fetch']) {
    const server = resolveServerForTool(registry, toolName);
    assert.ok(server, `expected server for tool "${toolName}"`);
    assert.equal(server!.sourceId, 'socrata');
    assert.equal(server!.endpointUrl, 'https://socrata-mcp.example.org/mcp');
    assert.equal(server!.headers, undefined, 'Socrata server carries no auth headers');
  }
});

test('Data Commons tool names route to the Data Commons endpoint with X-API-Key', () => {
  const registry = buildMcpRegistry(TEST_ENV);
  for (const toolName of ['search_indicators', 'get_observations']) {
    const server = resolveServerForTool(registry, toolName);
    assert.ok(server, `expected server for tool "${toolName}"`);
    assert.equal(server!.sourceId, 'data-commons');
    assert.equal(server!.endpointUrl, 'https://api.datacommons.org/mcp');
    assert.deepEqual(server!.headers, { 'X-API-Key': 'test-key-abc' });
  }
});

test('Unknown tool names do not resolve to any server', () => {
  const registry = buildMcpRegistry(TEST_ENV);
  assert.equal(resolveServerForTool(registry, 'get_observation_typo'), undefined);
  assert.equal(resolveServerForTool(registry, 'delete_data'), undefined);
  assert.equal(resolveServerForTool(registry, ''), undefined);
});

test('Bare Socrata URL gets /mcp appended; Data Commons URL is not double-appended', () => {
  const registry = buildMcpRegistry({
    socrataUrl: 'https://socrata-mcp.example.org',
    dataCommonsUrl: 'https://api.datacommons.org/mcp',
  });
  assert.equal(registry.servers.socrata.endpointUrl, 'https://socrata-mcp.example.org/mcp');
  assert.equal(registry.servers['data-commons'].endpointUrl, 'https://api.datacommons.org/mcp');
});

test('Trailing slash on either env var is normalized', () => {
  const registry = buildMcpRegistry({
    socrataUrl: 'https://socrata-mcp.example.org/',
    dataCommonsUrl: 'https://api.datacommons.org/mcp/',
  });
  assert.equal(registry.servers.socrata.endpointUrl, 'https://socrata-mcp.example.org/mcp');
  assert.equal(registry.servers['data-commons'].endpointUrl, 'https://api.datacommons.org/mcp');
});

test('Missing Data Commons API key omits the auth header entirely', () => {
  const registry = buildMcpRegistry({
    socrataUrl: 'https://socrata-mcp.example.org',
    dataCommonsUrl: 'https://api.datacommons.org/mcp',
    // no dataCommonsApiKey
  });
  assert.equal(registry.servers['data-commons'].headers, undefined);
});

test('readMcpEnvFromProcess falls back to defaults when env vars are unset', () => {
  const originalSocrata = process.env.SOCRATA_MCP_URL;
  const originalDc = process.env.DATA_COMMONS_MCP_URL;
  const originalKey = process.env.DATA_COMMONS_API_KEY;
  delete process.env.SOCRATA_MCP_URL;
  delete process.env.DATA_COMMONS_MCP_URL;
  delete process.env.DATA_COMMONS_API_KEY;
  try {
    const env = readMcpEnvFromProcess();
    assert.equal(env.socrataUrl, 'https://socrata-mcp.civicaitools.org');
    assert.equal(env.dataCommonsUrl, 'https://api.datacommons.org/mcp');
    assert.equal(env.dataCommonsApiKey, undefined);
  } finally {
    if (originalSocrata !== undefined) process.env.SOCRATA_MCP_URL = originalSocrata;
    if (originalDc !== undefined) process.env.DATA_COMMONS_MCP_URL = originalDc;
    if (originalKey !== undefined) process.env.DATA_COMMONS_API_KEY = originalKey;
  }
});

test('Every tool appears in exactly one server (no accidental overlap)', () => {
  const registry = buildMcpRegistry(TEST_ENV);
  const allTools = new Map<string, string>();
  for (const [sourceId, server] of Object.entries(registry.servers)) {
    for (const tool of server.tools) {
      assert.ok(
        !allTools.has(tool),
        `tool "${tool}" appears in both "${allTools.get(tool)}" and "${sourceId}"`,
      );
      allTools.set(tool, sourceId);
    }
  }
  assert.equal(allTools.size, 5, 'registry should host exactly 5 tools in M9.1');
});
