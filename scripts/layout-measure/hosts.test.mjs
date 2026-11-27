// OF3b (Sprint OF-1, website #810; criterion 12): the layout-measure driver's host reading, which check 7 compares
// between a "Map" answer and the base's. The browser half (that every request the page starts is recorded, and that a
// planted image from another host makes check 7 read FAIL) is the driver's own run: `--only 7` and `--plant 7`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

const browser = await import('./lib/browser.mjs');

test('OF3b (red): hostsOf reads every http(s) host a session recorded, once each, and none for data: or blob:', () => {
  assert.equal(typeof browser.hostsOf, 'function', 'the driver reads no hosts');
  const notes = { requests: [
    { host: 'localhost:3220', scheme: 'http', type: 'Document' },
    { host: 'localhost:3220', scheme: 'http', type: 'Script' },
    { host: 'plant.layout-measure.invalid', scheme: 'https', type: 'Image', failed: 'csp' },
    { host: null, scheme: 'data', type: 'Image' },
    { host: null, scheme: 'blob', type: 'Other' },
  ] };
  assert.deepEqual(browser.hostsOf(notes), ['localhost:3220', 'plant.layout-measure.invalid']);
});

test('OF3b (red): the plant for check 7 is offered by the runner', async () => {
  const { PLANT_NAMES } = await import('./lib/plants.mjs');
  assert.ok(PLANT_NAMES.includes('7'));
});
