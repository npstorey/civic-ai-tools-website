// #599 W3: the aliased view the app offers, the index it routes by, and the
// dispatch rule (design §6 as confirmed by D6, plus the rule D6 added).
//
//   1. The tools array the app offers is the router package's aliased view,
//      exactly, and `unaliasText` with the package's dispatch map undoes it to
//      the bare bytes W2 sent.
//   2. Both spellings read the same: `deriveOperationType`, `sourceIdForToolName`
//      and `routedSourceId` (the trace's `mcp.source`) answer the same for
//      `socrata__get_data` and `get_data`, for all eleven tools.
//   3. The registry indexes the EXPOSED names. Its duplicate refusal reads
//      exposed names, so it never fires on Socrata's `search`/`fetch` beside a
//      fourth source's `search`, and still fires on two servers under one alias.
//   4. The dispatch rule, driven with a manifest of FOUR sources in which a stub
//      source `example` also declares `search`: an exposed name routes; a bare
//      name exactly one offered source has is accepted; a bare name two offered
//      sources have is refused before any request, naming both aliased forms;
//      and the refusal reaches the model and the reader only through
//      `describeToolFailureForLlm` and `friendlyStreamError`.
//
// The fourth source's shape is the one that can fail: before W3 the index was
// keyed by bare names, so `search` from two servers was refused at startup.
//
// `routeToolCall` and the registry's `offeredSources` are W3's; this file reads
// them through the module namespace, so it type-checks and links at the base
// and is red there at its assertions.
//
// RED at 617b18b (W2): the tools array is the bare view; the aliased spellings
// derive and route to nothing; the index is bare; `buildToolIndex` refuses
// `search` from two servers; `routeToolCall` does not exist.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CIVIC_MANIFEST,
  civicRouter,
  createCivicRouter,
  unaliasText,
  type CivicManifestEntry,
} from '@typedstandards/civic-typed-router';
import { mcpTools, mcpToolsFor, offeredMcpTools } from './tools.ts';
import { deriveOperationType, sourceIdForToolName } from './operation-types.ts';
import * as registryModule from './registry.ts';
import {
  buildMcpRegistry,
  buildToolIndex,
  McpConfigurationError,
  routedSourceId,
  withheldToolNames,
  type McpRegistry,
  type McpRegistryEnv,
  type McpServerConfig,
} from './registry.ts';
import { classifyStreamError, describeToolFailureForLlm, friendlyStreamError } from '../streaming.ts';

/** The eleven, by source, each with its exposed name. */
const ELEVEN: ReadonlyArray<readonly [upstream: string, exposed: string, sourceId: string]> = [
  ['get_data', 'socrata__get_data', 'socrata'],
  ['search', 'socrata__search', 'socrata'],
  ['fetch', 'socrata__fetch', 'socrata'],
  ['search_indicators', 'data_commons__search_indicators', 'data-commons'],
  ['get_observations', 'data_commons__get_observations', 'data-commons'],
  ['ckan__search_datasets', 'boston__ckan__search_datasets', 'boston-opencontext'],
  ['ckan__get_dataset', 'boston__ckan__get_dataset', 'boston-opencontext'],
  ['ckan__get_schema', 'boston__ckan__get_schema', 'boston-opencontext'],
  ['ckan__query_data', 'boston__ckan__query_data', 'boston-opencontext'],
  ['ckan__aggregate_data', 'boston__ckan__aggregate_data', 'boston-opencontext'],
  ['ckan__execute_sql', 'boston__ckan__execute_sql', 'boston-opencontext'],
];

/** Router 0.3.0's hosted source (#617 P3): its five tools join the vocabulary
 *  (replay's tools) and, while NYC_CHARTER_HOSTING is unset, the withheld list.
 *  These are the moves the anchor names for the pin; the eleven above are
 *  unchanged. */
const CHARTER_FIVE: readonly string[] = [
  'nyc_charter__search',
  'nyc_charter__get_section',
  'nyc_charter__list_titles',
  'nyc_charter__get_title',
  'nyc_charter__get_version',
];

const FULL: McpRegistryEnv = {
  socrataUrl: 'https://socrata.invalid',
  dataCommonsUrl: 'https://data-commons.invalid/mcp',
  bostonOpencontextUrl: 'https://opencontext.invalid/mcp',
};
const NO_BOSTON: McpRegistryEnv = { socrataUrl: FULL.socrataUrl, dataCommonsUrl: FULL.dataCommonsUrl };
/** Every optional source on, the hosted one included. */
const ALL_ON: McpRegistryEnv = { ...FULL, nycCharterHosting: 'sandbox' };

const names = (tools: typeof mcpTools) => tools.map((t) => (t.type === 'function' ? t.function.name : t.type));

// --- 1. The aliased view ---------------------------------------------------------

test('the tools array names every tool <alias>__<upstream>, and is the router\'s own aliased array', () => {
  // The vocabulary: the eleven, in their order, then Charter's five at the end
  // (the router 0.3.0 move, #617 P3).
  assert.deepEqual(names(mcpTools).slice(0, 11).sort(), ELEVEN.map(([, exposed]) => exposed).sort());
  assert.deepEqual(names(mcpTools).slice(11), [...CHARTER_FIVE]);
  assert.equal(names(mcpTools).length, 16);
  assert.equal(JSON.stringify(mcpTools), JSON.stringify(civicRouter.aliasedMcpTools));
  for (const lock of [undefined, 'data.cityofnewyork.us']) {
    assert.equal(JSON.stringify(mcpToolsFor(lock)), JSON.stringify(civicRouter.aliasedMcpToolsFor(lock)), `lock ${lock}`);
    for (const env of [FULL, NO_BOSTON, ALL_ON]) {
      assert.equal(
        JSON.stringify(offeredMcpTools(mcpToolsFor(lock), env)),
        JSON.stringify(civicRouter.aliasedOfferedMcpTools(civicRouter.aliasedMcpToolsFor(lock), env)),
      );
    }
  }
});

test('the aliased tools array is reversible: un-aliased, it is the bare array byte for byte', () => {
  for (const lock of [undefined, 'data.cityofnewyork.us']) {
    assert.equal(
      unaliasText(civicRouter.dispatchMap, JSON.stringify(offeredMcpTools(mcpToolsFor(lock), NO_BOSTON))),
      JSON.stringify(civicRouter.offeredMcpTools(civicRouter.mcpToolsFor(lock), NO_BOSTON)),
    );
  }
});

test('the withheld tools are named as the model would have been offered them', () => {
  // The named move (#617 P3): with NYC_CHARTER_HOSTING unset, Charter's five
  // are withheld whatever else is configured; with every optional source on,
  // nothing is.
  assert.deepEqual(withheldToolNames(ALL_ON), []);
  assert.deepEqual(withheldToolNames(FULL), [...CHARTER_FIVE]);
  assert.deepEqual(
    new Set(withheldToolNames(NO_BOSTON)),
    new Set([...ELEVEN.filter(([, , source]) => source === 'boston-opencontext').map(([, exposed]) => exposed), ...CHARTER_FIVE]),
  );
});

// --- 2. Both spellings ------------------------------------------------------------

test('deriveOperationType, sourceIdForToolName and routedSourceId answer the same for either spelling', () => {
  for (const [upstream, exposed, sourceId] of ELEVEN) {
    const args = upstream === 'get_data' ? { type: 'query' } : {};
    assert.equal(deriveOperationType(exposed, args), deriveOperationType(upstream, args), `operation type of ${exposed}`);
    assert.equal(sourceIdForToolName(exposed), sourceId, `source of ${exposed}`);
    assert.equal(sourceIdForToolName(upstream), sourceId, `source of ${upstream}`);
    assert.equal(routedSourceId(exposed, FULL), sourceId, `routed source of ${exposed}`);
    assert.equal(routedSourceId(upstream, FULL), sourceId, `routed source of ${upstream}`);
  }
  // A Boston tool on an instance that did not configure Boston: no source for
  // either spelling, which the loop records as `unknown`.
  assert.equal(routedSourceId('boston__ckan__query_data', NO_BOSTON), undefined);
  assert.equal(routedSourceId('ckan__query_data', NO_BOSTON), undefined);
});

// --- 3. The index ------------------------------------------------------------------

test('the registry indexes the exposed names, and names the variable for an unconfigured source by its exposed names', () => {
  assert.deepEqual(new Set(Object.keys(buildMcpRegistry(FULL).toolIndex)), new Set(ELEVEN.map(([, exposed]) => exposed)));
  const noBoston = buildMcpRegistry(NO_BOSTON);
  for (const [, exposed, sourceId] of ELEVEN) {
    if (sourceId !== 'boston-opencontext') continue;
    assert.equal(noBoston.unconfiguredTools[exposed], 'BOSTON_OPENCONTEXT_MCP_URL', exposed);
  }
});

/** A server config for a test, cast so this file type-checks before the
 *  config carried an alias and a server identity. */
function serverConfig(fields: Record<string, unknown>): McpServerConfig {
  return fields as unknown as McpServerConfig;
}

test('the index never refuses Socrata\'s search beside a fourth source\'s search, and still refuses one exposed name twice', () => {
  const servers: Record<string, McpServerConfig> = {
    ...buildMcpRegistry(FULL).servers,
    example: serverConfig({
      sourceId: 'example',
      label: 'Example test server',
      endpointUrl: 'https://example.invalid/mcp',
      tools: ['search', 'lookup_record'],
      alias: 'example',
      serverId: 'example-mcp@https://example.org/mcp',
    }),
  };
  let index: Record<string, string> | undefined;
  assert.doesNotThrow(() => { index = buildToolIndex(servers); }, 'search from two sources was refused');
  assert.equal(index!['socrata__search'], 'socrata');
  assert.equal(index!['example__search'], 'example');

  const twice = {
    first: serverConfig({ sourceId: 'first', label: 'one', endpointUrl: 'https://one.invalid/mcp', tools: ['shared_tool'], alias: 'shared', serverId: 'one' }),
    second: serverConfig({ sourceId: 'second', label: 'two', endpointUrl: 'https://two.invalid/mcp', tools: ['shared_tool'], alias: 'shared', serverId: 'two' }),
  };
  assert.throws(() => buildToolIndex(twice), (error: unknown) =>
    error instanceof McpConfigurationError && /shared__shared_tool/.test(error.message) && /first/.test(error.message) && /second/.test(error.message));
});

// --- 4. The dispatch rule, over four sources ---------------------------------------------

const EXAMPLE_ENTRY: CivicManifestEntry = {
  id: 'example-mcp@https://example.org/mcp',
  alias: 'example',
  sourceId: 'example',
  displayName: 'Example Records Server',
  description: 'Example records: synthetic test records for one fictional town. Cannot answer about any real place.',
  freshness: 'Static: a fixed test set.',
  configuration: { addressVariable: 'EXAMPLE_MCP_URL', requirement: 'required' },
  tools: [
    { type: 'function', function: { name: 'search', description: 'Search the example records.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
    { type: 'function', function: { name: 'lookup_record', description: 'Look up one record.', parameters: { type: 'object', properties: { id: { type: 'string' } } } } },
  ],
  toolNames: ['search', 'lookup_record'],
  guidance: { async fetchText() { return ''; } },
};

const FOUR = createCivicRouter([...CIVIC_MANIFEST, EXAMPLE_ENTRY]);

/** The four-source registry: the three civic servers configured, plus the stub. */
function fourSourceRegistry(): McpRegistry {
  const base = buildMcpRegistry(FULL);
  const servers: Record<string, McpServerConfig> = {
    ...base.servers,
    example: serverConfig({
      sourceId: 'example',
      label: 'Example test server',
      endpointUrl: 'https://example.invalid/mcp',
      tools: ['search', 'lookup_record'],
      alias: 'example',
      serverId: EXAMPLE_ENTRY.id,
    }),
  };
  return {
    servers,
    toolIndex: buildToolIndex(servers),
    unconfiguredTools: {},
    offeredSources: ['socrata', 'data-commons', 'boston-opencontext', 'example'],
  } as unknown as McpRegistry;
}

type RouteToolCall = (registry: McpRegistry, name: string, map?: unknown) => {
  server: McpServerConfig;
  exposedName: string;
  upstreamName: string;
  alias: string;
  spelling: string;
};

function routeToolCallOf(): RouteToolCall {
  const fn = (registryModule as Record<string, unknown>).routeToolCall;
  assert.equal(typeof fn, 'function', 'registry.ts exports no routeToolCall: dispatch has no seam for the rule');
  return fn as RouteToolCall;
}

test('dispatch over four sources: an exposed name routes to its server and its upstream name', () => {
  const routeToolCall = routeToolCallOf();
  const registry = fourSourceRegistry();
  const socrataSearch = routeToolCall(registry, 'socrata__search', FOUR.dispatchMap);
  assert.equal(socrataSearch.server.sourceId, 'socrata');
  assert.equal(socrataSearch.upstreamName, 'search');
  const exampleSearch = routeToolCall(registry, 'example__search', FOUR.dispatchMap);
  assert.equal(exampleSearch.server.sourceId, 'example');
  assert.equal(exampleSearch.upstreamName, 'search');
  assert.equal(exampleSearch.spelling, 'aliased');
});

test('dispatch over four sources: a bare name exactly one offered source has is accepted', () => {
  const routeToolCall = routeToolCallOf();
  const registry = fourSourceRegistry();
  const bare = routeToolCall(registry, 'get_data', FOUR.dispatchMap);
  assert.equal(bare.server.sourceId, 'socrata');
  assert.equal(bare.upstreamName, 'get_data');
  assert.equal(bare.spelling, 'bare');
  assert.equal(routeToolCall(registry, 'lookup_record', FOUR.dispatchMap).server.sourceId, 'example');
});

test('dispatch over four sources: a bare name two offered sources have is refused, naming both aliased forms', () => {
  const routeToolCall = routeToolCallOf();
  const registry = fourSourceRegistry();
  let caught: unknown;
  try {
    routeToolCall(registry, 'search', FOUR.dispatchMap);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, 'a bare name two offered sources have was routed');
  const refusal = caught as Error & { candidates?: readonly string[] };
  assert.deepEqual([...(refusal.candidates ?? [])], ['socrata__search', 'example__search']);

  // The model is told, through `describeToolFailureForLlm`, which names to call
  // instead; nothing a source said, and no raw message.
  const forModel = describeToolFailureForLlm('search', caught);
  assert.match(forModel, /^This data request returned no data\. Do not estimate, guess, or fabricate/);
  assert.ok(forModel.includes('"socrata__search"') && forModel.includes('"example__search"'), forModel);
  assert.ok(!forModel.includes(refusal.message), 'the raw message reached the model');

  // The reader gets the generic copy; the record gets `unknown`.
  assert.equal(classifyStreamError(caught), 'generic');
  assert.equal(friendlyStreamError(caught), friendlyStreamError(new Error('')));
  assert.ok(!friendlyStreamError(caught).includes('search'), 'the reader copy names a tool');
});

test('dispatch over four sources: with the stub not offered, the bare name is accepted again', () => {
  const routeToolCall = routeToolCallOf();
  const registry = { ...fourSourceRegistry(), offeredSources: ['socrata', 'data-commons', 'boston-opencontext'] } as unknown as McpRegistry;
  assert.equal(routeToolCall(registry, 'search', FOUR.dispatchMap).server.sourceId, 'socrata');
});

test('the shipped dispatch map: no two civic sources share an upstream name, so every bare name is accepted', () => {
  const routeToolCall = routeToolCallOf();
  const registry = buildMcpRegistry(FULL);
  for (const [upstream, exposed, sourceId] of ELEVEN) {
    const viaBare = routeToolCall(registry, upstream);
    const viaExposed = routeToolCall(registry, exposed);
    assert.equal(viaBare.server.sourceId, sourceId);
    assert.equal(viaExposed.server.sourceId, sourceId);
    assert.equal(viaBare.upstreamName, upstream);
    assert.equal(viaExposed.upstreamName, upstream);
  }
});
