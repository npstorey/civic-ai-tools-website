// S4 W1 (npstorey/civic-ai-tools#335), criterion A15: no two source ids share a 4-byte hash.
//
// The consent cookie's second form names a source by the first 4 bytes of SHA-256 of its id (`sourceIdHash`), never by
// the id. Two ids that shared those bytes could not be told apart in a signed-out reader's cookie: a state given for
// one would read as the other's. This test runs on every change to the manifest (`CIVIC_MANIFEST`, which the router
// package supplies), so a source S6 adds cannot collide unseen; it also holds the 200-source fixture the stores are
// tested at.
//
// THE PLANT. `example-plant-58329` and `example-plant-66022` were found to share `854a3a88` (a search of ids of that
// shape, run once). The last test holds that `idHashCollisions` reports them, so the standing assertion is one that can
// fail; the phase report shows the first assertion red with the plant added to the manifest's ids.
//
// RED AT THE BASE: there is no hash function.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HERE = path.dirname(fileURLToPath(import.meta.url));
const consent = (await import(pathToFileURL(path.join(HERE, 'consent.ts')).href)) as Mod;
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'manifest-200.json'), 'utf8')) as { entries: Array<{ sourceId: string }> };

const PLANT = ['example-plant-58329', 'example-plant-66022'];

function collisions(): (ids: readonly string[]) => Array<[string, string]> {
  assert.equal(typeof consent.idHashCollisions, 'function', 'consent.ts exports no idHashCollisions: the second form\'s id hash is not checked');
  assert.equal(typeof consent.sourceIdHash, 'function', 'consent.ts exports no sourceIdHash');
  return consent.idHashCollisions;
}

test('A15: no two ids of CIVIC_MANIFEST share a 4-byte hash', () => {
  const ids = CIVIC_MANIFEST.map((entry) => entry.sourceId);
  assert.ok(ids.length >= 8, 'premise: the manifest lists its sources');
  assert.deepEqual(collisions()(ids), []);
});

test('A15: no two ids of the 200-source fixture, with the manifest\'s, share a 4-byte hash', () => {
  const ids = [...CIVIC_MANIFEST.map((entry) => entry.sourceId), ...fixture.entries.map((entry) => entry.sourceId)];
  assert.deepEqual(collisions()(ids), []);
});

test('A15: the hash is the first 4 bytes of SHA-256 of the id, and the plant shows the check can fail', () => {
  const find = collisions();
  for (const id of ['socrata', 'nyc-record', ...PLANT]) {
    assert.equal(consent.sourceIdHash(id), createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 8), id);
  }
  assert.equal(consent.sourceIdHash(PLANT[0]), consent.sourceIdHash(PLANT[1]), 'premise: the plant\'s two ids share a hash');
  assert.deepEqual(find([...CIVIC_MANIFEST.map((entry) => entry.sourceId), ...PLANT]), [[PLANT[0], PLANT[1]]]);
});
