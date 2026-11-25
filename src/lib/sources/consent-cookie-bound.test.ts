// S4 W1 (npstorey/civic-ai-tools#335), criterion A1 (the codec's leg; the driven leg is in
// `src/app/api/sources/consent/consent-stores-s4-driven.test.ts`): a signed-out consent holding a state for each of 200
// sources fits in 4,096 bytes, counted as the browsers count a cookie (its name, the `=` and its value, no attributes).
//
// THE SHAPE THAT CAN FAIL. The 200-source fixture's ids (mean length 20.2) each with a stored state, encoded as the
// writers encode (`v: 2`). At the base the encoder writes base64url JSON whatever the version: 38,344 bytes at Ask
// first, so this is red at the size assertion. The second form's figures are premise 7's form 3: 2,999 at 200, 274 the
// most that fit (4,084), 275 past the bound (4,099). Each entry is 11 bytes, so the size moves with the count only.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HERE = path.dirname(fileURLToPath(import.meta.url));
const consent = (await import(pathToFileURL(path.join(HERE, 'consent.ts')).href)) as Mod;
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'manifest-200.json'), 'utf8')) as { entries: Array<{ sourceId: string }> };

const H = (c: string) => c.repeat(64);
const size = (value: string) => consent.CONSENT_COOKIE_NAME.length + 1 + value.length;

function cookieOf(ids: readonly string[], state = 'ask-first'): string {
  return consent.encodeConsentCookie({
    v: 2,
    flows: H('a'),
    states: Object.fromEntries(ids.map((id) => [id, { state, since: '2026-11-24', version: H('b') }])),
  });
}

test('A1: 200 sources, each with a stored state, encoded as the writers encode, fit in 4,096 bytes (2,999)', () => {
  const ids = fixture.entries.map((e) => e.sourceId);
  assert.equal(ids.length, 200, 'premise: 200 ids');
  assert.ok(ids.reduce((n, id) => n + id.length, 0) / ids.length > 20, 'premise: ids of mean length above 20');
  for (const state of ['ask-first', 'on', 'off']) {
    const bytes = size(cookieOf(ids, state));
    assert.ok(bytes <= 4096, `200 states at ${state} take ${bytes} bytes`);
    assert.equal(bytes, 2999);
  }
});

test('A1: the most that fit is 274 (4,084 bytes); 275 is past the bound, and cookieFits says so', () => {
  const ids = Array.from({ length: 275 }, (_, i) => `example-source-${String(i).padStart(3, '0')}`);
  assert.equal(size(cookieOf(ids.slice(0, 274))), 4084);
  assert.equal(size(cookieOf(ids)), 4099);
  assert.equal(typeof consent.cookieFits, 'function', 'consent.ts exports no cookieFits');
  assert.equal(consent.cookieFits(cookieOf(ids.slice(0, 274))), true);
  assert.equal(consent.cookieFits(cookieOf(ids)), false);
  assert.equal(consent.CONSENT_COOKIE_BOUND, 4096);
});

test('A1: the second form round-trips each state, its date, its version\'s first 4 bytes and its flag, and refuses what it cannot read', () => {
  const states = {
    socrata: { state: 'on', since: '2026-11-24', version: H('b'), own: true },
    'nyc-record': { state: 'off', since: '2026-01-02', version: H('c'), own: false },
    'data-commons': { state: 'ask-first', since: '1999-12-31', version: H('d') },
  };
  const value = consent.encodeConsentCookie({ v: 2, flows: H('a'), states });
  assert.match(value, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(value, 'base64url')[0], 2);
  const back = consent.decodeConsentCookie(value, ['socrata', 'nyc-record', 'data-commons']);
  assert.deepEqual(back, {
    v: 2,
    flows: H('a'),
    states: {
      socrata: { state: 'on', since: '2026-11-24', version: 'bbbbbbbb', own: true },
      'nyc-record': { state: 'off', since: '2026-01-02', version: 'cccccccc', own: false },
      // No flag in, the rule's reading out: Ask first is not set on its own.
      'data-commons': { state: 'ask-first', since: '1999-12-31', version: 'dddddddd', own: false },
    },
  });
  // An entry no id matches is kept as it is, and written back.
  const partial = consent.decodeConsentCookie(value, ['socrata']);
  assert.equal(partial.unmatched.length, 2);
  const again = consent.decodeConsentCookie(consent.encodeConsentCookie(partial), ['socrata', 'nyc-record', 'data-commons']);
  assert.deepEqual(again, back);
  // Refused: a length that is not 33 + 11k, a state byte with stray bits, two entries for one id.
  const bytes = Buffer.from(value, 'base64url');
  for (const bad of [
    bytes.subarray(0, bytes.length - 1),
    Buffer.concat([bytes.subarray(0, 33 + 8), Buffer.from([0x40]), bytes.subarray(33 + 9)]),
    Buffer.concat([bytes, bytes.subarray(33, 44)]),
  ]) {
    assert.equal(consent.decodeConsentCookie(bad.toString('base64url'), ['socrata']), null);
  }
});
