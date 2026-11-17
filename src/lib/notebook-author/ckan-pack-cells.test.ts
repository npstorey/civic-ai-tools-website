// CKAN-1 P3 (npstorey/civic-ai-tools#314), stage R, criterion A17: the notebook author renders the Boston pack's two
// datastore tools as re-runnable cells against the call's `server_url`, and its other four tools as discovery
// steps, listed in the discovery summary and given no cell of their own, as Boston OpenContext's search and
// metadata tools are.
//
// RED AT STAGE L (`a9f092b`): no operation type derives from the six, so the predicate admits none of them as a
// step, and both datastore calls fall into the discovery summary.
//
// SHAPED TO FAIL. Each datastore call carries a resource id or a statement no other call carries, and the cell must
// state both it and the call's `server_url`, so a cell written for a fixed portal or for another call fails.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAnalysisStep, renderDiscoverySummaryCell, renderFetchToolCell, type PhaseAToolCall } from './tool-to-cell.ts';

const PORTAL = 'https://data.boston.gov';
const DATASTORE: PhaseAToolCall[] = [
  { name: 'boston__ckan_datastore_search', args: { server_url: PORTAL, resource_id: 'a17-resource-0001', limit: 5 } },
  { name: 'boston__ckan_datastore_search_sql', args: { server_url: PORTAL, sql: 'SELECT count(*) FROM "a17-resource-0002"' } },
];
/** A datastore call by its bare upstream name on another CKAN portal: its cell must name that portal, not Boston's. */
const OTHER_PORTAL = 'https://ckan.portal-a17.example.test';
const ON_ANOTHER_PORTAL: PhaseAToolCall = { name: 'ckan_datastore_search', args: { server_url: OTHER_PORTAL, resource_id: 'a17-resource-0003', limit: 5 } };
const DISCOVERY: PhaseAToolCall[] = [
  { name: 'boston__ckan_package_search', args: { server_url: PORTAL, q: 'potholes' } },
  { name: 'boston__ckan_find_relevant_datasets', args: { server_url: PORTAL, query: 'potholes' } },
  { name: 'boston__ckan_package_show', args: { server_url: PORTAL, id: '311-service-requests' } },
  { name: 'boston__ckan_list_resources', args: { server_url: PORTAL, id: '311-service-requests' } },
];
const text = (source: string[] | string) => (Array.isArray(source) ? source.join('') : source);

test('A17: the two datastore tools render re-runnable cells against the call\'s server_url; the other four are discovery steps', () => {
  for (const call of DATASTORE) {
    assert.equal(isAnalysisStep(call), true, `${call.name} is not a step`);
    const cell = renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal: '' });
    assert.ok(cell, `${call.name} renders no cell`);
    assert.equal(cell!.producedDataFrame, true, `${call.name}'s cell re-runs nothing`);
    const code = cell!.cells.map((c) => text(c.source)).join('\n');
    const own = String(call.args.resource_id ?? call.args.sql);
    assert.ok(code.includes(PORTAL), `${call.name}'s cell does not run against the call's server_url:\n${code}`);
    assert.ok(code.includes(own.replaceAll('"', '\\"')) || code.includes(own), `${call.name}'s cell does not state its own call:\n${code}`);
  }
  // The call's server_url, not a portal the renderer fixes: a bare-named call on another host names that host.
  assert.equal(isAnalysisStep(ON_ANOTHER_PORTAL), true, 'the bare-named datastore call is not a step');
  const other = renderFetchToolCell(ON_ANOTHER_PORTAL, { dataFrameIndex: 2, defaultPortal: '' });
  assert.ok(other, 'the bare-named datastore call renders no cell');
  const otherCode = other!.cells.map((c) => text(c.source)).join('\n');
  assert.ok(otherCode.includes(OTHER_PORTAL) && otherCode.includes('a17-resource-0003'), `the cell does not run against the call's own server_url:\n${otherCode}`);
  assert.ok(!otherCode.includes('data.boston.gov'), `the cell names Boston's portal for a call on another:\n${otherCode}`);
  for (const call of DISCOVERY) {
    assert.equal(isAnalysisStep(call), false, `${call.name} is a step`);
    assert.equal(renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal: '' }), null, `${call.name} renders a cell of its own`);
  }
  const summary = text(renderDiscoverySummaryCell([...DISCOVERY, ...DATASTORE])?.source ?? '');
  for (const call of DISCOVERY) assert.ok(summary.includes(call.name.replace(/^boston__/, '')), `the discovery summary leaves out ${call.name}`);
  for (const call of DATASTORE) assert.ok(!summary.includes(`\`${call.name.replace(/^boston__/, '')}\``), `the discovery summary lists ${call.name}`);
});
