// CKAN-1 P3 (npstorey/civic-ai-tools#314), A-C6: the table of old aliases (`LEGACY_TOOL_ALIASES`,
// `./operation-types.ts`) reads a tool name a record made before router 0.11.0 states, `boston__ckan__query_data`
// and the rest, as Boston OpenContext's. It is safe only while no source the installed manifest gives that alias
// has a tool whose name the table maps: this test fails the day the router gives one such a tool, and when a mapped
// name stops reading as its old source.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { civicRouter } from '@typedstandards/civic-typed-router';
import { deriveOperationType, LEGACY_TOOL_ALIASES, sourceIdForToolName, upstreamToolName } from './operation-types.ts';

test('no source under an old alias has a tool whose name the table maps, and each old source still has those tools', () => {
  assert.ok(Object.keys(LEGACY_TOOL_ALIASES).length > 0, 'premise: the table names an old alias');
  for (const [alias, { sourceId, tools }] of Object.entries(LEGACY_TOOL_ALIASES)) {
    const old = civicRouter.manifest.find((entry) => entry.sourceId === sourceId);
    assert.ok(old && old.alias !== alias, `premise: ${sourceId} is in the manifest under another alias than ${alias}`);
    assert.deepEqual(tools, old!.toolNames, `the table's tools for ${alias} are not ${sourceId}'s`);
    for (const holder of civicRouter.manifest.filter((entry) => entry.alias === alias)) {
      const clash = holder.toolNames.filter((tool) => tools.includes(tool));
      assert.deepEqual(clash, [], `${holder.sourceId}, which has the alias ${alias} now, has a tool the table maps to ${sourceId}`);
    }
    for (const [exposed, target] of civicRouter.dispatchMap) {
      if (exposed.startsWith(`${alias}__`)) assert.ok(!tools.includes(target.upstreamName), `the dispatch map sends ${exposed} to a tool the table maps`);
    }
  }
});

test('an old-alias tool name reads as its old source, with its upstream name and its operation type; the alias\'s current tools do not', () => {
  assert.equal(upstreamToolName('boston__ckan__query_data'), 'ckan__query_data');
  assert.equal(sourceIdForToolName('boston__ckan__query_data'), 'boston-opencontext');
  assert.equal(deriveOperationType('boston__ckan__search_datasets', {}), 'search');
  // The retired Boston pack's names (router 0.11.0; CKAN-2-WEB P1): read as the pack's, as a record made then states them.
  assert.equal(upstreamToolName('boston__ckan_package_search'), 'ckan_package_search');
  assert.equal(sourceIdForToolName('boston__ckan_package_search'), 'boston-ckan');
  assert.equal(deriveOperationType('boston__ckan_datastore_search', {}), 'query');
  assert.equal(upstreamToolName('boston__ckan_status_show'), 'boston__ckan_status_show', 'the pack never offered ckan_status_show');
  assert.equal(upstreamToolName('boston__no_such_tool'), 'boston__no_such_tool', 'a name the table does not map is returned as it is');
});

// --- W11 (CKAN-2-WEB P1, cold-read F4; D7 = A): a call under an old or retired exposed name ----------------------

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'CKAN_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.example.test/mcp';
const { buildMcpRegistry, readMcpEnvFromProcess, routeToolCall } = await import('./registry.ts');
const { classifyStreamError, describeToolFailureForLlm, sourceNotConfiguredForLlm } = await import('../streaming.ts');

const OLD_NAMES: Array<[string, string]> = [
  ['boston__ckan_package_search', 'CKAN_MCP_URL'],
  ['boston__ckan_datastore_search_sql', 'CKAN_MCP_URL'],
  ['boston__ckan__query_data', 'BOSTON_OPENCONTEXT_MCP_URL'],
  ['boston__ckan__search_datasets', 'BOSTON_OPENCONTEXT_MCP_URL'],
];

/** What the dispatch throws for `name` under the process's configuration. */
function refusalOf(name: string): unknown {
  try {
    routeToolCall(buildMcpRegistry(readMcpEnvFromProcess()), name);
  } catch (error) {
    return error;
  }
  return null;
}

test('W11: a call under the retired pack\'s name or OpenContext\'s old alias, its variable unset, is refused not_configured, naming the variable', () => {
  for (const [name, variable] of OLD_NAMES) {
    const error = refusalOf(name);
    assert.ok(error instanceof Error, `${name} was routed`);
    assert.equal(classifyStreamError(error), 'mcp_not_configured', `${name} is not refused as not configured: ${(error as Error).message}`);
    assert.equal((error as { variable?: unknown }).variable, variable, `${name}'s refusal does not name ${variable}`);
    assert.equal(describeToolFailureForLlm(name, error), sourceNotConfiguredForLlm(variable), `the model is not told ${variable} is not set`);
  }
});

test('W11: with its variable set, the same name is refused before any request, not routed: no source has it under that alias', () => {
  for (const [name, variable] of OLD_NAMES) {
    process.env[variable] = 'https://set.example.test/mcp';
    try {
      const error = refusalOf(name);
      assert.ok(error instanceof Error, `${name} was routed with ${variable} set`);
      assert.equal((error as { code?: unknown }).code, 'not_offered', `${name} with ${variable} set is not refused as not offered: ${(error as Error).message}`);
    } finally {
      delete process.env[variable];
    }
  }
});
