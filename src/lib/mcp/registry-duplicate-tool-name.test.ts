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
// Since #599 W3 the index is keyed by EXPOSED name, `<alias>__<tool>`: two
// servers may host one upstream name under different aliases (Socrata's
// `search` and a fourth source's `search`), and the refusal fires on an
// exposed name two servers share — which needs two servers under one alias.
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

function serverHosting(sourceId: string, tools: string[], alias: string = sourceId.replace(/-/g, '_')): McpServerConfig {
  return {
    sourceId,
    label: `${sourceId} test server`,
    endpointUrl: `https://${sourceId}.example.org/mcp`,
    tools,
    alias,
    serverId: `${sourceId}@https://${sourceId}.example.org/mcp`,
  };
}

test('two servers sharing an exposed tool name are refused, naming the name and both servers', () => {
  const servers: Record<string, McpServerConfig> = {
    'first-source': serverHosting('first-source', ['unique_to_first', 'shared_tool'], 'shared'),
    'second-source': serverHosting('second-source', ['shared_tool', 'unique_to_second'], 'shared'),
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
  assert.ok(message.includes('shared__shared_tool'), `message does not name the exposed name: ${message}`);
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

  assert.deepEqual(index, { first_source__alpha_tool: 'first-source', second_source__beta_tool: 'second-source' });
});

test('two servers hosting one upstream name under different aliases index without refusal', () => {
  const index = buildToolIndex({
    socrata: serverHosting('socrata', ['search', 'fetch'], 'socrata'),
    example: serverHosting('example', ['search'], 'example'),
  });

  assert.deepEqual(index, { socrata__search: 'socrata', socrata__fetch: 'socrata', example__search: 'example' });
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
