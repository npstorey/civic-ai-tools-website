// UX-2 P6 + P10 (#729), the directory-to-source mapping: contract p6p10.md v5.2, item 7, PQ3 = (a), 0c (v5.1's rule)
// and 0d item 2 (no `ckan-server` row: hub #329's).
//
// THE RULE. An entry maps to a source when it is that source's server or package, or the entry the router keeps for it
// (`nyc-record` keeps `nyc-record-mcp`, the retired package's entry). One explicit table; every value a manifest
// `sourceId` at the router this codebase pins; every key an entry of the checked-in snapshot or of a stated list of
// entries found only in the live index. `offeredSourceFor` returns the row's source only when the instance offers it.
//
// WHAT MAKES IT ABLE TO FAIL. The table is compared whole with the ruled one, so a missing row (the two the snapshot
// lacks) or an extra one (`boston-core-mcp`, another maintainer's server, or `ckan-mcp-server`, hub #329's) is red;
// `offeredSourceFor` is driven on an entry mapped to a source the instance does not offer.
//
// BLIND SPOTS, stated. `ckan-server` and `boston-ckan` are sources the action does not reach (0d item 2): both are
// manifest `sourceId`s from router 0.11.0 and no entry maps to either; the `ckan-mcp-server` row and its badge are hub
// #329's (OA-941 = A, `CKAN_MCP_URL` unset), and `boston-ckan` has no directory entry. Keys found only in the
// live index (`LIVE_ONLY`) are checked against that list, not against the hub's file, which this test does not fetch.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { DIRECTORY_SOURCE_MAP, offeredSourceFor } from './directory-source-map.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(HERE, 'mcp', 'directory-fallback.json'), 'utf8')) as Array<{ id: string }>;

/** The ruled table (contract first measurement 2, v5.1's rule, 0d item 2). */
const RULED: Record<string, string> = {
  'socrata-mcp-server': 'socrata',
  'data-commons-mcp': 'data-commons',
  'nyc-charter-laws-rules': 'nyc-charter',
  'nyc-checkbook-mcp': 'nyc-checkbook',
  'nys-openlegislation-mcp': 'nys-legislation',
  'nyc-record-mcp': 'nyc-record',
  opencontext: 'boston-opencontext',
};
/** Keys the live index holds and the snapshot does not (hub `1d97e0e`, 74 entries; snapshot 69). */
const LIVE_ONLY = ['nyc-checkbook-mcp', 'nys-openlegislation-mcp', 'opencontext'];
/** Sources the action does not reach (0d item 2; hub #329, OA-941 = A): the test's stated blind spot. */
const NOT_REACHED = ['ckan-server', 'boston-ckan'];

test('the mapping is the ruled table, whole', () => {
  assert.deepEqual({ ...DIRECTORY_SOURCE_MAP }, RULED);
});

test('every value is a manifest sourceId at the pinned router, and no value is a source the action does not reach', () => {
  const ids = new Set(CIVIC_MANIFEST.map((e: { sourceId: string }) => e.sourceId));
  const values = Object.values(DIRECTORY_SOURCE_MAP);
  assert.ok(values.length > 0, 'the table is empty');
  assert.deepEqual(values.filter((v) => !ids.has(v)), [], 'values that are not a manifest sourceId at the pin');
  assert.deepEqual(values.filter((v) => NOT_REACHED.includes(v)), []);
});

test('every key is a snapshot entry or on the stated live-only list; boston-core-mcp and ckan-mcp-server map to nothing', () => {
  const snapshot = new Set(SNAPSHOT.map((e) => e.id));
  const keys = Object.keys(DIRECTORY_SOURCE_MAP);
  assert.ok(keys.length > 0, 'the table is empty');
  assert.deepEqual(keys.filter((k) => !snapshot.has(k) && !LIVE_ONLY.includes(k)), []);
  assert.deepEqual(LIVE_ONLY.filter((k) => snapshot.has(k)), [], 'premise: the live-only keys are not in the snapshot');
  assert.equal(DIRECTORY_SOURCE_MAP['boston-core-mcp'], undefined);
  assert.equal(DIRECTORY_SOURCE_MAP['ckan-mcp-server'], undefined);
});

test('offeredSourceFor returns the source only when the instance offers it', () => {
  const offered = ['socrata', 'data-commons', 'nyc-record'];
  assert.equal(offeredSourceFor('socrata-mcp-server', offered), 'socrata');
  assert.equal(offeredSourceFor('nyc-record-mcp', offered), 'nyc-record');
  assert.equal(offeredSourceFor('nyc-charter-laws-rules', offered), null, 'a mapped source this instance does not offer');
  assert.equal(offeredSourceFor('boston-core-mcp', offered), null, 'an unmapped entry');
});
