// OF3b (Sprint OF-1, website #810; the seat's 7175166118, item 1): the map schema copy carries its source's license.
//
// The copy beside this file (`schema/squidmaps-map.d7cdb725.schema.json`) comes from the public repository
// `squidmaps-io/squidmaps-map-spec` at `d7cdb725`, whose LICENSE is MIT. MIT asks that its notice travel with every copy:
// `schema/LICENSE.squidmaps` is that LICENSE at the same commit, verbatim, and `schema/README.md` names the copy's
// source and commit. Each assertion fails when its file is missing or changed.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema');
const read = (name: string): string | null => {
  try {
    return fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8');
  } catch {
    return null;
  }
};

/** The sha256 of `LICENSE` at `squidmaps-io/squidmaps-map-spec@d7cdb725e0e3ebbe0a8f5651c6f060dec5789ecc`, as fetched. */
const LICENSE_SHA256 = 'd9dfe989c650363cb0dd645dd605dfe2a3a5f774eae57cb1a2d02df96f67d249';

test('the license notice sits beside the schema copy, verbatim from the source at d7cdb725', () => {
  assert.ok(read('squidmaps-map.d7cdb725.schema.json') !== null, 'premise: the schema copy');
  const notice = read('LICENSE.squidmaps');
  assert.ok(notice !== null, 'schema/LICENSE.squidmaps is missing');
  assert.equal(createHash('sha256').update(notice!, 'utf8').digest('hex'), LICENSE_SHA256, 'the notice is not the source\'s LICENSE at d7cdb725');
  assert.ok(notice!.startsWith('MIT License\n\nCopyright (c) 2026 Squidmaps\n'), notice!.slice(0, 80));
});

test('the schema directory names the copy\'s source repository and commit', () => {
  const readme = read('README.md');
  assert.ok(readme !== null, 'schema/README.md is missing');
  assert.ok(readme!.includes('squidmaps-io/squidmaps-map-spec'), 'the source repository is not named');
  assert.ok(readme!.includes('d7cdb725e0e3ebbe0a8f5651c6f060dec5789ecc'), 'the source commit is not named');
  assert.ok(readme!.includes('LICENSE.squidmaps'), 'the notice is not named');
});
