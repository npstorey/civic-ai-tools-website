// A tool name hosted by two servers is a configuration defect, not a silent
// rebinding (sprint #503 P3; hub open question Q60, part b).
//
// Run with:
//   node --test --experimental-strip-types src/lib/mcp/registry-duplicate-tool-name.test.ts
//
// Why this drives `buildToolIndex` and not `buildMcpRegistry`: the registry
// builds its three servers from compile-time constants (`SOCRATA_TOOLS`,
// `DATA_COMMONS_TOOLS`, `BOSTON_OPENCONTEXT_TOOLS`), so there is no
// environment an operator can set that produces two servers sharing a tool
// name — `buildMcpRegistry(env)` has no injection point for one. A duplicate
// can only arrive with a code change. `buildToolIndex` is the seam that makes
// the refusal drivable, and it is the same code path `buildMcpRegistry` runs.
//
// The third test is the reason a throw here is a startup refusal and not a
// `next build` crash: `src/lib/mcp/client.ts` calls `buildMcpRegistry` at
// MODULE-EVALUATION time, so this file asserts, mechanically, that the shipped
// tool lists do not overlap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMcpRegistry,
  buildToolIndex,
  McpConfigurationError,
  type McpServerConfig,
} from './registry.ts';

const FULLY_CONFIGURED = {
  socrataUrl: 'https://socrata-mcp.example.org',
  dataCommonsUrl: 'https://api.datacommons.example.org/mcp',
  bostonOpencontextUrl: 'https://data-mcp.boston.example.org/mcp',
};

function serverHosting(sourceId: string, tools: string[]): McpServerConfig {
  return {
    sourceId,
    label: `${sourceId} test server`,
    endpointUrl: `https://${sourceId}.example.org/mcp`,
    tools,
  };
}

test('two servers sharing a tool name are refused, naming the tool and both servers', () => {
  const servers: Record<string, McpServerConfig> = {
    'first-source': serverHosting('first-source', ['unique_to_first', 'shared_tool']),
    'second-source': serverHosting('second-source', ['shared_tool', 'unique_to_second']),
  };

  let caught: unknown;
  try {
    buildToolIndex(servers);
  } catch (err) {
    caught = err;
  }

  // Ordered so a failure names WHICH of the three ways this can go wrong:
  // nothing thrown, the wrong error thrown, or a message that does not carry
  // the operator's three facts.
  assert.ok(caught !== undefined, 'buildToolIndex returned instead of refusing the duplicate');
  assert.ok(
    caught instanceof McpConfigurationError,
    `expected McpConfigurationError, got ${caught instanceof Error ? caught.name : typeof caught}`,
  );

  const { message } = caught as Error;
  assert.ok(message.includes('shared_tool'), `message does not name the tool: ${message}`);
  assert.ok(
    message.includes('first-source'),
    `message does not name the server that already held the tool: ${message}`,
  );
  assert.ok(
    message.includes('second-source'),
    `message does not name the server that duplicated it: ${message}`,
  );
});

test('servers with distinct tool names index without refusal', () => {
  const index = buildToolIndex({
    'first-source': serverHosting('first-source', ['alpha_tool']),
    'second-source': serverHosting('second-source', ['beta_tool']),
  });

  assert.deepEqual(index, { alpha_tool: 'first-source', beta_tool: 'second-source' });
});

test('the shipped tool lists do not overlap, so the configured registry builds', () => {
  const registry = buildMcpRegistry(FULLY_CONFIGURED);
  const hosted = Object.values(registry.servers).flatMap((server) => server.tools);

  assert.equal(
    new Set(hosted).size,
    hosted.length,
    'the shipped tool lists share a name — client.ts builds this registry at module-evaluation time',
  );
  assert.equal(Object.keys(registry.toolIndex).length, hosted.length);
});
