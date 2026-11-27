// OF3b (Sprint OF-1, website #810): every reader-facing sentence of the plain map, as ruled, from its one builder.
//
// THE RULINGS PINNED. W7 to W11 as the contract carries them with W3 and W4 applied; the owner's three-card set
// (7175769495): C1 = A, C2a = A, C2b = A, C2c = A (the number rule; each form the ruling lists is tested), C2d = B, C3 =
// C; the seat's cap line (7175128278), reason lines (7172716367) and summary clause with no dataset (7175461805).
//
// WHAT MAKES IT ABLE TO FAIL. At OF3a's head there is no words module and the registry carries the earlier line, so
// every assertion below fails at its value. The singular forms are tested at 1 and their plural at 2, so a builder
// that pluralises one way only fails one of each pair.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (rel: string): Promise<Mod | null> => import(pathToFileURL(path.join(HERE, rel)).href).catch(() => null);
const words = await load('map-words.ts');
const registry = (await load('registry.ts'))!;
const W = (): Mod => {
  assert.ok(words, 'there is no map-words module');
  return words!;
};
const counts = (returned: number, drawn: number, withoutLocation: number, beyondCap: number) => ({ returned, drawn, withoutLocation, beyondCap });

test('W7 (C2b = A, C2c = A): the count line, normal, with and without the no-location clause, and its one-row forms', () => {
  assert.equal(W().mapCountLine(counts(5, 3, 2, 0)), '3 of 5 rows mapped; 2 had no location.');
  assert.equal(W().mapCountLine(counts(3, 3, 0, 0)), '3 of 3 rows mapped.');
  assert.equal(W().mapCountLine(counts(1, 1, 0, 0)), '1 of 1 row mapped.');
  assert.equal(W().mapCountLine(counts(2, 1, 1, 0)), '1 of 2 rows mapped; 1 had no location.');
});

test('W7 over the cap (C2d = B, C2c = A): the first 1,000 the source returned, the rows not shown, and the no-location sentence', () => {
  assert.equal(
    W().mapCountLine(counts(1203, 1000, 53, 150)),
    '1,000 of 1,203 rows mapped. Of the rows with a location, the map shows the first 1,000 the data source returned. ' +
      '150 more rows with a location are not shown. The rows not shown may come from other places or dates. 53 had no location.',
  );
  assert.equal(
    W().mapCountLine(counts(1001, 1000, 0, 1)),
    '1,000 of 1,001 rows mapped. Of the rows with a location, the map shows the first 1,000 the data source returned. ' +
      '1 more row with a location is not shown. The rows not shown may come from other places or dates.',
  );
});

test('W8 (C1 = A, the checker\'s forms): each no-map reason, and the no-located-rows forms at 0, 1 and n', () => {
  assert.equal(W().noMapSentence('no-result-named'), 'No map: the AI did not make a choice this site could use.');
  assert.equal(W().noMapSentence('no-location-columns', 2), 'No map: the data chosen for the map has no location column.');
  assert.equal(W().noMapSentence('no-located-rows', 2), 'No map: none of the 2 rows had a location.');
  assert.equal(W().noMapSentence('no-located-rows', 1), 'No map: the one row returned had no location.');
  assert.equal(W().noMapSentence('no-located-rows', 0), 'No map: the data chosen for the map returned no rows.');
  assert.equal(W().noMapSentence('result-failed'), 'No map: the data for the map did not arrive or could not be read.');
});

test('W9 (C2c = A): the caption, the alternative text and the save action, singular and plural', () => {
  assert.equal(W().mapCaption(3, 'dataset abcd-1234'), 'The 3 mapped rows from dataset abcd-1234');
  assert.equal(W().mapCaption(1, 'dataset abcd-1234'), 'The 1 mapped row from dataset abcd-1234');
  assert.equal(W().mapAltText(3, 2, 'dataset abcd-1234'), 'Map of 3 points from dataset abcd-1234. 2 rows had no location.');
  assert.equal(W().mapAltText(1, 0, 'dataset abcd-1234'), 'Map of 1 point from dataset abcd-1234.');
  assert.equal(W().mapAltText(2, 1, 'dataset abcd-1234'), 'Map of 2 points from dataset abcd-1234. 1 row had no location.');
  assert.equal(W().MAP_DATA_DOWNLOAD, 'Download map data');
});

test('fold 6 (red; the seat\'s 7225128356): the table\'s "Label" heading, its two lines under the table, and "not stated"', () => {
  assert.equal(W().MAP_TABLE_HEADINGS.name, 'Label');
  assert.equal(W().MAP_TABLE_HEADINGS.row, 'Row');
  assert.equal(W().MAP_TABLE_HEADINGS.latitude, 'Latitude');
  assert.equal(W().MAP_TABLE_HEADINGS.longitude, 'Longitude');
  assert.equal(typeof W().mapLabelLine, 'function', 'there is no Label line');
  assert.equal(W().mapLabelLine('complaint_type'), 'Label: the value in the complaint_type column. The AI chose that column.');
  assert.equal(typeof W().mapRowLine, 'function', 'there is no Row line');
  assert.equal(W().mapRowLine(5), 'Row: its place in the 5 rows the data source returned, counting from 1.');
  assert.equal(W().mapRowLine(1), 'Row: its place in the 1 row the data source returned, counting from 1.');
  assert.equal(W().mapRowLine(1203), 'Row: its place in the 1,203 rows the data source returned, counting from 1.');
  assert.equal(W().MAP_VALUE_NOT_STATED, 'not stated');
});

test('W10: the running line, the steps line (singular and plural), and the summary clause with and without a dataset (the seat, 7175461805)', () => {
  assert.equal(W().MAP_STEP_RUNNING, 'Choosing what to map');
  assert.equal(W().mapStepLine(3, 5, 'dataset abcd-1234'), 'This site mapped 3 of 5 rows from dataset abcd-1234');
  assert.equal(W().mapStepLine(1, 1, 'dataset abcd-1234'), 'This site mapped 1 of 1 row from dataset abcd-1234');
  assert.equal(W().mapSummaryClause('dataset abcd-1234'), 'chose rows from dataset abcd-1234 for this site to map');
  assert.equal(W().mapSummaryClause(undefined), 'chose rows for this site to map');
});

test('W11 (C2a = A): the record page\'s format line and the line saying it draws no map', () => {
  assert.equal(W().recordFormatLine('Map'), 'Output format: Map');
  assert.equal(W().RECORD_MAP_NOT_SHOWN, 'This page lists the mapped rows. It does not show the map.');
});

test('the menu (C3 = C, the seat\'s 7175128278 and 7172716367): the format\'s line, its cap line, and the two reason lines', () => {
  const map = registry.PLAIN_MAP_FORMAT;
  assert.equal(map.label, 'Map');
  assert.equal(map.description, 'This site maps rows the AI chose from the data. No map service receives anything.');
  assert.equal(map.capLine, 'The map shows at most 1,000 points.');
  assert.equal(map.offered, true, 'the plain map is not offered');
  assert.equal(W().MAP_COMPARE_REASON, 'Not offered while a map format is chosen. Switch Output format to Auto to compare.');
  assert.equal(W().MAP_SANDBOX_REASON, 'Not offered in a Sandbox session. Switch Session type to Standard to use a map.');
});

test('the offered list carries the format\'s cap line and kind, with the setting on; off, nothing is offered', () => {
  const offered = registry.offeredOutputFormats({ SITE_OUTPUT_FORMAT: 'on' }) as Array<Record<string, unknown>>;
  const map = offered.find((f) => f.id === 'plain-map');
  assert.deepEqual(map, {
    id: 'plain-map', version: '1', label: 'Map',
    description: 'This site maps rows the AI chose from the data. No map service receives anything.',
    capLine: 'The map shows at most 1,000 points.', kind: 'map',
  });
  assert.equal(registry.offeredOutputFormats({}), null);
});

test('one cap: the sentences state the cap the builder applies', async () => {
  const plainMap = (await load('plain-map.ts'))!;
  assert.equal(plainMap.MAP_POINT_CAP, W().MAP_POINT_CAP);
  assert.ok(W().MAP_CAP_LINE.includes(W().MAP_POINT_CAP.toLocaleString('en-US')));
});
