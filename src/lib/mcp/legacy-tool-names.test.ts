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
  assert.equal(upstreamToolName('boston__ckan_package_search'), 'ckan_package_search');
  assert.equal(sourceIdForToolName('boston__ckan_package_search'), 'boston-ckan');
  assert.equal(upstreamToolName('boston__no_such_tool'), 'boston__no_such_tool', 'a name the table does not map is returned as it is');
});
