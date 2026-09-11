/**
 * The skeleton's reading, in the reader's words (#416; Wave N11 #434, D7 = B).
 *
 * THE RULING. `NOTEBOOK_PROVENANCE_SIGNALS.skeleton.label` read "Skeleton
 * notebook (not executed)". "Skeleton" is the name of a code path — the
 * generator that writes a notebook from the chat transcript without running it
 * — and it fails `docs/design-principles.md` Principle 9: a reader has no reason
 * to know what a skeleton notebook is. The owner ruled the words "Analysis
 * notebook (not executed)", keeping "executed", the word the other reading and
 * the rest of the page use for running.
 *
 * WHAT THIS FILE PINS, and how.
 *   - The ruled words, once, through the constant that owns them. No other
 *     assertion here restates them: each reads the constant.
 *   - The reading a page shows for a REAL skeleton is that constant, driven from
 *     the generator through the reader `NotebookSection` renders. A hand-built
 *     `{ provenance: 'skeleton' }` would be an object this file wrote to say
 *     whatever it liked.
 *   - The two properties the ruling rests on, so that a later rewording which
 *     drops one reads as a new ruling rather than a copy edit: no code-path name
 *     in the label, and the execution axis stated in the page's own word.
 *   - The vocabulary document agrees with the code, row by row, over every value
 *     the code declares (derived from `NOTEBOOK_PROVENANCE_VALUES`, not from a
 *     list of rows written here), and no longer calls either value reserved.
 *
 * WHAT IS NOT PINNED HERE. The stamp VALUE `skeleton` is a different thing: it
 * is in a package's signed bytes and the label is not. That was measured for
 * this change by building a datHere package from a real skeleton — the bytes
 * carry `"provenance":"skeleton"` and neither wording of the label, and the
 * notebook's content hash was the same before and after the label moved. The
 * value belongs to the vocabulary and is unchanged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NOTEBOOK_PROVENANCE_EXECUTED,
  NOTEBOOK_PROVENANCE_SIGNALS,
  NOTEBOOK_PROVENANCE_SKELETON,
  NOTEBOOK_PROVENANCE_VALUES,
  type NotebookProvenance,
} from './trust-signal.ts';
import { readNotebookProvenanceOfNotebook } from '../notebook-author/notebook-provenance-reading.ts';
import { generateNotebook } from '../notebook.ts';
import type { ToolCall } from '../../hooks/useStreamingComparison.ts';

const VOCABULARY = fileURLToPath(new URL('../../../docs/trust-signal-vocabulary.md', import.meta.url));

const SKELETON = NOTEBOOK_PROVENANCE_SIGNALS[NOTEBOOK_PROVENANCE_SKELETON];
const EXECUTED = NOTEBOOK_PROVENANCE_SIGNALS[NOTEBOOK_PROVENANCE_EXECUTED];

test('D7 = B: the skeleton reading is "Analysis notebook (not executed)"', () => {
  assert.equal(
    SKELETON.label,
    'Analysis notebook (not executed)',
    'the owner ruled these words (#434, D7 = B). A change to them is a new ruling, not a copy edit',
  );
  assert.equal(SKELETON.tier, 'normal', 'a skeleton is not a failure, and the tier is where a surface would learn otherwise');
});

test('the reading a page shows for a real skeleton is the vocabulary\'s label, driven from the generator', () => {
  const portal = 'data.example.gov';
  const notebook = generateNotebook(
    'How many permits were filed last year?',
    portal,
    [
      { name: 'get_data', args: { type: 'query', portal, dataset_id: 'abcd-efab', select: 'count(*)' } },
    ] as unknown as ToolCall[],
    'About 1,200 permits were filed.',
    { origin: null, host: null, platformTitle: null },
  );
  const reading = readNotebookProvenanceOfNotebook(notebook);
  assert.equal(
    reading.state,
    NOTEBOOK_PROVENANCE_SKELETON,
    'fixture premise: the generator stamps what it wrote as a skeleton — without that, the label below is never reached',
  );
  assert.equal(reading.label, SKELETON.label, 'NotebookSection renders this reading\'s label; it must be the vocabulary\'s');
  assert.equal(reading.detail, SKELETON.detail);
});

test('the label names no code path, and states the execution axis in the page\'s own word', () => {
  assert.doesNotMatch(
    SKELETON.label,
    new RegExp(NOTEBOOK_PROVENANCE_SKELETON, 'i'),
    `"${NOTEBOOK_PROVENANCE_SKELETON}" is the generator's name for itself, implementation language a reader ` +
      'cannot decode (design-principles Principle 9, #416)',
  );
  assert.match(SKELETON.label, /\bnot executed\b/, 'the reading states that the notebook did not run');
  assert.match(
    EXECUTED.label,
    /\bexecuted\b/i,
    'and "executed" is the word the other reading uses for running — the reason D7 kept it. If this ' +
      'fails, the two readings no longer share an axis and the ruling needs revisiting, not this test',
  );
});

/** The `notebookProvenance` section of the vocabulary document: its heading up to the next heading. */
function notebookProvenanceSection(doc: string): string {
  const start = doc.indexOf('### notebookProvenance');
  assert.ok(start >= 0, 'docs/trust-signal-vocabulary.md has no notebookProvenance section — re-anchor this test');
  const next = doc.indexOf('\n#', start + 1);
  return doc.slice(start, next === -1 ? undefined : next);
}

test('the vocabulary document states the code\'s vocabulary, row by row, and calls neither value reserved', () => {
  const section = notebookProvenanceSection(readFileSync(VOCABULARY, 'utf8'));
  const rows = [...section.matchAll(/^\| `([^`]+)` \| (\w+) \| (.+?) \|$/gm)].map((m) => ({
    value: m[1],
    tier: m[2],
    copy: m[3],
  }));
  assert.deepEqual(
    rows.map((r) => r.value).sort(),
    [...NOTEBOOK_PROVENANCE_VALUES].sort(),
    'one row per value the code declares, and no row for a value it does not',
  );
  for (const row of rows) {
    const signal = NOTEBOOK_PROVENANCE_SIGNALS[row.value as NotebookProvenance];
    assert.equal(row.copy, signal.label, `the \`${row.value}\` row's copy is not the label the page renders`);
    assert.equal(row.tier.toLowerCase(), signal.tier, `the \`${row.value}\` row's tier is not the code's`);
  }
  assert.doesNotMatch(
    section,
    /\breserved\b/i,
    'both values are written — the executed pipeline stamps one and the skeleton generator the other (#401) — ' +
      'so the vocabulary must not call either reserved',
  );
});
