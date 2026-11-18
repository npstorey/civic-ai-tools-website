// CKAN-2-WEB P2 criterion 4 (npstorey/civic-ai-tools#329; the owner's M6 = A with the card's rules, OA-1043; G0's D9;
// Seat rulings 6991837731 fix 3 and 6992847297 fix 7): a record's "Data sources used" line, which the website builds.
//
// THE LINE. One item per source, in first-seen order, joined by " · ":
//   - a pack prints "<its name> (<its portal's host>)", and only on a record whose call says it used that pack: a call
//     span that states `mcp.pack_id` and was sent (the rule the chooser's pack credit reads; a call refused before any
//     request credits no pack). A `dataSources` entry is the pack's when such a call, recorded under the entry's
//     `sourceId`, names the entry's portal and dataset in its arguments; an entry a bare call also names prints as today;
//   - the CKAN source prints "CKAN (<host>, <host>)", its portals' hosts in first-seen order; a portal named by two
//     addresses is listed once for each, two entries on one host print it once;
//   - a record whose CKAN calls all went through the retired Boston pack prints "Analyze Boston (data.boston.gov)" alone;
//   - every other source prints as today.
//
// WHAT IS DRIVEN. The record adapter (`adaptRecord`), the only renderer of the line, on packages built here from the
// saved production fixtures (`src/lib/flows/fixtures/`): each shape's `dataSources` and trace spans are written so the
// line can only read as pinned if the rule holds.
//
// WHAT MAKES IT ABLE TO FAIL. At P2's base (`c451a735`) the line is the harness formatter's, one display name per
// source: every shape below whose expected line names a host, a pack or Analyze Boston is red there. The shapes that
// read as today are guards ("must not change"): they hold at the base, so each was shown able to fail by a mutation run
// (P2's report). The refused-pack shape carries an entry for the refused call's dataset, which no real run mints, so a
// rule that credited a refused call would name the pack there.
//
// BLIND SPOTS, stated. The line as the adapter places it, read off the model, not off a browser; the census of
// production's public records (P2's report) is the read across every published package.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptRecord } from './adapt-record.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'flows', 'fixtures');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fixture = (name: string): Json => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Json;

/** The line the record page prints for a package. */
function line(pkg: Json): string {
  const model = adaptRecord({ stored: pkg, resolution: null, row: { slug: 'fixture', summary: 'fixture', contentProfile: null, captureMethod: null }, instance: null, servedStatement: null } as never) as Json;
  const item = (model.disclosure.environment as Array<{ label: string; value: string }>).find((i) => i.label === 'Data sources used');
  assert.ok(item, 'premise: the record has a "Data sources used" item');
  return item!.value;
}

// --- Building records ------------------------------------------------------------------------------------------------

const CITY_RECORD_PACK = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';
const BOSTON_PACK = 'boston-ckan@https://data.boston.gov';
const NYC = 'data.cityofnewyork.us';

const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });
interface Call { tool: string; source: string; args: Json; packId?: string; refused?: string }
function span(call: Call): Json {
  return {
    name: 'mcp_tool_call',
    attributes: [
      attribute('tool.name', call.tool),
      attribute('tool.operation_type', 'query'),
      attribute('mcp.source', call.source),
      attribute('tool.arguments', JSON.stringify(call.args)),
      ...(call.packId ? [attribute('mcp.pack_id', call.packId), attribute('mcp.alias', call.tool.split('__')[0])] : []),
      ...(call.refused ? [attribute('error.kind', call.refused)] : []),
    ],
  };
}
const packCall = (dataset: string, refused?: string): Call => ({ tool: 'nyc_record__get_data', source: 'socrata', packId: CITY_RECORD_PACK, args: { type: 'query', portal: NYC, dataset_id: dataset }, refused });
const bareCall = (dataset: string, portal = NYC): Call => ({ tool: 'socrata__get_data', source: 'socrata', args: { type: 'query', portal, dataset_id: dataset } });
const ckanCall = (serverUrl: string, packId?: string): Call => ({ tool: packId ? 'boston__ckan_package_search' : 'ckan__ckan_package_search', source: 'ckan-server', packId, args: { server_url: serverUrl, q: 'fixture' } });

const socrataEntry = (dataset: string, portal = `https://${NYC}`) => ({ sourceId: 'socrata', catalogType: 'socrata', portalUrl: portal, datasetId: dataset, datasetUrl: `${portal}/d/${dataset}`, accessTimestamp: '2026-11-18T00:00:00.000Z' });
const ckanEntry = (portalUrl: string) => ({ sourceId: 'ckan-server', catalogType: 'ckan', portalUrl, accessTimestamp: '2026-11-18T00:00:00.000Z' });

/** cbd1c7's package with these entries and these call spans in place of its own. */
function record(dataSources: Json[], calls: Call[]): Json {
  const pkg = structuredClone(fixture('record-cbd1c7.package.json'));
  pkg.dataSources = dataSources;
  pkg.trace = { resourceSpans: [{ scopeSpans: [{ spans: calls.map(span) }] }] };
  return pkg;
}

// --- The shapes -----------------------------------------------------------------------------------------------------

test('M6: two CKAN portals on two hosts print as one item, its hosts in first-seen order', () => {
  assert.equal(line(record([ckanEntry('https://data.boston.gov'), ckanEntry('https://opendata.swiss')], [ckanCall('https://data.boston.gov'), ckanCall('https://opendata.swiss')])), 'CKAN (data.boston.gov, opendata.swiss)');
});

test('M6, the card\'s rule: a portal the model named by two addresses is listed once for each address', () => {
  assert.equal(
    line(record([ckanEntry('https://open.toronto.ca'), ckanEntry('https://ckan0.cf.opendata.inter.prod-toronto.ca')], [ckanCall('https://open.toronto.ca'), ckanCall('https://ckan0.cf.opendata.inter.prod-toronto.ca')])),
    'CKAN (open.toronto.ca, ckan0.cf.opendata.inter.prod-toronto.ca)',
  );
});

test('M6, the card\'s rule: two entries on one host print it once', () => {
  assert.equal(
    line(record([socrataEntry('erm2-nwe9'), ckanEntry('https://data.boston.gov'), ckanEntry('data.boston.gov/')], [bareCall('erm2-nwe9'), ckanCall('https://data.boston.gov'), ckanCall('data.boston.gov/')])),
    'Socrata · CKAN (data.boston.gov)',
  );
});

test('M6: a pack call beside a bare call to the same base, on another dataset: each source once, in first-seen order', () => {
  assert.equal(line(record([socrataEntry('erm2-nwe9'), socrataEntry('dg92-zbpx')], [bareCall('erm2-nwe9'), packCall('dg92-zbpx')])), `Socrata · NYC City Record (${NYC})`);
  assert.equal(line(record([socrataEntry('dg92-zbpx'), socrataEntry('erm2-nwe9')], [packCall('dg92-zbpx'), bareCall('erm2-nwe9')])), `NYC City Record (${NYC}) · Socrata`);
});

test('M6: a pack call and a bare call on the same dataset: no rule covers the entry, so the line is as today', () => {
  assert.equal(line(record([socrataEntry('dg92-zbpx')], [packCall('dg92-zbpx'), bareCall('dg92-zbpx')])), 'Socrata');
});

test('M6: a pack call refused before any request, beside a bare call, names no pack', () => {
  for (const kind of ['not_configured', 'not_offered', 'base_changed']) {
    // As a run records it: the refused call mints no entry.
    assert.equal(line(record([socrataEntry('erm2-nwe9')], [packCall('dg92-zbpx', kind), bareCall('erm2-nwe9')])), 'Socrata', `${kind}, as recorded`);
    // The probe: an entry for the refused call's dataset, so only the sent rule keeps the pack out.
    assert.equal(line(record([socrataEntry('erm2-nwe9'), socrataEntry('dg92-zbpx')], [bareCall('erm2-nwe9'), packCall('dg92-zbpx', kind)])), 'Socrata', `${kind}, the probe`);
  }
});

test('M6: a router 0.11.0-era record whose CKAN calls all stated the Boston pack prints the pack alone', () => {
  assert.equal(line(record([ckanEntry('https://data.boston.gov')], [ckanCall('https://data.boston.gov', BOSTON_PACK), ckanCall('https://data.boston.gov', BOSTON_PACK)])), 'Analyze Boston (data.boston.gov)');
});

test('M6, the card\'s example: Socrata, the City Record pack and two CKAN portals', () => {
  assert.equal(
    line(record(
      [socrataEntry('erm2-nwe9'), socrataEntry('dg92-zbpx'), ckanEntry('https://data.boston.gov'), ckanEntry('https://opendata.swiss')],
      [bareCall('erm2-nwe9'), packCall('dg92-zbpx'), ckanCall('https://data.boston.gov'), ckanCall('https://opendata.swiss')],
    )),
    'Socrata · NYC City Record (data.cityofnewyork.us) · CKAN (data.boston.gov, opendata.swiss)',
  );
});

test('M6 fallbacks, unruled: an unresolvable pack id, and a CKAN portal address that does not parse, print as today', () => {
  const unknownPack: Call = { ...packCall('dg92-zbpx'), packId: 'no-such-pack@https://example.test/d/x' };
  assert.equal(line(record([socrataEntry('dg92-zbpx')], [unknownPack])), 'Socrata');
  assert.equal(line(record([ckanEntry('not an address')], [ckanCall('not an address')])), 'CKAN');
});

// --- Production's own records: must not change, but one ----------------------------------------------------------------

test('M6, production\'s records: …city-recor-cbd1c7 reads its pack and portal, not "Socrata"', () => {
  assert.equal(line(fixture('record-cbd1c7.package.json')), `NYC City Record (${NYC})`);
});

test('M6, production\'s records (must not change): b8cc28, Boston OpenContext with catalogType ckan, reads as today', () => {
  const pkg = fixture('record-b8cc28.package.json');
  assert.equal(pkg.dataSources[0].catalogType, 'ckan', 'premise: the entry\'s catalogType is ckan');
  assert.equal(line(pkg), 'Boston OpenContext');
});

test('M6, production\'s records (must not change): a nyc-record npm-package entry with no pack id (…fcd9e8\'s shape) reads "NYC City Record"', () => {
  const entry = { sourceId: 'nyc-record', catalogType: 'npm-package', portalUrl: 'pkg:npm/%40betanyc/nyc-record-mcp@1.1.0', accessTimestamp: '2026-10-22T13:27:24.763Z' };
  const hosted: Call = { tool: 'nyc_record__search_notices', source: 'nyc-record', args: { query: 'hearing' } };
  assert.equal(line(record([entry], [hosted])), 'NYC City Record');
});

test('M6, production\'s records (must not change): an entry with no sourceId (…2a2053\'s and …da9246\'s shape) reads "Socrata"', () => {
  const pkg = fixture('record-d887c1.package.json');
  delete pkg.dataSources[0].sourceId;
  assert.equal(line(pkg), 'Socrata');
});

test('M6, production\'s records (must not change): an empty dataSources reads "—"', () => {
  assert.equal(line(record([], [bareCall('erm2-nwe9')])), '—');
});
