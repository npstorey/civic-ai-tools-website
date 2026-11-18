// CKAN-2-WEB P1 (npstorey/civic-ai-tools#329), W10 (gate): each of the hosted CKAN server's seven tools (router
// 0.12.0, `ckan__<name>`) has one defined notebook step, and the two datastore tools render a cell that re-runs the
// call with every argument it carried.
//
// The server's `ckan_datastore_search` (the fork `npstorey/ckan-mcp-server` at `pin` 05cd1a86,
// `src/tools/datastore.ts`) sends the portal's `datastore_search` action `resource_id`, `limit` (default 100),
// `offset` (default 0) and `distinct` (default false) on every call, and `q`, `filters` (JSON), `fields` (joined with
// commas) and `sort` when the call carries them. `response_format` only shapes the server's text for the model (a
// markdown table or compact JSON of the same records); the portal's action is the same either way, so the cell does
// not pass it and states why. The cell re-runs the same action with the same values, so an absent `limit` is the
// server's 100, never the helper's own default, and `limit: 0` stays 0.
//
// SHAPED TO FAIL. The full call carries every argument with a value no default supplies (`limit` 250, `offset` 50,
// `distinct` true), so a cell that drops one, or writes a default in its place, fails by name. The absent-limit call
// carries no limit at all, so a cell that falls back to any number but 100 fails. Each call's resource id is its own.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CKAN_TOOL_NAMES } from '@typedstandards/civic-typed-router';
import { isAnalysisStep, renderDiscoverySummaryCell, renderFetchToolCell, type PhaseAToolCall } from './tool-to-cell.ts';
import { generateNotebook } from '../notebook.ts';

const PORTAL = 'https://data.boston.gov';
const exposed = (upstream: string) => `ckan__${upstream}`;
const text = (source: string[] | string) => (Array.isArray(source) ? source.join('') : source);
const codeOf = (call: PhaseAToolCall) => {
  const cell = renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal: '' });
  assert.ok(cell, `${call.name} renders no cell`);
  return cell!.cells.map((c) => text(c.source)).join('\n');
};

/** Every argument the server's datastore tool takes, each with a value no default supplies. */
const FULL: PhaseAToolCall = {
  name: exposed('ckan_datastore_search'),
  args: {
    server_url: PORTAL,
    resource_id: 'w10-resource-0001',
    q: 'pothole',
    filters: { case_status: 'Closed' },
    limit: 250,
    offset: 50,
    fields: ['_id', 'case_title'],
    sort: 'open_dt desc',
    distinct: true,
    response_format: 'json',
  },
};
const NO_LIMIT: PhaseAToolCall = { name: exposed('ckan_datastore_search'), args: { server_url: PORTAL, resource_id: 'w10-resource-0002' } };
const LIMIT_ZERO: PhaseAToolCall = { name: exposed('ckan_datastore_search'), args: { server_url: PORTAL, resource_id: 'w10-resource-0003', limit: 0 } };
const SQL: PhaseAToolCall = { name: exposed('ckan_datastore_search_sql'), args: { server_url: PORTAL, sql: 'SELECT count(*) FROM "w10-resource-0004"' } };
const DISCOVERY: PhaseAToolCall[] = [
  { name: exposed('ckan_package_search'), args: { server_url: PORTAL, q: 'potholes' } },
  { name: exposed('ckan_find_relevant_datasets'), args: { server_url: PORTAL, query: 'potholes' } },
  { name: exposed('ckan_package_show'), args: { server_url: PORTAL, id: '311-service-requests' } },
  { name: exposed('ckan_list_resources'), args: { server_url: PORTAL, id: '311-service-requests' } },
  { name: exposed('ckan_status_show'), args: { server_url: PORTAL } },
];

test('W10: each of the seven tools has one defined step: the two datastore tools are steps, the other five discovery, and the executed renderer, the predicate and the skeleton notebook agree', () => {
  assert.deepEqual(
    [...CKAN_TOOL_NAMES].sort(),
    [...DISCOVERY, FULL, SQL].map((call) => call.name.replace(/^ckan__/, '')).sort(),
    'premise: this file covers the router\'s seven tools',
  );
  for (const call of [FULL, SQL]) {
    assert.equal(isAnalysisStep(call), true, `${call.name} is not a step`);
    assert.equal(renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal: '' })?.producedDataFrame, true, `${call.name}'s cell re-runs nothing`);
  }
  for (const call of DISCOVERY) {
    assert.equal(isAnalysisStep(call), false, `${call.name} is a step`);
    assert.equal(renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal: '' }), null, `${call.name} renders a cell of its own`);
  }
  const summary = text(renderDiscoverySummaryCell([...DISCOVERY, FULL, SQL])?.source ?? '');
  for (const call of DISCOVERY) assert.ok(summary.includes(call.name.replace(/^ckan__/, '')), `the discovery summary leaves out ${call.name}`);
  // The skeleton notebook (`../notebook.ts`) reads the same predicate: one numbered step per datastore call.
  const skeleton = generateNotebook('q', null, [...DISCOVERY, FULL, SQL].map((c) => ({ name: c.name, args: c.args })), '', { origin: null, host: null, platformTitle: null });
  const steps = skeleton.cells.map((c) => text(c.source)).filter((s) => /^## Step \d+:/m.test(s));
  assert.equal(steps.length, 2, `the skeleton notebook does not number exactly the two datastore steps: ${steps.length}`);
});

test('W10: a datastore cell re-runs the call with every argument it carried: resource_id, q, filters, limit, offset, fields, sort, distinct, against the call\'s server_url', () => {
  const code = codeOf(FULL);
  const expected: Array<[string, RegExp]> = [
    ['server_url', /fetch_ckan\(\s*"https:\/\/data\.boston\.gov",/],
    ['resource_id', /\bresource_id="w10-resource-0001",/],
    ['q', /\bq="pothole",/],
    ['filters', /\bfilters=\{\s*"case_status": "Closed",?\s*\},/],
    ['limit', /\blimit=250,/],
    ['offset', /\boffset=50,/],
    ['fields', /\bfields=\["_id", "case_title"\],/],
    ['sort', /\bsort="open_dt desc",/],
    ['distinct', /\bdistinct=True,/],
  ];
  const missing = expected.filter(([, pattern]) => !pattern.test(code)).map(([name]) => name);
  assert.deepEqual(missing, [], `the cell drops or rewrites these arguments:\n${code}`);
  assert.ok(!/response_format/.test(code.replace(/^#.*$/gm, '')), `the cell passes response_format, which the portal's action does not take:\n${code}`);
});

test('W10: an absent limit renders the server\'s 100, and limit 0 renders 0', () => {
  assert.match(codeOf(NO_LIMIT), /\blimit=100,/, 'an absent limit does not render 100');
  assert.doesNotMatch(codeOf(NO_LIMIT), /\blimit=1000\b/, 'an absent limit renders the helper\'s old 1000');
  assert.match(codeOf(LIMIT_ZERO), /\blimit=0,/, 'limit 0 does not render 0');
});

test('W10: the SQL tool\'s cell re-runs its statement against the call\'s server_url', () => {
  const code = codeOf(SQL);
  assert.ok(code.includes(PORTAL) && code.includes('SELECT count(*) FROM \\"w10-resource-0004\\"'), `the SQL cell does not state its call:\n${code}`);
});

test('W10: fetch_ckan takes each argument the server sends, with the server\'s defaults', () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'fetch_ckan.py'), 'utf8');
  const signature = /def fetch_ckan\(([\s\S]*?)\)\s*->/.exec(source)?.[1] ?? '';
  const parameters = signature.split(',').map((p) => p.trim()).filter(Boolean);
  const named = (name: string) => parameters.find((p) => p === name || p.startsWith(`${name}:`) || p.startsWith(`${name} `));
  const missing = ['q', 'filters', 'limit', 'offset', 'fields', 'sort', 'distinct'].filter((name) => named(name) === undefined);
  assert.deepEqual(missing, [], `fetch_ckan does not take: ${missing.join(', ')}`);
  assert.match(named('limit') ?? '', /=\s*100$/, `fetch_ckan's limit default is not the server's 100: ${named('limit')}`);
  assert.match(named('offset') ?? '', /=\s*0$/, `fetch_ckan's offset default is not the server's 0: ${named('offset')}`);
  assert.match(named('distinct') ?? '', /=\s*False$/, `fetch_ckan's distinct default is not the server's false: ${named('distinct')}`);
});
