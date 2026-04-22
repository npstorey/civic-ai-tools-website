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
import { buildMcpRequestHeaders } from './client.ts';

const TEST_ENV = {
  socrataUrl: 'https://socrata-mcp.example.org',
  dataCommonsUrl: 'https://api.datacommons.org/mcp',
  dataCommonsApiKey: 'test-key-abc',
  bostonOpencontextUrl: 'https://data-mcp.boston.example.org/mcp',
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

test('Boston OpenContext tool names route to the OpenContext endpoint with no auth header', () => {
  const registry = buildMcpRegistry(TEST_ENV);
  const expected = [
    'ckan__search_datasets',
    'ckan__get_dataset',
    'ckan__query_data',
    'ckan__get_schema',
    'ckan__execute_sql',
    'ckan__aggregate_data',
  ];
  for (const toolName of expected) {
    const server = resolveServerForTool(registry, toolName);
    assert.ok(server, `expected server for tool "${toolName}"`);
    assert.equal(server!.sourceId, 'boston-opencontext');
    assert.equal(server!.endpointUrl, 'https://data-mcp.boston.example.org/mcp');
    assert.equal(server!.headers, undefined, 'OpenContext is unauthenticated; no auth headers expected');
  }
});

test('Unknown tool names do not resolve to any server', () => {
  const registry = buildMcpRegistry(TEST_ENV);
  assert.equal(resolveServerForTool(registry, 'get_observation_typo'), undefined);
  assert.equal(resolveServerForTool(registry, 'delete_data'), undefined);
  assert.equal(resolveServerForTool(registry, ''), undefined);
});

test('Bare Socrata URL gets /mcp appended; DC + OpenContext URLs are not double-appended', () => {
  const registry = buildMcpRegistry({
    socrataUrl: 'https://socrata-mcp.example.org',
    dataCommonsUrl: 'https://api.datacommons.org/mcp',
    bostonOpencontextUrl: 'https://data-mcp.boston.example.org/mcp',
  });
  assert.equal(registry.servers.socrata.endpointUrl, 'https://socrata-mcp.example.org/mcp');
  assert.equal(registry.servers['data-commons'].endpointUrl, 'https://api.datacommons.org/mcp');
  assert.equal(registry.servers['boston-opencontext'].endpointUrl, 'https://data-mcp.boston.example.org/mcp');
});

test('Trailing slash on any env var is normalized', () => {
  const registry = buildMcpRegistry({
    socrataUrl: 'https://socrata-mcp.example.org/',
    dataCommonsUrl: 'https://api.datacommons.org/mcp/',
    bostonOpencontextUrl: 'https://data-mcp.boston.example.org/mcp/',
  });
  assert.equal(registry.servers.socrata.endpointUrl, 'https://socrata-mcp.example.org/mcp');
  assert.equal(registry.servers['data-commons'].endpointUrl, 'https://api.datacommons.org/mcp');
  assert.equal(registry.servers['boston-opencontext'].endpointUrl, 'https://data-mcp.boston.example.org/mcp');
});

test('Missing Data Commons API key omits the auth header entirely', () => {
  const registry = buildMcpRegistry({
    socrataUrl: 'https://socrata-mcp.example.org',
    dataCommonsUrl: 'https://api.datacommons.org/mcp',
    bostonOpencontextUrl: 'https://data-mcp.boston.example.org/mcp',
    // no dataCommonsApiKey
  });
  assert.equal(registry.servers['data-commons'].headers, undefined);
});

test('readMcpEnvFromProcess falls back to defaults when env vars are unset', () => {
  const originalSocrata = process.env.SOCRATA_MCP_URL;
  const originalDc = process.env.DATA_COMMONS_MCP_URL;
  const originalKey = process.env.DATA_COMMONS_API_KEY;
  const originalBoston = process.env.BOSTON_OPENCONTEXT_MCP_URL;
  delete process.env.SOCRATA_MCP_URL;
  delete process.env.DATA_COMMONS_MCP_URL;
  delete process.env.DATA_COMMONS_API_KEY;
  delete process.env.BOSTON_OPENCONTEXT_MCP_URL;
  try {
    const env = readMcpEnvFromProcess();
    assert.equal(env.socrataUrl, 'https://socrata-mcp.civicaitools.org');
    assert.equal(env.dataCommonsUrl, 'https://api.datacommons.org/mcp');
    assert.equal(env.dataCommonsApiKey, undefined);
    assert.equal(env.bostonOpencontextUrl, 'https://data-mcp.boston.gov/mcp');
  } finally {
    if (originalSocrata !== undefined) process.env.SOCRATA_MCP_URL = originalSocrata;
    if (originalDc !== undefined) process.env.DATA_COMMONS_MCP_URL = originalDc;
    if (originalKey !== undefined) process.env.DATA_COMMONS_API_KEY = originalKey;
    if (originalBoston !== undefined) process.env.BOSTON_OPENCONTEXT_MCP_URL = originalBoston;
  }
});

test('Stateless server: request headers omit mcp-session-id, keep X-API-Key', () => {
  // The Data Commons hosted endpoint is stateless and returns no
  // mcp-session-id on initialize. Tool calls against such a server must
  // still carry the registry-supplied headers (X-API-Key) but NOT an
  // mcp-session-id header — which would otherwise be 'null' or 'undefined'
  // coerced to a string.
  const registry = buildMcpRegistry(TEST_ENV);
  const dataCommons = registry.servers['data-commons'];
  const headers = buildMcpRequestHeaders(dataCommons, null);
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Accept'], 'application/json, text/event-stream');
  assert.equal(headers['X-API-Key'], 'test-key-abc');
  assert.ok(!('mcp-session-id' in headers), 'stateless server must not emit mcp-session-id header');

  // Contrast: a stateful Socrata server with an issued session id should
  // include the header.
  const socrata = registry.servers.socrata;
  const statefulHeaders = buildMcpRequestHeaders(socrata, 'session-xyz');
  assert.equal(statefulHeaders['mcp-session-id'], 'session-xyz');

  // Socrata before initialize completes (sessionId still null) — should also
  // omit the header. Covers the `initialize` request itself.
  const preInitHeaders = buildMcpRequestHeaders(socrata, null);
  assert.ok(!('mcp-session-id' in preInitHeaders));
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
  // 3 Socrata + 2 Data Commons + 6 Boston OpenContext = 11
  assert.equal(allTools.size, 11, 'registry should host exactly 11 tools across three sources');
});
