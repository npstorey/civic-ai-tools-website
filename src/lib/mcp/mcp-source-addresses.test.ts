// The source-id → configured-address mapping cannot drift from the routing
// registry (Wave N12 W5, website #449 and civic-ai-tools#205).
//
// `MCP_SOURCE_ADDRESS_FIELD` (registry.ts) names, for each source id, the
// `McpRegistryEnv` field that carries its configured address. A record states
// that address for the source's agent and lists it in the datHere environment
// extension. The mapping is a table beside `buildMcpRegistry`, so this file
// fails in each direction it can drift:
//
//   1. a server `buildMcpRegistry` emits that has no entry in the mapping —
//      its address would never reach a record;
//   2. an entry in the mapping that names no server `buildMcpRegistry` emits,
//      even fully configured — a record could name an address nothing routes to;
//   3. an entry that names a DIFFERENT field from the one the server's
//      `endpointUrl` is built from — each variable is set to a distinct decoy
//      value, so a swapped pair routes one address and records another.
//
// AND HOW IT RELATES TO THE HARNESS REGISTRY. The packager builds the
// provenance registry by walking `CIVIC_SOURCE_REGISTRY`'s keys and asking
// this mapping for each one's address. The two key sets are asserted EQUAL
// (4): a routed source with no vocabulary entry would reach the graph with no
// registry entry, and so with no address and a synthetic title; a vocabulary
// entry with no routed source could never carry an address. Adding a source
// means adding it to both, and this test says so.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIVIC_SOURCE_REGISTRY } from '@typedstandards/civic-typed-harness';
import {
  MCP_SOURCE_ADDRESS_FIELD,
  buildMcpRegistry,
  configuredAddressForSource,
  configuredMcpServers,
  type McpRegistryEnv,
} from './registry.ts';

/** Every address set, each to a distinct value already in endpoint form, so
 *  `endpointUrl` equals the configured value and a swapped field shows. */
const FULLY_CONFIGURED: McpRegistryEnv = {
  socrataUrl: 'http://decoy-socrata.invalid/mcp',
  dataCommonsUrl: 'http://decoy-data-commons.invalid/mcp',
  bostonOpencontextUrl: 'http://decoy-boston.invalid/mcp',
};

const MAPPED = Object.keys(MCP_SOURCE_ADDRESS_FIELD).sort();

test('(1) every server the routing registry emits has an address mapping', () => {
  const servers = Object.keys(buildMcpRegistry(FULLY_CONFIGURED).servers);
  const unmapped = servers.filter((id) => !Object.hasOwn(MCP_SOURCE_ADDRESS_FIELD, id));
  assert.deepEqual(
    unmapped,
    [],
    `buildMcpRegistry emits ${unmapped.join(', ')} with no entry in MCP_SOURCE_ADDRESS_FIELD — ` +
      'a record could not name its address',
  );
});

test('(2) every address mapping names a server the fully configured registry emits', () => {
  const servers = new Set(Object.keys(buildMcpRegistry(FULLY_CONFIGURED).servers));
  const orphaned = MAPPED.filter((id) => !servers.has(id));
  assert.deepEqual(
    orphaned,
    [],
    `MCP_SOURCE_ADDRESS_FIELD maps ${orphaned.join(', ')}, which buildMcpRegistry never emits`,
  );
});

test('(3) each mapping names the field its server is routed by', () => {
  const { servers } = buildMcpRegistry(FULLY_CONFIGURED);
  for (const [id, server] of Object.entries(servers)) {
    assert.equal(
      configuredAddressForSource(FULLY_CONFIGURED, id),
      server.endpointUrl,
      `the record would name one address for "${id}" while the client routes to another`,
    );
  }
});

test('(4) the mapped source ids equal CIVIC_SOURCE_REGISTRY\'s keys', () => {
  assert.deepEqual(
    MAPPED,
    Object.keys(CIVIC_SOURCE_REGISTRY).sort(),
    'the provenance registry walks CIVIC_SOURCE_REGISTRY and asks this mapping for each address; ' +
      'a source in one and not the other reaches a record with no address',
  );
});

test('the server list keeps registry insertion order and the address as configured', () => {
  const bareHost: McpRegistryEnv = {
    socrataUrl: 'https://socrata.example/',
    dataCommonsUrl: 'http://127.0.0.1:9/mcp',
    bostonOpencontextUrl: 'https://data-mcp.boston.gov/mcp',
  };
  assert.deepEqual(configuredMcpServers(bareHost), [
    // As configured: not `normalizeMcpEndpoint`'s `https://socrata.example/mcp`.
    { url: 'https://socrata.example/', name: 'socrata' },
    { url: 'http://127.0.0.1:9/mcp', name: 'data-commons' },
    { url: 'https://data-mcp.boston.gov/mcp', name: 'boston-opencontext' },
  ]);
  assert.deepEqual(
    configuredMcpServers(bareHost).map((s) => s.name),
    Object.keys(buildMcpRegistry(bareHost).servers),
  );
});

test('with Data Commons and Boston OpenContext configured, N is 3 with Socrata configured and 2 without', () => {
  const withoutSocrata: McpRegistryEnv = {
    dataCommonsUrl: 'https://api.datacommons.org/mcp',
    bostonOpencontextUrl: 'https://data-mcp.boston.gov/mcp',
  };
  assert.deepEqual(
    configuredMcpServers(withoutSocrata).map((s) => s.name),
    ['data-commons', 'boston-opencontext'],
  );
  assert.equal(configuredMcpServers({ ...withoutSocrata, socrataUrl: 'https://s.example' }).length, 3);
});

test('an unknown source id, and a configured empty string, have no address', () => {
  assert.equal(configuredAddressForSource(FULLY_CONFIGURED, 'unknown'), undefined);
  assert.equal(configuredAddressForSource(FULLY_CONFIGURED, 'toString'), undefined);
  assert.equal(configuredAddressForSource({ ...FULLY_CONFIGURED, socrataUrl: '' }, 'socrata'), undefined);
});

// --- A hosted source (#617 P4, ruling a2) ---------------------------------------
//
// A hosted source has no configured address: the instance runs it from a
// pinned package, and its sandbox's address lives only as long as one session.
// A record states it by the package it ran, as a purl derived from the
// manifest entry's hosting field (`package` and `version`), never configured:
// `pkg:npm/%40betanyc/nyc-charter-laws-rules@0.3.1`, the scope and the name
// encoded separately (encoding the whole name would write `%2F`). What this
// asserts, in both directions:
//   - a hosted server appears in the record's server list with its purl, and
//     has no address field (`MCP_SOURCE_ADDRESS_FIELD` never maps it, so no
//     configured value can be recorded for it);
//   - an addressed server has an address field, and its entry is that
//     address, never a purl.
// A server in neither form still throws (the list never silently loses one).

const CHARTER_ON: McpRegistryEnv = { ...FULLY_CONFIGURED, nycCharterHosting: 'sandbox' };
const CHARTER_PURL = 'pkg:npm/%40betanyc/nyc-charter-laws-rules@0.3.1';

test('a2: a hosted server is listed by its purl, after the addressed servers', () => {
  assert.deepEqual(configuredMcpServers(CHARTER_ON), [
    { url: 'http://decoy-socrata.invalid/mcp', name: 'socrata' },
    { url: 'http://decoy-data-commons.invalid/mcp', name: 'data-commons' },
    { url: 'http://decoy-boston.invalid/mcp', name: 'boston-opencontext' },
    { url: CHARTER_PURL, name: 'nyc-charter' },
  ]);
});

test('a2, both directions: a hosted server has a purl and no address field; an addressed server has an address field and no purl', () => {
  const registry = buildMcpRegistry(CHARTER_ON);
  const listed = new Map(configuredMcpServers(CHARTER_ON).map((s) => [s.name, s.url]));
  assert.ok(Object.keys(registry.hosted).length > 0, 'premise: the switch built a hosted server');
  for (const [id, server] of Object.entries(registry.hosted)) {
    assert.equal(Object.hasOwn(MCP_SOURCE_ADDRESS_FIELD, id), false, `the hosted "${id}" has an address field`);
    assert.equal(configuredAddressForSource(CHARTER_ON, id), undefined, `a configured value is recorded for the hosted "${id}"`);
    const encoded = server.hosting.package.split('/').map(encodeURIComponent).join('/');
    assert.equal(listed.get(id), `pkg:npm/${encoded}@${server.hosting.version}`, `the hosted "${id}" is not listed by its purl`);
  }
  for (const id of Object.keys(registry.servers)) {
    assert.equal(Object.hasOwn(MCP_SOURCE_ADDRESS_FIELD, id), true, `the addressed "${id}" has no address field`);
    assert.equal(listed.get(id), configuredAddressForSource(CHARTER_ON, id), `the addressed "${id}" is not listed by its address`);
    assert.doesNotMatch(listed.get(id) ?? '', /^pkg:/, `the addressed "${id}" is listed by a purl`);
  }
});

test('a2: the purl encodes the scope and the name separately (no %2F)', () => {
  const url = configuredMcpServers(CHARTER_ON).find((s) => s.name === 'nyc-charter')?.url ?? '';
  assert.equal(url, CHARTER_PURL);
  assert.ok(!url.includes('%2F'), 'the whole package name was encoded');
});

test('a2: with the switch unset the list is the three addressed servers, unchanged', () => {
  assert.deepEqual(configuredMcpServers(FULLY_CONFIGURED).map((s) => s.name), ['socrata', 'data-commons', 'boston-opencontext']);
});
