// A notebook states its reach: the hosts its data steps read, and the notebook
// keys its run reads (#807).
//
// The rules: a notebook's sandbox reaches only the hosts its run's data steps
// read; a notebook's environment holds a source's key only when its run reads
// that source. `synthesizeNotebook` returns `reach: { hosts, credentials }`,
// taken from the cells it rendered, and the executor reads nothing else.
//
// WHAT MAKES IT ABLE TO FAIL. Every fixture's hosts are distinct, so a reach
// that collapsed two of them, or that took a host from anywhere other than a
// data step (the synthesis cell, a discovery call, a failed call), shows as a
// different list. The synthesis cell of each fixture names hosts no data step
// reads.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { synthesizeNotebook, type PhaseAOutputs } from './synthesize.ts';
import type { PhaseAToolCall } from './tool-to-cell.ts';
import { SYNTHESIS_CELL_ROLE } from './prompt.ts';

interface Reach { hosts: string[]; credentials: string[] }

const SYNTHESIS_ANSWER = [
  'The counts are below.',
  '',
  '```python',
  'import requests',
  'requests.get("https://example.com/")',
  'requests.get("https://data.boston.gov/api/3/action/package_list")',
  '```',
].join('\n');

function synthesize(toolCalls: PhaseAToolCall[], finalAnswer = SYNTHESIS_ANSWER) {
  const inputs: PhaseAOutputs = {
    query: 'How many permits were issued?',
    defaultPortal: 'data.cityofnewyork.us',
    toolCalls,
    finalAnswer,
    modelName: 'fixture/model',
    modelAccess: 'through a fixture endpoint',
    generatedAt: '2026-11-23T00:00:00.000Z',
  };
  const out = synthesizeNotebook(inputs);
  return { out, reach: (out as unknown as { reach?: Reach }).reach };
}

const socrata = (portal: string, datasetId: string): PhaseAToolCall => ({
  name: 'get_data',
  args: { type: 'query', portal, dataset_id: datasetId, query: 'SELECT count(*)' },
  resultSummary: { rows: 1, columns: 1 },
});
const dataCommons: PhaseAToolCall = {
  name: 'get_observations',
  args: { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' },
  resultSummary: { rows: 3, columns: 4 },
};
const ckan = (serverUrl: string): PhaseAToolCall => ({
  name: 'ckan_datastore_search',
  args: { server_url: serverUrl, resource_id: 'abcd-resource' },
  resultSummary: { rows: 2, columns: 2 },
});
const openContext: PhaseAToolCall = {
  name: 'ckan__execute_sql',
  args: { sql: 'SELECT 1' },
  resultSummary: { rows: 1, columns: 1 },
};

function synthesisSource(out: ReturnType<typeof synthesizeNotebook>): string {
  const cell = out.notebook.cells.find((c) => (c.metadata as { role?: string } | undefined)?.role === SYNTHESIS_CELL_ROLE);
  assert.ok(cell, 'premise: the notebook has a synthesis cell');
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source);
}

test('the reach names every data step\'s host, lower-cased, unique and sorted, and both keys when both sources are read', () => {
  const { out, reach } = synthesize([
    socrata('Data.CityOfNewYork.us', 'erm2-nwe9'),
    socrata('data.cityofchicago.org', 'ijzp-q8t2'),
    socrata('data.cityofnewyork.us', 'h9gi-nx95'),
    dataCommons,
    ckan('https://Data.Example-CKAN.org/'),
    openContext,
  ]);
  assert.ok(synthesisSource(out).includes('https://example.com/'), 'premise: the synthesis cell names a host no data step reads');
  assert.deepEqual(reach, {
    hosts: ['api.datacommons.org', 'data.boston.gov', 'data.cityofchicago.org', 'data.cityofnewyork.us', 'data.example-ckan.org'],
    credentials: ['DC_API_KEY', 'SOCRATA_APP_TOKEN'],
  });
});

test('a run that reads Data Commons alone reaches its one host and holds only its key', () => {
  const { reach } = synthesize([dataCommons]);
  assert.deepEqual(reach, { hosts: ['api.datacommons.org'], credentials: ['DC_API_KEY'] });
});

test('a run that reads one Socrata portal alone holds only the Socrata key', () => {
  const { reach } = synthesize([socrata('data.cityofchicago.org', 'ijzp-q8t2')]);
  assert.deepEqual(reach, { hosts: ['data.cityofchicago.org'], credentials: ['SOCRATA_APP_TOKEN'] });
});

test('a run with no data step reaches no host and holds no key: discovery, a failed call and a step that cannot re-run add nothing', () => {
  const { out, reach } = synthesize([
    { name: 'get_data', args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'permits' } },
    { ...socrata('data.cityofchicago.org', 'ijzp-q8t2'), failed: true, failureKind: 'unavailable' },
    { name: 'fetch', args: { id: 'https://data.cityofnewyork.us/d/erm2-nwe9' } },
  ]);
  assert.ok(out.notebook.cells.length > 0, 'premise: a notebook was written');
  assert.deepEqual(reach, { hosts: [], credentials: [] });
});

test('a host that is not a plain domain name is not reached: a wildcard, an IP literal or a single label', () => {
  for (const portal of ['*', '*.gov', '1.1.1.1', 'localhost']) {
    const { reach } = synthesize([socrata(portal, 'ijzp-q8t2')]);
    assert.deepEqual(reach?.hosts, [], `the reach named ${JSON.stringify(reach?.hosts)} for the portal ${JSON.stringify(portal)}`);
  }
  const { reach } = synthesize([ckan('not an address')]);
  assert.deepEqual(reach?.hosts, [], 'a CKAN step with no parseable address reaches no host');
});

test('each fixed host the reach names is the host its helper requests', () => {
  const helper = (name: string) => readFileSync(new URL(`./helpers/${name}`, import.meta.url), 'utf8');
  const dc = synthesize([dataCommons]).reach?.hosts ?? [];
  const boston = synthesize([openContext]).reach?.hosts ?? [];
  assert.equal(dc.length, 1, `the Data Commons step named ${JSON.stringify(dc)}`);
  assert.equal(boston.length, 1, `the OpenContext step named ${JSON.stringify(boston)}`);
  assert.ok(helper('fetch_data_commons.py').includes(`"https://${dc[0]}/`), 'fetch_data_commons.py requests another host');
  assert.ok(helper('fetch_opencontext.py').includes(`"https://${boston[0]}/`), 'fetch_opencontext.py requests another host');
  // The two helpers whose host is the call's own: the portal, and the server address.
  assert.ok(helper('fetch_socrata.py').includes('url = f"https://{portal}/resource/'), 'fetch_socrata.py no longer requests the portal it is given');
  assert.ok(helper('fetch_ckan.py').includes('base = server_url.rstrip("/")'), 'fetch_ckan.py no longer requests the address it is given');
});
