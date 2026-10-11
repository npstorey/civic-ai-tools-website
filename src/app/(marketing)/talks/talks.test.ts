// The /talks index lists every deck the deck route serves, and nothing else.
//
// The route (`[deck]/route.ts`) serves every `.html` file in `_decks/`, and
// adding a deck needs no code change. The index reads `TALKS`, so this test
// is what keeps the two sets equal: a deck with no entry would be served
// but unlisted, and an entry with no deck would link to a 404.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { TALKS } from './talks.ts';

const DECK_DIR = path.join(process.cwd(), 'src', 'app', '(marketing)', 'talks', '_decks');

test('every served deck has one TALKS entry, and every entry names a served deck', () => {
  const served = readdirSync(DECK_DIR).filter((name) => name.endsWith('.html')).sort();
  const listed = TALKS.map((talk) => talk.deck).sort();
  assert.ok(served.length > 0, `no decks found in ${DECK_DIR}`);
  assert.deepEqual(listed, served);
});

test('each entry carries a title, an event and a real ISO date', () => {
  for (const talk of TALKS) {
    assert.ok(talk.title.trim(), `${talk.deck}: title`);
    assert.ok(talk.event.trim(), `${talk.deck}: event`);
    assert.match(talk.date, /^\d{4}-\d{2}-\d{2}$/, `${talk.deck}: date`);
    assert.equal(new Date(`${talk.date}T00:00:00Z`).toISOString().slice(0, 10), talk.date, `${talk.deck}: date`);
  }
});
