// LAYOUT-WEB W4 P1 fix 1 — the privacy page names every display choice the
// browser keeps, and the key it is kept under.
//
// THE GUARD. Every `*_STORAGE_KEY` that `src/lib/query-presentation.ts`
// exports is a `sessionStorage` key some surface writes. The privacy page's
// `browser-storage` statement must name each one as code and trace it to its
// export, and its count word must be the number of keys, so a fourth key
// cannot be added without the page saying so. The universe is the module's
// exports, read at run time, not a list in this file.
//
// RED AT THE BASE STATEMENT: at 641a82f the statement named two choices and
// two keys, while the module (since W4 P1) exports three.
//
// BLIND SPOT, stated. A key written to storage under a name that is not a
// `*_STORAGE_KEY` export of this module is not seen here.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from './query-presentation.ts';

const facts = await import('./privacy-facts.ts');

type Segment = string | { code: string } | { link: string; text: string };

function browserStorage(): { parts: Segment[]; traces: string[] } {
  const statements = facts.buildPrivacySections(null).flatMap((section) => section.statements);
  const found = statements.filter((s) => s.id === 'browser-storage');
  assert.equal(found.length, 1, 'the page has one browser-storage statement');
  return { parts: found[0].parts as Segment[], traces: found[0].traces };
}

const KEYS = Object.entries(presentation).filter(([name, value]) => /_STORAGE_KEY$/.test(name) && typeof value === 'string') as Array<[string, string]>;
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

test('W4 P1 fix 1 (F6) every storage key query-presentation exports is named in the browser-storage statement, as code, and traced', () => {
  assert.ok(KEYS.length >= 3, `premise: the module exports its storage keys (${KEYS.map(([n]) => n).join(', ')})`);
  const { parts, traces } = browserStorage();
  const codes = parts.filter((p): p is { code: string } => typeof p === 'object' && 'code' in p).map((p) => p.code);
  for (const [name, value] of KEYS) {
    assert.ok(codes.includes(value), `the statement does not name ${name} (${value})`);
    assert.ok(traces.includes(`const:src/lib/query-presentation.ts#${name}`), `the statement does not trace ${name}`);
  }
  assert.equal(codes.length, KEYS.length, 'the statement names no key the module does not export');
  const text = parts.filter((p): p is string => typeof p === 'string').join('');
  assert.ok(text.includes(`keeps ${NUMBER_WORDS[KEYS.length]} display choices`), `the statement's count is not ${NUMBER_WORDS[KEYS.length]}: ${text}`);
});

test('W4 P1 fix 1 (F6) the browser-storage statement, word for word', () => {
  const { parts, traces } = browserStorage();
  assert.deepEqual(parts, [
    'Your browser keeps three display choices for the current tab: notebook or standard mode, whether the comparison is shown, ' +
      'and which layout an answer is shown under. They are stored under ',
    { code: 'civicaitools.notebookMode' },
    ', ',
    { code: 'civicaitools.showComparison' },
    ' and ',
    { code: 'civicaitools.answerLayout' },
    '.',
  ]);
  assert.deepEqual(traces, [
    'const:src/lib/query-presentation.ts#MODE_STORAGE_KEY',
    'const:src/lib/query-presentation.ts#COMPARISON_STORAGE_KEY',
    'const:src/lib/query-presentation.ts#LAYOUT_STORAGE_KEY',
  ]);
});
